import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';

import { CoupangSignatureService } from './coupang.signature.service';
import { ICoupangProduct } from '../../../../../lib/types/coupangProduct.interface';
import { CronType } from '../../types/enum.type';

@Injectable()
export class CoupangApiService {
  constructor(
    private readonly signatureService: CoupangSignatureService,
    private readonly configService: ConfigService,
  ) {}

  async getProductListPaging(cronId: string, type: string): Promise<ICoupangProduct[]> {
    console.log(`${type}${cronId}: 쿠팡 전체상품 조회...`);
    const apiPath = '/v2/providers/seller_api/apis/api/v1/marketplace/seller-products';

    let nextToken = '';
    let pageCount = 0;
    const allProducts: ICoupangProduct[] = [];
    const maxRetries = 3; // 최대 재시도 횟수

    try {
      while (true) {
        let retryCount = 0;

        while (retryCount < maxRetries) {
          try {
            const { authorization, datetime } = await this.signatureService.createHmacSignature(
              'GET',
              apiPath,
              nextToken,
              true,
            );

            await new Promise((resolve) => setTimeout(resolve, 1000));

            const response = await axios.get(`https://api-gateway.coupang.com${apiPath}`, {
              headers: {
                Authorization: authorization,
                'Content-Type': 'application/json;charset=UTF-8',
                'X-EXTENDED-TIMEOUT': '90000',
                'X-Coupang-Date': datetime,
              },
              params: {
                vendorId: this.configService.get<string>('L_COUPANG_VENDOR_ID'),
                nextToken: nextToken,
                maxPerPage: 100,
                status: 'APPROVED',
              },
            });

            const { data } = response.data;
            allProducts.push(...data);

            nextToken = response.data.nextToken;
            pageCount++;

            if (pageCount % 10 === 0)
              console.log(
                `${type}${cronId}: 진행중 - 현재 페이지 ${pageCount}, ${allProducts.length} 수집됨`,
              );

            if (!nextToken) {
              // nextToken이 없으면 마지막 페이지이므로 종료
              break;
            }

            // 성공 시 재시도 루프 종료
            break;
          } catch (error: any) {
            retryCount++;
            console.error(
              `${CronType.ERROR}${type}${cronId}: API 요청 오류, 재시도 ${retryCount}/${maxRetries}\n`,
              error.response?.data || error.message,
            );

            // 재시도 횟수 초과 시 throw
            if (retryCount >= maxRetries) {
              throw new Error(
                `${CronType.ERROR}${type}${cronId}: 최대 재시도 횟수를 초과하여 요청 실패 (nextToken: ${nextToken || '없음'})`,
              );
            }

            // 짧은 대기 후 재시도
            await new Promise((resolve) => setTimeout(resolve, 2000));
          }
        }

        // 다음 페이지로 이동
        if (!nextToken) break;
      }

      return allProducts;
    } catch (error: any) {
      console.error(
        `${CronType.ERROR}${type}${cronId}: API 요청 중단\n`,
        error.response?.data || error.message,
      );
      throw new Error('쿠팡 API 요청 실패');
    }
  }

  async getProductDetail(cronId: string, type: string, sellerProductId: number) {
    const apiPath = `/v2/providers/seller_api/apis/api/v1/marketplace/seller-products/${sellerProductId}`;

    const { authorization, datetime } = await this.signatureService.createHmacSignature(
      'GET',
      apiPath,
      '',
      false,
    );

    try {
      const response = await axios.get(`https://api-gateway.coupang.com${apiPath}`, {
        headers: {
          Authorization: authorization,
          'Content-Type': 'application/json;charset=UTF-8',
          'X-EXTENDED-TIMEOUT': '90000',
          'X-Coupang-Date': datetime,
        },
      });

      return response.data.data;
    } catch (error: any) {
      console.error(
        `${CronType.ERROR}${type}${cronId}: 상품 상세 조회 오류 ${sellerProductId}\n`,
        error.response?.data || error.message,
      );
      throw new Error('쿠팡 상품 상세 조회 실패');
    }
  }

