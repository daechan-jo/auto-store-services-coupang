import { CoupangExtractDetail, CronType } from '@daechanjo/models';
import { PlaywrightService } from '@daechanjo/playwright';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { CoupangApiService } from '../coupang.api.service';
import { CoupangService } from '../coupang.service';
import { CrawlCoupangDetailProductsProvider } from './provider/crawlCoupangDetailProducts.provider';
import { DeleteConfirmedCoupangProductProvider } from './provider/deleteConfirmedCoupangProduct.provider';
import { InvoiceUploaderProvider } from './provider/invoiceUploader.provider';
import { OrderStatusUpdateProvider } from './provider/orderStatusUpdate.provider';
import { CoupangRepository } from '../../infrastructure/repository/coupang.repository';

@Injectable()
export class CoupangCrawlerService {
  constructor(
    private readonly playwrightService: PlaywrightService,
    private readonly coupangRepository: CoupangRepository,
    private readonly coupangService: CoupangService,
    private readonly coupangApiService: CoupangApiService,
    private readonly configService: ConfigService,
    private readonly invoiceUploaderProvider: InvoiceUploaderProvider,
    private readonly orderStatusUpdateProvider: OrderStatusUpdateProvider,
    private readonly crawlCoupangDetailProductsProvider: CrawlCoupangDetailProductsProvider,
    private readonly deleteConfirmedCoupangProductProvider: DeleteConfirmedCoupangProductProvider,
  ) {}

  /**
   * 쿠팡 윙에서 주문 상태를 업데이트하는 메서드
   *
   * @param cronId - 현재 실행 중인 크론 작업의 고유 식별자
   * @param type - 로그 메시지에 포함될 작업 유형 식별자
   *
   * @returns {Promise<void>} - 작업 완료 후 반환되는 Promise
   *
   * @throws {Error} - Playwright 작업 중 발생하는 모든 오류
   *
   * @description
   * 이 메서드는 다음 단계로 진행됩니다:
   * 1. 쿠팡 윙 관리자 사이트에 로그인 (playwrightService 사용)
   * 2. 배송 관리 페이지로 이동
   * 3. 결제 완료된 상품 체크박스 선택
   * 4. 주문 확인 버튼 클릭
   * 5. 배송사 선택 (CJ 대한통운)
   * 6. 상세 사유 입력
   * 7. 확인 및 다운로드 버튼 클릭
   * 8. 작업 완료 후 Playwright 컨텍스트 리소스 해제
   *
   * 크롤링 과정에서 오류가 발생하면 에러 로그를 남기고 처리를 계속합니다.
   * 마지막에 컨텍스트 리소스를 확실히 해제하여 메모리 누수를 방지합니다.
   */
  async orderStatusUpdate(cronId: string, type: string): Promise<void> {
    console.log(`${type}${cronId}: 주문 상태 업데이트 시작`);

    // 브라우저 컨텍스트 및 페이지 ID 설정
    const store = this.configService.get<string>('STORE');
    const contextId = `context-${store}-${cronId}`;
    const pageId = `page-${store}-${cronId}`;

    try {
      // 쿠팡 윙 로그인 및 페이지 객체 가져오기
      const coupangPage = await this.playwrightService.loginToCoupangSite(contextId, pageId);

      // 주문 상태 업데이트 프로바이더에 처리 위임
      await this.orderStatusUpdateProvider.updateOrderStatus(coupangPage, cronId, type);

      console.log(`${type}${cronId}: 주문 상태 업데이트 완료`);
    } catch (error) {
      console.error(`${type}${cronId}: 주문 상태 업데이트 중 오류 발생`, error);
    } finally {
      await this.playwrightService.releaseContext(contextId);
    }
  }

