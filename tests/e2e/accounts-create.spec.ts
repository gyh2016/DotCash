import { expect, test } from '@playwright/test';
import { resetDatabase } from './helpers/reset';

test.beforeEach(async ({ page }) => {
  await resetDatabase(page);
});

test('create account from accounts page', async ({ page }) => {
  await page.goto('/accounts');

  await page.getByRole('button', { name: '+ 新建账户' }).click();
  const dialog = page.locator('.accounts-modal-card');
  await expect(dialog.getByRole('heading', { name: '新建账户' })).toBeVisible();

  await dialog.getByPlaceholder('例如：招商银行储蓄卡').fill('测试储蓄卡');
  await dialog.getByLabel('类型').selectOption('debit_card');
  await dialog.getByLabel('卡组织').selectOption('visa');
  await dialog.getByLabel('默认入账币种').selectOption('USD');

  await dialog.getByRole('button', { name: '保存账户' }).click();

  await expect(page.locator('.accounts-card-grid').getByText('测试储蓄卡')).toBeVisible();
  await expect(page.locator('.accounts-card-grid').getByText('默认币种：USD（美元）')).toBeVisible();
});
