import { Injectable, Logger } from '@nestjs/common';
import {
  ContractOrderInfo,
  ContractTokenInfo,
  ContractUserInfo,
  IPFSTokenInfo,
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

@Injectable()
export class SubTasksService {
  private readonly logger = new Logger('SubTasksService');

  constructor(
    private configService: ConfigService,
    private dbService: DbService,
    @InjectConnection() private readonly connection: Connection,
    @InjectQueue('order-data-queue-local') private orderDataQueueLocal: Queue,
    @InjectQueue('token-data-queue-local') private tokenDataQueueLocal: Queue,
  ) {}

  private async getInfoByIpfsUri(ipfsUri: string): Promise<IPFSTokenInfo | ContractUserInfo> {
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

  async updateTokenOwner(tokenId: string, to: string, blockNumber: number) {
    const token = await this.connection.collection('tokens').findOne({ tokenId });
    if (!token) {
      this.logger.warn(`Token ${tokenId} is not in database`);
      await Sleep(1000);
      await this.tokenDataQueueLocal.add(
        'update-token-owner',
        { tokenId, to, blockNumber },
        { removeOnComplete: true },
      );
    } else {
      await this.connection
        .collection('tokens')
        .updateOne(
          { tokenId: tokenId, blockNumber: { $lt: blockNumber } },
          { $set: { tokenOwner: to, blockNumber } },
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
}