  /**
   * 쿠팡 윙에서 주문의 송장 정보를 업로드하는 메서드
   *
   * @param cronId - 현재 실행 중인 크론 작업의 고유 식별자
   * @param updatedOrders - 송장 정보를 업로드할 주문 배열
   * @param type - 로그 메시지에 포함될 작업 유형 식별자
   *
   * @returns {Promise<any[]>} - 각 주문별 송장 업로드 결과 배열
   *
   * @throws {Error} - Processing 버튼을 찾을 수 없는 경우 또는 Playwright 작업 중 발생하는 오류
   *
   * @description
   * 이 메서드는 쿠팡 윙의 송장 업로드 프로세스를 자동화하며 다음 단계로 진행됩니다:
   * 1. 쿠팡 윙 관리자 사이트에 로그인 (playwrightService 사용)
   * 2. 배송 관리 페이지로 이동
   * 3. Processing 상태의 주문 탭 선택
   * 4. 각 주문에 대해:
   *    a. 수취인 이름과 안심번호로 해당 주문 행 찾기
   *    b. 체크박스 선택 (비활성화된 경우 활성화 후 선택)
   *    c. 지정된 배송사 선택
   *    d. 운송장 번호 입력
   *    e. 변경사항 적용 및 페이지 새로고침
   * 5. 모든 주문 처리 후 결과 반환
   *
   * 주문 행을 찾지 못한 경우 여러 페이지를 순회하며 검색합니다.
   * 모든 작업 완료 후 Playwright 컨텍스트 리소스를 해제하여 메모리 누수를 방지합니다.
   * 각 단계마다 적절한 대기 시간을 적용하여 페이지 로딩 및 DOM 업데이트를 기다립니다.
   */
  async invoiceUpload(cronId: string, updatedOrders: any[], type: string): Promise<any[]> {
    console.log(`${type}${cronId}: 송장업로드 시작`);

    // 기본 설정 및 페이지 초기화
    const store = this.configService.get<string>('STORE');
    const contextId = `context-${store}-${cronId}`;
    const pageId = `page-${store}-${cronId}`;

    const coupangPage = await this.playwrightService.loginToCoupangSite(contextId, pageId);

    try {
      // 배송 관리 페이지로 이동
      await this.invoiceUploaderProvider.navigateToDeliveryManagementPage(coupangPage);

      // Processing 버튼 클릭
      await this.invoiceUploaderProvider.clickProcessingButton(coupangPage);

      // 각 주문별 처리 결과 저장
      const results = [];

      // 각 주문 처리
      for (const order of updatedOrders) {
        const result = await this.invoiceUploaderProvider.processOrder(
          coupangPage,
          order,
          type,
          cronId,
        );
        results.push(result);
      }

      return results;
    } finally {
      await this.playwrightService.releaseContext(contextId);
    }
  }

  /**
   * 쿠팡 윙에서 판매자의 상품 상세 정보를 크롤링하는 메서드
   *
   * @param cronId - 현재 실행 중인 크론 작업의 고유 식별자
   * @param type - 로그 메시지에 포함될 작업 유형 식별자
   *
   * @returns {Promise<void>} - 크롤링 작업 완료 후 반환되는 Promise
   *
   * @description
   * 이 메서드는 쿠팡 윙의 판매자 인벤토리 페이지에서 모든 상품의 상세 정보를 크롤링합니다.
   * 페이지네이션을 처리하여 전체 상품 목록을 순회하며, 각 페이지에서 다음 정보를 수집합니다:
   * - 판매자 상품 ID
   * - 상품 코드
   * - 아이템 위너 여부
   * - 판매 가격
   * - 배송비
   *
   * 수집된 데이터는 데이터베이스에 저장되며, 모든 페이지를 크롤링한 후 리소스를 정리합니다.
   * 페이지당 50개 상품을 크롤링하도록 설정되어 있으며, 10페이지마다 진행 상황을 로그로 기록합니다.
   */
  async crawlCoupangDetailProducts(cronId: string, type: string): Promise<void> {
    console.log(`${type}${cronId}: 쿠팡 상품 상세 크롤링 시작...`);

    // 브라우저 컨텍스트 및 페이지 설정
    const store = this.configService.get<string>('STORE');
    const contextId = `context-${store}-${cronId}`;
    const pageId = `page-${store}-${cronId}`;

    try {
      // 쿠팡 윙 로그인 및 페이지 객체 가져오기
      const coupangPage = await this.playwrightService.loginToCoupangSite(contextId, pageId);

      let isLastPage = false;
      let currentPage = 1;

      // 모든 페이지 순회
      while (!isLastPage) {
        // 진행 상황 로깅 (10페이지마다)
        if (currentPage % 10 === 0) {
          console.log(`${type}${cronId}: 상품 스크랩핑중 - 현재 페이지 ${currentPage}`);
        }

        // 현재 페이지 크롤링
        const scrapedProducts: CoupangExtractDetail[] =
          await this.crawlCoupangDetailProductsProvider.scrapeProductPage(coupangPage, currentPage);

        // 수집된 데이터 저장
        await this.coupangRepository.saveCoupangProductDetails(scrapedProducts);

        // 다음 페이지 확인
        if (scrapedProducts.length === 0) {
          console.log(`${type}${cronId}: 더 이상 상품이 없습니다. 크롤링 종료`);
          isLastPage = true;
        } else {
          currentPage++;
        }
      }
    } catch (error) {
      console.error(`${type}${cronId}: 상품 크롤링 중 오류 발생`, error);
    } finally {
      await this.playwrightService.releaseContext(contextId);
      console.log(`${type}${cronId}: 쿠팡 상품 상세 크롤링 종료`);
    }
  }

