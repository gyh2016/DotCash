import { expect, test } from '@playwright/test';
import { createAccount } from './helpers/accounts';
import { mockFx } from './helpers/fx';
import { resetDatabase } from './helpers/reset';
import { createTransaction } from './helpers/transactions';

test.beforeEach(async ({ page }) => {
  await resetDatabase(page);
  await mockFx(page);
});

test('editing corrected transaction amount forces it back to estimated state', async ({ page }) => {
  await createAccount(page, { name: '重新预估账户', baseCurrency: 'USD' });
  await createTransaction(page, {
    amount: '100',
    note: '重新估算用例',
    originalCurrency: 'EUR',
    conversionFeeValue: '1',
    serviceFeeValue: '2',
    expectSettledText: '入账金额：128.00 USD（预估）',
  });

  await page.goto('/records');
  let row = page.locator('tbody tr').filter({ hasText: '重新估算用例' }).first();
  await row.locator('button[title="更正入账"]').click();

  const actualDialog = page.locator('.modal-card-sm').filter({ has: page.getByRole('heading', { name: '更正实际入账' }) });
  await actualDialog.getByLabel('实际入账金额').fill('129');
  await actualDialog.getByRole('button', { name: '保存更正' }).click();

  row = page.locator('tbody tr').filter({ hasText: '重新估算用例' }).first();
  await expect(row).toContainText('129.00 USD');
  await expect(row.locator('.estimated-tag')).toHaveCount(0);
  await expect(row.locator('button[title="更正入账"]')).toHaveCount(0);

  await row.locator('button[title="编辑"]').click();
  const editDialog = page.locator('.modal-card').filter({ has: page.getByRole('heading', { name: '编辑记录' }) });
  await editDialog.getByLabel('金额').fill('110');
  await expect(editDialog.locator('.result-box')).toContainText('入账金额：140.50 USD（预估）');
  await editDialog.getByRole('button', { name: '保存修改' }).click();

  const reEstimatedRow = page.locator('tbody tr').filter({ hasText: '重新估算用例' }).first();
  await expect(reEstimatedRow).toContainText('140.50 USD');
  await expect(reEstimatedRow.locator('.estimated-tag')).toContainText('预估');
  await expect(reEstimatedRow.locator('button[title="更正入账"]')).toBeVisible();
});
