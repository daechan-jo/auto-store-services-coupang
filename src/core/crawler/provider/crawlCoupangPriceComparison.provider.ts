import { Injectable } from '@nestjs/common';
import { Page } from 'playwright';
import { CoupangPriceComparisonData } from '@daechanjo/models';
import { CoupangRepository } from '../../../infrastructure/repository/coupang.repository';

@Injectable()
export class CrawlCoupangPriceComparisonProvider {
  constructor(private readonly coupangRepository: CoupangRepository) {}

  /**
   * 가격 비교 페이지를 스크래핑하는 메서드
   *
   * @param coupangPage - Playwright의 Page 객체
   * @param winnerStatus - 가격 경쟁 상태 (WIN_NOT_SUPPRESSED 또는 LOSE_NOT_SUPPRESSED)
   * @param cronId - 크론 작업 식별자
   * @param type - 로그 유형
   * @returns {Promise<void>} - 스크래핑 완료 후 Promise 반환
   */
  async scrapePriceComparisonPages(
    coupangPage: Page,
    winnerStatus: 'LOSE_NOT_SUPPRESSED' | 'WIN_NOT_SUPPRESSED',
    cronId: string,
    type: string,
  ): Promise<void> {
    let currentPage = 1;

    // 모든 페이지 순회
    while (true) {
      // 현재 페이지 URL 구성
      const pageUrl = `https://wing.coupang.com/tenants/seller-price-management/?searchInputValue=&searchInputType=KEYWORD&itemWinnerStatus=${winnerStatus}&salesMethod=ALL&autoPriceStatus=ALL&salesStatus=ON_SALE&alarmStatus=ALL&listingDate.startDate=&listingDate.endDate=&searchPresets&isTopGMV&page=${currentPage}&pageSize=100&sortingType=MY_VI_SALES_DESC`;

      // API 응답 캐치 설정
      const responsePromise = coupangPage.waitForResponse(
        (response) => response.url().includes('getProductList') && response.status() === 200,
      );

      // 페이지로 이동
      await coupangPage.goto(pageUrl);

      // 응답 기다리기
      const productListResponse = await responsePromise;

      // 응답 데이터 가져오기
      const responseData: {
        totalSize: number;
        page: number;
        pageSize: number;
        totalPages: number;
        vendorItemIds: string | number | null;
        result: CoupangPriceComparisonData[];
      } = await productListResponse.json();

      // 데이터 저장
      await this.coupangRepository.savePriceComparison(responseData.result);
      console.log(
        `${type}${cronId}: ${currentPage}/${responseData.totalPages} 페이지 - ${responseData.result.length}개 데이터 수집 완료`,
      );

      // 마지막 페이지 확인
      if (responseData.totalPages === currentPage) break;

      currentPage++;

      // 마지막 페이지가 아니라면 잠시 대기
      if (currentPage <= responseData.totalPages) {
        await coupangPage.waitForTimeout(1000);
      }
    }
  }
}
