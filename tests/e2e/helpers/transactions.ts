import { expect, type Page } from '@playwright/test';

interface CreateTransactionOptions {
  accountIndex?: number;
  type?: 'income' | 'expense';
  categoryIndex?: number;
  amount: string;
  note: string;
  originalCurrency?: string;
  conversionFeeMode?: 'fixed' | 'rate';
  conversionFeeValue?: string;
  serviceFeeMode?: 'fixed' | 'rate';
  serviceFeeValue?: string;
  expectSettledText?: string;
}

export const createTransaction = async (page: Page, options: CreateTransactionOptions) => {
  const {
    accountIndex = 1,
    type = 'expense',
    categoryIndex = 1,
    amount,
    note,
    originalCurrency,
    conversionFeeMode,
    conversionFeeValue,
    serviceFeeMode,
    serviceFeeValue,
    expectSettledText,
  } = options;

  await page.goto('/create');

  if (type === 'income') {
    await page.getByRole('button', { name: '收入' }).click();
  }

  await page.getByLabel('出账账户').selectOption({ index: accountIndex });
  await page.getByLabel('分类').selectOption({ index: categoryIndex });

  if (originalCurrency) {
    await page.getByLabel('交易币种').selectOption(originalCurrency);
  }

  await page.getByLabel('金额').fill(amount);

  if (conversionFeeMode === 'rate') {
    await page.getByRole('button', { name: '比例' }).nth(0).click();
    if (conversionFeeValue) {
      await page.getByRole('spinbutton', { name: '货币转换费 %' }).fill(conversionFeeValue);
    }
  } else if (conversionFeeValue) {
    await page.locator('label:has-text("货币转换费") input[type="number"]').fill(conversionFeeValue);
  }

  if (serviceFeeMode === 'rate') {
    await page.getByRole('button', { name: '比例' }).nth(1).click();
    if (serviceFeeValue) {
      await page.getByRole('spinbutton', { name: '手续费 %' }).fill(serviceFeeValue);
    }
  } else if (serviceFeeValue) {
    await page.locator('label:has-text("手续费") input[type="number"]').fill(serviceFeeValue);
  }

  await page.getByLabel('备注').fill(note);

  if (expectSettledText) {
    await expect(page.locator('.result-box')).toContainText(expectSettledText);
  }

  await page.getByRole('button', { name: '保存记录' }).click();
  await expect(page.getByText('记录已保存')).toBeVisible();
};
