import { expect, test } from '@playwright/test';
import { resetDatabase } from './helpers/reset';

test.beforeEach(async ({ page }) => {
  await resetDatabase(page);
});

test('core routes render', async ({ page }) => {
  await page.goto('/home');
  await expect(page.getByText('本月总览')).toBeVisible();

  await page.goto('/records');
  await expect(page.getByText('记录列表')).toBeVisible();

  await page.goto('/create');
  await expect(page.getByText('新增记录')).toBeVisible();

  await page.goto('/accounts');
  await expect(page.getByText('账户列表')).toBeVisible();

  await page.goto('/stats');
  await expect(page.getByText('收支趋势')).toBeVisible();
});
