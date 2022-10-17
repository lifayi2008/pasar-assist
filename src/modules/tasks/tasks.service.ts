import { Injectable, Logger } from '@nestjs/common';
import { DbService } from '../database/db.service';
import { Web3Service } from '../utils/web3.service';
import { InjectConnection } from '@nestjs/mongoose';
import { Connection } from 'mongoose';
import { getTokenEventModel } from '../common/models/TokenEventModel';
import { Constants } from '../../constants';
import { SubTasksService } from './sub-tasks.service';
import { CollectionEventType, ContractTokenInfo, OrderEventType, OrderState } from './interfaces';
import { ConfigService } from '@nestjs/config';
import { getOrderEventModel } from '../common/models/OrderEventModel';
import { Sleep } from '../utils/utils.service';
import { Chain } from '../utils/enums';
import Web3 from 'web3';
import { ConfigContract } from '../../config/config.contract';
import { Timeout } from '@nestjs/schedule';
import { getCollectionEventModel } from '../common/models/CollectionEventModel';
import { TOKEN721_ABI } from '../../contracts/Token721ABI';

@Injectable()
export class TasksService {
  private readonly logger = new Logger('TasksService');

  private readonly step = 5000;
  private readonly stepInterval = 1000 * 10;
  private readonly chain = Chain.ELA;
  private readonly rpc = this.web3Service.web3RPC[this.chain];
  private readonly stickerContract =
    ConfigContract[this.configService.get('NETWORK')][this.chain].stickerContract;
  private readonly pasarContract =
    ConfigContract[this.configService.get('NETWORK')][this.chain].pasarContract;
  private readonly registerContract =
    ConfigContract[this.configService.get('NETWORK')][this.chain].registerContract;
  private readonly stickerContractWS = this.web3Service.stickerContractWS[this.chain];
  private readonly stickerContractRPC = this.web3Service.stickerContractRPC[this.chain];
  private readonly pasarContractWS = this.web3Service.pasarContractWS[this.chain];
  private readonly pasarContractRPC = this.web3Service.pasarContractRPC[this.chain];
  private readonly registerContractWS = this.web3Service.registerContractWS[this.chain];

  constructor(
    private subTasksService: SubTasksService,
    private configService: ConfigService,
    private dbService: DbService,
    private web3Service: Web3Service,
    @InjectConnection() private readonly connection: Connection,
  ) {}

  @Timeout('transfer', 1000)
  async handleTransferEvent() {
    const nowHeight = await this.rpc.eth.getBlockNumber();
    const lastHeight = await this.dbService.getTokenEventLastHeight(
      this.chain,
      this.stickerContract,
    );

    let syncStartBlock = lastHeight;

    if (nowHeight - lastHeight > this.step + 1) {
      syncStartBlock = nowHeight;

      let fromBlock = lastHeight + 1;
      let toBlock = fromBlock + this.step;
      while (fromBlock <= nowHeight) {
        this.logger.log(`Sync past Transfer events from [${fromBlock}] to [${toBlock}]`);

        this.stickerContractWS
          .getPastEvents('TransferSingle', {
            fromBlock,
            toBlock,
          })
          .then((events) => {
            events.forEach(async (event) => {
              await this.handleTransferEventData(event);
            });
          });
        fromBlock = toBlock + 1;
        toBlock = fromBlock + this.step > nowHeight ? nowHeight : toBlock + this.step;
        await Sleep(this.stepInterval);
      }

      this.logger.log(
        `Sync past Transfer events from [${lastHeight + 1}] to [${nowHeight}] finished ✅☕🚾️`,
      );
    }

    this.logger.log(`Start sync Transfer events from [${syncStartBlock + 1}] 💪💪💪 `);

    this.stickerContractWS.events
      .TransferSingle({
        fromBlock: syncStartBlock + 1,
      })
      .on('error', (error) => {
        this.logger.error(error);
      })
      .on('data', async (event) => {
        await this.handleTransferEventData(event);
      });
  }

