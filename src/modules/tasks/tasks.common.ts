import { Injectable, Logger } from '@nestjs/common';
import { Cron, Timeout } from '@nestjs/schedule';
import { SubTasksService } from './sub-tasks.service';
import { DbService } from '../database/db.service';
import { Web3Service } from '../utils/web3.service';
import { Sleep } from '../utils/utils.service';
import { TOKEN721_ABI } from '../../contracts/Token721ABI';
import { TOKEN1155_ABI } from '../../contracts/Token1155ABI';

@Injectable()
export class TasksCommonService {
  constructor(
    private dbService: DbService,
    private subTasksService: SubTasksService,
    private web3Service: Web3Service,
  ) {}

  private readonly logger = new Logger('TasksCommonService');
  private readonly step = 20000;
  private readonly stepInterval = 1000 * 10;

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
          await this.dbService.increaseTokenRetryTimes(token.tokenId, token.chain, token.contract);
          this.logger.error(`Error in getting token info for ${tokenUri}`);
        }
      }
    }
  }

  @Timeout('userCollection', 0)
  async startupListenUserCollectionEvent() {
    const registeredCollections = await this.dbService.getRegisteredCollections();
    registeredCollections.forEach(async (collection) => {
      if (!this.subTasksService.checkIsBaseCollection(collection.token, collection.chain)) {
        const nowHeight = await this.web3Service.web3RPC[collection.chain].eth.getBlockNumber();
        const lastHeight = await this.dbService.getUserTokenEventLastHeight(
          collection.chain,
          collection.token,
        );

        const ABI = collection.is721 ? TOKEN721_ABI : TOKEN1155_ABI;
        const event = collection.is721 ? 'Transfer' : 'TransferSingle';
        const contractWs = new this.web3Service.web3WS[collection.chain].eth.Contract(
          ABI as any,
          collection.token,
        );

        let syncStartBlock = lastHeight;

        if (nowHeight - lastHeight > this.step + 1) {
          syncStartBlock = nowHeight;

          let fromBlock = lastHeight + 1;
          let toBlock = fromBlock + this.step;
          while (fromBlock <= nowHeight) {
            this.logger.log(
              `Sync past user Collection ${collection.token} Transfer events from [${fromBlock}] to [${toBlock}]`,
            );

            contractWs
              .getPastEvents(event, {
                fromBlock,
                toBlock,
              })
              .then((events) => {
                events.forEach(async (event) => {
                  await this.subTasksService.dealWithUserCollectionToken(
                    event,
                    collection.token,
                    collection.chain,
                    collection.is721,
                  );
                });
              });
            fromBlock = toBlock + 1;
            toBlock = fromBlock + this.step > nowHeight ? nowHeight : toBlock + this.step;
            await Sleep(this.stepInterval);
          }

          this.logger.log(
            `Sync past user Collection ${collection.token} Transfer events from [${fromBlock}] to [${toBlock}] ✅☕🚾️`,
          );
        }

        this.logger.log(
          `Start sync user Collection ${collection.token} Transfer events from [${
            syncStartBlock + 1
          }] 💪💪💪 `,
        );

        contractWs.events[event]({
          fromBlock: syncStartBlock + 1,
        })
          .on('error', (error) => {
            this.logger.error(error);
          })
          .on('data', async (event) => {
            await this.subTasksService.dealWithUserCollectionToken(
              event,
              collection.token,
              collection.chain,
              collection.is721,
            );
          });
      }
    });
  }
}
