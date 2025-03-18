import { Injectable } from '@nestjs/common';
import { Page } from 'playwright';

/**
 * 쿠팡 윙 관리자 페이지에서 상품 상세 정보를 크롤링하는 프로바이더
 *
 * @description
 * 이 프로바이더는 쿠팡 윙의 판매자 인벤토리 페이지를 크롤링하여
 * 상품 코드, 가격, 배송비, 아이템 위너 상태 등의 상세 정보를 수집합니다.
 * 페이지네이션을 처리하고 스크롤 동작을 포함한 크롤링 로직을 캡슐화합니다.
 */
@Injectable()
export class CrawlCoupangDetailProductsProvider {
  constructor() {}

  /**
   * 특정 페이지의 상품 목록을 스크래핑하는 메서드
   *
   * @param page - Playwright의 Page 객체
   * @param currentPage - 현재 크롤링할 페이지 번호
   * @returns {Promise<any[]>} - 스크래핑된 상품 정보 배열
   *
   * @description
   * 이 메서드는 쿠팡 윙의 특정 페이지로 이동하여 상품 정보를 스크래핑합니다.
   * 각 상품의 판매자 상품 ID, 상품 코드, 아이템 위너 여부, 가격, 배송비 정보를 추출합니다.
   * 페이지 내의 모든 콘텐츠를 확인하기 위해 점진적인 스크롤 동작을 수행합니다.
   */
  async scrapeProductPage(page: Page, currentPage: number): Promise<any[]> {
    // 페이지 이동 및 로딩 대기
    await this.navigateToProductPage(page, currentPage);

    // 페이지 로딩 후 잠시 대기
    await this.delay(3000);

    // 페이지 전체 스크롤 수행
    await this.scrollFullPage(page);

    // 추가 대기로 동적 콘텐츠가 모두 로드되도록 함
    await this.delay(3000);

    // 페이지의 모든 상품 정보 추출
    return this.extractProductDetails(page);
  }

  /**
   * 상품 인벤토리 페이지로 이동
   *
   * @param page - Playwright의 Page 객체
   * @param pageNumber - 이동할 페이지 번호
   * @returns {Promise<void>} - 네비게이션 완료 후 Promise 반환
   *
   * @description
   * 쿠팡 윙의 판매자 인벤토리 목록 페이지로 이동합니다.
   * URL 파라미터를 통해 페이지 번호, 정렬 방식, 페이지당 항목 수 등을 지정합니다.
   */
  private async navigateToProductPage(page: Page, pageNumber: number): Promise<void> {
    await page.goto(
      `https://wing.coupang.com/vendor-inventory/list?searchKeywordType=ALL&searchKeywords=&salesMethod=ALL&productStatus=ALL&stockSearchType=ALL&shippingFeeSearchType=ALL&displayCategoryCodes=&listingStartTime=null&listingEndTime=null&saleEndDateSearchType=ALL&bundledShippingSearchType=ALL&displayDeletedProduct=false&shippingMethod=ALL&exposureStatus=ALL&locale=ko_KR&sortMethod=SORT_BY_ITEM_LEVEL_UNIT_SOLD&countPerPage=50&page=${pageNumber}`,
    );
  }

  /**
   * 지정된 시간(밀리초) 동안 실행을 지연
   *
   * @param ms - 지연할 시간(밀리초)
   * @returns {Promise<void>} - 지연 시간 경과 후 resolve되는 Promise
   */
  private async delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * 페이지 전체를 부드럽게 스크롤
   *
   * @param page - Playwright의 Page 객체
   * @returns {Promise<void>} - 스크롤 완료 후 Promise 반환
   *
   * @description
   * 페이지의 모든 콘텐츠를 로드하기 위해 상단에서 하단까지 점진적으로 스크롤합니다.
   * 자연스러운 사용자 동작을 모방하여 봇 탐지를 회피하고 동적 콘텐츠가 로드되도록 합니다.
   */
  private async scrollFullPage(page: Page): Promise<void> {
    await page.evaluate(async () => {
      const scrollStep = 100; // 한 번에 스크롤할 픽셀 수
      const scrollDelay = 100; // 스크롤 간 딜레이(ms)

      for (let y = 0; y < document.body.scrollHeight; y += scrollStep) {
        window.scrollBy(0, scrollStep);
        await new Promise((resolve) => setTimeout(resolve, scrollDelay)); // 각 스크롤 간격마다 대기
      }
    });
  }

  /**
   * 페이지에서 상품 정보 추출
   *
   * @param page - Playwright의 Page 객체
   * @returns {Promise<any[]>} - 추출된 상품 정보 배열
   *
   * @description
   * 페이지 내의 모든 상품 행('tr.inventory-line')에서 필요한 정보를 추출합니다.
   * DOM에서 상품 ID, 코드, 가격, 배송비, 아이템 위너 상태 등의 정보를 파싱합니다.
   */
  private async extractProductDetails(page: Page): Promise<any[]> {
    return page.evaluate(() => {
      const getPrice = (text: string) => text?.replace(/[^0-9]/g, '') || null;

      // 모든 상품 행을 순회하며 데이터 추출
      return Array.from(document.querySelectorAll('tr.inventory-line')).map((row) => {
        const ipContentDiv = row.querySelector('.ip-right .ip-content div:nth-child(3)');
        const sellerProductId = ipContentDiv
          ? ipContentDiv.textContent.replace(/[^0-9]/g, '')
          : null;

        const productCode =
          row.querySelector('.ip-title')?.textContent?.trim().split(' ')[0] || null;

        const isWinnerContainer = row.querySelector('.ies-container');
        const isWinnerText =
          isWinnerContainer?.querySelector('.ies-top')?.textContent?.trim().replace(/\s/g, '') ||
          '';
        const isWinner = isWinnerText === 'Itemwinner';

        const priceText = row.querySelector('.isp-top')?.textContent || '';
        const shippingText = row.querySelector('.isp-bottom')?.textContent || '';

        return {
          sellerProductId,
          productCode,
          isWinner,
          price: priceText ? parseInt(getPrice(priceText)) : null,
          shippingCost: shippingText ? parseInt(getPrice(shippingText)) : 0,
        };
      });
    });
  }
}