  private async handleTransferEventData(event: any) {
    const eventInfo = {
      blockNumber: event.blockNumber,
      transactionHash: event.transactionHash,
      from: event.returnValues._from,
      to: event.returnValues._to,
      tokenId: event.returnValues._id,
      operator: event.returnValues._operator,
      value: event.returnValues._value,
    };

    this.logger.log(`Received Transfer Event: ${JSON.stringify(eventInfo)}`);

    const [blockInfo, tokenInfo] = await this.web3Service.web3BatchRequest(
      [
        ...this.web3Service.getBaseBatchRequestParam(event, this.chain),
        {
          method: this.stickerContractRPC.methods.tokenInfo(event.returnValues._id).call,
          params: {},
        },
      ],
      this.chain,
    );

    const contractTokenInfo = { ...tokenInfo };
    contractTokenInfo.chain = this.chain;
    contractTokenInfo.contract = this.stickerContract;
    contractTokenInfo.uniqueKey = `${this.chain}-${this.stickerContract}-${eventInfo.tokenId}`;

    const TokenEventModel = getTokenEventModel(this.connection);
    const tokenEvent = new TokenEventModel({
      ...eventInfo,
      chain: this.chain,
      contract: this.stickerContract,
      gasFee: blockInfo.gasUsed,
      timestamp: blockInfo.timestamp,
    });

    await tokenEvent.save();

    if (eventInfo.from === Constants.BURN_ADDRESS) {
      await this.subTasksService.dealWithNewToken(
        contractTokenInfo as ContractTokenInfo,
        eventInfo.blockNumber,
      );
    } else {
      if (eventInfo.to !== this.pasarContract) {
        await this.subTasksService.updateTokenOwner(eventInfo.tokenId, eventInfo.to);
      }
    }
  }

  @Timeout('orderForAuction', 30 * 1000)
  async handleOrderForAuctionEvent() {
    const nowHeight = await this.rpc.eth.getBlockNumber();
    const lastHeight = await this.dbService.getOrderEventLastHeight(
      this.chain,
      OrderEventType.OrderForAuction,
    );

    let syncStartBlock = lastHeight;

    if (nowHeight - lastHeight > this.step + 1) {
      syncStartBlock = nowHeight;

      let fromBlock = lastHeight + 1;
      let toBlock = fromBlock + this.step;
      while (fromBlock <= nowHeight) {
        this.logger.log(`Sync past OrderForAuction events from [${fromBlock}] to [${toBlock}]`);
        this.pasarContractWS
          .getPastEvents('OrderForAuction', {
            fromBlock,
            toBlock,
          })
          .then((events) => {
            events.forEach(async (event) => {
              await this.handleOrderForAuctionEventData(event);
            });
          });
        fromBlock = toBlock + 1;
        toBlock = fromBlock + this.step > nowHeight ? nowHeight : toBlock + this.step;
        await Sleep(this.stepInterval);
      }

      this.logger.log(
        `Sync past OrderForAuction events from [${
          lastHeight + 1
        }] to [${nowHeight}] finished ✅☕🚾️️`,
      );
    }

    this.logger.log(`Start sync OrderForAuction events from [${syncStartBlock + 1}] 💪💪💪 `);

    this.pasarContractWS.events
      .OrderForAuction({
        fromBlock: syncStartBlock + 1,
      })
      .on('error', (error) => {
        this.logger.error(error);
      })
      .on('data', async (event) => {
        await this.handleOrderForAuctionEventData(event);
      });
  }

  private async handleOrderForAuctionEventData(event: any) {
    const eventInfo = {
      blockNumber: event.blockNumber,
      transactionHash: event.transactionHash,
      seller: event.returnValues._seller,
      orderId: event.returnValues._orderId,
      tokenId: event.returnValues._tokenId,
      baseToken: event.returnValues._baseToken,
      amount: event.returnValues._amount,
      quoteToken: event.returnValues._quoteToken,
      minPrice: event.returnValues._minPrice,
      reservePrice: event.returnValues._reservePrice,
      buyoutPrice: event.returnValues._buyoutPrice,
      startTime: event.returnValues._startTime,
      endTime: event.returnValues._endTime,
    };

    this.logger.log(`Received OrderForAuction Event: ${JSON.stringify(eventInfo)}`);

    const [blockInfo, contractOrder] = await this.web3Service.web3BatchRequest(
      [
        ...this.web3Service.getBaseBatchRequestParam(event, this.chain),
        {
          method: this.web3Service.pasarContractRPC[this.chain].methods.getOrderById(
            event.returnValues._orderId,
          ).call,
          params: {},
        },
      ],
      this.chain,
    );

    const contractOrderInfo = { ...contractOrder };
    contractOrderInfo.chain = this.chain;
    contractOrderInfo.uniqueKey = `${this.chain}-${this.stickerContract}-${eventInfo.tokenId}`;

    const OrderEventModel = getOrderEventModel(this.connection);
    const orderEvent = new OrderEventModel({
      ...eventInfo,
      chain: this.chain,
      eventType: OrderEventType.OrderForAuction,
      gasFee: blockInfo.gasUsed,
      timestamp: blockInfo.timestamp,
    });

    await orderEvent.save();
    await this.subTasksService.dealWithNewOrder(contractOrderInfo);
  }

