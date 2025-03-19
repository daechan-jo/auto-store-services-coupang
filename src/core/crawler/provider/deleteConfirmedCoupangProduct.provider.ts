import { Injectable } from '@nestjs/common';
import { Page } from 'playwright';

/**
 * 쿠팡 윙에서 비준수 상품을 조회하고 삭제하는 기능을 제공하는 프로바이더
 *
 * @description
 * 이 프로바이더는 쿠팡 윙의 비준수(NON_CONFORMING_ATTR) 상품 목록을 조회하고
 * 해당 상품들의 코드를 추출하여 API를 통해 판매 중지 및 삭제 처리하는 기능을 제공합니다.
 * 상품 페이지 탐색, 상품 코드 추출, 일치하는 상품 찾기 등의 기능이 모듈화되어 있습니다.
 */
@Injectable()
export class DeleteConfirmedCoupangProductProvider {
  /**
   * 비준수 상품 목록 페이지로 이동하고 페이지 로딩을 기다림
   *
   * @param page - Playwright의 Page 객체
   * @returns {Promise<void>} - 페이지 이동이 완료된 후의 Promise
   *
   * @description
   * 쿠팡 윙의 판매자 인벤토리 목록에서 비준수(NON_CONFORMING_ATTR) 상태의 상품만 필터링하여 조회합니다.
   * 페이지 이동 후 네트워크 요청이 완료될 때까지 기다립니다.
   */
  async navigateToNonConformingProductsPage(page: Page): Promise<void> {
    await page.goto(
      `https://wing.coupang.com/vendor-inventory/list?searchKeywordType=ALL&searchKeywords=&salesMethod=ALL&productStatus=ALL&stockSearchType=ALL&shippingFeeSearchType=ALL&displayCategoryCodes=&listingStartTime=null&listingEndTime=null&saleEndDateSearchType=ALL&bundledShippingSearchType=ALL&displayDeletedProduct=false&shippingMethod=ALL&exposureStatus=NON_CONFORMING_ATTR&locale=ko_KR&sortMethod=SORT_BY_REGISTRATION_DATE&countPerPage=50&page=1`,
      { timeout: 0 },
    );
    await page.waitForLoadState('networkidle');
  }

  /**
   * 페이지에서 비준수 상품의 상품 코드 목록을 추출
   *
   * @param page - Playwright의 Page 객체
   * @param cronId - 크론 작업 ID
   * @param type - 로그 메시지 타입
   * @returns {Promise<string[]>} - 추출된 상품 코드 배열
   * @throws {Error} - 상품을 찾을 수 없는 경우 예외 발생
   *
   * @description
   * 페이지에서 상품 행(tr.inventory-line)을 찾아 각 상품의 제목에서 상품 코드를 추출합니다.
   * 상품 코드는 제목의 첫 번째 단어로 가정합니다.
   * 상품이 없는 경우 timeout 예외가 발생할 수 있으며, 이 경우 적절한 메시지를 출력합니다.
   */
  async extractNonConformingProductCodes(
    page: Page,
    cronId: string,
    type: string,
  ): Promise<string[]> {
    try {
      console.log(`${type}${cronId}: 컨펌 상품 확인중...`);
      // 상품 행이 로드될 때까지 대기
      await page.waitForSelector('tr.inventory-line', { timeout: 6000 });

      // 페이지에서 상품 코드 추출
      return page.evaluate(() => {
        return Array.from(document.querySelectorAll('tr.inventory-line'))
          .map((row) => {
            const titleElement = row.querySelector('.ip-title');
            const text = titleElement?.textContent?.trim();
            return text ? text.split(' ')[0] : null;
          })
          .filter((code): code is string => code !== null);
      });
    } catch (error: any) {
      console.log(
        `${type}${cronId}: 새로운 컨펌 상품이 없습니다\n`,
        error.response?.data || error.message,
      );
      throw new Error('No non-conforming products found');
    }
  }

  /**
   * API에서 조회한 상품 목록과 페이지에서 추출한 상품 코드를 비교하여 일치하는 상품 찾기
   *
   * @param productCodes - 페이지에서 추출한 상품 코드 배열
   * @param apiProducts - API에서 조회한 상품 목록
   * @returns {Array} - 일치하는 상품 배열
   *
   * @description
   * 페이지에서 추출한 상품 코드와 API에서 조회한 상품 목록을 비교하여
   * API 상품의 sellerProductName에 상품 코드가 포함된 상품들을 찾아 반환합니다.
   * 타입 안전성을 위한 검사도 포함되어 있습니다.
   */
  findMatchingProducts(productCodes: string[], apiProducts: any[]): any[] {
    return apiProducts.filter(
      (product) =>
        Array.isArray(productCodes) &&
        typeof product.sellerProductName === 'string' &&
        productCodes.some(
          (code) => typeof code === 'string' && product.sellerProductName.includes(code),
        ),
    );
  }
}
