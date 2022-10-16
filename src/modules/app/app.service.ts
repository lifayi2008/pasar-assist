import {
  BadRequestException,
  CACHE_MANAGER,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';
import { Web3Service } from '../utils/web3.service';
import { ConfigService } from '@nestjs/config';
import { DbService } from '../database/db.service';
import { Constants } from '../../constants';
import { InjectConnection } from '@nestjs/mongoose';
import { Connection } from 'mongoose';
import { Cache } from 'cache-manager';
import { OrderEventType, OrderState, OrderType } from '../tasks/interfaces';
import { QueryLatestBidsDTO } from './dto/QueryLatestBidsDTO';
import { Chain } from '../utils/enums';
import { ConfigContract } from '../../config/config.contract';
import { TOKEN721_ABI } from '../../contracts/Token721ABI';

@Injectable()
export class AppService {
  private logger = new Logger('AppService');

  constructor(
    private web3Service: Web3Service,
    private configService: ConfigService,
    private dbService: DbService,
    @InjectConnection() private readonly connection: Connection,
    @Inject(CACHE_MANAGER) private cacheManager: Cache,
  ) {}

  async check() {
    return { status: HttpStatus.OK, message: Constants.MSG_SUCCESS };
  }

  // async getCollectibleByTokenId(tokenId: string) {
  //   const data = await this.connection.collection('tokens').findOne({ tokenId });
  //
  //   if (data) {
  //     const authorData = await this.cacheManager.get(data.royaltyOwner.toLowerCase());
  //     if (authorData) {
  //       data.authorAvatar = JSON.parse(authorData as string).avatar;
  //     }
  //
  //     const ownerData = await this.cacheManager.get(data.tokenOwner.toLowerCase());
  //     if (ownerData) {
  //       data.holderName = JSON.parse(ownerData as string).name;
  //     }
  //   }
  //
  //   return { status: HttpStatus.OK, message: Constants.MSG_SUCCESS, data };
  // }

  async getTokenOrderByTokenId(tokenId: string) {
    const result = await this.connection
      .collection('tokens')
      .aggregate([
        { $match: { tokenId } },
        {
          $lookup: {
            from: 'token_events',
            let: { tokenId: '$tokenId' },
            pipeline: [
              {
                $match: { $expr: { $eq: ['$tokenId', '$$tokenId'] }, from: Constants.BURN_ADDRESS },
              },
              { $sort: { blockNumber: -1 } },
              { $group: { _id: '$tokenId', doc: { $first: '$$ROOT' } } },
              { $replaceRoot: { newRoot: '$doc' } },
              { $project: { _id: 0, transactionHash: 1 } },
            ],
            as: 'tokenEvent',
          },
        },
        { $unwind: { path: '$tokenEvent', preserveNullAndEmptyArrays: true } },
        {
          $lookup: {
            from: 'orders',
            let: { tokenId: '$tokenId' },
            pipeline: [
              { $sort: { createTime: -1 } },
              { $group: { _id: '$tokenId', doc: { $first: '$$ROOT' } } },
              { $replaceRoot: { newRoot: '$doc' } },
              { $match: { $expr: { $eq: ['$tokenId', '$$tokenId'] } } },
              { $project: { _id: 0, tokenId: 0 } },
            ],
            as: 'order',
          },
        },
        { $unwind: { path: '$order', preserveNullAndEmptyArrays: true } },
      ])
      .toArray();

    let data;
    if (result.length > 0) {
      data = result[0];
      const authorData = await this.cacheManager.get(data.royaltyOwner.toLowerCase());
      if (authorData) {
        data.authorAvatar = JSON.parse(authorData as string).avatar;
      }
    } else {
      data = {} as any;
    }

    return { status: HttpStatus.OK, message: Constants.MSG_SUCCESS, data };
  }

  async getLatestBids(dto: QueryLatestBidsDTO) {
    const order = await this.connection
      .collection('orders')
      .findOne(
        { tokenId: dto.tokenId, orderType: OrderType.Auction },
        { sort: { createTime: -1 } },
      );

    if (!order) {
      throw new BadRequestException('No auction order found');
    }

    const filter = { orderId: order.orderId, eventType: OrderEventType.OrderBid };

    const total = await this.connection.collection('order_events').count(filter);
    let data = [];

    if (total > 0) {
      data = await this.connection
        .collection('order_events')
        .find(filter)
        .sort({ blockNumber: -1 })
        .project({ _id: 0, transactionHash: 0 })
        .skip((dto.pageNum - 1) * dto.pageSize)
        .limit(dto.pageSize)
        .toArray();

      for (const item of data) {
        const userData = await this.cacheManager.get(item.buyer.toLowerCase());
        if (userData) {
          item.buyerName = JSON.parse(userData as string).name;
        }
      }
    }

    return { status: HttpStatus.OK, message: Constants.MSG_SUCCESS, data: { total, data } };
  }

  async getTransHistoryByTokenId(tokenId: string) {
    const data = await this.connection
      .collection('orders')
      .aggregate([
        { $match: { tokenId } },
        { $sort: { updateTime: -1 } },
        {
          $lookup: {
            from: 'order_events',
            localField: 'orderId',
            foreignField: 'orderId',
            as: 'events',
          },
        },
        {
          $project: {
            _id: 0,
            'events._id': 0,
            'events.tokenId': 0,
            tokenId: 0,
            quoteToken: 0,
            royaltyOwner: 0,
            royaltyFee: 0,
            sellerUri: 0,
            buyerUri: 0,
            platformFee: 0,
            platformAddr: 0,
          },
        },
      ])
      .toArray();

    return { status: HttpStatus.OK, message: Constants.MSG_SUCCESS, data };
  }

  async getEarnedByAddress(address: string, isToday: boolean, isReturnList: boolean) {
    const match = {
      orderState: OrderState.Filled,
      $or: [{ royaltyOwner: address }, { sellerAddr: address }],
    };

    if (isToday) {
      match['updateTime'] = {
        $gte: new Date().setHours(0, 0, 0) / 1000,
        $lte: new Date().setHours(23, 59, 59) / 1000,
      };
    }

    const items = await this.connection
      .collection('orders')
      .aggregate([
        { $match: match },
        {
          $lookup: {
            from: 'tokens',
            localField: 'tokenId',
            foreignField: 'tokenId',
            as: 'token',
          },
        },
        { $unwind: { path: '$token' } },
        {
          $project: {
            _id: 0,
            orderType: 1,
            orderState: 1,
            price: 1,
            sellerAddr: 1,
            filled: 1,
            royaltyOwner: 1,
            royaltyFee: 1,
            platformFee: 1,
            updateTime: 1,
            'token.name': 1,
            'token.data.thumbnail': 1,
          },
        },
        { $sort: { updateTime: -1 } },
      ])
      .toArray();

    if (isReturnList) {
      return { status: HttpStatus.OK, message: Constants.MSG_SUCCESS, data: items };
    }

    let data = 0;
    items.forEach((item) => {
      if (item.royaltyOwner === address) {
        if (item.sellerAddr === address) {
          data += (item.orderType === OrderType.Sale ? item.price : item.filled) - item.platformFee;
        } else {
          data += item.royaltyFee;
        }
      } else {
        data +=
          (item.orderType === OrderType.Sale ? item.price : item.filled) -
          item.platformFee -
          item.royaltyFee;
      }
    });

    return { status: HttpStatus.OK, message: Constants.MSG_SUCCESS, data };
  }

  async getTokenPriceHistory(tokenId: string) {
    const data = await this.connection
      .collection('orders')
      .find({ tokenId, orderState: OrderState.Filled })
      .sort({ updateTime: 1 })
      .project({ _id: 0, updateTime: 1, price: '$filled' })
      .toArray();

    return { status: HttpStatus.OK, message: Constants.MSG_SUCCESS, data };
  }

  async test() {
    // this.web3Service.web3RPC.eth.getBlockNumber().then((number) => {
    //   console.log(number);
    //   console.log(typeof number);
    // });
    // const result = await this.web3Service.web3BatchRequest([
    //   {
    //     method: this.web3Service.metContractRPC.methods.tokenInfo(
    //       '103244789162639796336139546484767475042549830186784659157413781488168484689769',
    //     ).call,
    //     params: {},
    //   },
    // ]);
    // console.log(result);
    // this.web3Service.metMarketContractRPC.methods.getOrderById(196).call({}).then(console.log);
    //   this.web3Service.metMarketContractWS.events
    //     .OrderTakenDown({
    //       fromBlock: 0,
    //     })
    //     .on('data', console.log);
    // this.web3Service.registerContractWS[Chain.FSN]
    //   .getPastEvents('TokenRegistered', {
    //     fromBlock: AppConfig[this.configService.get('NETWORK')][Chain.FSN].registerContractDeploy,
    //     toBlock: 'latest',
    //   })
    //   .then(console.log);

    const fromBlock =
      ConfigContract[this.configService.get('NETWORK')][Chain.ELA].registerContractDeploy;
    //
    // this.web3Service.stickerContractWS['V1']
    //   .getPastEvents('TransferSingle', {
    //     fromBlock,
    //     toBlock: fromBlock + 100000,
    //   })
    //   .then(console.log);

    // this.web3Service.pasarContractRPC[Chain.ELA].methods.getOrderById(124).call().then(console.log);
    // this.web3Service.registerContractWS[Chain.ELA]
    //   .getPastEvents('TokenRegistered', {
    //     fromBlock,
    //     toBlock: 'latest',
    //   })
    //   .then(console.log);
    // this.web3Service.stickerContractRPC[Chain.ELA].methods
    //   .tokenInfo('81208071140106897041126415054316348139610899416969546386452189101997683463193')
    //   .call()
    //   .then(console.log);
    // this.web3Service.registerContractRPC[Chain.ELA].methods
    //   .tokenInfo('0xE27934fB3683872e35b8d9E57c30978e1260c614')
    //   .call()
    //   .then(console.log);

    // const tokenContract = new this.web3Service.web3RPC[Chain.ELA].eth.Contract(
    //   TOKEN721_ABI,
    //   '0xcB262A92e2E3c8C3590b72A1fDe3c6768EE08B7e',
    // );
    // tokenContract.methods.tokenURI(1).call().then(console.log);

    // axios('https://gateway.pinata.cloud/ipfs/QmS9obSyBypporHKvvJTrcymGD21dmz8ofPz73AwyYc1vU').then(
    //   (result) => {
    //     console.log(result.data);
    //   },
    // );

    // await tokenContract.methods.symbol().call().then(console.log);
    // await tokenContract.methods.supportsInterface('0x80ac58cd').call().then(console.log);
    // await tokenContract.methods.supportsInterface('0xd9b67a26').call().then(console.log);

    // const tokenContract = new this.web3Service.web3WS[Chain.ELA].eth.Contract(
    //   TOKEN721_ABI,
    //   '0xcB262A92e2E3c8C3590b72A1fDe3c6768EE08B7e',
    // );
    //
    // tokenContract
    //   .getPastEvents('Transfer', {
    //     fromBlock: 0,
    //     toBlock: 'latest',
    //   })
    //   .then(console.log);
  }

  async getDidByAddress(address: string) {
    const data = await this.connection.collection('users').findOne({ address });
    return { status: HttpStatus.OK, message: Constants.MSG_SUCCESS, data };
  }

  async listStickers(pageNum: number, pageSize: number, timeOrder: number) {
    const total = await this.connection
      .collection('tokens')
      .countDocuments({ tokenOwner: { $ne: Constants.BURN_ADDRESS } });
    const result = await this.connection
      .collection('tokens')
      .aggregate([
        { $match: { tokenOwner: { $ne: Constants.BURN_ADDRESS } } },
        {
          $lookup: {
            from: 'orders',
            let: { tokenId: '$tokenId', chain: '$chain', contract: '$contract' },
            pipeline: [
              {
                $match: {
                  $expr: {
                    $and: [
                      { $eq: ['$tokenId', '$$tokenId'] },
                      { $eq: ['$chain', '$$chain'] },
                      { $eq: ['$contract', '$$contract'] },
                    ],
                  },
                },
              },
              { $sort: { blockNumber: -1 } },
              { $group: { _id: '$tokenId', doc: { $first: '$$ROOT' } } },
              { $replaceRoot: { newRoot: '$doc' } },
            ],
            as: 'orders',
          },
        },
        { $sort: { createTime: timeOrder } },
        { $skip: (pageNum - 1) * pageSize },
        { $limit: pageSize },
      ])
      .toArray();

    return { status: HttpStatus.OK, message: Constants.MSG_SUCCESS, data: { result, total } };
  }

  async search(keyword: string) {
    const result = await this.connection
      .collection('tokens')
      .aggregate([
        {
          $match: {
            $or: [
              { tokenId: keyword },
              { tokenIdHex: keyword },
              { royaltyOwner: keyword },
              { name: { $regex: keyword } },
              { description: { $regex: keyword } },
            ],
          },
        },
        {
          $lookup: {
            from: 'orders',
            let: { tokenId: '$tokenId', chain: '$chain', contract: '$contract' },
            pipeline: [
              {
                $match: {
                  $expr: {
                    $and: [
                      { $eq: ['$tokenId', '$$tokenId'] },
                      { $eq: ['$chain', '$$chain'] },
                      { $eq: ['$contract', '$$contract'] },
                    ],
                  },
                },
              },
              { $sort: { blockNumber: -1 } },
              { $group: { _id: '$tokenId', doc: { $first: '$$ROOT' } } },
              { $replaceRoot: { newRoot: '$doc' } },
            ],
            as: 'orders',
          },
        },
      ])
      .toArray();

    return { status: HttpStatus.OK, message: Constants.MSG_SUCCESS, data: result };
  }

  async listTrans(pageNum: number, pageSize: number, timeOrder: number) {
    const total = await this.connection.collection('token_events').countDocuments();
    const result = await this.connection
      .collection('token_events')
      .aggregate([
        {
          $lookup: {
            from: 'tokens',
            let: { tokenId: '$tokenId', chain: '$chain', contract: '$contract' },
            pipeline: [
              {
                $match: {
                  $expr: {
                    $and: [
                      { $eq: ['$tokenId', '$$tokenId'] },
                      { $eq: ['$chain', '$$chain'] },
                      { $eq: ['$contract', '$$contract'] },
                    ],
                  },
                },
              },
            ],
            as: 'token',
          },
        },
        { $sort: { blockNumber: timeOrder } },
        { $skip: (pageNum - 1) * pageSize },
        { $limit: pageSize },
      ])
      .toArray();

    return { status: HttpStatus.OK, message: Constants.MSG_SUCCESS, data: { result, total } };
  }

  async nftNumber() {
    const data = await this.connection
      .collection('tokens')
      .countDocuments({ tokenOwner: { $ne: Constants.BURN_ADDRESS } });

    return { status: HttpStatus.OK, message: Constants.MSG_SUCCESS, data };
  }

  async relatedNftNumber() {
    const countTokens = await this.connection.collection('token_events').countDocuments();
    const countOrders = await this.connection.collection('order_events').countDocuments();
    const data = countTokens + countOrders;

    return { status: HttpStatus.OK, message: Constants.MSG_SUCCESS, data };
  }

  async ownerAddressNumber() {
    const data = await this.connection
      .collection('tokens')
      .distinct('tokenOwner')
      .then((res) => res.length);

    return { status: HttpStatus.OK, message: Constants.MSG_SUCCESS, data };
  }

  //TODO: need to change logic here, find all filled orders then calculate the total amount is not a good idea; this value should be calculated when order is filled
  async getTotalVolume() {
    const result = await this.connection
      .collection('orders')
      .find({ orderState: OrderState.Filled })
      .toArray();

    const tokenRates = await this.connection.collection('token_rates').find().toArray();
    const rates = {};
    tokenRates.forEach((item) => {
      rates[item.chain][item.token] = item.rate;
    });

    let total = 0;
    result.forEach((item) => {
      let rate = 1;
      if (item.quoteToken && item.quoteToken !== Constants.BURN_ADDRESS) {
        rate = rates[item.chain][item.quoteToken];
      }
      const amount = item.amount ? item.amount : 1;
      total += (amount * item.price * rate) / Constants.ELA_ESC_PRECISION;
    });

    return { status: HttpStatus.OK, message: Constants.MSG_SUCCESS, data: total };
  }

  async getNftPriceByTokenId(tokenId: string, baseToken: string) {
    const data = await this.connection
      .collection('tokens')
      .find({ tokenId, baseToken, orderState: OrderState.Filled })
      .sort({ createTime: 1 })
      .toArray();

    return { status: HttpStatus.OK, message: Constants.MSG_SUCCESS, data };
  }

  async getTranDetailsByTokenId(tokenId: string, baseToken: string, timeOrder: number) {
    const data = await this.connection
      .collection('orders')
      .aggregate([
        { $match: { tokenId, baseToken } },
        {
          $lookup: {
            from: 'tokens',
            let: { tokenId: '$tokenId', chain: '$chain', baseToken: '$contract' },
            pipeline: [
              {
                $match: {
                  $expr: {
                    $and: [
                      { $eq: ['$tokenId', '$$tokenId'] },
                      { $eq: ['$chain', '$$chain'] },
                      { $eq: ['$contract', '$$baseToken'] },
                    ],
                  },
                },
              },
            ],
            as: 'token',
          },
        },
        {
          $lookup: {
            from: 'order_events',
            let: { orderId: '$orderId', chain: '$chain' },
            pipeline: [
              {
                $match: {
                  $expr: {
                    $and: [{ $eq: ['$orderId', '$$orderId'] }, { $eq: ['$chain', '$$chain'] }],
                  },
                },
              },
            ],
            as: 'events',
          },
        },
      ])
      .toArray();

    return { status: HttpStatus.OK, message: Constants.MSG_SUCCESS, data };
  }

  async getCollectibleByTokenId(tokenId: string, baseToken: string) {
    const data = await this.connection
      .collection('tokens')
      .findOne({ tokenId, contract: baseToken });
    return { status: HttpStatus.OK, message: Constants.MSG_SUCCESS, data };
  }

  async getTotalRoyaltyAndTotalSaleByWalletAddr(walletAddr: string) {
    const result = await this.connection
      .collection('orders')
      .find({
        orderState: OrderState.Filled,
        $or: [
          { sellAddr: walletAddr },
          { royaltyOwner: walletAddr },
          { royaltyOwners: { $elemMatch: { $eq: walletAddr } } },
        ],
      })
      .toArray();

    return { status: HttpStatus.OK, message: Constants.MSG_SUCCESS, data: result };
  }

  async getStatisticDataByWalletAddr(walletAddr: string) {
    const assets = await this.connection
      .collection('tokens')
      .countDocuments({ tokenOwner: walletAddr });

    const sold = await this.connection
      .collection('orders')
      .countDocuments({ sellAddr: walletAddr, orderState: OrderState.Filled });

    const purchased = await this.connection
      .collection('orders')
      .countDocuments({ buyerAddr: walletAddr, orderState: OrderState.Filled });

    const transactions = await this.connection
      .collection('token_events')
      .countDocuments({ $or: [{ from: walletAddr }, { to: walletAddr }] });

    return {
      status: HttpStatus.OK,
      message: Constants.MSG_SUCCESS,
      data: { assets, sold, purchased, transactions },
    };
  }

  async listCollectibles(pageNum: number, pageSize: number, type: string, after: number) {
    const match = {};
    if (type !== '') {
      match['$or'] = [];
      const types = type.split(',');

      if (types.includes('minted')) {
        match['$or'].push({ order: { $exists: false } });
      }
      if (types.includes('listed')) {
        match['$or'].push({ 'order.orderState': OrderState.Created });
      }
      if (types.includes('sale')) {
        match['$or'].push({ 'order.orderState': OrderState.Filled });
      }
      if (match['$or'].length === 0 || match['$or'].length === 3) {
        delete match['$or'];
      }
    }

    if (after > 0) {
      match['createTime'] = { $gt: after };
    }

    const pipeline = [
      {
        $lookup: {
          from: 'orders',
          let: { tokenId: '$tokenId', chain: '$chain', contract: '$contract' },
          pipeline: [
            {
              $match: {
                $expr: {
                  $and: [
                    { $eq: ['$tokenId', '$$tokenId'] },
                    { $eq: ['$chain', '$$chain'] },
                    { $eq: ['$contract', '$$contract'] },
                  ],
                },
              },
            },
            { $sort: { createTime: -1 } },
            { $group: { _id: '$tokenId', doc: { $first: '$$ROOT' } } },
            { $replaceRoot: { newRoot: '$doc' } },
          ],
          as: 'order',
        },
      },
      { $unwind: { path: '$order', preserveNullAndEmptyArrays: true } },
    ] as any;

    if (Object.keys(match).length > 0) {
      pipeline.push({ $match: match });
    }

    const result = await this.connection
      .collection('orders')
      .aggregate([...pipeline, { $count: 'total' }])
      .toArray();

    const total = result.length > 0 ? result[0].total : 0;
    let data = [];

    if (total > 0) {
      data = await this.connection
        .collection('tokens')
        .aggregate([
          ...pipeline,
          { $sort: { 'order.createTime': -1, createTime: -1 } },
          { $skip: (pageNum - 1) * pageSize },
          { $limit: pageSize },
        ])
        .toArray();
    }

    return { status: HttpStatus.OK, message: Constants.MSG_SUCCESS, data: { data, total } };
  }
}