  @Timeout('orderBid', 60 * 1000)
  async handleOrderBidEvent() {
    const nowHeight = await this.rpc.eth.getBlockNumber();
    const lastHeight = await this.dbService.getOrderEventLastHeight(
      this.chain,
      OrderEventType.OrderBid,
    );

    let syncStartBlock = lastHeight;

    if (nowHeight - lastHeight > this.step + 1) {
      syncStartBlock = nowHeight;

      let fromBlock = lastHeight + 1;
      let toBlock = fromBlock + this.step;
      while (fromBlock <= nowHeight) {
        this.logger.log(`Sync past OrderBid events from [${fromBlock}] to [${toBlock}]`);
        this.pasarContractWS
          .getPastEvents('OrderBid', {
            fromBlock,
            toBlock,
          })
          .then((events) => {
            events.forEach(async (event) => {
              await this.handleOrderBidEventData(event);
            });
          });
        fromBlock = toBlock + 1;
        toBlock = fromBlock + this.step > nowHeight ? nowHeight : toBlock + this.step;
        await Sleep(this.stepInterval);
      }

      this.logger.log(
        `Sync past OrderBid events from [${lastHeight + 1}] to [${nowHeight}] finished ✅☕🚾️️`,
      );
    }

    this.logger.log(`Start sync OrderBid events from [${syncStartBlock + 1}] 💪💪💪 `);
    this.web3Service.pasarContractWS[this.chain].events
      .OrderBid({
        fromBlock: syncStartBlock + 1,
      })
      .on('error', (error) => {
        this.logger.error(error);
      })
      .on('data', async (event) => {
        await this.handleOrderBidEventData(event);
      });
  }

  private async handleOrderBidEventData(event: any) {
    const eventInfo = {
      blockNumber: event.blockNumber,
      transactionHash: event.transactionHash,
      seller: event.returnValues._seller,
      buyer: event.returnValues._buyer,
      orderId: event.returnValues._orderId,
      price: event.returnValues._price,
    };

    this.logger.log(`Received BidOrder Event: ${JSON.stringify(eventInfo)}`);

    const [blockInfo, contractOrderInfo] = await this.web3Service.web3BatchRequest(
      [
        ...this.web3Service.getBaseBatchRequestParam(event, this.chain),
        {
          method: this.pasarContractRPC.methods.getOrderById(event.returnValues._orderId).call,
          params: {},
        },
      ],
      this.chain,
    );

    const OrderEventModel = getOrderEventModel(this.connection);
    const orderEvent = new OrderEventModel({
      ...eventInfo,
      chain: this.chain,
      eventType: OrderEventType.OrderBid,
      gasFee: blockInfo.gasUsed,
      timestamp: blockInfo.timestamp,
    });

    await orderEvent.save();

    await this.subTasksService.updateOrder(parseInt(eventInfo.orderId), {
      ...contractOrderInfo,
    });
  }

