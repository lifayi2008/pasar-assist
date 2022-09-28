import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { SubTasksService } from './sub-tasks.service';
import { ConfigService } from '@nestjs/config';
import { DbService } from '../database/db.service';
import { Web3Service } from '../utils/web3.service';
import { InjectConnection } from '@nestjs/mongoose';
import { Connection } from 'mongoose';

@Injectable()
export class TasksCommonService {
  constructor(private dbService: DbService) {}

  private readonly logger = new Logger('TasksCommonService');

  @Cron('0 */1 0 * * *')
  async getUserTokenInfo() {
    const tokens = await this.dbService.getLatestNoDetailTokens();
    if (tokens.length > 0) {
      tokens.forEach(async (token) => {
        this.logger.log(JSON.stringify(token));
      });
    }
  }
}
