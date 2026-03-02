export const toMinor = (value: number) => Math.round(value * 100);

export const fromMinor = (minor: number) => (minor / 100).toFixed(2);

export const formatMoney = (minor: number, currency = 'CNY') => {
  const amount = fromMinor(minor);
  return currency === 'CNY' ? `${amount} 元` : `${amount} ${currency}`;
};