  @Timeout('orderForSale', 30 * 1000)
  async handleOrderForSaleEvent() {
    const nowHeight = await this.rpc.eth.getBlockNumber();
    const lastHeight = await this.dbService.getOrderEventLastHeight(
      this.chain,
      OrderEventType.OrderForSale,
    );

    let syncStartBlock = lastHeight;

    if (nowHeight - lastHeight > this.step + 1) {
      syncStartBlock = nowHeight;

      let fromBlock = lastHeight + 1;
      let toBlock = fromBlock + this.step;

      while (fromBlock <= nowHeight) {
        this.logger.log(`Sync past OrderForSale events from [${fromBlock}] to [${toBlock}]`);
        this.pasarContractWS
          .getPastEvents('OrderForSale', {
            fromBlock,
            toBlock,
          })
          .then((events) => {
            events.forEach(async (event) => {
              await this.handleOrderForSaleEventData(event);
            });
          });
        fromBlock = toBlock + 1;
        toBlock = fromBlock + this.step > nowHeight ? nowHeight : toBlock + this.step;
        await Sleep(this.stepInterval);
      }

      this.logger.log(
        `Sync past OrderForSale events from [${
          lastHeight + 1
        }] to [${nowHeight}] finished ✅☕🚾️️`,
      );
    }

    this.logger.log(`Start sync OrderForSale events from [${syncStartBlock + 1}] 💪💪💪 `);
    this.web3Service.pasarContractWS[this.chain].events
      .OrderForSale({
        fromBlock: syncStartBlock + 1,
      })
      .on('error', (error) => {
        this.logger.error(error);
      })
      .on('data', async (event) => {
        await this.handleOrderForSaleEventData(event);
      });
  }

  private async handleOrderForSaleEventData(event: any) {
    const eventInfo = {
      blockNumber: event.blockNumber,
      transactionHash: event.transactionHash,
      seller: event.returnValues._seller,
      orderId: event.returnValues._orderId,
      tokenId: event.returnValues._id,
      baseToken: event.returnValues._baseToken,
      amount: event.returnValues._amount,
      quoteToken: event.returnValues._quoteToken,
      price: event.returnValues._price,
      startTime: event.returnValues._startTime,
    };

    this.logger.log(`Received OrderForSale Event: ${JSON.stringify(eventInfo)}`);

    const [blockInfo, contractOrder] = await this.web3Service.web3BatchRequest(
      [
        ...this.web3Service.getBaseBatchRequestParam(event, this.chain),
        {
          method: this.pasarContractRPC.methods.getOrderById(event.returnValues._orderId).call,
          params: {},
        },
      ],
      this.chain,
    );

    const contractOrderInfo = { ...contractOrder };
    contractOrderInfo.chain = this.chain;
    contractOrderInfo.uniqueKey = `${this.chain}-${this.stickerContract}-${eventInfo.tokenId}`;

    const OrderEventModel = getOrderEventModel(this.connection);
    const orderEvent = new OrderEventModel({
      ...eventInfo,
      chain: this.chain,
      eventType: OrderEventType.OrderForSale,
      gasFee: blockInfo.gasUsed,
      timestamp: blockInfo.timestamp,
    });

    await orderEvent.save();

    await this.subTasksService.dealWithNewOrder(contractOrderInfo);
  }

  @Timeout('orderPriceChanged', 60 * 1000)
  async handleOrderPriceChangedEvent() {
    const nowHeight = await this.rpc.eth.getBlockNumber();
    const lastHeight = await this.dbService.getOrderEventLastHeight(
      this.chain,
      OrderEventType.OrderPriceChanged,
    );

    let syncStartBlock = lastHeight;

    if (nowHeight - lastHeight > this.step + 1) {
      syncStartBlock = nowHeight;

      let fromBlock = lastHeight + 1;
      let toBlock = fromBlock + this.step;

      while (fromBlock <= nowHeight) {
        this.logger.log(`Sync past OrderPriceChanged events from [${fromBlock}] to [${toBlock}]`);

        this.pasarContractWS
          .getPastEvents('OrderPriceChanged', {
            fromBlock,
            toBlock,
          })
          .then((events) => {
            events.forEach(async (event) => {
              await this.handleOrderPriceChangedEventData(event);
            });
          });
        fromBlock = toBlock + 1;
        toBlock = fromBlock + this.step > nowHeight ? nowHeight : toBlock + this.step;
        await Sleep(this.stepInterval);
      }

      this.logger.log(
        `Sync past OrderPriceChanged events from [${
          lastHeight + 1
        }] to [${nowHeight}] finished ✅☕🚾️`,
      );
    }

    this.logger.log(`Start sync OrderPriceChanged events from [${syncStartBlock + 1}] 💪💪💪 `);

    this.pasarContractWS.events
      .OrderPriceChanged({
        fromBlock: syncStartBlock + 1,
      })
      .on('error', (error) => {
        this.logger.error(error);
      })
      .on('data', async (event) => {
        await this.handleOrderPriceChangedEventData(event);
      });
  }

