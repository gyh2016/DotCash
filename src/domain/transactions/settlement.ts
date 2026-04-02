import type { FeeMode } from '@/domain/types';

export interface TransactionSettlementInput {
  originalAmountMinor: number;
  originalCurrency: string;
  settledCurrency: string;
  cashbackAmountMinor: number;
  cashbackCurrency: string;
  discountAmountMinor: number;
  discountCurrency: string;
  conversionFeeMode: FeeMode;
  conversionFeeAmountMinor: number;
  conversionFeeRate: number;
  conversionFeeCurrency: string | null;
  serviceFeeMode: FeeMode;
  serviceFeeAmountMinor: number;
  serviceFeeRate: number;
  serviceFeeCurrency: string | null;
}

export interface TransactionSettlementBreakdown {
  baseSettledAmountMinor: number;
  cashbackSettledMinor: number;
  discountSettledMinor: number;
  conversionFeeSettledMinor: number;
  serviceFeeSettledMinor: number;
  settledAmountMinor: number;
  mainRate: number;
}

export const feeSourceCurrency = (
  mode: FeeMode,
  originalCurrency: string,
  feeCurrency: string | null,
  settledCurrency: string,
) => {
  if (mode === 'rate') return originalCurrency;
  return feeCurrency || settledCurrency;
};

export const feeOriginalMinor = (
  mode: FeeMode,
  baseAmountMinor: number,
  fixedAmountMinor: number,
  ratePercent: number,
) => {
  if (mode === 'rate') {
    return Math.round(baseAmountMinor * (ratePercent / 100));
  }
  return fixedAmountMinor;
};

export const collectSettlementSourceCurrencies = (input: TransactionSettlementInput) => {
  const currencies = [
    input.originalCurrency,
    input.cashbackCurrency || input.settledCurrency,
    input.discountCurrency || input.settledCurrency,
    feeSourceCurrency(input.conversionFeeMode, input.originalCurrency, input.conversionFeeCurrency, input.settledCurrency),
    feeSourceCurrency(input.serviceFeeMode, input.originalCurrency, input.serviceFeeCurrency, input.settledCurrency),
  ].filter(Boolean);

  return Array.from(new Set(currencies));
};

export const calculateTransactionSettlement = (
  input: TransactionSettlementInput,
  getRate: (from: string, to: string) => number | undefined,
): TransactionSettlementBreakdown | null => {
  const mainRate = input.originalCurrency === input.settledCurrency
    ? 1
    : getRate(input.originalCurrency, input.settledCurrency);
  if (!mainRate || mainRate <= 0) return null;

  const cashbackRate = input.cashbackCurrency === input.settledCurrency
    ? 1
    : getRate(input.cashbackCurrency || input.settledCurrency, input.settledCurrency);
  const discountRate = input.discountCurrency === input.settledCurrency
    ? 1
    : getRate(input.discountCurrency || input.settledCurrency, input.settledCurrency);
  if (!cashbackRate || cashbackRate <= 0 || !discountRate || discountRate <= 0) return null;

  const conversionSourceCurrency = feeSourceCurrency(
    input.conversionFeeMode,
    input.originalCurrency,
    input.conversionFeeCurrency,
    input.settledCurrency,
  );
  const serviceSourceCurrency = feeSourceCurrency(
    input.serviceFeeMode,
    input.originalCurrency,
    input.serviceFeeCurrency,
    input.settledCurrency,
  );
  const conversionRate = conversionSourceCurrency === input.settledCurrency
    ? 1
    : getRate(conversionSourceCurrency, input.settledCurrency);
  const serviceRate = serviceSourceCurrency === input.settledCurrency
    ? 1
    : getRate(serviceSourceCurrency, input.settledCurrency);
  if (!conversionRate || conversionRate <= 0 || !serviceRate || serviceRate <= 0) return null;

  const baseSettledAmountMinor = Math.round(input.originalAmountMinor * mainRate);
  const cashbackSettledMinor = Math.round(input.cashbackAmountMinor * cashbackRate);
  const discountSettledMinor = Math.round(input.discountAmountMinor * discountRate);

  const conversionOriginalMinor = feeOriginalMinor(
    input.conversionFeeMode,
    input.originalAmountMinor,
    input.conversionFeeAmountMinor,
    input.conversionFeeRate,
  );
  const serviceOriginalMinor = feeOriginalMinor(
    input.serviceFeeMode,
    input.originalAmountMinor,
    input.serviceFeeAmountMinor,
    input.serviceFeeRate,
  );
  const conversionFeeSettledMinor = Math.round(conversionOriginalMinor * conversionRate);
  const serviceFeeSettledMinor = Math.round(serviceOriginalMinor * serviceRate);

  return {
    baseSettledAmountMinor,
    cashbackSettledMinor,
    discountSettledMinor,
    conversionFeeSettledMinor,
    serviceFeeSettledMinor,
    settledAmountMinor:
      baseSettledAmountMinor
      - cashbackSettledMinor
      - discountSettledMinor
      - conversionFeeSettledMinor
      - serviceFeeSettledMinor,
    mainRate,
  };
};
