import type { Page, Route } from '@playwright/test';

const json = async (route: Route, body: unknown) => {
  await route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(body),
  });
};

export const mockFx = async (page: Page) => {
  await page.route('https://api.frankfurter.dev/v1/latest?*', async (route) => {
    const url = new URL(route.request().url());
    const base = url.searchParams.get('base');
    const symbols = (url.searchParams.get('symbols') ?? '')
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);

    if (base === 'USD') {
      const rates = Object.fromEntries(symbols.map((symbol) => {
        if (symbol === 'EUR') return [symbol, 0.8];
        if (symbol === 'JPY') return [symbol, 160];
        if (symbol === 'CNY') return [symbol, 7.2];
        return [symbol, 1];
      }));
      await json(route, { amount: 1, base: 'USD', date: '2026-04-02', rates });
      return;
    }

    if (base === 'EUR') {
      const rates = Object.fromEntries(symbols.map((symbol) => {
        if (symbol === 'USD') return [symbol, 1.25];
        return [symbol, 1];
      }));
      await json(route, { amount: 1, base: 'EUR', date: '2026-04-02', rates });
      return;
    }

    await route.abort();
  });

  await page.route('https://open.er-api.com/v6/latest/**', async (route) => {
    await route.abort();
  });
};
