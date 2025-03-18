import { Injectable } from '@nestjs/common';
import { Page, ElementHandle } from 'playwright';

/**
 * 쿠팡 윙 관리자 페이지에서 송장 업로드 기능을 제공하는 프로바이더
 *
 * @description
 * 이 프로바이더는 쿠팡 윙의 송장 업로드 과정을 자동화합니다. 배송 관리 페이지의 'Processing' 탭에서
 * 특정 주문을 찾아 배송사 정보와 운송장 번호를 입력하는 모든 과정을 처리합니다.
 * 페이지 탐색, 주문 검색, 송장 정보 입력 등의 기능이 모듈화되어 있어 유지보수와 테스트가 용이합니다.
 */
@Injectable()
export class InvoiceUploaderProvider {
  constructor() {}

  /**
   * 쿠팡 윙의 배송 관리 페이지로 이동
   *
   * @param page - Playwright의 Page 객체
   * @returns {Promise<void>} - 페이지 이동 완료 후 Promise 반환
   *
   * @description
   * 배송 관리 페이지(https://wing.coupang.com/tenants/sfl-portal/delivery/management)로 이동합니다.
   * timeout 0으로 설정하여 네트워크 상태에 관계없이 페이지 로드를 기다립니다.
   * 페이지 로드 후 1초 대기하여 DOM이 완전히 렌더링되도록 합니다.
   */
  async navigateToDeliveryManagementPage(page: Page): Promise<void> {
    await page.goto('https://wing.coupang.com/tenants/sfl-portal/delivery/management', {
      timeout: 0,
    });
    await this.delay(1000);
  }

