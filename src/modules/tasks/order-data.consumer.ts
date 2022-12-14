import { Processor, Process } from '@nestjs/bull';
import { Job } from 'bull';
import { Logger } from '@nestjs/common';
import { UpdateOrderParams } from '../database/interfaces';
import { SubTasksService } from './sub-tasks.service';
import { Chain } from '../utils/enums';

@Processor('order-data-queue-local')
export class OrderDataConsumer {
  private readonly logger = new Logger('OrderDataConsumer');

  constructor(private subTasksService: SubTasksService) {}

  @Process('update-order')
  async updateOrder(job: Job<{ chain: Chain; orderId: number; params: UpdateOrderParams }>) {
    this.logger.log(`Processing job ['update-order'] data: ${JSON.stringify(job.data)}`);
    await this.subTasksService.updateOrder(job.data.chain, job.data.orderId, job.data.params);

    return true;
  }
}
