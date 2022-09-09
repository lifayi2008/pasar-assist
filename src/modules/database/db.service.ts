import { Injectable, Logger } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { Connection } from 'mongoose';
import { ConfigService } from '@nestjs/config';
import { OrderEventType } from '../tasks/interfaces';
import { UpdateOrderParams } from './interfaces';
import { Chain } from '../utils/enums';
import { AppConfig } from '../../app-config';

@Injectable()
export class DbService {
  private logger = new Logger('DbService');

  constructor(
    @InjectConnection() private readonly connection: Connection,
    private configService: ConfigService,
  ) {}

  async getTokenEventLastHeight(chain: Chain, contract: string): Promise<number> {
    const results = await this.connection
      .collection('token_events')
      .find({ chain, contract })
      .sort({ blockNumber: -1 })
      .limit(1)
      .toArray();
    if (results.length > 0) {
      return results[0].blockNumber;
    } else {
      //TODO: change to more universal method to get contract deploy block
      return parseInt(AppConfig[this.configService.get('NETWORK')][chain].stickerContractDeploy);
    }
  }

  async getOrderEventLastHeight(
    chain: Chain,
    contract: string,
    orderEventType: OrderEventType,
  ): Promise<number> {
    const results = await this.connection
      .collection('order_events')
      .find({ chain, contract, eventType: orderEventType })
      .sort({ blockNumber: -1 })
      .limit(1)
      .toArray();
    if (results.length > 0) {
      return results[0].blockNumber;
    } else {
      return parseInt(this.configService.get('CONTRACT_MARKET_DEPLOY'));
    }
  }

  async getBidOrderEventLastHeight(): Promise<number> {
    const results = await this.connection
      .collection('order_events')
      .find({ eventType: OrderEventType.OrderBid })
      .sort({ blockNumber: -1 })
      .limit(1)
      .toArray();
    if (results.length > 0) {
      return results[0].blockNumber;
    } else {
      return parseInt(this.configService.get('CONTRACT_MARKET_DEPLOY'));
    }
  }

  async updateOrder(orderId: number, params: UpdateOrderParams) {
    return await this.connection.collection('orders').updateOne({ orderId }, { $set: params });
  }

  async orderCount() {
    return await this.connection.collection('orders').countDocuments();
  }

  async tokenCount() {
    return await this.connection.collection('tokens').countDocuments();
  }
}