  /**
   * 'Processing' 상태의 주문을 보여주는 탭 버튼을 찾아 클릭
   *
   * @param page - Playwright의 Page 객체
   * @returns {Promise<void>} - 버튼 클릭 완료 후 Promise 반환
   * @throws {Error} - Processing 버튼을 찾을 수 없는 경우 예외 발생
   *
   * @description
   * 페이지 내의 모든 span 요소 중 텍스트가 'Processing'인 요소를 찾아 클릭합니다.
   * 페이지의 DOM 구조에 따라 유연하게 요소를 검색하여 UI 변경에도 대응할 수 있습니다.
   * 버튼을 찾지 못한 경우 명시적인 에러를 발생시켜 문제를 즉시 파악할 수 있게 합니다.
   */
  async clickProcessingButton(page: Page): Promise<void> {
    const found = await page.evaluate(() => {
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

    await this.delay(1000);
  }

  /**
   * 지정된 시간(밀리초) 동안 실행을 지연
   *
   * @param ms - 지연할 시간(밀리초)
   * @returns {Promise<void>} - 지연 시간 경과 후 resolve되는 Promise
   *
   * @description
   * 페이지 로딩, DOM 업데이트, 애니메이션 완료 등을 기다리기 위한 유틸리티 함수입니다.
   * setTimeout을 Promise로 래핑하여 async/await 패턴에서 사용할 수 있게 합니다.
   */
  private async delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * 단일 주문에 대한 송장 정보 처리 로직
   *
   * @param page - Playwright의 Page 객체
   * @param order - 처리할 주문 정보 객체 (courier, receiver 정보 포함)
   * @param type - 로그 메시지에 포함될 작업 유형 식별자
   * @param cronId - 현재 실행 중인 크론 작업의 고유 식별자
   * @returns {Promise<Object>} - 송장 업로드 처리 결과를 담은 객체
   *
   * @description
   * 이 메서드는 하나의 주문에 대한 전체 송장 업로드 과정을 관리합니다:
   * 1. 수취인 이름과 안심번호로 해당 주문 행 검색 (여러 페이지 탐색)
   * 2. 찾은 주문의 체크박스 선택
   * 3. 배송사 정보 선택
   * 4. 운송장 번호 입력
   * 5. 변경사항 적용 및 페이지 새로고침
   *
   * 각 단계에서 발생하는 오류를 처리하고, 작업 결과를 상세히 기록하여 반환합니다.
   * 주문을 찾지 못한 경우 페이지네이션을 통해 다음 페이지로 이동하며 검색을 계속합니다.
   */
  async processOrder(page: Page, order: any, type: string, cronId: string): Promise<any> {
    const { courier, trackingNumber } = order.courier;
    const { name, safeNumber } = order.receiver;

    // 결과 객체 초기화
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

    // 주문과 일치하는 행을 찾을 때까지 페이지 탐색
    while (!found) {
      try {
        const matchingRow = await this.findMatchingRow(page, name, safeNumber);

        if (matchingRow) {
          console.log(`${type}${cronId}: 일치하는 행을 찾았습니다 ${name} ${safeNumber}`);
          found = true;

          // 체크박스 선택
          await this.selectCheckbox(matchingRow);

          // 배송사 선택
          await this.selectCourier(matchingRow, courier);

          // 운송장 번호 입력
          await this.enterTrackingNumber(matchingRow, trackingNumber);

          // 적용 버튼 클릭 및 재로딩
          await this.applyChangesAndReload(page, result);

          // Processing 버튼 다시 클릭
          await this.clickProcessingButton(page);
        } else {
          // 다음 페이지로 이동 시도
          const hasNextPage = await this.navigateToNextPage(page, currentPage, type, cronId);

          if (hasNextPage) {
            currentPage++;
          } else {
            console.log(`${type}${cronId}: 더 이상 페이지가 없습니다 ${name}, ${safeNumber}`);
            result.error = '대기중인 상품을 찾을 수 없음';
            break;
          }
        }
      } catch (error: any) {
        result.error = error.toString();
        break;
      }
    }

    return result;
  }

  /**
   * 주문과 일치하는 테이블 행을 찾는 메서드
   *
   * @param page - Playwright의 Page 객체
   * @param name - 검색할 수취인 이름
   * @param safeNumber - 검색할 안심번호
   * @returns {Promise<ElementHandle | null>} - 일치하는 행의 ElementHandle 또는 찾지 못한 경우 null
   *
   * @description
   * 페이지 내의 '#tableContext tr' 선택자로 모든 테이블 행을 찾아,
   * 그 중 지정된 수취인 이름과 안심번호를 모두 포함하는 행을 찾습니다.
   * 브라우저 컨텍스트에서 실행되는 자바스크립트 로직을 evaluateHandle을 통해 구현하여,
   * DOM 탐색을 효율적으로 수행합니다.
   */
  private async findMatchingRow(
    page: Page,
    name: string,
    safeNumber: string,
  ): Promise<ElementHandle | null> {
    const matchingRowHandle = await page.evaluateHandle(
      ({ name, safeNumber }) => {
        const rows = Array.from(document.querySelectorAll('#tableContext tr'));
        return rows.find((row) => {
          const rowText = (row as HTMLElement).textContent || '';
          return rowText.includes(name) && rowText.includes(safeNumber);
        });
      },
      { name, safeNumber },
    );

    return matchingRowHandle ? matchingRowHandle.asElement() : null;
  }

  /**
   * 테이블 행의 체크박스를 선택하는 메서드
   *
   * @param row - 체크박스를 포함하는 테이블 행의 ElementHandle
   * @returns {Promise<void>} - 체크박스 선택 작업 완료 후 Promise 반환
   *
   * @description
   * 주어진 테이블 행에서 체크박스를 찾아 선택합니다.
   * 체크박스가 disabled 상태인 경우, 자바스크립트를 통해 disabled 속성을 제거하고 강제로 클릭합니다.
   * 이는 UI에서 기술적으로 비활성화된 체크박스에 대한 우회 방법을 제공합니다.
   */
  private async selectCheckbox(row: ElementHandle): Promise<void> {
    const checkbox = await row.$('input[type="checkbox"]');
    if (checkbox) {
      const isDisabled = await checkbox.isDisabled();
      if (isDisabled) {
        // disabled 속성 제거
        await checkbox.evaluate((el) => {
          (el as HTMLInputElement).removeAttribute('disabled');
        });
      }
      // 강제 클릭
      await checkbox.click({ force: true });
    }
  }

  /**
   * 테이블 행에서 배송사를 선택하는 메서드
   *
   * @param row - 배송사 드롭다운을 포함하는 테이블 행의 ElementHandle
   * @param courier - 선택할 배송사 이름
   * @returns {Promise<void>} - 배송사 선택 작업 완료 후 Promise 반환
   *
   * @description
   * 주어진 테이블 행에서 select 드롭다운을 찾아, 지정된 배송사 이름과 일치하는 옵션을 선택합니다.
   * 클라이언트 측 자바스크립트를 통해 옵션을 선택하고, change 이벤트를 발생시켜
   * 쿠팡 윙의 UI 업데이트 로직이 정상적으로 작동하도록 합니다.
   */
  private async selectCourier(row: ElementHandle, courier: string): Promise<void> {
    const dropdown = await row.$('select');
    if (dropdown) {
      await dropdown.evaluate((dropdownElement: any, courier: any) => {
        const options = Array.from(dropdownElement.options);
        const targetOption = options.find(
          (option) => (option as HTMLOptionElement).textContent!.trim() === courier.trim(),
        );
        if (targetOption) {
          (targetOption as HTMLOptionElement).selected = true;
          dropdownElement.dispatchEvent(new Event('change', { bubbles: true }));
        }
      }, courier);
    }
  }

  /**
   * 테이블 행에서 운송장 번호를 입력하는 메서드
   *
   * @param row - 운송장 입력 아이콘을 포함하는 테이블 행의 ElementHandle
   * @param trackingNumber - 입력할 운송장 번호
   * @returns {Promise<void>} - 운송장 번호 입력 작업 완료 후 Promise 반환
   *
   * @description
   * 주어진 테이블 행에서 편집 아이콘(i 태그)을 찾아 클릭한 후,
   * 나타나는 모달 내의 텍스트 입력 필드에 운송장 번호를 입력합니다.
   * 데이터 입력 후 일정 시간(1초) 대기하여 UI가 안정화되도록 합니다.
   */
  private async enterTrackingNumber(row: ElementHandle, trackingNumber: string): Promise<void> {
    const editIcon = await row.$('i[data-wuic-props*="name:ico icon:edit"]');
    if (editIcon) {
      await editIcon.click();
      const trackingInput = await row.$('div[deliverytrackingmodal] input[type="text"]');
      if (trackingInput) {
        await trackingInput.fill(trackingNumber);
      }
    }
    await this.delay(1000);
  }

  /**
   * 변경사항을 적용하고 페이지를 새로고침하는 메서드
   *
   * @param page - Playwright의 Page 객체
   * @param result - 업데이트할 결과 객체 (상태를 'success'로 변경)
   * @returns {Promise<void>} - 적용 및 새로고침 작업 완료 후 Promise 반환
   *
   * @description
   * 'Apply' 또는 '적용' 버튼(name:btn type:primary 속성을 가진 버튼)을 찾아 클릭하고,
   * 결과 객체의 상태를 'success'로 업데이트합니다.
   * 작업 후 일정 시간(1초) 대기하고 페이지를 새로고침하여 변경사항이 적용된 상태로 UI를 초기화합니다.
   * 버튼이 나타날 때까지 최대 5초간 대기하며, 시간 내에 나타나지 않으면 작업이 실패합니다.
   */
  private async applyChangesAndReload(page: Page, result: any): Promise<void> {
    const applyButton = await page.waitForSelector(
      'button[data-wuic-props*="name:btn type:primary"]',
      { state: 'visible', timeout: 5000 },
    );

    if (applyButton) {
      await applyButton.click();
      result.status = 'success';
      await this.delay(1000);
      await page.reload({ waitUntil: 'domcontentloaded' });
    }
  }

  /**
   * 다음 페이지로 이동하는 메서드
   *
   * @param page - Playwright의 Page 객체
   * @param currentPage - 현재 페이지 번호
   * @param type - 로그 메시지에 포함될 작업 유형 식별자
   * @param cronId - 현재 실행 중인 크론 작업의 고유 식별자
   * @returns {Promise<boolean>} - 다음 페이지 이동 성공 여부 (성공: true, 실패: false)
   *
   * @description
   * 현재 페이지 번호를 기반으로 다음 페이지 링크를 찾아 클릭합니다.
   * 다음 페이지가 존재하면 클릭 후 테이블이 로드될 때까지 기다리고 true를 반환합니다.
   * 다음 페이지가 없으면 false를 반환하여 페이지 탐색을 종료합니다.
   * 페이지 전환 전후에 적절한 대기 시간을 두어 UI가 안정화되도록 합니다.
   */
  private async navigateToNextPage(
    page: Page,
    currentPage: number,
    type: string,
    cronId: string,
  ): Promise<boolean> {
    await this.delay(1000);
    const nextPage = await page.$(`span[data-wuic-attrs^="page:${currentPage + 1}"] a`);

    if (nextPage) {
      console.log(`${type}${cronId}: 다음 페이지로 이동: ${currentPage + 1}`);
      await nextPage.click();
      await page.waitForSelector('#tableContext', { timeout: 5000 });
      await this.delay(1000);
      return true;
    }

    return false;
  }
}
