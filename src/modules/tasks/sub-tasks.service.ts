import { Injectable, Logger } from '@nestjs/common';
import {
  ContractOrderInfo,
  ContractTokenInfo,
  ContractUserInfo,
  IPFSCollectionInfo,
  IPFSTokenInfo,
  UpdateCollectionParams,
} from './interfaces';
import { InjectConnection } from '@nestjs/mongoose';
import { Connection } from 'mongoose';
import { ConfigService } from '@nestjs/config';
import { getTokenInfoModel } from '../common/models/TokenInfoModel';
import axios from 'axios';
import { getOrderInfoModel } from '../common/models/OrderInfoModel';
import { DbService } from '../database/db.service';
import { UpdateOrderParams } from '../database/interfaces';
import { Sleep } from '../utils/utils.service';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { Chain } from '../utils/enums';
import { Web3Service } from '../utils/web3.service';
import { TOKEN721_ABI } from '../../contracts/Token721ABI';
import { TOKEN1155_ABI } from '../../contracts/Token1155ABI';
import { AppConfig } from '../../app-config';
import { getTokenEventModel } from '../common/models/TokenEventModel';

@Injectable()
export class SubTasksService {
  private readonly logger = new Logger('SubTasksService');

  constructor(
    private configService: ConfigService,
    private dbService: DbService,
    private web3Service: Web3Service,
    @InjectConnection() private readonly connection: Connection,
    @InjectQueue('order-data-queue-local') private orderDataQueueLocal: Queue,
    @InjectQueue('token-data-queue-local') private tokenDataQueueLocal: Queue,
    @InjectQueue('collection-data-queue-local') private collectionDataQueueLocal: Queue,
  ) {}

  private async getInfoByIpfsUri(
    ipfsUri: string,
  ): Promise<IPFSTokenInfo | ContractUserInfo | IPFSCollectionInfo> {
    const tokenCID = ipfsUri.split(':')[2];

    try {
      const response = await axios(this.configService.get('IPFS_GATEWAY') + tokenCID);
      return (await response.data) as IPFSTokenInfo;
    } catch (err) {
      this.logger.error(err);
    }
  }

  async dealWithNewToken(tokenInfo: ContractTokenInfo, blockNumber: number) {
    const ipfsTokenInfo = (await this.getInfoByIpfsUri(tokenInfo.tokenUri)) as IPFSTokenInfo;

    const TokenInfoModel = getTokenInfoModel(this.connection);
    await TokenInfoModel.findOneAndUpdate(
      { tokenId: tokenInfo.tokenId },
      {
        tokenIdHex: '0x' + BigInt(tokenInfo.tokenId).toString(16),
        ...tokenInfo,
        ...ipfsTokenInfo,
        tokenOwner: tokenInfo.royaltyOwner,
        blockNumber,
      },
      {
        upsert: true,
      },
    );
  }

  async dealWithNewOrder(orderInfo: ContractOrderInfo) {
    let ipfsUserInfo;
    if (orderInfo.chain !== Chain.V1) {
      ipfsUserInfo = await this.getInfoByIpfsUri(orderInfo.sellerUri);
    }

    const OrderInfoModel = getOrderInfoModel(this.connection);
    const orderInfoDoc = new OrderInfoModel({
      ...orderInfo,
      sellerInfo: ipfsUserInfo,
      tokenIdHex: '0x' + BigInt(orderInfo.tokenId).toString(16),
    });

    await orderInfoDoc.save();
  }

  async updateTokenOwner(tokenId: string, to: string) {
    const result = await this.dbService.updateTokenOwner(tokenId, to);
    if (result.matchedCount === 0) {
      this.logger.warn(`Token ${tokenId} is not exist yet, put the operation into the queue`);
      await Sleep(1000);
      await this.tokenDataQueueLocal.add(
        'update-token-owner',
        { tokenId, to },
        { removeOnComplete: true },
      );
    }
  }

  async updateOrder(orderId: number, params: UpdateOrderParams) {
    if (params.buyerUri) {
      params.buyerInfo = (await this.getInfoByIpfsUri(params.buyerUri)) as ContractUserInfo;
    }

    const result = await this.dbService.updateOrder(orderId, params);
    if (result.matchedCount === 0) {
      this.logger.warn(`Order ${orderId} is not exist yet, put the operation into the queue`);
      await Sleep(1000);
      await this.orderDataQueueLocal.add(
        'update-order',
        { orderId, params },
        { removeOnComplete: true },
      );
    }
  }

