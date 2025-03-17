import { Injectable } from '@nestjs/common';

import { CoupangApiService } from './coupang.api.service';
import { CoupangService } from './coupang.service';
import { CoupangRepository } from '../infrastructure/repository/coupang.repository';
import { PlaywrightService } from '@daechanjo/playwright';
import { ConfigService } from '@nestjs/config';
import { CronType } from '../../../../models/types/cron.type';

@Injectable()
export class CoupangCrawlerService {
  constructor(
    private readonly playwrightService: PlaywrightService,
    private readonly coupangRepository: CoupangRepository,
    private readonly coupangService: CoupangService,
    private readonly coupangApiService: CoupangApiService,
    private readonly configService: ConfigService,
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
    const store = this.configService.get<string>('STORE');
    const contextId = `context-${store}-${cronId}`;
    const pageId = `page-${store}-${cronId}`;

    const coupangPage = await this.playwrightService.loginToCoupangSite(contextId, pageId);

    await coupangPage.goto('https://wing.coupang.com/tenants/sfl-portal/delivery/management', {
      timeout: 0,
    });

    await coupangPage.waitForLoadState('networkidle');

    const checkboxSelector =
      '.search-table tbody span[data-wuic-props="name:check"] input[type="checkbox"]';

    await coupangPage
      .waitForSelector(checkboxSelector, { state: 'attached', timeout: 10000 })
      .catch(() => console.log(`${type}${cronId}: 체크박스 요소를 찾을 수 없습니다.`));

    const checkboxes = await coupangPage.$$(checkboxSelector);

    if (checkboxes.length === 0) {
      console.warn(`${type}${cronId}: 결제 완료 상품이 없습니다.`);
      return;
    }

    for (const checkbox of checkboxes) {
      // disabled 속성 확인 (Playwright 방식으로 수정)
      const isDisabled = await checkbox.isDisabled();

      if (isDisabled) {
        // disabled 속성 제거 (Playwright에서는 evaluateHandle 사용)
        await coupangPage.evaluateHandle((el) => {
          el.removeAttribute('disabled');
        }, checkbox);
      }

      // 체크박스 클릭 (Playwright 방식으로 수정)
      await checkbox.click({ force: true });
    }

    // 주문 확인 버튼 클릭
    const confirmOrderButtonSelector = '#confirmOrder'; // 버튼 ID로 선택
    await coupangPage.waitForSelector(confirmOrderButtonSelector, { state: 'visible' }); // 버튼 요소 기다리기
    await coupangPage.click(confirmOrderButtonSelector);

    await coupangPage.waitForLoadState('networkidle');

    // select 태그 선택 및 값 변경
    const selectSelector = 'select[data-v-305197cb]';
    await coupangPage.waitForSelector(selectSelector, { state: 'visible' });
    await coupangPage.selectOption(selectSelector, 'CJGLS'); // CJ 대한통운 선택

    // textarea에 텍스트 입력
    const textareaSelector = 'textarea[placeholder="Enter reason in detail"]';
    await coupangPage.waitForSelector(textareaSelector, { state: 'visible' });
    await coupangPage.fill(textareaSelector, '상품을 준비합니다');

    // 4. `Download` 버튼 클릭
    const downloadButtonSelector =
      'button#submitConfirm[style="float: right; margin: 0px 0px 0px 8px; padding: 6px 16px 8px;"][data-wuic-props*="icon-name:download"]';

    await coupangPage.evaluate((downloadButtonSelector) => {
      const button = document.querySelector(downloadButtonSelector) as HTMLElement;
      if (button) {
        button.click();
      } else {
        console.error(`${CronType.ERROR}${type}${cronId}: 버튼을 찾을 수 없습니다.`);
      }
    }, downloadButtonSelector);

    await this.playwrightService.releaseContext(contextId);
  }

