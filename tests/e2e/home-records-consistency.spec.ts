import { expect, test } from '@playwright/test';
import { createAccount } from './helpers/accounts';
import { mockFx } from './helpers/fx';
import { resetDatabase } from './helpers/reset';
import { createTransaction } from './helpers/transactions';

test.beforeEach(async ({ page }) => {
  await resetDatabase(page);
  await mockFx(page);
});

test('home recent transaction and records list show consistent amount and estimated tag', async ({ page }) => {
  await createAccount(page, { name: '一致性账户', baseCurrency: 'USD' });
  await createTransaction(page, {
    amount: '100',
    note: '一致性用例',
    originalCurrency: 'EUR',
    conversionFeeValue: '1',
    serviceFeeValue: '2',
    expectSettledText: '入账金额：128.00 USD（预估）',
  });

  await page.goto('/home');
  const homeCard = page.locator('.home-recent-list .transaction-card').filter({ hasText: '一致性用例' }).first();
  await expect(homeCard).toContainText('128.00 USD');
  await expect(homeCard).toContainText('预估');
  await expect(homeCard).toContainText('转换费：1.00 USD');
  await expect(homeCard).toContainText('手续费：2.00 USD');

  await page.goto('/records');
  const recordRow = page.locator('tbody tr').filter({ hasText: '一致性用例' }).first();
  await expect(recordRow).toContainText('128.00 USD');
  await expect(recordRow).toContainText('预估');
  await expect(recordRow).toContainText('1.00 USD');
  await expect(recordRow).toContainText('2.00 USD');
});