  async updateCollection(token: string, chain: Chain, params: UpdateCollectionParams) {
    const collection = { token, ...params };
    if (params.uri && params.uri.split(':')[0] === 'pasar') {
      const ipfsCollectionInfo = (await this.getInfoByIpfsUri(params.uri)) as IPFSCollectionInfo;
      Object.assign(collection, ipfsCollectionInfo);
    }

    const result = await this.dbService.updateCollection(token, chain, collection);
    if (result.upsertedCount === 0 && result.matchedCount === 0) {
      this.logger.warn(`Collection ${token} is not exist yet, put the operation into the queue`);
      await Sleep(1000);
      await this.collectionDataQueueLocal.add(
        'update-collection',
        { token, chain, params },
        { removeOnComplete: true },
      );
    }
  }

  checkIsBaseCollection(token: string, chain: Chain) {
    return (
      AppConfig[this.configService.get('NETWORK')][chain].stickerContract === token ||
      AppConfig[this.configService.get('NETWORK')][Chain.V1].stickerContract === token
    );
  }

  async startupSyncCollection(token: string, chain: Chain, blockNumber: number, is721: boolean) {
    const ABI = is721 ? TOKEN721_ABI : TOKEN1155_ABI;
    const event = is721 ? 'Transfer' : 'TransferSingle';
    const contractWs = new this.web3Service.web3WS[chain].eth.Contract(ABI, token);
    contractWs.events[event]({
      fromBlock: 0,
    })
      .on('error', (error) => {
        this.logger.error(error);
      })
      .on('data', async (event) => {
        this.logger.log(`=============Collection ${token} event ${JSON.stringify(event)} received`);
        await this.dealWithUserCollectionToken(event, token, chain, is721);
      });
  }

  private async dealWithUserCollectionToken(event, contract: string, chain: Chain, is721: boolean) {
    const tokenId = is721 ? event.returnValues._tokenId : event.returnValues._id;
    const contractRPC = new this.web3Service.web3RPC[chain].eth.Contract(
      is721 ? TOKEN721_ABI : TOKEN1155_ABI,
      contract,
    );
    const method = is721
      ? contractRPC.methods.tokenURI(tokenId).call
      : contractRPC.methods.uri(tokenId).call;

    const [blockInfo, tokenUri] = await this.web3Service.web3BatchRequest(
      [
        ...this.web3Service.getBaseBatchRequestParam(event, chain),
        {
          method: method,
          params: {},
        },
      ],
      chain,
    );

    const eventInfo = {
      blockNumber: event.blockNumber,
      transactionHash: event.transactionHash,
      from: event.returnValues._from,
      to: event.returnValues._to,
      tokenId,
      operator: event.returnValues._operator,
      value: is721 ? 1 : parseInt(event.returnValues._value),
      chain,
      contract,
      gasFee: blockInfo.gasUsed,
      timestamp: blockInfo.timestamp,
    };

    const TokenEventModel = getTokenEventModel(this.connection);
    const tokenEvent = new TokenEventModel(eventInfo);
    await tokenEvent.save();

    const tokenInfo = {
      tokenId,
      tokenUri,
      tokenOwner: event.returnValues._to,
      tokenIdHex: '0x' + BigInt(tokenId).toString(16),
      chain,
      contract,
      blockNumber: event.blockNumber,
      createTime: blockInfo.timestamp,
      updateTime: blockInfo.timestamp,
      notGetDetail: true,
    };

    await this.dbService.insertToken(tokenInfo);
  }

  public async getTokenInfoByUri(uri: string) {
    if (uri.startsWith('pasar:json') || uri.startsWith('feeds:json')) {
      return await this.getInfoByIpfsUri(uri);
    }

    if (uri.startsWith('https://')) {
      return (await axios(uri)).data;
    }

    if (uri.startsWith('ipfs://')) {
      const ipfsHash = uri.split('ipfs://')[1];
      const ipfsUri = this.configService.get('IPFS_GATEWAY') + ipfsHash;
      return (await axios(ipfsUri)).data;
    }

    return null;
  }
}