  private async handleOrderPriceChangedEventData(event: any) {
    const eventInfo = {
      blockNumber: event.blockNumber,
      transactionHash: event.transactionHash,
      seller: event.returnValues._seller,
      orderId: event.returnValues._orderId,
      oldPrice: event.returnValues._oldPrice,
      newPrice: event.returnValues._newPrice,
      oldReservePrice: event.returnValues._olderReservePrice,
      newReservePrice: event.returnValues._newReservePrice,
      oldBuyoutPrice: event.returnValues._olderBuyoutPrice,
      newBuyoutPrice: event.returnValues._newBuyoutPrice,
      oldQuoteToken: event.returnValues._olderQuoteToken,
      newQuoteToken: event.returnValues._newQuoteToken,
    };

    this.logger.log(`Received OrderPriceChanged Event: ${JSON.stringify(eventInfo)}`);

    const [blockInfo] = await this.web3Service.web3BatchRequest(
      [...this.web3Service.getBaseBatchRequestParam(event, this.chain)],
      this.chain,
    );

    const OrderEventModel = getOrderEventModel(this.connection);
    const orderEvent = new OrderEventModel({
      ...eventInfo,
      chain: this.chain,
      eventType: OrderEventType.OrderPriceChanged,
      gasFee: blockInfo.gasUsed,
      timestamp: blockInfo.timestamp,
    });

    await orderEvent.save();

    await this.subTasksService.updateOrder(parseInt(eventInfo.orderId), {
      price: parseInt(eventInfo.newPrice),
      reservePrice: parseInt(eventInfo.newReservePrice),
      buyoutPrice: parseInt(eventInfo.newBuyoutPrice),
      quoteToken: eventInfo.newQuoteToken,
      updateTime: orderEvent.timestamp,
    });
  }

  @Timeout('orderFilled', 60 * 1000)
  async handleOrderFilledEvent() {
    const nowHeight = await this.rpc.eth.getBlockNumber();
    const lastHeight = await this.dbService.getOrderEventLastHeight(
      this.chain,
      OrderEventType.OrderFilled,
    );

    let syncStartBlock = lastHeight;

    if (nowHeight - lastHeight > this.step + 1) {
      syncStartBlock = nowHeight;

      let fromBlock = lastHeight + 1;
      let toBlock = fromBlock + this.step;

      while (fromBlock <= nowHeight) {
        this.logger.log(`Sync past OrderFilled events from [${fromBlock}] to [${toBlock}]`);

        this.pasarContractWS
          .getPastEvents('OrderFilled', {
            fromBlock,
            toBlock,
          })
          .then((events) => {
            events.forEach(async (event) => {
              await this.handleOrderFilledEventData(event);
            });
          });
        fromBlock = toBlock + 1;
        toBlock = fromBlock + this.step > nowHeight ? nowHeight : toBlock + this.step;
        await Sleep(this.stepInterval);
      }

      this.logger.log(
        `Sync past OrderFilled events from [${lastHeight + 1}] to [${nowHeight}] finished ✅☕🚾️️`,
      );
    }

    this.logger.log(`Start sync OrderFilled events from [${syncStartBlock + 1}] 💪💪💪 `);
    this.pasarContractWS.events
      .OrderFilled({
        fromBlock: syncStartBlock + 1,
      })
      .on('error', (error) => {
        this.logger.error(error);
      })
      .on('data', async (event) => {
        await this.handleOrderFilledEventData(event);
      });
  }

  private async handleOrderFilledEventData(event: any) {
    const eventInfo = {
      blockNumber: event.blockNumber,
      transactionHash: event.transactionHash,
      seller: event.returnValues._seller,
      buyer: event.returnValues._buyer,
      orderId: event.returnValues._orderId,
      baseToken: event.returnValues._baseToken,
      quoteToken: event.returnValues._quoteToken,
      price: event.returnValues._price,
      royaltyFee: event.returnValues._royaltyFee,
      platformFee: event.returnValues._platformFee,
    };

    this.logger.log(`Received OrderFilled Event: ${JSON.stringify(eventInfo)}`);

    const [blockInfo, contractOrderInfo] = await this.web3Service.web3BatchRequest(
      [
        ...this.web3Service.getBaseBatchRequestParam(event, this.chain),
        {
          method: this.pasarContractRPC.methods.getOrderById(event.returnValues._orderId).call,
          params: {},
        },
      ],
      this.chain,
    );

    const OrderEventModel = getOrderEventModel(this.connection);
    const orderEvent = new OrderEventModel({
      ...eventInfo,
      eventType: OrderEventType.OrderFilled,
      chain: this.chain,
      gasFee: blockInfo.gasUsed,
      timestamp: blockInfo.timestamp,
    });

    await orderEvent.save();

    await this.subTasksService.updateOrder(parseInt(eventInfo.orderId), {
      orderState: parseInt(contractOrderInfo.orderState),
      buyerAddr: contractOrderInfo.buyerAddr,
      buyerUri: contractOrderInfo.buyerUri,
      filled: parseInt(contractOrderInfo.filled),
      platformFee: parseInt(contractOrderInfo.platformFee),
      royaltyFee: parseInt(eventInfo.royaltyFee),
      updateTime: parseInt(contractOrderInfo.updateTime),
    });
  }

