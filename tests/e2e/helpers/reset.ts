import type { Page } from '@playwright/test';

export const resetDatabase = async (page: Page) => {
  await page.goto('/home');
  await page.evaluate(async () => {
    await window.__DOTCASH_E2E__?.resetDatabase();
  });
  await page.reload();
};
