import { CronType, RabbitmqMessage } from '@daechanjo/models';
import { InjectQueue } from '@nestjs/bull';
import { Controller } from '@nestjs/common';
import { MessagePattern } from '@nestjs/microservices';
import { Queue } from 'bull';

import { CoupangApiService } from '../core/coupang.api.service';
import { CoupangService } from '../core/coupang.service';
import { CoupangCrawlerService } from '../core/crawler/coupang.crawler.service';

@Controller()
export class CoupangMessageController {
  constructor(
    private readonly coupangService: CoupangService,
    private readonly coupangApiService: CoupangApiService,
    private readonly coupangCrawlerService: CoupangCrawlerService,
    @InjectQueue('coupang-message-queue') private readonly messageQueue: Queue,
  ) {}

  @MessagePattern('coupang-queue')
  async processMessage(message: RabbitmqMessage) {
    const { pattern, payload } = message;
    console.log(`${payload.type}${payload.cronId}: 📬${pattern}`);

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

      case 'crawlCoupangDetailProducts':
        await this.coupangCrawlerService.crawlCoupangDetailProducts(payload.cronId, payload.type);
        return 'success';

      case 'deleteConfirmedCoupangProduct':
        const matchedProducts = await this.coupangCrawlerService.deleteConfirmedCoupangProduct(
          payload.cronId,
          payload.type,
        );
        return { status: 'success', data: matchedProducts };

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
        break;

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

      case 'saveUpdateCoupangItems':
        await this.coupangService.saveUpdateCoupangItems(
          payload.cronId,
          payload.type,
          payload.items,
        );
        return { status: 'success' };

      default:
        console.error(
          `${CronType.ERROR}${payload.type}${payload.cronId}: 📬알 수 없는 패턴 유형 ${pattern}`,
        );
        return { status: 'error', message: `알 수 없는 패턴 유형: ${pattern}` };
    }
  }
}
