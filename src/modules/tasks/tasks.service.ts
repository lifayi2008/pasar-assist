import { Injectable, Logger } from '@nestjs/common';
import { DbService } from '../database/db.service';
import { Web3Service } from '../utils/web3.service';
import { InjectConnection } from '@nestjs/mongoose';
import { Connection } from 'mongoose';
import { getTokenEventModel } from '../common/models/TokenEventModel';
import { Constants } from '../../constants';
import { SubTasksService } from './sub-tasks.service';
import { ContractTokenInfo, OrderEventType, OrderState, OrderType } from './interfaces';
import { ConfigService } from '@nestjs/config';
import { getOrderEventModel } from '../common/models/OrderEventModel';
import { CallOfBatch } from '../utils/interfaces';
import { Timeout } from '@nestjs/schedule';
import { Sleep } from '../utils/utils.service';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { Chain } from '../utils/enums';
import Web3 from 'web3';
import { AppConfig } from '../../app-config';

@Injectable()
export class TasksService {
  private readonly logger = new Logger('TasksService');

  private readonly step = 5000;
  private readonly stepInterval = 1000 * 10;
  private readonly rpc: Web3;
  private readonly stickerContract =
    AppConfig[this.configService.get('NETWORK')][Chain.ELA].stickerContract;
  private readonly pasarContract =
    AppConfig[this.configService.get('NETWORK')][Chain.ELA].pasarContract;
  private readonly stickerContractWS = this.web3Service.stickerContractWS[Chain.ELA];
  private readonly stickerContractRPC = this.web3Service.stickerContractRPC[Chain.ELA];
  private readonly pasarContractWS = this.web3Service.pasarContractWS[Chain.ELA];
  private readonly pasarContractRPC = this.web3Service.pasarContractRPC[Chain.ELA];

  constructor(
    private subTasksService: SubTasksService,
    private configService: ConfigService,
    private dbService: DbService,
    private web3Service: Web3Service,
    @InjectConnection() private readonly connection: Connection,
    @InjectQueue('order-data-queue') private orderDataQueue: Queue,
  ) {
    this.rpc = this.web3Service.web3RPC[Chain.ELA];
  }

