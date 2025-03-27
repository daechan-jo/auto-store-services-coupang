// import { Page } from 'playwright';
//
// export class CrawlCoupangPriceComparisonProvider {
//   async scrapePriceComparisonPage(coupangPage: Page, currentPage: number) {}
//
//   /**
//    * 상품 인벤토리 페이지로 이동
//    *
//    * @param page - Playwright의 Page 객체
//    * @param pageNumber - 이동할 페이지 번호
//    * @returns {Promise<void>} - 네비게이션 완료 후 Promise 반환
//    *
//    * @description
//    * 쿠팡 윙의 판매자 인벤토리 목록 페이지로 이동합니다.
//    * URL 파라미터를 통해 페이지 번호, 정렬 방식, 페이지당 항목 수 등을 지정합니다.
//    */
//   private async navigateToPriceComparisonPage(page: Page, pageNumber: number): Promise<void> {
//     await page.goto(
//       `https://wing.coupang.com/tenants/seller-price-management/?searchInputValue=&searchInputType=KEYWORD&itemWinnerStatus=LOSE_NOT_SUPPRESSED&salesMethod=ALL&autoPriceStatus=ALL&salesStatus=ON_SALE&alarmStatus=ALL&listingDate.startDate=&listingDate.endDate=&searchPresets&isTopGMV&page=${pageNumber}&pageSize=500&sortingType=MY_VI_SALES_DESC`,
//     );
//   }
// }