  @Timeout('orderCancelled', 60 * 1000)
  async handleOrderCancelledEvent() {
    const nowHeight = await this.rpc.eth.getBlockNumber();
    const lastHeight = await this.dbService.getOrderEventLastHeight(
      this.chain,
      OrderEventType.OrderCancelled,
    );

    let syncStartBlock = lastHeight;

    if (nowHeight - lastHeight > this.step + 1) {
      syncStartBlock = nowHeight;

      let fromBlock = lastHeight + 1;
      let toBlock = fromBlock + this.step;

      while (fromBlock <= nowHeight) {
        this.logger.log(`Sync past OrderCancelled events from [${fromBlock}] to [${toBlock}]`);

        this.pasarContractWS
          .getPastEvents('OrderCanceled', {
            fromBlock,
            toBlock,
          })
          .then((events) => {
            events.forEach(async (event) => {
              await this.handleOrderCancelledEventData(event);
            });
          });
        fromBlock = toBlock + 1;
        toBlock = fromBlock + this.step > nowHeight ? nowHeight : toBlock + this.step;
        await Sleep(this.stepInterval);
      }

      this.logger.log(
        `Sync past OrderCancelled events from [${
          lastHeight + 1
        }] to [${nowHeight}] finished ✅☕🚾️️`,
      );
    }

    this.logger.log(`Start sync OrderCancelled events from [${syncStartBlock + 1}] 💪💪💪 `);
    this.pasarContractWS.events
      .OrderCanceled({
        fromBlock: syncStartBlock + 1,
      })
      .on('error', (error) => {
        this.logger.error(error);
      })
      .on('data', async (event) => {
        await this.handleOrderCancelledEventData(event);
      });
  }

  private async handleOrderCancelledEventData(event: any) {
    const eventInfo = {
      blockNumber: event.blockNumber,
      transactionHash: event.transactionHash,
      seller: event.returnValues._seller,
      orderId: event.returnValues._orderId,
    };

    this.logger.log(`Received OrderCancelled Event: ${JSON.stringify(eventInfo)}`);

    const [blockInfo] = await this.web3Service.web3BatchRequest(
      [...this.web3Service.getBaseBatchRequestParam(event, this.chain)],
      this.chain,
    );

    const OrderEventModel = getOrderEventModel(this.connection);
    const orderEvent = new OrderEventModel({
      ...eventInfo,
      chain: this.chain,
      eventType: OrderEventType.OrderCancelled,
      gasFee: blockInfo.gasUsed,
      timestamp: blockInfo.timestamp,
    });

    await orderEvent.save();

    await this.subTasksService.updateOrder(parseInt(eventInfo.orderId), {
      orderState: OrderState.Cancelled,
      updateTime: orderEvent.timestamp,
    });
  }

