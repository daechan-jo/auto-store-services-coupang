import { CronType } from '@daechanjo/models';
import { Process, Processor } from '@nestjs/bull';
import { Injectable } from '@nestjs/common';
import { Job } from 'bull';

import { CoupangCrawlerService } from './crawler/coupang.crawler.service';

@Processor('coupang-message-queue') // 큐 이름
@Injectable()
export class MessageQueueProcessor {
  constructor(private readonly coupangCrawlerService: CoupangCrawlerService) {}

  @Process('process-message') // 작업 이름
  async processMessage(job: Job) {
    const { pattern, payload } = job.data;

    console.log(`${payload.type}${payload.cronId}: 🔥${pattern}`);

    try {
      switch (pattern) {
        case 'orderStatusUpdate':
          await this.coupangCrawlerService.orderStatusUpdate(payload.cronId, payload.type);
          break;

        case 'invoiceUpload':
          return await this.coupangCrawlerService.invoiceUpload(
            payload.cronId,
            payload.updatedOrders,
            payload.type,
          );

        // todo price 모듈에서 개별환경에서 동작중
        case 'crawlCoupangDetailProducts':
          await this.coupangCrawlerService.crawlCoupangDetailProducts(payload.cronId, payload.type);
          return 'success';

        case 'deleteConfirmedCoupangProduct':
          const matchedProducts = await this.coupangCrawlerService.deleteConfirmedCoupangProduct(
            payload.cronId,
            payload.type,
          );
          return { status: 'success', data: matchedProducts };

        default:
          console.warn(
            `${CronType.ERROR}${payload.type}${payload.cronId}: 알 수 없는 패턴 ${pattern}`,
          );
      }
    } catch (error: any) {
      console.error(
        `${CronType.ERROR}${payload.type}${payload.cronId}: 🔥${pattern}\n`,
        error.response?.data || error.message,
      );
    }
  }
}
