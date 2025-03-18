import { CronType } from '@daechanjo/models';
import { Injectable } from '@nestjs/common';
import { Page } from 'playwright';

@Injectable()
export class OrderStatusUpdateProvider {
  constructor() {}

  /**
   * 쿠팡 윙에서 주문 상태를 업데이트하는 메서드
   *
   * @param page - Playwright의 Page 객체
   * @param cronId - 현재 실행 중인 크론 작업의 고유 식별자
   * @param type - 로그 메시지에 포함될 작업 유형 식별자
   *
   * @returns {Promise<boolean>} - 작업 성공 여부를 나타내는 boolean 값
   *
   * @throws {Error} - Playwright 작업 중 발생하는 모든 오류
   *
   * @description
   * 이 메서드는 다음 단계로 진행됩니다:
   * 1. 배송 관리 페이지로 이동
   * 2. 결제 완료된 상품 체크박스 선택
   * 3. 주문 확인 버튼 클릭
   * 4. 배송사 선택 (CJ 대한통운)
   * 5. 상세 사유 입력
   * 6. 확인 및 다운로드 버튼 클릭
   */
  async updateOrderStatus(page: Page, cronId: string, type: string): Promise<boolean> {
    try {
      // 배송 관리 페이지로 이동
      await this.navigateToDeliveryPage(page);

      // 결제 완료 상품 체크박스 선택
      const checkboxes = await this.findCompletedOrderCheckboxes(page, cronId, type);

      if (checkboxes.length === 0) {
        console.warn(`${type}${cronId}: 결제 완료 상품이 없습니다.`);
        return false;
      }

      // 모든 체크박스 선택
      await this.selectAllCheckboxes(page, checkboxes);

      // 주문 확인 버튼 클릭 및 폼 처리
      await this.confirmOrderAndFillForm(page);

      return true;
    } catch (error) {
      console.error(`${CronType.ERROR}${type}${cronId}: 주문 상태 업데이트 중 오류 발생`, error);
      return false;
    }
  }

  /**
   * 배송 관리 페이지로 이동하고 페이지 로딩이 완료될 때까지 대기
   *
   * @param page - Playwright의 Page 객체
   */
  private async navigateToDeliveryPage(page: Page): Promise<void> {
    await page.goto('https://wing.coupang.com/tenants/sfl-portal/delivery/management', {
      timeout: 0,
    });
    await page.waitForLoadState('networkidle');
  }

  /**
   * 결제 완료된 상품의 체크박스 요소들을 찾음
   *
   * @param page - Playwright의 Page 객체
   * @param cronId - 크론 작업 ID
   * @param type - 로그 타입
   * @returns - 체크박스 요소의 배열
   */
  private async findCompletedOrderCheckboxes(page: Page, cronId: string, type: string) {
    const checkboxSelector =
      '.search-table tbody span[data-wuic-props="name:check"] input[type="checkbox"]';

    await page
      .waitForSelector(checkboxSelector, { state: 'attached', timeout: 10000 })
      .catch(() => console.log(`${type}${cronId}: 체크박스 요소를 찾을 수 없습니다.`));

    return await page.$$(checkboxSelector);
  }

  /**
   * 모든 체크박스를 선택 (disabled 상태인 경우 속성 제거 후 선택)
   *
   * @param page - Playwright의 Page 객체
   * @param checkboxes - 체크박스 요소 배열
   */
  private async selectAllCheckboxes(page: Page, checkboxes: any[]): Promise<void> {
    for (const checkbox of checkboxes) {
      // disabled 속성 확인
      const isDisabled = await checkbox.isDisabled();

      if (isDisabled) {
        // disabled 속성 제거
        await page.evaluateHandle((el) => {
          el.removeAttribute('disabled');
        }, checkbox);
      }

      // 체크박스 클릭 (force 옵션으로 어떤 상황에서도 클릭 보장)
      await checkbox.click({ force: true });
    }
  }

  /**
   * 주문 확인 버튼을 클릭하고 후속 폼을 작성하여 제출
   *
   * @param page - Playwright의 Page 객체
   */
  private async confirmOrderAndFillForm(page: Page): Promise<void> {
    // 주문 확인 버튼 클릭
    const confirmOrderButtonSelector = '#confirmOrder';
    await page.waitForSelector(confirmOrderButtonSelector, { state: 'visible' });
    await page.click(confirmOrderButtonSelector);

    // 페이지 로딩 대기
    await page.waitForLoadState('networkidle');

    // 배송사 선택 (CJ 대한통운)
    await this.selectCourierCompany(page);

    // 상세 사유 입력
    await this.enterDetailReason(page);

    // 확인 및 다운로드 버튼 클릭
    await this.clickDownloadButton(page);
  }

  /**
   * 배송사(CJ 대한통운) 선택
   *
   * @param page - Playwright의 Page 객체
   */
  private async selectCourierCompany(page: Page): Promise<void> {
    const selectSelector = 'select[data-v-305197cb]';
    await page.waitForSelector(selectSelector, { state: 'visible' });
    await page.selectOption(selectSelector, 'CJGLS'); // CJ 대한통운 선택
  }

  /**
   * 상세 사유 입력
   *
   * @param page - Playwright의 Page 객체
   */
  private async enterDetailReason(page: Page): Promise<void> {
    const textareaSelector = 'textarea[placeholder="Enter reason in detail"]';
    await page.waitForSelector(textareaSelector, { state: 'visible' });
    await page.fill(textareaSelector, '상품을 준비합니다');
  }

  /**
   * 확인 및 다운로드 버튼 클릭
   *
   * @param page - Playwright의 Page 객체
   */
  private async clickDownloadButton(page: Page): Promise<void> {
    const downloadButtonSelector =
      'button#submitConfirm[style="float: right; margin: 0px 0px 0px 8px; padding: 6px 16px 8px;"][data-wuic-props*="icon-name:download"]';

    await page.evaluate((downloadButtonSelector) => {
      const button = document.querySelector(downloadButtonSelector) as HTMLElement;
      if (button) {
        button.click();
      } else {
        console.error(`버튼을 찾을 수 없습니다.`);
      }
    }, downloadButtonSelector);
  }
}