  @Timeout('tokenRegistered', 60 * 1000)
  async handleTokenRegisteredEvent() {
    const nowHeight = await this.rpc.eth.getBlockNumber();
    const lastHeight = await this.dbService.getCollectionEventLastHeight(
      this.chain,
      CollectionEventType.TokenRegistered,
    );

    let syncStartBlock = lastHeight;

    if (nowHeight - lastHeight > this.step + 1) {
      syncStartBlock = nowHeight;

      let fromBlock = lastHeight + 1;
      let toBlock = fromBlock + this.step;

      while (fromBlock <= nowHeight) {
        this.logger.log(`Sync past TokenRegistered events from [${fromBlock}] to [${toBlock}]`);

        this.registerContractWS
          .getPastEvents('TokenRegistered', {
            fromBlock,
            toBlock,
          })
          .then((events) => {
            events.forEach(async (event) => {
              await this.handleTokenRegisteredEventData(event);
            });
          });
        fromBlock = toBlock + 1;
        toBlock = fromBlock + this.step > nowHeight ? nowHeight : toBlock + this.step;
        await Sleep(this.stepInterval);
      }

      this.logger.log(
        `Sync past TokenRegistered events from [${
          lastHeight + 1
        }] to [${nowHeight}] finished ✅☕🚾️️`,
      );
    }

    this.logger.log(`Start sync TokenRegistered events from [${syncStartBlock + 1}] 💪💪💪 `);
    this.registerContractWS.events
      .TokenRegistered({
        fromBlock: syncStartBlock + 1,
      })
      .on('error', (error) => {
        this.logger.error(error);
      })
      .on('data', async (event) => {
        await this.handleTokenRegisteredEventData(event);
      });
  }

  private async handleTokenRegisteredEventData(event: any) {
    const eventInfo = {
      blockNumber: event.blockNumber,
      transactionHash: event.transactionHash,
      token: event.returnValues._token,
      owner: event.returnValues._owner,
      name: event.returnValues._name,
      uri: event.returnValues._uri,
    };

    this.logger.log(`Received TokenRegistered Event: ${JSON.stringify(eventInfo)}`);

    const tokenContract = new this.web3Service.web3RPC[this.chain].eth.Contract(
      TOKEN721_ABI,
      eventInfo.token,
    );

    const [blockInfo, is721, symbol] = await this.web3Service.web3BatchRequest(
      [
        ...this.web3Service.getBaseBatchRequestParam(event, this.chain),
        { method: tokenContract.methods.supportsInterface('0x80ac58cd').call, params: {} },
        { method: tokenContract.methods.symbol().call, params: {} },
      ],
      this.chain,
    );

    const CollectionEventModel = getCollectionEventModel(this.connection);
    const collectionEvent = new CollectionEventModel({
      ...eventInfo,
      chain: this.chain,
      eventType: CollectionEventType.TokenRegistered,
      gasFee: blockInfo.gasUsed,
      timestamp: blockInfo.timestamp,
    });

    await collectionEvent.save();
    await this.subTasksService.updateCollection(eventInfo.token, this.chain, {
      owner: eventInfo.owner,
      uri: eventInfo.uri,
      name: eventInfo.name,
      chain: this.chain,
      is721,
      symbol,
      blockNumber: eventInfo.blockNumber,
    });

    if (!this.subTasksService.checkIsBaseCollection(eventInfo.token, this.chain)) {
      await this.subTasksService.startupSyncCollection(eventInfo.token, this.chain, is721);
    }
  }

  @Timeout('tokenRoyaltyChanged', 60 * 1000)
  async handleRoyaltyChangedEvent() {
    const nowHeight = await this.rpc.eth.getBlockNumber();
    const lastHeight = await this.dbService.getCollectionEventLastHeight(
      this.chain,
      CollectionEventType.TokenRoyaltyChanged,
    );

    let syncStartBlock = lastHeight;

    if (nowHeight - lastHeight > this.step + 1) {
      syncStartBlock = nowHeight;

      let fromBlock = lastHeight + 1;
      let toBlock = fromBlock + this.step;

      while (fromBlock <= nowHeight) {
        this.logger.log(`Sync past TokenRoyaltyChanged events from [${fromBlock}] to [${toBlock}]`);

        this.registerContractWS
          .getPastEvents('TokenRoyaltyChanged', {
            fromBlock,
            toBlock,
          })
          .then((events) => {
            events.forEach(async (event) => {
              await this.handleTokenRoyaltyChangedEventData(event);
            });
          });
        fromBlock = toBlock + 1;
        toBlock = fromBlock + this.step > nowHeight ? nowHeight : toBlock + this.step;
        await Sleep(this.stepInterval);
      }

      this.logger.log(
        `Sync past TokenRoyaltyChanged events from [${
          lastHeight + 1
        }] to [${nowHeight}] finished ✅☕🚾️️`,
      );
    }

    this.logger.log(`Start sync TokenRoyaltyChanged events from [${syncStartBlock + 1}] 💪💪💪 `);
    this.registerContractWS.events
      .TokenRoyaltyChanged({
        fromBlock: syncStartBlock + 1,
      })
      .on('error', (error) => {
        this.logger.error(error);
      })
      .on('data', async (event) => {
        await this.handleTokenRoyaltyChangedEventData(event);
      });
  }

