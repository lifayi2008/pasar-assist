import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { SubTasksService } from './sub-tasks.service';
import { DbService } from '../database/db.service';

@Injectable()
export class TasksCommonService {
  constructor(private dbService: DbService, private subTasksService: SubTasksService) {}

  private readonly logger = new Logger('TasksCommonService');

  @Cron('*/10 * * * * *')
  async getUserTokenInfo() {
    const tokens = await this.dbService.getLatestNoDetailTokens();
    if (tokens.length > 0) {
      for (const token of tokens) {
        const tokenUri = token.tokenUri;
        try {
          const tokenInfo = await this.subTasksService.getTokenInfoByUri(tokenUri);
          this.logger.log(JSON.stringify(tokenInfo));

          if (tokenInfo) {
            const tokenDetail = {
              name: tokenInfo.name,
              description: tokenInfo.description,
              image: tokenInfo.image ? tokenInfo.image : '',
              type: tokenInfo.type ? tokenInfo.type : 'image',
              adult: tokenInfo.adult ? tokenInfo.adult : false,
              version: tokenInfo.version ? tokenInfo.version : 2,
              properties: tokenInfo.properties ? tokenInfo.properties : {},
              creator: tokenInfo.creator ? tokenInfo.creator : {},
              data: tokenInfo.data ? tokenInfo.data : {},
              notGetDetail: false,
            };

            await this.dbService.updateTokenDetail(
              token.tokenId,
              token.chain,
              token.contract,
              tokenDetail,
            );
          }
        } catch (e) {
          this.logger.error(`Error in getting token info for ${tokenUri}`);
        }
      }
    }
  }
}