  async invoiceUpload(cronId: string, updatedOrders: any[], type: string) {
    console.log(`${type}${cronId}: 송장업로드 시작`);

    const coupangPage = await this.playwrightService.loginToCoupangSite();
    await coupangPage.goto('https://wing.coupang.com/tenants/sfl-portal/delivery/management', {
      timeout: 0,
    });

    await new Promise((resolve) => setTimeout(resolve, 1000));

    const found = await coupangPage.evaluate(() => {
      const elements = Array.from(document.querySelectorAll('span'));
      const target = elements.find((el) => el.textContent === 'Processing');
      if (target) {
        (target as HTMLElement).click();
        return true;
      }
      return false;
    });

    if (!found) {
      throw new Error('Processing 버튼을 찾을 수 없습니다.');
    }

    await new Promise((resolve) => setTimeout(resolve, 1000));

    const results = [];

    try {
      for (const order of updatedOrders) {
        const { courier, trackingNumber } = order.courier;
        const { name, safeNumber } = order.receiver;
        const result = {
          orderId: order.orderId,
          status: 'failed',
          courierName: courier,
          trackingNumber: trackingNumber,
          name,
          safeNumber,
          error: '',
        };
        let currentPage = 1;
        let found = false;

        while (!found) {
          try {
            // 주문과 일치하는 행 찾기
            const matchingRowHandle = await coupangPage.evaluateHandle(
              ({ name, safeNumber }) => {
                const rows = Array.from(document.querySelectorAll('#tableContext tr'));
                return rows.find((row) => {
                  const rowText = (row as HTMLElement).textContent || '';
                  return rowText.includes(name) && rowText.includes(safeNumber);
                });
              },
              { name, safeNumber },
            );

            const matchingRow = matchingRowHandle ? matchingRowHandle.asElement() : null;

            if (matchingRow) {
              console.log(`${type}${cronId}: 일치하는 행을 찾았습니다 ${name} ${safeNumber}`);
              found = true;

              // 체크박스 가져오기
              const checkbox = await matchingRow.$('input[type="checkbox"]');
              if (checkbox) {
                const isDisabled = await checkbox.evaluate((el) => el.disabled);
                if (isDisabled) {
                  await checkbox.evaluate((el) => el.removeAttribute('disabled'));
                }
                await checkbox.evaluate((el) => el.click());
              }

              // 배송사 선택
              const { courier, trackingNumber } = order.courier;
              const dropdown = await matchingRow.$('select');
              if (dropdown) {
                await dropdown.evaluate((dropdownElement: any, courier: any) => {
                  const options = Array.from(dropdownElement.options);
                  const targetOption = options.find(
                    (option) =>
                      (option as HTMLOptionElement).textContent!.trim() === courier.trim(),
                  );
                  if (targetOption) {
                    (targetOption as HTMLOptionElement).selected = true;
                    dropdownElement.dispatchEvent(new Event('change', { bubbles: true }));
                  }
                }, courier);
              }

              // 운송장 번호 입력
              const editIcon = await matchingRow.$('i[data-wuic-props*="name:ico icon:edit"]');
              if (editIcon) {
                await editIcon.click();
                const trackingInput = await matchingRow.$(
                  'div[deliverytrackingmodal] input[type="text"]',
                );
                if (trackingInput) {
                  await trackingInput.type(trackingNumber);
                }
              }

              await new Promise((resolve) => setTimeout(resolve, 1000));
              // Apply 버튼 클릭
              const applyButton = await coupangPage.waitForSelector(
                'button[data-wuic-props*="name:btn type:primary"]',
                { visible: true, timeout: 5000 },
              );

              if (applyButton) {
                await applyButton.click();
                result.status = 'success';
                await new Promise((resolve) => setTimeout(resolve, 1000));

                await coupangPage.reload({ waitUntil: 'domcontentloaded' });

                const found = await coupangPage.evaluate(() => {
                  const elements = Array.from(document.querySelectorAll('span'));
                  const target = elements.find((el) => el.textContent === 'Processing');
                  if (target) {
                    (target as HTMLElement).click();
                    return true;
                  }
                  return false;
                });

                if (found) {
                  console.log(`${type}${cronId}: Processing 버튼 클릭 성공`);
                } else {
                  console.error(
                    `${CronType.ERROR}${type}${cronId}: Processing 버튼을 찾을 수 없습니다.`,
                  );
                  throw new Error('Processing 버튼 클릭 실패');
                }
              }
            } else {
              // 현재 페이지에 매칭되지 않을 경우 다음 페이지로 이동
              await new Promise((resolve) => setTimeout(resolve, 1000));
              const nextPage = await coupangPage.$(
                `span[data-wuic-attrs^="page:${currentPage + 1}"] a`,
              );

              if (nextPage) {
                currentPage++;
                console.log(`${type}${cronId}: 다음 페이지로 이동: ${currentPage}`);
                await nextPage.click();
                await coupangPage.waitForSelector('#tableContext', { timeout: 5000 });
                await new Promise((resolve) => setTimeout(resolve, 1000));
              } else {
                console.log(`${type}${cronId}: 더 이상 페이지가 없습니다 ${name}, ${safeNumber}`);
                result.status = 'failed';
                result.error = '대기중인 상품을 찾을 수 없음';
                break;
              }
            }
          } catch (error: any) {
            result.status = 'failed';
            result.error = error;
            break;
          }
        }
        results.push(result);
      }
    } finally {
      await this.playwrightService.closeAllPages();
    }

    return results;
  }

