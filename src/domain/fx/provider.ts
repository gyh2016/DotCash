export interface FxQuote {
  rate: number;
  provider: string;
  timestamp: string;
}

export interface FxMultiQuote {
  rates: Record<string, number>;
  providers: Record<string, string>;
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

const fetchFrankfurterRatesToTarget = async (target: string, sources: string[]): Promise<FxMultiQuote> => {
  const uniqueSources = Array.from(new Set(sources));
  const needRemote = uniqueSources.filter((source) => source !== target);
  if (needRemote.length === 0) {
    return {
      rates: Object.fromEntries(uniqueSources.map((source) => [source, 1])),
      providers: Object.fromEntries(uniqueSources.map((source) => [source, 'same-currency'])),
      provider: 'same-currency',
      timestamp: new Date().toISOString(),
    };
  }

  const url = `https://api.frankfurter.dev/v1/latest?base=${encodeURIComponent(target)}&symbols=${encodeURIComponent(needRemote.join(','))}`;
  const response = await fetch(url);
  if (!response.ok) throw new Error('FX API unavailable');

  const data = (await response.json()) as { rates?: Record<string, number> };
  const rates: Record<string, number> = {};
  const providers: Record<string, string> = {};
  for (const source of uniqueSources) {
    if (source === target) {
      rates[source] = 1;
      providers[source] = 'same-currency';
      continue;
    }
    const reverseRate = data.rates?.[source];
    if (!reverseRate || reverseRate <= 0) continue;
    rates[source] = 1 / reverseRate;
    providers[source] = 'frankfurter';
  }

  return {
    rates,
    providers,
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

const fetchOpenErApiRatesToTarget = async (target: string, sources: string[]): Promise<FxMultiQuote> => {
  const uniqueSources = Array.from(new Set(sources));
  const needRemote = uniqueSources.filter((source) => source !== target);
  if (needRemote.length === 0) {
    return {
      rates: Object.fromEntries(uniqueSources.map((source) => [source, 1])),
      providers: Object.fromEntries(uniqueSources.map((source) => [source, 'same-currency'])),
      provider: 'same-currency',
      timestamp: new Date().toISOString(),
    };
  }

  const url = `https://open.er-api.com/v6/latest/${encodeURIComponent(target)}`;
  const response = await fetch(url);
  if (!response.ok) throw new Error('Backup FX API unavailable');

  const data = (await response.json()) as { rates?: Record<string, number> };
  const rates: Record<string, number> = {};
  const providers: Record<string, string> = {};
  for (const source of uniqueSources) {
    if (source === target) {
      rates[source] = 1;
      providers[source] = 'same-currency';
      continue;
    }
    const reverseRate = data.rates?.[source];
    if (!reverseRate || reverseRate <= 0) throw new Error('Backup FX rate missing');
    rates[source] = 1 / reverseRate;
    providers[source] = 'open-er-api';
  }

  return {
    rates,
    providers,
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

export const fetchAutoRatesToTarget = async (target: string, sources: string[]): Promise<FxMultiQuote> => {
  const uniqueSources = Array.from(new Set(sources));
  if (uniqueSources.length === 0) {
    return {
      rates: {},
      providers: {},
      provider: 'same-currency',
      timestamp: new Date().toISOString(),
    };
  }

  let frankfurterRates: Record<string, number> = {};
  let frankfurterProviders: Record<string, string> = {};
  let frankfurterOk = false;
  try {
    const frankfurter = await fetchFrankfurterRatesToTarget(target, uniqueSources);
    frankfurterRates = frankfurter.rates;
    frankfurterProviders = frankfurter.providers;
    frankfurterOk = true;
  } catch {
    frankfurterOk = false;
  }

  const missingSources = uniqueSources.filter((source) => typeof frankfurterRates[source] !== 'number');
  if (missingSources.length === 0 && frankfurterOk) {
    return {
      rates: frankfurterRates,
      providers: frankfurterProviders,
      provider: 'frankfurter',
      timestamp: new Date().toISOString(),
    };
  }

  const backup = await fetchOpenErApiRatesToTarget(target, missingSources.length > 0 ? missingSources : uniqueSources);
  return {
    rates: { ...backup.rates, ...frankfurterRates },
    providers: { ...backup.providers, ...frankfurterProviders },
    provider: frankfurterOk ? 'frankfurter+open-er-api' : backup.provider,
    timestamp: new Date().toISOString(),
  };
};
