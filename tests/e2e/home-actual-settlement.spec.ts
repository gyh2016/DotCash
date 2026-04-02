import { expect, test } from '@playwright/test';
import { createAccount } from './helpers/accounts';
import { mockFx } from './helpers/fx';
import { resetDatabase } from './helpers/reset';
import { createTransaction } from './helpers/transactions';

test.beforeEach(async ({ page }) => {
  await resetDatabase(page);
  await mockFx(page);
});

test('correct actual settled amount from home recent transactions and keep records in sync', async ({ page }) => {
  await createAccount(page, { name: '首页更正账户', baseCurrency: 'USD' });
  await createTransaction(page, {
    amount: '100',
    note: '首页更正用例',
    originalCurrency: 'EUR',
    conversionFeeValue: '1',
    serviceFeeValue: '2',
    expectSettledText: '入账金额：128.00 USD（预估）',
  });

  await page.goto('/home');
  const homeCard = page.locator('.home-recent-list .transaction-card').filter({ hasText: '首页更正用例' }).first();
  await expect(homeCard).toContainText('128.00 USD');
  await expect(homeCard).toContainText('预估');
  await homeCard.locator('button[title="更正入账"]').click();

  const dialog = page.locator('.modal-card-sm').filter({ has: page.getByRole('heading', { name: '更正实际入账' }) });
  await expect(dialog).toContainText('原预估：128.00 USD');
  await dialog.getByLabel('实际入账金额').fill('130');
  await dialog.getByRole('button', { name: '保存更正' }).click();

  const updatedHomeCard = page.locator('.home-recent-list .transaction-card').filter({ hasText: '首页更正用例' }).first();
  await expect(updatedHomeCard).toContainText('130.00 USD');
  await expect(updatedHomeCard).not.toContainText('预估');
  await expect(updatedHomeCard.locator('button[title="更正入账"]')).toHaveCount(0);

  await page.goto('/records');
  const row = page.locator('tbody tr').filter({ hasText: '首页更正用例' }).first();
  await expect(row).toContainText('130.00 USD');
  await expect(row).not.toContainText('预估');
});
