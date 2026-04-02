import { expect, test } from '@playwright/test';
import { createAccount } from './helpers/accounts';
import { mockFx } from './helpers/fx';
import { resetDatabase } from './helpers/reset';
import { createTransaction } from './helpers/transactions';

test.beforeEach(async ({ page }) => {
  await resetDatabase(page);
  await mockFx(page);
});

test('edit transaction and switch fee modes between fixed and rate', async ({ page }) => {
  await createAccount(page, { name: '编辑费用账户', baseCurrency: 'USD' });
  await createTransaction(page, {
    amount: '100',
    note: '编辑费用用例',
    originalCurrency: 'EUR',
    conversionFeeValue: '1',
    serviceFeeValue: '2',
    expectSettledText: '入账金额：128.00 USD（预估）',
  });

  await page.goto('/records');
  const row = page.locator('tbody tr').filter({ hasText: '编辑费用用例' }).first();
  await row.locator('button[title="编辑"]').click();

  const dialog = page.locator('.modal-card').filter({ has: page.getByRole('heading', { name: '编辑记录' }) });
  await expect(dialog).toBeVisible();

  await dialog.getByRole('button', { name: '比例' }).nth(0).click();
  await dialog.getByRole('spinbutton', { name: '货币转换费 %' }).fill('1.5');
  await expect(dialog.locator('label:has-text("货币转换费") .input-suffix')).toHaveText('%');

  await dialog.getByRole('button', { name: '比例' }).nth(1).click();
  await dialog.getByRole('spinbutton', { name: '手续费 %' }).fill('2.5');
  await expect(dialog.locator('label:has-text("手续费") .input-suffix')).toHaveText('%');

  await expect(dialog.locator('.result-box')).toContainText('入账金额：130.01 USD（预估）');
  await dialog.getByRole('button', { name: '保存修改' }).click();

  const updatedRow = page.locator('tbody tr').filter({ hasText: '编辑费用用例' }).first();
  await expect(updatedRow).toContainText('1.5%');
  await expect(updatedRow).toContainText('2.5%');
  await expect(updatedRow).toContainText('130.01 USD');
  await expect(updatedRow).toContainText('预估');
});
