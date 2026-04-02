import { expect, type Page } from '@playwright/test';

interface CreateAccountOptions {
  name: string;
  type?: 'cash' | 'debit_card' | 'credit_card' | 'alipay' | 'wechat' | 'other';
  network?: string;
  baseCurrency?: string;
  allowOverdraft?: boolean;
}

export const createAccount = async (page: Page, options: CreateAccountOptions) => {
  const {
    name,
    type = 'debit_card',
    network = 'visa',
    baseCurrency = 'USD',
    allowOverdraft = true,
  } = options;

  await page.goto('/accounts');
  await page.getByRole('button', { name: '+ 新建账户' }).click();

  const dialog = page.locator('.accounts-modal-card');
  await expect(dialog.getByRole('heading', { name: '新建账户' })).toBeVisible();

  await dialog.getByPlaceholder('例如：招商银行储蓄卡').fill(name);
  await dialog.getByLabel('类型').selectOption(type);

  if (type === 'debit_card' || type === 'credit_card') {
    await dialog.getByLabel('卡组织').selectOption(network);
  }

  await dialog.getByLabel('默认入账币种').selectOption(baseCurrency);

  const overdraftCheckbox = dialog.getByRole('checkbox', { name: '允许透支' });
  if ((await overdraftCheckbox.isChecked()) !== allowOverdraft) {
    await overdraftCheckbox.click();
  }

  await dialog.getByRole('button', { name: '保存账户' }).click();
  await expect(page.locator('.accounts-card-grid').getByText(name)).toBeVisible();
};