  private async handleTokenRoyaltyChangedEventData(event: any) {
    const eventInfo = {
      blockNumber: event.blockNumber,
      transactionHash: event.transactionHash,
      token: event.returnValues._token,
      royaltyOwners: event.returnValues._royaltyOwners,
      royaltyFees: event.returnValues._royaltyRates,
    };

    this.logger.log(`Received TokenRoyaltyChanged Event: ${JSON.stringify(eventInfo)}`);

    const [blockInfo] = await this.web3Service.web3BatchRequest(
      [...this.web3Service.getBaseBatchRequestParam(event, this.chain)],
      this.chain,
    );

    const CollectionEventModel = getCollectionEventModel(this.connection);
    const collectionEvent = new CollectionEventModel({
      ...eventInfo,
      chain: this.chain,
      eventType: CollectionEventType.TokenRoyaltyChanged,
      gasFee: blockInfo.gasUsed,
      timestamp: blockInfo.timestamp,
    });

    await collectionEvent.save();
    await this.subTasksService.updateCollection(eventInfo.token, this.chain, {
      royaltyOwners: eventInfo.royaltyOwners,
      royaltyFees: eventInfo.royaltyFees,
    });
  }

  @Timeout('tokenInfoUpdated', 60 * 1000)
  async handleTokenInfoUpdatedEvent() {
    const nowHeight = await this.rpc.eth.getBlockNumber();
    const lastHeight = await this.dbService.getCollectionEventLastHeight(
      this.chain,
      CollectionEventType.TokenInfoUpdated,
    );

    let syncStartBlock = lastHeight;

    if (nowHeight - lastHeight > this.step + 1) {
      syncStartBlock = nowHeight;

      let fromBlock = lastHeight + 1;
      let toBlock = fromBlock + this.step;

      while (fromBlock <= nowHeight) {
        this.logger.log(`Sync past TokenInfoUpdated events from [${fromBlock}] to [${toBlock}]`);

        this.registerContractWS
          .getPastEvents('TokenInfoUpdated', {
            fromBlock,
            toBlock,
          })
          .then((events) => {
            events.forEach(async (event) => {
              await this.handleTokenInfoUpdatedEventData(event);
            });
          });
        fromBlock = toBlock + 1;
        toBlock = fromBlock + this.step > nowHeight ? nowHeight : toBlock + this.step;
        await Sleep(this.stepInterval);
      }

      this.logger.log(
        `Sync past TokenInfoUpdated events from [${
          lastHeight + 1
        }] to [${nowHeight}] finished ✅☕🚾️️`,
      );
    }

    this.logger.log(`Start sync TokenInfoUpdated events from [${syncStartBlock + 1}] 💪💪💪 `);
    this.registerContractWS.events
      .TokenInfoUpdated({
        fromBlock: syncStartBlock + 1,
      })
      .on('error', (error) => {
        this.logger.error(error);
      })
      .on('data', async (event) => {
        await this.handleTokenInfoUpdatedEventData(event);
      });
  }

  private async handleTokenInfoUpdatedEventData(event: any) {
    const eventInfo = {
      blockNumber: event.blockNumber,
      transactionHash: event.transactionHash,
      token: event.returnValues._token,
      name: event.returnValues._name,
      uri: event.returnValues._uri,
    };

    this.logger.log(`Received TokenInfoUpdatedEventData Event: ${JSON.stringify(eventInfo)}`);

    const [blockInfo] = await this.web3Service.web3BatchRequest(
      [...this.web3Service.getBaseBatchRequestParam(event, this.chain)],
      this.chain,
    );

    const CollectionEventModel = getCollectionEventModel(this.connection);
    const collectionEvent = new CollectionEventModel({
      ...eventInfo,
      chain: this.chain,
      eventType: CollectionEventType.TokenInfoUpdated,
      gasFee: blockInfo.gasUsed,
      timestamp: blockInfo.timestamp,
    });

    await collectionEvent.save();
    await this.subTasksService.updateCollection(eventInfo.token, this.chain, {
      uri: eventInfo.uri,
      name: eventInfo.name,
    });
  }
}
