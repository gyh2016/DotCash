import { expect, test } from '@playwright/test';
import { createAccount } from './helpers/accounts';
import { resetDatabase } from './helpers/reset';

test.beforeEach(async ({ page }) => {
  await resetDatabase(page);
});

test('create transaction with rate-based fees', async ({ page }) => {
  await createAccount(page, { name: '比例费用账户', baseCurrency: 'USD' });

  await page.goto('/create');
  await page.getByLabel('出账账户').selectOption({ index: 1 });
  await page.getByLabel('分类').selectOption({ index: 1 });
  await page.getByLabel('金额').fill('100');
  await page.getByLabel('备注').fill('比例费用用例');

  await page.getByRole('button', { name: '比例' }).nth(0).click();
  await page.getByRole('spinbutton', { name: '货币转换费 %' }).fill('1.5');
  await expect(page.locator('label:has-text("货币转换费") .input-suffix')).toHaveText('%');

  await page.getByRole('button', { name: '比例' }).nth(1).click();
  await page.getByRole('spinbutton', { name: '手续费 %' }).fill('2.5');
  await expect(page.locator('label:has-text("手续费") .input-suffix')).toHaveText('%');

  await expect(page.locator('.result-box')).toContainText('入账金额：104.00 USD（实际）');
  await page.getByRole('button', { name: '保存记录' }).click();

  await expect(page.getByText('记录已保存')).toBeVisible();

  await page.goto('/records');
  const row = page.locator('tbody tr').filter({ hasText: '比例费用用例' }).first();
  await expect(row).toContainText('1.5%');
  await expect(row).toContainText('2.5%');
  await expect(row).toContainText('104.00 USD');
});
