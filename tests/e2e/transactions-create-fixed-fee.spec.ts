import { expect, test } from '@playwright/test';
import { createAccount } from './helpers/accounts';
import { mockFx } from './helpers/fx';
import { resetDatabase } from './helpers/reset';

test.beforeEach(async ({ page }) => {
  await resetDatabase(page);
  await mockFx(page);
});

test('create transaction with fixed fees and mocked fx', async ({ page }) => {
  await createAccount(page, { name: '固定费用账户', baseCurrency: 'USD' });

  await page.goto('/create');
  await page.getByLabel('出账账户').selectOption({ index: 1 });
  await page.getByLabel('分类').selectOption({ index: 1 });
  await page.getByLabel('交易币种').selectOption('EUR');

  await expect(page.locator('.fx-rate-input').first()).toHaveValue('1.25');

  await page.getByLabel('金额').fill('100');
  await page.locator('label:has-text("货币转换费") input[type="number"]').fill('1');
  await page.locator('label:has-text("手续费") input[type="number"]').fill('2');
  await page.getByLabel('备注').fill('固定费用用例');

  await expect(page.locator('.result-box')).toContainText('入账金额：128.00 USD（预估）');
  await page.getByRole('button', { name: '保存记录' }).click();

  await expect(page.getByText('记录已保存')).toBeVisible();

  await page.goto('/records');
  const row = page.locator('tbody tr').filter({ hasText: '固定费用用例' }).first();
  await expect(row).toContainText('固定费用账户');
  await expect(row).toContainText('100.00 EUR');
  await expect(row).toContainText('1.00 USD');
  await expect(row).toContainText('2.00 USD');
  await expect(row).toContainText('128.00 USD');
  await expect(row).toContainText('预估');
});
