import {
  AdjustData,
  CoupangComparisonWithOnchData,
  CoupangInvoice,
  JobType,
  InvoiceUploadResult,
  OnchWithCoupangProduct,
} from '@daechanjo/models';
import { RabbitMQService } from '@daechanjo/rabbitmq';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import * as XLSX from 'xlsx';

import { CoupangApiService } from './coupang.api.service';
import { CoupangSignatureService } from './coupang.signature.service';
import { CoupangUpdateItemEntity } from '../infrastructure/entities/coupangUpdateItem.entity';
import { CoupangRepository } from '../infrastructure/repository/coupang.repository';

@Injectable()
export class CoupangService {
  constructor(
    private readonly configService: ConfigService,
    private readonly signatureService: CoupangSignatureService,
    private readonly coupangRepository: CoupangRepository,
    private readonly rabbitmqService: RabbitMQService,
    private readonly coupangApiService: CoupangApiService,
  ) {}

  async stopSaleBySellerProductId(
    jobId: string,
    jobType: string,
    data: OnchWithCoupangProduct[] | CoupangComparisonWithOnchData[],
  ) {
    console.log(`${jobType}${jobId}: 쿠팡 아이템 판매 중지 시작`);
    if (data.length === 0) {
      console.warn(`${jobType}${jobId}: 중지할 아이템이 없습니다`);
    }
    const detailedProducts = [];

    for (const [i, product] of data.entries()) {
      if (i % Math.ceil(data.length / 10) === 0) {
        const progressPercentage = ((i + 1) / data.length) * 100;
        console.log(
          `${jobType}${jobId}: 중지 상품 상세조회중 ${i + 1}/${data.length} (${progressPercentage.toFixed(2)}%)`,
        );
      }

      const productId =
        jobType === JobType.SOLDOUT
          ? +(product as OnchWithCoupangProduct).sellerProductId
          : (product as CoupangComparisonWithOnchData).vendorInventoryId;

      const details = await this.coupangApiService.getProductDetail(jobId, jobType, productId);
      detailedProducts.push(details);
      await new Promise((resolve) => setTimeout(resolve, 500));
    }

    for (const [i, productDetail] of detailedProducts.entries()) {
      if (i % Math.ceil(detailedProducts.length / 10) === 0) {
        const progressPercentage = ((i + 1) / detailedProducts.length) * 100;
        console.log(
          `${jobType}${jobId}: 아이템 중지중 ${i + 1}/${detailedProducts.length} (${progressPercentage.toFixed(2)}%)`,
        );
      }

      if (productDetail && productDetail.items) {
        const items = productDetail.items;

        for (const item of items) {
          await this.coupangApiService.putStopSellingItem(jobId, jobType, item.vendorItemId);
          await new Promise((resolve) => setTimeout(resolve, 500));
        }
      }
    }

    return { status: 'success' };
  }

  async deleteProducts(
    jobId: string,
    jobType: string,
    data: OnchWithCoupangProduct[] | CoupangComparisonWithOnchData[],
  ) {
    console.log(`${jobType}${jobId}: 쿠팡 상품 삭제 시작`);
    if (data.length === 0) {
      console.warn(`${jobType}${jobId}: 삭제할 상품이 없습니다`);
      return;
    }

    const deletedProducts: { sellerProductId: number; productName: string }[] = [];
    for (const [i, product] of data.entries()) {
      if (i % Math.ceil(data.length / 10) === 0) {
        const progressPercentage = ((i + 1) / data.length) * 100;
        console.log(
          `${jobType}${jobId}: 아이템 삭제중 ${i + 1}/${data.length} (${progressPercentage.toFixed(2)}%)`,
        );
      }

      const productId =
        jobType === JobType.SOLDOUT
          ? +(product as OnchWithCoupangProduct).sellerProductId
          : (product as CoupangComparisonWithOnchData).vendorInventoryId;

      const productName =
        jobType === JobType.SOLDOUT
          ? (product as OnchWithCoupangProduct).sellerProductName
          : (product as CoupangComparisonWithOnchData).productName;

      try {
        await this.coupangApiService.deleteProduct(productId);

        deletedProducts.push({
          sellerProductId: productId,
          productName: productName,
        });

        await new Promise((resolve) => setTimeout(resolve, 500));
      } catch (error: any) {
        console.error(
          `${JobType.ERROR}${jobType}${jobId}: 쿠팡 상품 삭제 실패-${productId})\n`,
          error.response?.data || error.message,
        );
      }
    }

    if (deletedProducts.length > 0) {
      try {
        await this.rabbitmqService.emit('mail-queue', 'sendBatchDeletionEmail', {
          deletedProducts: deletedProducts,
          jobType: jobType,
          store: this.configService.get<string>('STORE'),
          platformName: 'coupang',
        });
      } catch (error: any) {
        console.error(
          `${JobType.ERROR}${jobType}${jobId}: 삭제 알림 이메일 발송 실패\n`,
          error.response?.data || error.message,
        );
      }
    }
  }

