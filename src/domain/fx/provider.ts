export interface FxQuote {
  rate: number;
  provider: string;
  timestamp: string;
}

const fetchFrankfurterRate = async (from: string, to: string): Promise<FxQuote> => {
  if (from === to) {
    return {
      rate: 1,
      provider: 'same-currency',
      timestamp: new Date().toISOString(),
    };
  }

  const url = `https://api.frankfurter.dev/v1/latest?base=${encodeURIComponent(from)}&symbols=${encodeURIComponent(to)}`;
  const response = await fetch(url);
  if (!response.ok) throw new Error('FX API unavailable');

  const data = (await response.json()) as { rates?: Record<string, number> };
  const rate = data.rates?.[to];
  if (!rate) throw new Error('FX rate missing');

  return {
    rate,
    provider: 'frankfurter',
    timestamp: new Date().toISOString(),
  };
};

const fetchOpenErApiRate = async (from: string, to: string): Promise<FxQuote> => {
  const url = `https://open.er-api.com/v6/latest/${encodeURIComponent(from)}`;
  const response = await fetch(url);
  if (!response.ok) throw new Error('Backup FX API unavailable');

  const data = (await response.json()) as { rates?: Record<string, number> };
  const rate = data.rates?.[to];
  if (!rate) throw new Error('Backup FX rate missing');

  return {
    rate,
    provider: 'open-er-api',
    timestamp: new Date().toISOString(),
  };
};

export const fetchAutoRate = async (from: string, to: string): Promise<FxQuote> => {
  try {
    return await fetchFrankfurterRate(from, to);
  } catch {
    return fetchOpenErApiRate(from, to);
  }
};
