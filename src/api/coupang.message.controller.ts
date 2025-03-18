import { CronType } from '@daechanjo/models';
import { InjectQueue } from '@nestjs/bull';
import { Controller } from '@nestjs/common';
import { MessagePattern } from '@nestjs/microservices';
import { Queue } from 'bull';

import { CoupangApiService } from '../core/coupang.api.service';
import { CoupangService } from '../core/coupang.service';

@Controller()
export class CoupangMessageController {
  constructor(
    private readonly coupangService: CoupangService,
    private readonly coupangApiService: CoupangApiService,
    @InjectQueue('coupang-message-queue') private readonly messageQueue: Queue,
  ) {}

  @MessagePattern('coupang-queue')
  async handleMailMessage(message: any) {
    const { pattern, payload } = message;
    const type = payload.type;
    const cronId = payload.cronId;

    try {
      const queuePatterns = [
        'orderStatusUpdate',
        'invoiceUpload',
        'crawlCoupangDetailProducts',
        'deleteConfirmedCoupangProduct',
      ];

      if (queuePatterns.includes(pattern)) {
        console.log(`${type}${cronId}: 📨${pattern}`);
        const job = await this.messageQueue.add('process-message', message);

        // 결과를 반환해야 하는 경우
        if (
          ['invoiceUpload', 'crawlCoupangDetailProducts', 'deleteConfirmedCoupangProduct'].includes(
            pattern,
          )
        ) {
          const result = await job.finished();
          return { status: 'success', data: result };
        }

        return;
      }
      return await this.processMessage(pattern, payload, type, cronId);
    } catch (error: any) {
      console.error(`${CronType.ERROR}${type}${cronId}:  📬${pattern}\n`, error);
      return { status: 'error', message: error.message };
    }
  }

  async processMessage(pattern: string, payload: any, type: string, cronId: string) {
    console.log(`${type}${cronId}: 📬${pattern}`);

    switch (pattern) {
      case 'getProductListPaging':
        const coupangProducts = await this.coupangApiService.getProductListPaging(
          payload.cronId,
          payload.type,
        );
        return { status: 'success', data: coupangProducts };

      case 'getProductDetail':
        const coupangProduct = await this.coupangApiService.getProductDetail(
          payload.cronId,
          payload.type,
          payload.sellerProductId,
        );
        return { status: 'success', data: coupangProduct };

      case 'getCoupangOrderList':
        const coupangOrderList = await this.coupangApiService.getCoupangOrderList(
          payload.cronId,
          payload.type,
          payload.status,
          payload.vendorId,
          payload.today,
          payload.yesterday,
        );
        return { status: 'success', data: coupangOrderList };

      case 'putStopSellingItem':
        await this.coupangApiService.putStopSellingItem(
          payload.cronId,
          payload.type,
          payload.vendorItemId,
        );
        break;

      case 'stopSaleForMatchedProducts':
        await this.coupangService.stopSaleForMatchedProducts(
          payload.cronId,
          payload.type,
          payload.matchedProducts,
        );
        return { status: 'success' };

      case 'deleteProducts':
        await this.coupangService.deleteProducts(
          payload.cronId,
          payload.type,
          payload.matchedProducts,
        );
        return { status: 'success' };

      case 'coupangProductsPriceControl':
        await this.coupangService.coupangProductsPriceControl(payload.cronId, payload.type);
        return { status: 'success' };

      case 'shippingCostManagement':
        const shippingCostResult = await this.coupangService.shippingCostManagement(
          payload.cronId,
          payload.coupangProductDetails,
          payload.type,
        );
        return { status: 'success', data: shippingCostResult };

      case 'clearCoupangProducts':
        await this.coupangService.clearCoupangProducts();
        return { status: 'success' };

      default:
        console.error(`${CronType.ERROR}${type}${cronId}: 📬알 수 없는 패턴 유형 ${pattern}`);
        return { status: 'error', message: `알 수 없는 패턴 유형: ${pattern}` };
    }
  }
}