  async coupangProductsPriceControl(jobId: string, jobType: string) {
    console.log(`${jobType}${jobId}: 새로운 상품 가격 업데이트 시작`);

    let successCount = 0;
    let failedCount = 0;

    const updatedItems = await this.coupangRepository.getUpdatedItems(jobId);

    if (updatedItems.length === 0) {
      console.log(`${jobType}${jobId}: 새로운 업데이트가 없습니다. 종료합니다.`);
      return;
    }

    console.log(`${jobType}${jobId}: 총 ${updatedItems.length}개의 아이템 업데이트`);

    for (const [i, item] of updatedItems.entries()) {
      if (i % Math.ceil(updatedItems.length / 10) === 0) {
        const progressPercentage = ((i + 1) / updatedItems.length) * 100;
        console.log(
          `${jobType}${jobId}: 가격 업데이트중 ${i + 1}/${updatedItems.length} (${progressPercentage.toFixed(2)}%)`,
        );
      }

      const vendorItemId = item.vendorItemId;

      const priceUpdatePath = `/v2/providers/seller_api/apis/api/v1/marketplace/vendor-items/${vendorItemId}/prices/${item.newPrice}`;

      const { authorization, datetime } = await this.signatureService.createHmacSignature(
        'PUT',
        priceUpdatePath,
        '',
        false,
      );

      try {
        await axios.put(`https://api-gateway.coupang.com${priceUpdatePath}`, null, {
          headers: {
            Authorization: authorization,
            'Content-Type': 'application/json;charset=UTF-8',
            'X-Coupang-Date': datetime,
          },
        });

        successCount++;
        await new Promise((resolve) => setTimeout(resolve, 100));
      } catch (error: any) {
        failedCount++;
        console.error(
          `${JobType.ERROR}${jobType}${jobId}: 가격 업데이트 오류-${vendorItemId}\n`,
          error.response?.data || error.message,
        );
      }
    }

    console.log(`${jobType}${jobId}: 엑셀 생성 시작`);
    setImmediate(async () => {
      try {
        const excelData = updatedItems.map((item: CoupangUpdateItemEntity) => ({
          'Vendor Item ID': item.vendorItemId,
          'Product Name': item.productName,
          'Winner Price': item.winnerPrice,
          'Current Price': item.currentPrice,
          'Seller Price': item.sellerPrice,
          'New Price': item.newPrice,
        }));

        const worksheet = XLSX.utils.json_to_sheet(excelData);
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, 'UpdatedProducts');
        const filePath = '/Users/daechanjo/codes/project/auto-store/tmp/coupang_' + jobId + '.xlsx';

        XLSX.writeFile(workbook, filePath);

        console.log(`${jobType}${jobId}: 엑셀 파일 전송 요청`);
        await this.rabbitmqService.emit('mail-queue', 'sendUpdateEmail', {
          filePath: filePath,
          successCount: successCount,
          filedCount: failedCount,
          store: this.configService.get<string>('STORE'),
          smartStore: 'coupang',
        });

        console.log(`${jobType}${jobId}: 엑셀 파일 전송 요청 완료`);
      } catch (error: any) {
        console.error(
          `${JobType.ERROR}${jobType}${jobId}: 메시지 전송 실패\n`,
          error.response?.data || error.message,
        );
      }
    });

    console.log(`${jobType}${jobId}: 상품 가격 업데이트 완료`);
  }

  async shippingCostManagement(jobId: string, jobType: string, coupangProductDetails: any) {
    let successCount = 0;
    let failedCount = 0;

    console.log(`${jobType}${jobId}: ${coupangProductDetails.length}개 수정 시작...`);

    for (const product of coupangProductDetails) {
      try {
        await this.coupangApiService.putUpdateProduct(product);

        successCount++;
      } catch (error: any) {
        console.error(
          `${JobType.ERROR}${jobType}${jobId}: 반품 배송비 업데이트 실패-${product.sellerProductId}\n`,
          error.response?.data || error.message,
        );
        failedCount++;
      }
      await new Promise((resolve) => setTimeout(resolve, 300));
    }

    return { successCount: successCount, failedCount: failedCount };
  }

  async clearCoupangComparison() {
    await this.coupangRepository.clearCoupangComparison();
  }

  async saveUpdateCoupangItems(jobId: string, jobType: string, items: AdjustData[]) {
    await this.coupangRepository.saveUpdatedCoupangItems(items, jobId);
  }

  async getComparisonCount() {
    return this.coupangRepository.getComparisonCount();
  }

  /**
   * 쿠팡 송장 정보를 순차적으로 업로드합니다.
   * @param jobId 크론 작업 ID
   * @param jobType 작업 유형
   * @param invoices 업로드할 송장 목록
   */
  async uploadInvoices(
    jobId: string,
    jobType: string,
    invoices: CoupangInvoice[],
  ): Promise<InvoiceUploadResult[]> {
    const results: InvoiceUploadResult[] = [];

    for (const invoice of invoices) {
      const result: InvoiceUploadResult = {
        orderId: invoice.orderId,
        status: 'failed', // 기본값은 실패로 설정
        courierName: invoice.courier.courier,
        trackingNumber: invoice.courier.trackNumber,
        name: invoice.courier.nameText,
        safeNumber: invoice.courier.phoneText,
        error: '',
      };

      try {
        // 송장 업로드 시도
        await this.coupangApiService.uploadInvoice(jobId, jobType, invoice);

        // 성공 시 상태 업데이트
        result.status = 'success';
      } catch (error: any) {
        // 오류 메시지 저장
        result.error = error.message || '알 수 없는 오류';
        console.error(
          `${jobType}${jobId}: 주문 ${invoice.orderId} 송장 업로드 실패\n`,
          error.response?.data || error.message,
        );
      }

      // 결과 배열에 추가
      results.push(result);

      // 요청 간 간격 두기
      await new Promise((resolve) => setTimeout(resolve, 500));
    }

    return results;
  }
}
