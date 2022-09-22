import { Processor, Process } from '@nestjs/bull';
import { Job } from 'bull';
import { Logger } from '@nestjs/common';
import { SubTasksService } from './sub-tasks.service';
import { UpdateCollectionParams } from './interfaces';

@Processor('collection-data-queue-local')
export class CollectionDataConsumer {
  private readonly logger = new Logger('CollectionDataConsumer');

  constructor(private subTasksService: SubTasksService) {}

  @Process('update-collection')
  async updateOrder(job: Job<{ token: string; param: UpdateCollectionParams }>) {
    this.logger.log(`Processing job ['update-collection'] data: ${JSON.stringify(job.data)}`);
    await this.subTasksService.updateCollection(job.data.token, job.data.param);

    return true;
  }
}