  async getCoupangOrderList(
    cronId: string,
    type: string,
    status: string,
    vendorId: string,
    today: string,
    yesterday: string,
  ) {
    const apiPath = `/v2/providers/openapi/apis/api/v4/vendors/${vendorId}/ordersheets`;

    let nextToken = '';
    const allProducts = [];
    try {
      while (true) {
        const { authorization, datetime } = await this.signatureService.createParamHmacSignature(
          'GET',
          apiPath,
          {
            vendorId,
            createdAtFrom: yesterday,
            createdAtTo: today,
            status: status,
            nextToken: nextToken,
            maxPerPage: 50,
          },
        );

        const response = await axios.get(`https://api-gateway.coupang.com${apiPath}`, {
          headers: {
            Authorization: authorization,
            'Content-Type': 'application/json;charset=UTF-8',
            'X-EXTENDED-TIMEOUT': '90000',
            'X-Coupang-Date': datetime,
          },
          params: {
            vendorId: this.configService.get<string>('L_COUPANG_VENDOR_ID'),
            createdAtFrom: yesterday,
            createdAtTo: today,
            status: status,
            nextToken: nextToken,
            maxPerPage: 50,
          },
        });

        const { data } = response.data;
        allProducts.push(...data);

        nextToken = response.data.nextToken;
        if (!nextToken) break;
      }

      return allProducts;
    } catch (error: any) {
      console.error(
        `${CronType.ERROR}${type}${cronId}: API 요청 오류\n`,
        error.response?.data || error.message,
      );

      throw new Error('쿠팡 API 요청 실패');
    }
  }

  async putStopSellingItem(cronId: string, type: string, vendorItemId: number) {
    const apiPath = `/v2/providers/seller_api/apis/api/v1/marketplace/vendor-items/${vendorItemId}/sales/stop`;

    const { authorization, datetime } = await this.signatureService.createHmacSignature(
      'PUT',
      apiPath,
      '',
      false,
    );

    try {
      await axios.put(`https://api-gateway.coupang.com${apiPath}`, null, {
        headers: {
          Authorization: authorization,
          'Content-Type': 'application/json;charset=UTF-8',
          'X-EXTENDED-TIMEOUT': '90000',
          'X-Coupang-Date': datetime,
        },
      });
    } catch (error: any) {
      console.error(
        `${CronType.ERROR}${type}${cronId}: 아이템 판매 중지 실패 ${vendorItemId}\n`,
        error.response?.data || error.message,
      );
    }
  }

  async deleteProduct(product: any) {
    const apiPath = `/v2/providers/seller_api/apis/api/v1/marketplace/seller-products/${product.sellerProductId}`;
    const { authorization, datetime } = await this.signatureService.createHmacSignature(
      'DELETE',
      apiPath,
      '',
      false,
    );

    return axios.delete(`https://api-gateway.coupang.com${apiPath}`, {
      headers: {
        Authorization: authorization,
        'Content-Type': 'application/json;charset=UTF-8',
        'X-EXTENDED-TIMEOUT': '90000',
        'X-Coupang-Date': datetime,
      },
    });
  }

  async putUpdateProduct(product: any) {
    const updatePath = `/v2/providers/seller_api/apis/api/v1/marketplace/seller-products/${product.sellerProductId}/partial`;
    const body = { sellerProductId: product.sellerProductId, returnCharge: 5000 };

    const { authorization, datetime } = await this.signatureService.createHmacSignature(
      'PUT',
      updatePath,
      '',
      false,
    );

    await axios.put(`https://api-gateway.coupang.com${updatePath}`, body, {
      headers: {
        Authorization: authorization,
        'Content-Type': 'application/json;charset=UTF-8',
        'X-Coupang-Date': datetime,
      },
    });
  }
}