  @Timeout('transfer', 1000)
  async handleTransferEvent() {
    const nowHeight = await this.rpc.eth.getBlockNumber();
    const lastHeight = await this.dbService.getTokenEventLastHeight(
      Chain.ELA,
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

    const [txInfo, blockInfo, contractTokenInfo] = await this.web3Service.web3BatchRequest(
      [
        ...this.web3Service.getBaseBatchRequestParam(event, Chain.ELA),
        {
          method: this.stickerContractRPC.methods.tokenInfo(event.returnValues._id).call,
          params: {},
        },
      ],
      Chain.ELA,
    );

    const TokenEventModel = getTokenEventModel(this.connection);
    const tokenEvent = new TokenEventModel({
      ...eventInfo,
      chain: Chain.ELA,
      contract: this.stickerContract,
      gasFee: (txInfo.gas * txInfo.gasPrice) / Constants.ELA_ESC_PRECISION,
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
        await this.subTasksService.updateTokenOwner(
          eventInfo.tokenId,
          eventInfo.to,
          eventInfo.blockNumber,
        );
      }
    }
  }

  @Timeout('orderForAuction', 30 * 1000)
  async handleOrderForAuctionEvent() {
    const nowHeight = await this.rpc.eth.getBlockNumber();
    const lastHeight = await this.dbService.getOrderEventLastHeight(
      Chain.ELA,
      this.stickerContract,
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

    const [blockInfo, txInfo, contractOrderInfo] = await this.web3Service.web3BatchRequest(
      [
        ...this.web3Service.getBaseBatchRequestParam(event, Chain.ELA),
        {
          method: this.web3Service.pasarContractRPC[Chain.ELA].methods.getOrderById(
            event.returnValues._orderId,
          ).call,
          params: {},
        },
      ],
      Chain.ELA,
    );

    contractOrderInfo.chain = Chain.ELA;
    contractOrderInfo.contract = this.pasarContract;

    const OrderEventModel = getOrderEventModel(this.connection);
    const orderEvent = new OrderEventModel({
      ...eventInfo,
      chain: Chain.ELA,
      contract: this.pasarContract,
      eventType: OrderEventType.OrderForAuction,
      gasFee: (txInfo.gas * txInfo.gasPrice) / Constants.ELA_ESC_PRECISION,
      timestamp: blockInfo.timestamp,
    });

    await orderEvent.save();
    await this.subTasksService.dealWithNewOrder(contractOrderInfo);
  }

  @Timeout('orderBid', 60 * 1000)
  async handleOrderBidEvent() {
    const nowHeight = await this.rpc.eth.getBlockNumber();
    const lastHeight = await this.dbService.getOrderEventLastHeight(
      Chain.ELA,
      this.stickerContract,
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
    this.web3Service.pasarContractWS[Chain.ELA].events
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

    const [blockInfo, txInfo, contractOrderInfo] = await this.web3Service.web3BatchRequest(
      [
        ...this.web3Service.getBaseBatchRequestParam(event, Chain.ELA),
        {
          method: this.pasarContractRPC.methods.getOrderById(event.returnValues._orderId).call,
          params: {},
        },
      ],
      Chain.ELA,
    );

    const OrderEventModel = getOrderEventModel(this.connection);
    const orderEvent = new OrderEventModel({
      ...eventInfo,
      chain: Chain.ELA,
      contract: this.pasarContract,
      eventType: OrderEventType.OrderBid,
      gasFee: (txInfo.gas * txInfo.gasPrice) / Constants.ELA_ESC_PRECISION,
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
      Chain.ELA,
      this.stickerContract,
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
    this.web3Service.pasarContractWS[Chain.ELA].events
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

    const [blockInfo, txInfo, contractOrderInfo] = await this.web3Service.web3BatchRequest(
      [
        ...this.web3Service.getBaseBatchRequestParam(event, Chain.ELA),
        {
          method: this.pasarContractRPC.methods.getOrderById(event.returnValues._orderId).call,
          params: {},
        },
      ],
      Chain.ELA,
    );

    contractOrderInfo.chain = Chain.ELA;
    contractOrderInfo.contract = this.pasarContract;

    const OrderEventModel = getOrderEventModel(this.connection);
    const orderEvent = new OrderEventModel({
      ...eventInfo,
      chain: Chain.ELA,
      contract: this.pasarContract,
      eventType: OrderEventType.OrderForSale,
      gasFee: (txInfo.gas * txInfo.gasPrice) / Constants.ELA_ESC_PRECISION,
      timestamp: blockInfo.timestamp,
    });

    await orderEvent.save();

    await this.subTasksService.dealWithNewOrder(contractOrderInfo);
  }

  @Timeout('orderPriceChanged', 60 * 1000)
  async handleOrderPriceChangedEvent() {
    const nowHeight = await this.rpc.eth.getBlockNumber();
    const lastHeight = await this.dbService.getOrderEventLastHeight(
      Chain.ELA,
      this.stickerContract,
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

    this.web3Service.pasarContractWS[Chain.ELA].events
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

    const [blockInfo, txInfo] = await this.web3Service.web3BatchRequest(
      [...this.web3Service.getBaseBatchRequestParam(event, Chain.ELA)],
      Chain.ELA,
    );

    const OrderEventModel = getOrderEventModel(this.connection);
    const orderEvent = new OrderEventModel({
      ...eventInfo,
      eventType: OrderEventType.OrderPriceChanged,
      gasFee: (txInfo.gas * txInfo.gasPrice) / Constants.ELA_ESC_PRECISION,
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
      Chain.ELA,
      this.stickerContract,
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

    const [blockInfo, txInfo, contractOrderInfo] = await this.web3Service.web3BatchRequest(
      [
        ...this.web3Service.getBaseBatchRequestParam(event, Chain.ELA),
        {
          method: this.web3Service.pasarContractRPC[Chain.ELA].methods.getOrderById(
            event.returnValues._orderId,
          ).call,
          params: {},
        },
      ],
      Chain.ELA,
    );

    const OrderEventModel = getOrderEventModel(this.connection);
    const orderEvent = new OrderEventModel({
      ...eventInfo,
      eventType: OrderEventType.OrderFilled,
      chain: Chain.ELA,
      stickerContract: this.stickerContract,
      gasFee: (txInfo.gas * txInfo.gasPrice) / Constants.ELA_ESC_PRECISION,
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
      Chain.ELA,
      this.stickerContract,
      OrderEventType.OrderCancelled,
    );

    let syncStartBlock = lastHeight;

    if (nowHeight - lastHeight > this.step + 1) {
      syncStartBlock = nowHeight;

      let fromBlock = lastHeight + 1;
      let toBlock = fromBlock + this.step;

      while (fromBlock <= nowHeight) {
        this.logger.log(`Sync past OrderCancelled events from [${fromBlock}] to [${toBlock}]`);

        this.web3Service.pasarContractWS[Chain.ELA]
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
    this.web3Service.pasarContractWS[Chain.ELA].events
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

    const [blockInfo, txInfo] = await this.web3Service.web3BatchRequest(
      [...this.web3Service.getBaseBatchRequestParam(event, Chain.ELA)],
      Chain.ELA,
    );

    const OrderEventModel = getOrderEventModel(this.connection);
    const orderEvent = new OrderEventModel({
      ...eventInfo,
      eventType: OrderEventType.OrderCancelled,
      gasFee: (txInfo.gas * txInfo.gasPrice) / Constants.ELA_ESC_PRECISION,
      timestamp: blockInfo.timestamp,
    });

    await orderEvent.save();

    await this.subTasksService.updateOrder(parseInt(eventInfo.orderId), {
      orderState: OrderState.Cancelled,
      updateTime: orderEvent.timestamp,
    });
  }
}
