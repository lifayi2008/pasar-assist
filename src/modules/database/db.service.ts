import { Injectable, Logger } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { Connection } from 'mongoose';
import { ConfigService } from '@nestjs/config';
import { CollectionEventType, OrderEventType, UpdateCollectionParams } from '../tasks/interfaces';
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

  async getOrderEventLastHeight(chain: Chain, orderEventType: OrderEventType): Promise<number> {
    const results = await this.connection
      .collection('order_events')
      .find({ chain, eventType: orderEventType })
      .sort({ blockNumber: -1 })
      .limit(1)
      .toArray();
    if (results.length > 0) {
      return results[0].blockNumber;
    } else {
      return parseInt(AppConfig[this.configService.get('NETWORK')][chain].pasarContractDeploy);
    }
  }

  async updateOrder(orderId: number, params: UpdateOrderParams) {
    return await this.connection.collection('orders').updateOne({ orderId }, { $set: params });
  }

  async updateCollection(token: string, collection: UpdateCollectionParams) {
    return await this.connection
      .collection('collections')
      .updateOne({ token }, { $set: collection }, { upsert: true });
  }

  async orderCount() {
    return await this.connection.collection('orders').countDocuments();
  }

  async tokenCount() {
    return await this.connection.collection('tokens').countDocuments();
  }

  async getCollectionEventLastHeight(
    chain: Chain,
    eventType: CollectionEventType,
  ): Promise<number> {
    const results = await this.connection
      .collection('collection_events')
      .find({ chain, eventType })
      .sort({ blockNumber: -1 })
      .limit(1)
      .toArray();
    if (results.length > 0) {
      return results[0].blockNumber;
    } else {
      //TODO: change to more universal method to get contract deploy block
      return parseInt(AppConfig[this.configService.get('NETWORK')][chain].registerContractDeploy);
    }
  }
}