  /**
   * 쿠팡 윙에서 비준수(컨펌) 상품을 찾아 판매 중지 및 삭제하는 메서드
   *
   * @param cronId - 현재 실행 중인 크론 작업의 고유 식별자
   * @param type - 로그 메시지에 포함될 작업 유형 식별자
   *
   * @returns {Promise<{matchedProducts: any[]} | undefined>} - 일치하는 상품 목록 또는 없을 경우 undefined
   *
   * @description
   * 이 메서드는 쿠팡 윙에서 비준수(컨펌) 상태의 상품을 식별하고 삭제하는 전체 프로세스를 관리합니다:
   *
   * 1. 쿠팡 윙 관리자 사이트에 로그인 (playwrightService 사용)
   * 2. 비준수 상품 목록 페이지로 이동 (exposureStatus=NON_CONFORMING_ATTR)
   * 3. 페이지에서 모든 비준수 상품의 상품 코드 추출
   * 4. API를 통해 판매자의 전체 상품 목록 조회
   * 5. 비준수 상품 코드와 일치하는 상품 식별
   * 6. 일치하는 상품에 대해 판매 중지 및 삭제 처리
   *
   * 이 메서드는 비준수 상품이 없는 경우 undefined를 반환하며,
   * 모든 작업이 완료되면 일치하는 상품 목록을 포함한 객체를 반환합니다.
   * 작업 중 발생하는 오류는 로그로 기록되며, 컨텍스트 리소스는 항상 해제됩니다.
   */
  async deleteConfirmedCoupangProduct(
    cronId: string,
    type: string,
  ): Promise<{ matchedProducts: any[] } | undefined> {
    // 브라우저 컨텍스트 및 페이지 설정
    const store = this.configService.get<string>('STORE');
    const contextId = `context-${store}-${cronId}`;
    const pageId = `page-${store}-${cronId}`;

    try {
      // 쿠팡 윙 로그인 및 페이지 객체 가져오기
      const coupangPage = await this.playwrightService.loginToCoupangSite(contextId, pageId);

      // 비준수 상품 목록 페이지로 이동
      await this.deleteConfirmedCoupangProductProvider.navigateToNonConformingProductsPage(
        coupangPage,
      );

      // 비준수 상품 코드 추출
      let conformProductCodes: string[];
      try {
        conformProductCodes =
          await this.deleteConfirmedCoupangProductProvider.extractNonConformingProductCodes(
            coupangPage,
            cronId,
            type,
          );
      } catch (error: any) {
        // 비준수 상품이 없는 경우
        console.log(`${type}${cronId}: 비준수 상품이 없습니다`, error);
        await this.playwrightService.releaseContext(contextId);
        return undefined;
      }

      // 브라우저 컨텍스트 해제 (API 요청 전에 리소스 확보)
      await this.playwrightService.releaseContext(contextId);

      // API를 통해 판매자의 상품 목록 조회
      const coupangProducts = await this.coupangApiService.getProductListPaging(
        cronId,
        CronType.CONFORM,
      );

      // 비준수 상품 코드와 일치하는 상품 찾기
      const matchedProducts = this.deleteConfirmedCoupangProductProvider.findMatchingProducts(
        conformProductCodes,
        coupangProducts,
      );

      console.log(`${type}${cronId}: 컨펌 상품\n`, matchedProducts);

      if (matchedProducts.length > 0) {
        // 일치하는 상품 판매 중지 및 삭제
        await this.coupangService.stopSaleForMatchedProducts(
          cronId,
          CronType.CONFORM,
          matchedProducts,
        );
        await this.coupangService.deleteProducts(cronId, CronType.CONFORM, matchedProducts);
        console.log(`${type}${cronId}: 쿠팡 컨펌상품 삭제 완료`);
      } else {
        console.log(`${type}${cronId}: 삭제할 컨펌상품이 없습니다`);
      }

      return { matchedProducts };
    } catch (error) {
      console.error(`${type}${cronId}: 컨펌상품 삭제 중 오류 발생`, error);
      await this.playwrightService.releaseContext(contextId);
      return undefined;
    }
  }
}
