import * as path from 'path';

import { CronType } from '@daechanjo/models';
import { RabbitMQService } from '@daechanjo/rabbitmq';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import * as XLSX from 'xlsx';

import { CoupangApiService } from './coupang.api.service';
import { CoupangSignatureService } from './coupang.signature.service';
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

  async stopSaleForMatchedProducts(cronId: string, type: string, matchedProducts: any[]) {
    console.log(`${type}${cronId}: 쿠팡 아이템 판매 중지 시작`);
    if (matchedProducts.length === 0) {
      console.warn(`${type}${cronId}: 중지할 아이템이 없습니다`);
    }
    const detailedProducts = [];
    for (const [i, product] of matchedProducts.entries()) {
      const progress = Math.floor(((i + 1) / matchedProducts.length) * 100);
      if (progress % 10 === 0) {
        console.log(
          `${type}${cronId}: 중지 아이템 상세조회중 ${i + 1}/${matchedProducts.length} - ${progress}%`,
        );
      }

      const details = await this.coupangApiService.getProductDetail(
        cronId,
        type,
        product.sellerProductId,
      );
      detailedProducts.push(details);
      await new Promise((resolve) => setTimeout(resolve, 500));
    }

    for (const [i, productDetail] of detailedProducts.entries()) {
      const progress = Math.floor(((i + 1) / detailedProducts.length) * 100);
      if (progress % 10 === 0)
        console.log(
          `${type}${cronId}: 아이템 중지중 ${i + 1}/${detailedProducts.length} - ${progress}%`,
        );

      if (productDetail && productDetail.items) {
        const items = productDetail.items;

        for (const item of items) {
          await this.coupangApiService.putStopSellingItem(cronId, type, item.vendorItemId);
          await new Promise((resolve) => setTimeout(resolve, 500));
        }
      }
    }
    return { status: 'success' };
  }

  async deleteProducts(cronId: string, type: string, matchedProducts: any[]) {
    console.log(`${type}${cronId}: 쿠팡 상품 삭제 시작`);
    if (matchedProducts.length === 0) {
      console.warn(`${type}${cronId}: 삭제할 상품이 없습니다`);
      return;
    }

    const deletedProducts: { sellerProductId: number; productName: string }[] = [];
    for (const [i, product] of matchedProducts.entries()) {
      const progress = Math.floor(((i + 1) / matchedProducts.length) * 100);
      if (progress % 10 === 0)
        console.log(
          `${type}${cronId}: 아이템 삭제중 ${i + 1}/${matchedProducts.length} - ${progress}%`,
        );

      try {
        await this.coupangApiService.deleteProduct(product);

        deletedProducts.push({
          sellerProductId: product.sellerProductId,
          productName: product.sellerProductName
            ? product.sellerProductName
            : product.onchItems[0].itemName.trim(),
        });

        await new Promise((resolve) => setTimeout(resolve, 500));
      } catch (error: any) {
        console.error(
          `${CronType.ERROR}${type}${cronId}: 쿠팡 상품 삭제 실패-${product.sellerProductId})\n`,
          error.response?.data || error.message,
        );
      }
    }

    if (deletedProducts.length > 0) {
      try {
        await this.rabbitmqService.emit('mail-queue', 'sendBatchDeletionEmail', {
          deletedProducts: deletedProducts,
          type: type,
          store: this.configService.get<string>('STORE'),
          platformName: 'coupang',
        });
      } catch (error: any) {
        console.error(
          `${CronType.ERROR}${type}${cronId}: 삭제 알림 이메일 발송 실패\n`,
          error.response?.data || error.message,
        );
      }
    }
  }

  async coupangProductsPriceControl(cronId: string, type: string) {
    console.log(`${type}${cronId}: 새로운 상품 가격 업데이트 시작`);

    let successCount = 0;
    let failedCount = 0;

    console.log(`${type}${cronId}: 업데이트 상품정보 요청 메시지 전송`);
    const updatedItems = await this.rabbitmqService.send('price-queue', 'getUpdatedItems', {
      cronId: cronId,
    });

    if (!updatedItems) {
      console.error(
        `${CronType.ERROR}${type}${cronId}: price-queue'에서 'getUpdatedItems' 메시지에 대한 응답이 없습니다\n`,
      );
      throw new Error(
        '업데이트된 항목을 가져올 수 없습니다. 가격 대기열이 올바르게 처리되고 있는지 확인하세요.',
      );
    }

    console.log(`${type}${cronId}: 총 ${updatedItems.data.length}개의 아이템 업데이트`);

    for (const [i, item] of updatedItems.data.entries()) {
      const progress = Math.floor(((i + 1) / updatedItems.data.length) * 100);
      if (progress % 10 === 0)
        console.log(
          `${type}${cronId}: 가격 업데이트 중 ${i + 1}/${updatedItems.data.length} - ${progress}%`,
        );

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
          `${CronType.ERROR}${type}${cronId}: 가격 업데이트 오류-${vendorItemId}\n`,
          error.response?.data || error.message,
        );
      }
    }

    console.log(`${type}${cronId}: 엑셀 생성 시작`);
    setImmediate(async () => {
      try {
        const excelData = updatedItems.data.map((item: any) => ({
          'Seller Product ID': item.sellerProductId,
          'Vendor Item ID': item.vendorItemId,
          'Item Name': item.itemName,
          Action: item.action,
          'New Price': item.newPrice,
          'Current Price': item.currentPrice,
          'Current Is Winner': item.currentIsWinner,
          'Created At': item.createdAt,
        }));

        const worksheet = XLSX.utils.json_to_sheet(excelData);
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, 'UpdatedProducts');

        const filePath = path.resolve(__dirname, '../../../../../tmp', `coupang_${cronId}.xlsx`);

        XLSX.writeFile(workbook, filePath);

        console.log(`${type}${cronId}: 엑셀 파일 전송 요청`);
        await this.rabbitmqService.emit('mail-queue', 'sendUpdateEmail', {
          filePath: filePath,
          successCount: successCount,
          filedCount: failedCount,
          store: this.configService.get<string>('STORE'),
          smartStore: 'coupang',
        });

        console.log(`${type}${cronId}: 엑셀 파일 전송 요청 완료`);
      } catch (error: any) {
        console.error(
          `${CronType.ERROR}${type}${cronId}: 메시지 전송 실패\n`,
          error.response?.data || error.message,
        );
      }
    });

    console.log(`${type}${cronId}: 상품 가격 업데이트 완료`);
  }

  async shippingCostManagement(cronId: string, coupangProductDetails: any, type: string) {
    let successCount = 0;
    let failedCount = 0;

    console.log(`${type}${cronId}: ${coupangProductDetails.length}개 수정 시작...`);

    for (const product of coupangProductDetails) {
      try {
        await this.coupangApiService.putUpdateProduct(product);

        successCount++;
      } catch (error: any) {
        console.error(
          `${CronType.ERROR}${type}${cronId}: 반품 배송비 업데이트 실패-${product.sellerProductId}\n`,
          error.response?.data || error.message,
        );
        failedCount++;
      }
      await new Promise((resolve) => setTimeout(resolve, 300));
    }

    return { successCount: successCount, failedCount: failedCount };
  }

  async clearCoupangProducts() {
    await this.coupangRepository.clearCoupangProducts();
  }
}
