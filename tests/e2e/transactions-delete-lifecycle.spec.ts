import { expect, test } from '@playwright/test';
import { createAccount } from './helpers/accounts';
import { resetDatabase } from './helpers/reset';
import { createTransaction } from './helpers/transactions';

test.beforeEach(async ({ page }) => {
  await resetDatabase(page);
});

test('soft delete, restore, and hard delete a transaction', async ({ page }) => {
  page.on('dialog', async (dialog) => {
    await dialog.accept();
  });

  await createAccount(page, { name: '删除流程账户', baseCurrency: 'USD' });
  await createTransaction(page, {
    amount: '88',
    note: '删除流程用例',
    expectSettledText: '入账金额：88.00 USD（实际）',
  });

  await page.goto('/records');
  const activeRow = page.locator('tbody tr').filter({ hasText: '删除流程用例' }).first();
  await activeRow.locator('button[title="删除"]').click();

  await expect(page.locator('tbody tr').filter({ hasText: '删除流程用例' })).toHaveCount(0);

  await page.getByRole('checkbox', { name: '显示已删除记录' }).check();
  const deletedRow = page.locator('tbody tr').filter({ hasText: '删除流程用例' }).first();
  await expect(deletedRow).toContainText('已删除');

  await deletedRow.locator('button[title="恢复"]').click();
  const restoredRow = page.locator('tbody tr', {
    has: page.locator('button[title="删除"]'),
  }).filter({ hasText: '删除流程用例' }).first();
  await expect(restoredRow).toContainText('删除流程用例');
  await expect(restoredRow.locator('button[title="删除"]')).toBeVisible();

  await restoredRow.locator('button[title="删除"]').click();
  const deletedAgainRow = page.locator('tbody tr', {
    has: page.locator('button[title="恢复"]'),
  }).filter({ hasText: '删除流程用例' }).first();
  await expect(deletedAgainRow).toContainText('已删除');

  await deletedAgainRow.locator('button[title="永久删除"]').click();
  await expect(page.locator('tbody tr').filter({ hasText: '删除流程用例' })).toHaveCount(0);
});