  async crawlCoupangDetailProducts(cronId: string, type: string) {
    console.log(`${type}${cronId}: 쿠팡 크롤링 시작...`);

    const coupangPage = await this.playwrightService.loginToCoupangSite();

    let isLastPage = false;
    let currentPage = 1;

    try {
      while (!isLastPage) {
        if (currentPage % 10 === 0)
          console.log(`${type}${cronId}: 상품 스크랩핑중 - 현제 페이지 ${currentPage}`);

        await coupangPage.goto(
          `https://wing.coupang.com/vendor-inventory/list?searchKeywordType=ALL&searchKeywords=&salesMethod=ALL&productStatus=ALL&stockSearchType=ALL&shippingFeeSearchType=ALL&displayCategoryCodes=&listingStartTime=null&listingEndTime=null&saleEndDateSearchType=ALL&bundledShippingSearchType=ALL&displayDeletedProduct=false&shippingMethod=ALL&exposureStatus=ALL&locale=ko_KR&sortMethod=SORT_BY_ITEM_LEVEL_UNIT_SOLD&countPerPage=50&page=${currentPage}`,
        );
        await new Promise((resolve) => setTimeout(resolve, 3000));

        await coupangPage.evaluate(async () => {
          const scrollStep = 100; // 한 번에 스크롤할 픽셀 수
          const scrollDelay = 100; // 스크롤 간 딜레이(ms)

          for (let y = 0; y < document.body.scrollHeight; y += scrollStep) {
            window.scrollBy(0, scrollStep);
            await new Promise((resolve) => setTimeout(resolve, scrollDelay)); // 각 스크롤 간격마다 대기
          }
        });

        await new Promise((resolve) => setTimeout(resolve, 3000));

        const scrapedProducts = await coupangPage.evaluate(() => {
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
              isWinnerContainer
                ?.querySelector('.ies-top')
                ?.textContent?.trim()
                .replace(/\s/g, '') || '';
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

        await this.coupangRepository.saveCoupangProductDetails(scrapedProducts);
        // 다음 페이지로 이동 (없다면 종료)
        if (scrapedProducts.length === 0) {
          console.log(`${type}${cronId}: 쿠팡 크롤링 종료`);
          isLastPage = true;
        } else {
          currentPage++;
        }
      }
    } finally {
      console.log(`${type}${cronId}: 쿠팡 크롤링 종료`);
    }
    await this.playwrightService.closeAllPages();
  }

  async deleteConfirmedCoupangProduct(cronId: string, type: string) {
    const coupangPage = await this.playwrightService.loginToCoupangSite();

    // 쿠팡 페이지에서 상품 코드 추출
    await coupangPage.goto(
      `https://wing.coupang.com/vendor-inventory/list?searchKeywordType=ALL&searchKeywords=&salesMethod=ALL&productStatus=ALL&stockSearchType=ALL&shippingFeeSearchType=ALL&displayCategoryCodes=&listingStartTime=null&listingEndTime=null&saleEndDateSearchType=ALL&bundledShippingSearchType=ALL&displayDeletedProduct=false&shippingMethod=ALL&exposureStatus=NON_CONFORMING_ATTR&locale=ko_KR&sortMethod=SORT_BY_REGISTRATION_DATE&countPerPage=50&page=1`,
      { timeout: 0 },
    );
    await coupangPage.waitForNavigation({ waitUntil: 'networkidle0' });

    try {
      console.log(`${type}${cronId}: 컨펌 상품 확인중...`);
      await coupangPage.waitForSelector('tr.inventory-line', { timeout: 6000 });
    } catch (error: any) {
      console.log(
        `${type}${cronId}: 새로운 컨펌 상품이 없습니다\n`,
        error.response?.data || error.message,
      );
      await this.playwrightService.closeAllPages();
      return;
    }

    const conformProductCodes = await coupangPage.evaluate(() => {
      return Array.from(document.querySelectorAll('tr.inventory-line'))
        .map((row) => {
          const titleElement = row.querySelector('.ip-title');
          const text = titleElement?.textContent?.trim();
          return text ? text.split(' ')[0] : null;
        })
        .filter((code) => code !== null);
    });
    await this.playwrightService.closeAllPages();

    const coupangProducts = await this.coupangApiService.getProductListPaging(
      cronId,
      CronType.CONFORM,
    );

    const matchedProducts = coupangProducts.filter(
      (product) =>
        Array.isArray(conformProductCodes) &&
        typeof product.sellerProductName === 'string' &&
        conformProductCodes.some(
          (code) => typeof code === 'string' && product.sellerProductName.includes(code),
        ),
    );

    console.log(`${type}${cronId}: 컨펌 상품\n`, matchedProducts);

    // 쿠팡에서 중지 및 삭제
    await this.coupangService.stopSaleForMatchedProducts(cronId, CronType.CONFORM, matchedProducts);
    await this.coupangService.deleteProducts(cronId, CronType.CONFORM, matchedProducts);

    console.log(`${type}${cronId}: 쿠팡 컨펌상품 삭제 완료`);

    return { matchedProducts };
  }
}
