import { expect, test } from '@playwright/test';
import { createAccount } from './helpers/accounts';
import { resetDatabase } from './helpers/reset';

test.beforeEach(async ({ page }) => {
  await resetDatabase(page);
});

test('block saving expense when non-overdraft account balance is insufficient', async ({ page }) => {
  await createAccount(page, { name: '余额校验账户', baseCurrency: 'USD', allowOverdraft: false });

  await page.goto('/create');
  await page.getByRole('button', { name: '收入' }).click();
  await page.getByLabel('出账账户').selectOption({ index: 1 });
  await page.getByLabel('分类').selectOption({ index: 1 });
  await page.getByLabel('金额').fill('50');
  await page.getByLabel('备注').fill('初始收入');
  await page.getByRole('button', { name: '保存记录' }).click();
  await expect(page.getByText('记录已保存')).toBeVisible();

  await page.getByLabel('出账账户').selectOption({ index: 1 });
  await page.getByLabel('分类').selectOption({ index: 1 });
  await page.getByLabel('金额').fill('60');
  await page.getByLabel('备注').fill('超额支出');

  await expect(page.getByText(/预计余额不足/)).toBeVisible();
  await expect(page.getByRole('button', { name: '保存记录' })).toBeDisabled();
});
