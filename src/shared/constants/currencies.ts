export interface CurrencyOption {
  code: string;
  nameZh: string;
}

export const CURRENCY_OPTIONS: CurrencyOption[] = [
  { code: 'CNY', nameZh: '人民币' },
  { code: 'USD', nameZh: '美元' },
  { code: 'EUR', nameZh: '欧元' },
  { code: 'JPY', nameZh: '日元' },
  { code: 'KRW', nameZh: '韩元' },
  { code: 'HKD', nameZh: '港币' },
  { code: 'MOP', nameZh: '澳门元' },
  { code: 'TWD', nameZh: '新台币' },
  { code: 'SGD', nameZh: '新加坡元' },
  { code: 'MYR', nameZh: '马来西亚林吉特' },
  { code: 'THB', nameZh: '泰铢' },
  { code: 'IDR', nameZh: '印尼盾' },
  { code: 'PHP', nameZh: '菲律宾比索' },
  { code: 'VND', nameZh: '越南盾' },
  { code: 'CAD', nameZh: '加元' },
  { code: 'AUD', nameZh: '澳元' },
  { code: 'NZD', nameZh: '新西兰元' },
  { code: 'GBP', nameZh: '英镑' },
  { code: 'CHF', nameZh: '瑞士法郎' },
];

export const COMMON_CURRENCIES = CURRENCY_OPTIONS.map((item) => item.code);

export const currencyLabelMap = Object.fromEntries(
  CURRENCY_OPTIONS.map((item) => [item.code, `${item.code}（${item.nameZh}）`]),
) as Record<string, string>;

export const formatCurrencyLabel = (currency: string) => currencyLabelMap[currency] ?? currency;
