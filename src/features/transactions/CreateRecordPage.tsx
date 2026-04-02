import { useEffect, useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { accountsRepository } from '@/db/repositories/accounts.repository';
import { categoriesRepository } from '@/db/repositories/categories.repository';
import { transactionsRepository } from '@/db/repositories/transactions.repository';
import { calculateTransactionSettlement, collectSettlementSourceCurrencies, feeOriginalMinor, feeSourceCurrency } from '@/domain/transactions/settlement';
import { fetchAutoRatesToTarget } from '@/domain/fx/provider';
import { calculateAccountBalanceMinor } from '@/domain/accounts/balance';
import type { Account, Category, FeeMode, RecordWithAmount, TransactionType } from '@/domain/types';
import { CURRENCY_OPTIONS, formatCurrencyLabel } from '@/shared/constants/currencies';
import { PageCard } from '@/shared/components/PageCard';
import { localInputToUtcIso, toLocalInputValue } from '@/shared/utils/datetime';
import { formatMoney, toMinor } from '@/shared/utils/money';

interface RecordFormValues {
  type: TransactionType;
  fromAccountId: string;
  categoryId: string;
  amount: number;
  originalCurrency: string;
  settledCurrency: string;
  cashbackAmount: number;
  cashbackCurrency: string;
  discountAmount: number;
  discountCurrency: string;
  conversionFeeMode: FeeMode;
  conversionFeeAmount: number;
  conversionFeeRate: number;
  conversionFeeCurrency: string;
  serviceFeeMode: FeeMode;
  serviceFeeAmount: number;
  serviceFeeRate: number;
  serviceFeeCurrency: string;
  occurredAt: string;
  note: string;
  fxMode: 'api' | 'manual';
  fxRate: number;
}

export const CreateRecordPage = () => {
  const toPairKey = (from: string, to: string) => `${from}->${to}`;
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [allRecords, setAllRecords] = useState<RecordWithAmount[]>([]);
  const [estimatedMinor, setEstimatedMinor] = useState<number | null>(null);
  const [submitMessage, setSubmitMessage] = useState('');
  const [rateError, setRateError] = useState('');
  const [balanceError, setBalanceError] = useState('');
  const [isRateLoading, setIsRateLoading] = useState(false);
  const [formulaText, setFormulaText] = useState('');
  const [fxRates, setFxRates] = useState<Record<string, number>>({});
  const [fxProviders, setFxProviders] = useState<Record<string, string>>({});
  const [rateProvider, setRateProvider] = useState('');

  const formatRate = (rate: number) => {
    if (!Number.isFinite(rate)) return '-';
    return Number(rate.toFixed(5)).toString();
  };

  const { register, handleSubmit, watch, setValue, reset } = useForm<RecordFormValues>({
    defaultValues: {
      type: 'expense',
      fromAccountId: '',
      categoryId: '',
      amount: 0,
      originalCurrency: '',
      settledCurrency: '',
      cashbackAmount: 0,
      cashbackCurrency: '',
      discountAmount: 0,
      discountCurrency: '',
      conversionFeeMode: 'fixed',
      conversionFeeAmount: 0,
      conversionFeeRate: 0,
      conversionFeeCurrency: '',
      serviceFeeMode: 'fixed',
      serviceFeeAmount: 0,
      serviceFeeRate: 0,
      serviceFeeCurrency: '',
      occurredAt: toLocalInputValue(new Date().toISOString()),
      note: '',
      fxMode: 'api',
      fxRate: 1,
    },
  });

  const values = watch();
  const { type, fromAccountId, originalCurrency, settledCurrency, fxMode } = values;

  const fromAccount = useMemo(() => accounts.find((item) => item.id === fromAccountId), [accounts, fromAccountId]);

  const supportedSettleCurrencies = useMemo(() => {
    if (!fromAccount) return [];
    const source = fromAccount.allowedCurrencies?.length ? fromAccount.allowedCurrencies : [fromAccount.baseCurrency];
    return Array.from(new Set(source));
  }, [fromAccount]);

  const defaultSettleCurrency = fromAccount?.baseCurrency ?? '';
  const accountReady = !!fromAccount;
  const hasBothCurrencies = originalCurrency !== '' && settledCurrency !== '';
  const canDirectSettle = accountReady && originalCurrency !== '' && supportedSettleCurrencies.includes(originalCurrency);
  const settledCurrencyNow = settledCurrency || defaultSettleCurrency;
  const requiredRatePairs = useMemo(() => {
    if (!accountReady || !settledCurrencyNow) return [] as Array<{ from: string; to: string; key: string }>;
    const fromCandidates = collectSettlementSourceCurrencies({
      originalAmountMinor: toMinor(values.amount || 0),
      originalCurrency,
      settledCurrency: settledCurrencyNow,
      cashbackAmountMinor: toMinor(values.cashbackAmount || 0),
      cashbackCurrency: values.cashbackCurrency || settledCurrencyNow,
      discountAmountMinor: toMinor(values.discountAmount || 0),
      discountCurrency: values.discountCurrency || settledCurrencyNow,
      conversionFeeMode: values.conversionFeeMode,
      conversionFeeAmountMinor: toMinor(values.conversionFeeAmount || 0),
      conversionFeeRate: values.conversionFeeRate || 0,
      conversionFeeCurrency: values.conversionFeeCurrency || settledCurrencyNow,
      serviceFeeMode: values.serviceFeeMode,
      serviceFeeAmountMinor: toMinor(values.serviceFeeAmount || 0),
      serviceFeeRate: values.serviceFeeRate || 0,
      serviceFeeCurrency: values.serviceFeeCurrency || settledCurrencyNow,
    });
    const uniqueSources = Array.from(new Set(fromCandidates));
    return uniqueSources
      .filter((source) => source !== settledCurrencyNow)
      .map((source) => ({ from: source, to: settledCurrencyNow, key: toPairKey(source, settledCurrencyNow) }));
  }, [accountReady, settledCurrencyNow, originalCurrency, values.discountCurrency, values.cashbackCurrency]);
  const mainRatePairKey = useMemo(() => {
    if (!originalCurrency || !settledCurrencyNow || originalCurrency === settledCurrencyNow) return '';
    return toPairKey(originalCurrency, settledCurrencyNow);
  }, [originalCurrency, settledCurrencyNow]);
  const currentBalanceMinor = useMemo(() => {
    if (!fromAccount) return null;
    return calculateAccountBalanceMinor(fromAccount.id, allRecords);
  }, [fromAccount, allRecords]);
  const willSpend = type === 'expense';
  const projectedBalanceMinor = useMemo(() => {
    if (!willSpend || currentBalanceMinor === null || estimatedMinor === null) return null;
    return currentBalanceMinor - estimatedMinor;
  }, [willSpend, currentBalanceMinor, estimatedMinor]);
  const isInsufficientBalance = !!fromAccount && !(fromAccount.allowOverdraft ?? true) && projectedBalanceMinor !== null && projectedBalanceMinor < 0;

  useEffect(() => {
    const load = async () => {
      const [accountList, records] = await Promise.all([
        accountsRepository.listActive(),
        transactionsRepository.listAll(),
      ]);
      setAccounts(accountList);
      setAllRecords(records);
    };
    void load();
  }, []);

  useEffect(() => {
    const loadCategories = async () => {
      const items = await categoriesRepository.listByKind(type === 'income' ? 'income' : 'expense');
      setCategories(items);
      if (items.length > 0) setValue('categoryId', items[0].id);
    };
    void loadCategories();
  }, [type, setValue]);

  useEffect(() => {
    setValue('originalCurrency', defaultSettleCurrency);
    setValue('settledCurrency', defaultSettleCurrency);
    setValue('cashbackCurrency', defaultSettleCurrency);
    setValue('discountCurrency', defaultSettleCurrency);
    setValue('conversionFeeCurrency', defaultSettleCurrency);
    setValue('serviceFeeCurrency', defaultSettleCurrency);
    setValue('fxRate', 1);
    setRateError('');
    setRateProvider('');
    setEstimatedMinor(null);
    setFormulaText('');
    setFxRates({});
    setFxProviders({});
    setIsRateLoading(false);
  }, [fromAccountId, defaultSettleCurrency, setValue]);

  useEffect(() => {
    if (canDirectSettle) {
      setValue('settledCurrency', originalCurrency);
      if (!values.cashbackCurrency) setValue('cashbackCurrency', originalCurrency);
      if (!values.discountCurrency) setValue('discountCurrency', originalCurrency);
      if (!values.conversionFeeCurrency) setValue('conversionFeeCurrency', originalCurrency);
      if (!values.serviceFeeCurrency) setValue('serviceFeeCurrency', originalCurrency);
      setValue('fxRate', 1);
    }
  }, [canDirectSettle, originalCurrency, setValue, values.cashbackCurrency, values.discountCurrency, values.conversionFeeCurrency, values.serviceFeeCurrency]);

  useEffect(() => {
    if (!settledCurrencyNow) return;
    if (!values.cashbackCurrency) setValue('cashbackCurrency', settledCurrencyNow);
    if (!values.discountCurrency) setValue('discountCurrency', settledCurrencyNow);
    if (!values.conversionFeeCurrency) setValue('conversionFeeCurrency', settledCurrencyNow);
    if (!values.serviceFeeCurrency) setValue('serviceFeeCurrency', settledCurrencyNow);
  }, [settledCurrencyNow, setValue, values.cashbackCurrency, values.discountCurrency, values.conversionFeeCurrency, values.serviceFeeCurrency]);

  useEffect(() => {
    const loadRate = async () => {
      if (fxMode !== 'api') {
        setIsRateLoading(false);
        return;
      }
      if (requiredRatePairs.length === 0) {
        setIsRateLoading(false);
        setRateError('');
        setRateProvider('');
        return;
      }

      try {
        setIsRateLoading(true);
        const sources = requiredRatePairs.map((pair) => pair.from);
        const quote = await fetchAutoRatesToTarget(settledCurrencyNow, sources);
        const nextRates: Record<string, number> = {};
        const nextProviders: Record<string, string> = {};
        for (const pair of requiredRatePairs) {
          const nextRate = quote.rates[pair.from];
          if (!nextRate || nextRate <= 0) continue;
          nextRates[pair.key] = Number(nextRate.toFixed(5));
          nextProviders[pair.key] = quote.providers[pair.from] ?? quote.provider;
        }
        setFxRates((prev) => ({ ...prev, ...nextRates }));
        setFxProviders((prev) => ({ ...prev, ...nextProviders }));
        if (mainRatePairKey && nextRates[mainRatePairKey]) {
          setValue('fxRate', nextRates[mainRatePairKey]);
        }
        setRateProvider(quote.provider);
        setRateError('');
      } catch {
        setRateProvider('');
        setRateError('自动汇率暂不可用，请切换到手动汇率录入。');
      } finally {
        setIsRateLoading(false);
      }
    };

    void loadRate();
  }, [fxMode, requiredRatePairs, settledCurrencyNow, mainRatePairKey, setValue]);

  useEffect(() => {
    if (!accountReady || values.amount <= 0 || !hasBothCurrencies) {
      setEstimatedMinor(null);
      setFormulaText('');
      return;
    }
    const getRate = (from: string, to: string) => {
      if (from === to) return 1;
      return fxRates[toPairKey(from, to)];
    };
    if (fxMode === 'api' && isRateLoading) {
      setEstimatedMinor(null);
      setFormulaText('');
      return;
    }
    const amountMinor = toMinor(values.amount);
    const settlement = calculateTransactionSettlement({
      originalAmountMinor: amountMinor,
      originalCurrency: values.originalCurrency,
      settledCurrency: settledCurrencyNow,
      cashbackAmountMinor: toMinor(values.cashbackAmount || 0),
      cashbackCurrency: values.cashbackCurrency || settledCurrencyNow,
      discountAmountMinor: toMinor(values.discountAmount || 0),
      discountCurrency: values.discountCurrency || settledCurrencyNow,
      conversionFeeMode: values.conversionFeeMode,
      conversionFeeAmountMinor: toMinor(values.conversionFeeAmount || 0),
      conversionFeeRate: values.conversionFeeRate || 0,
      conversionFeeCurrency: values.conversionFeeCurrency || settledCurrencyNow,
      serviceFeeMode: values.serviceFeeMode,
      serviceFeeAmountMinor: toMinor(values.serviceFeeAmount || 0),
      serviceFeeRate: values.serviceFeeRate || 0,
      serviceFeeCurrency: values.serviceFeeCurrency || settledCurrencyNow,
    }, getRate);
    if (!settlement) {
      setEstimatedMinor(null);
      setFormulaText('');
      return;
    }

    const nextEstimatedMinor = settlement.settledAmountMinor;
    setEstimatedMinor(nextEstimatedMinor);
    setValue('fxRate', settlement.mainRate);

    const discountOriginalMinor = toMinor(values.discountAmount || 0);
    const cashbackOriginalMinor = toMinor(values.cashbackAmount || 0);
    const conversionFeeOriginalMinor = feeOriginalMinor(
      values.conversionFeeMode,
      amountMinor,
      toMinor(values.conversionFeeAmount || 0),
      values.conversionFeeRate || 0,
    );
    const serviceFeeOriginalMinor = feeOriginalMinor(
      values.serviceFeeMode,
      amountMinor,
      toMinor(values.serviceFeeAmount || 0),
      values.serviceFeeRate || 0,
    );
    const discountCurrency = values.discountCurrency || settledCurrencyNow;
    const cashbackCurrency = values.cashbackCurrency || settledCurrencyNow;
    const conversionFeeCurrency = feeSourceCurrency(
      values.conversionFeeMode,
      values.originalCurrency,
      values.conversionFeeCurrency || settledCurrencyNow,
      settledCurrencyNow,
    );
    const serviceFeeCurrency = feeSourceCurrency(
      values.serviceFeeMode,
      values.originalCurrency,
      values.serviceFeeCurrency || settledCurrencyNow,
      settledCurrencyNow,
    );
    const discountRate = getRate(discountCurrency, settledCurrencyNow) ?? 1;
    const cashbackRate = getRate(cashbackCurrency, settledCurrencyNow) ?? 1;
    const conversionFeeRate = getRate(conversionFeeCurrency, settledCurrencyNow) ?? 1;
    const serviceFeeRate = getRate(serviceFeeCurrency, settledCurrencyNow) ?? 1;

    const mainPart = settlement.mainRate === 1
      ? `${formatMoney(amountMinor, values.originalCurrency)}`
      : `${formatMoney(amountMinor, values.originalCurrency)} × ${formatRate(settlement.mainRate)}`;
    const discountPart = discountOriginalMinor <= 0
      ? `0 ${settledCurrencyNow}`
      : discountCurrency === settledCurrencyNow
        ? `${formatMoney(discountOriginalMinor, settledCurrencyNow)}`
        : `${formatMoney(discountOriginalMinor, discountCurrency)} × ${formatRate(discountRate)}`;
    const cashbackPart = cashbackOriginalMinor <= 0
      ? `0 ${settledCurrencyNow}`
      : cashbackCurrency === settledCurrencyNow
        ? `${formatMoney(cashbackOriginalMinor, settledCurrencyNow)}`
        : `${formatMoney(cashbackOriginalMinor, cashbackCurrency)} × ${formatRate(cashbackRate)}`;
    const conversionFeePart = conversionFeeOriginalMinor <= 0
      ? `0 ${settledCurrencyNow}`
      : values.conversionFeeMode === 'rate'
        ? `${formatMoney(amountMinor, values.originalCurrency)} × ${values.conversionFeeRate}%${conversionFeeCurrency === settledCurrencyNow ? '' : ` × ${formatRate(conversionFeeRate)}`}`
        : conversionFeeCurrency === settledCurrencyNow
          ? `${formatMoney(conversionFeeOriginalMinor, settledCurrencyNow)}`
          : `${formatMoney(conversionFeeOriginalMinor, conversionFeeCurrency)} × ${formatRate(conversionFeeRate)}`;
    const serviceFeePart = serviceFeeOriginalMinor <= 0
      ? `0 ${settledCurrencyNow}`
      : values.serviceFeeMode === 'rate'
        ? `${formatMoney(amountMinor, values.originalCurrency)} × ${values.serviceFeeRate}%${serviceFeeCurrency === settledCurrencyNow ? '' : ` × ${formatRate(serviceFeeRate)}`}`
        : serviceFeeCurrency === settledCurrencyNow
          ? `${formatMoney(serviceFeeOriginalMinor, settledCurrencyNow)}`
          : `${formatMoney(serviceFeeOriginalMinor, serviceFeeCurrency)} × ${formatRate(serviceFeeRate)}`;

    setFormulaText(
      `${mainPart} + ${conversionFeePart} + ${serviceFeePart} - ${discountPart} - ${cashbackPart} = ${formatMoney(nextEstimatedMinor, settledCurrencyNow)}`,
    );
  }, [
    accountReady, hasBothCurrencies, canDirectSettle, values.amount, values.fxRate, values.cashbackAmount, values.cashbackCurrency,
    values.discountAmount, values.discountCurrency, values.originalCurrency, values.conversionFeeMode, values.conversionFeeAmount,
    values.conversionFeeRate, values.conversionFeeCurrency, values.serviceFeeMode, values.serviceFeeAmount, values.serviceFeeRate,
    values.serviceFeeCurrency, fxMode, isRateLoading, settledCurrencyNow, fxRates, setValue,
  ]);

  const onSubmit = handleSubmit(async (submitValues) => {
    const getRate = (from: string, to: string) => {
      if (from === to) return 1;
      return fxRates[toPairKey(from, to)];
    };
    const amountMinor = toMinor(submitValues.amount);
    const settlement = calculateTransactionSettlement({
      originalAmountMinor: amountMinor,
      originalCurrency: submitValues.originalCurrency,
      settledCurrency: submitValues.settledCurrency,
      cashbackAmountMinor: toMinor(submitValues.cashbackAmount || 0),
      cashbackCurrency: submitValues.cashbackCurrency || submitValues.settledCurrency,
      discountAmountMinor: toMinor(submitValues.discountAmount || 0),
      discountCurrency: submitValues.discountCurrency || submitValues.settledCurrency,
      conversionFeeMode: submitValues.conversionFeeMode,
      conversionFeeAmountMinor: toMinor(submitValues.conversionFeeAmount || 0),
      conversionFeeRate: submitValues.conversionFeeRate || 0,
      conversionFeeCurrency: submitValues.conversionFeeCurrency || submitValues.settledCurrency,
      serviceFeeMode: submitValues.serviceFeeMode,
      serviceFeeAmountMinor: toMinor(submitValues.serviceFeeAmount || 0),
      serviceFeeRate: submitValues.serviceFeeRate || 0,
      serviceFeeCurrency: submitValues.serviceFeeCurrency || submitValues.settledCurrency,
    }, getRate);
    if (!settlement) {
      setRateError('存在未配置的汇率，请补全后再保存。');
      return;
    }
    const involvedRates = requiredRatePairs
      .map((pair) => fxRates[pair.key])
      .filter((rate): rate is number => Number.isFinite(rate));
    const hasDifferentRate = involvedRates.some((rate) => Math.abs(rate - settlement.mainRate) > 0.0000001);

    if (submitValues.type === 'expense' && fromAccount && !(fromAccount.allowOverdraft ?? true)) {
      const latestRecords = await transactionsRepository.listAll();
      const latestBalanceMinor = calculateAccountBalanceMinor(fromAccount.id, latestRecords);
      const latestProjectedMinor = latestBalanceMinor - settlement.settledAmountMinor;
      if (latestProjectedMinor < 0) {
        setBalanceError(`余额不足：当前余额 ${formatMoney(latestBalanceMinor, fromAccount.baseCurrency)}。`);
        return;
      }
    }

    setBalanceError('');

    await transactionsRepository.create({
      type: submitValues.type,
      fromAccountId: submitValues.fromAccountId,
      toAccountId: null,
      categoryId: submitValues.categoryId,
      note: submitValues.note || null,
      occurredAt: localInputToUtcIso(submitValues.occurredAt),
      amount: {
        originalAmountMinor: amountMinor,
        originalCurrency: submitValues.originalCurrency,
        settledAmountMinor: settlement.settledAmountMinor,
        settledCurrency: submitValues.settledCurrency,
        cashbackAmountMinor: toMinor(submitValues.cashbackAmount || 0),
        cashbackCurrency: submitValues.cashbackCurrency || submitValues.settledCurrency,
        discountAmountMinor: toMinor(submitValues.discountAmount || 0),
        discountCurrency: submitValues.discountCurrency || submitValues.settledCurrency,
        conversionFeeMode: submitValues.conversionFeeMode,
        conversionFeeAmountMinor: toMinor(submitValues.conversionFeeAmount || 0),
        conversionFeeRate: submitValues.conversionFeeRate || 0,
        conversionFeeCurrency: submitValues.conversionFeeMode === 'fixed'
          ? (submitValues.conversionFeeCurrency || submitValues.settledCurrency)
          : null,
        serviceFeeMode: submitValues.serviceFeeMode,
        serviceFeeAmountMinor: toMinor(submitValues.serviceFeeAmount || 0),
        serviceFeeRate: submitValues.serviceFeeRate || 0,
        serviceFeeCurrency: submitValues.serviceFeeMode === 'fixed'
          ? (submitValues.serviceFeeCurrency || submitValues.settledCurrency)
          : null,
        actualSettledAmountMinor: null,
        isEstimated: !canDirectSettle || hasDifferentRate,
        fxRate: settlement.mainRate,
        fxSource: canDirectSettle ? null : submitValues.fxMode,
        fxProvider: canDirectSettle ? null : submitValues.fxMode === 'api' ? ((fxProviders[mainRatePairKey] ?? rateProvider) || 'auto') : 'manual',
        fxTimestamp: new Date().toISOString(),
      },
    });

    setEstimatedMinor(null);
    setSubmitMessage('记录已保存');
    setRateError('');
    setRateProvider('');
    reset({
      type: 'expense',
      fromAccountId: '',
      categoryId: '',
      amount: 0,
      originalCurrency: '',
      settledCurrency: '',
      cashbackAmount: 0,
      cashbackCurrency: '',
      discountAmount: 0,
      discountCurrency: '',
      conversionFeeMode: 'fixed',
      conversionFeeAmount: 0,
      conversionFeeRate: 0,
      conversionFeeCurrency: '',
      serviceFeeMode: 'fixed',
      serviceFeeAmount: 0,
      serviceFeeRate: 0,
      serviceFeeCurrency: '',
      occurredAt: toLocalInputValue(new Date().toISOString()),
      note: '',
      fxMode: 'api',
      fxRate: 1,
    });
    setAllRecords(await transactionsRepository.listAll());
  });

  return (
    <PageCard className="create-record-card">
      <h2>新增记录</h2>
      <form className="record-form" onSubmit={onSubmit}>
        <section className="form-section">
          <h3>基础信息</h3>
          <div className="form-grid create-basic-grid">
            <div className="form-control">
              <span className="fx-label">记录类型</span>
              <div className="fx-segmented type-segmented" role="radiogroup" aria-label="记录类型">
                <button
                  type="button"
                  className={type === 'expense' ? 'fx-option active' : 'fx-option'}
                  onClick={() => setValue('type', 'expense')}
                >
                  支出
                </button>
                <button
                  type="button"
                  className={type === 'income' ? 'fx-option active' : 'fx-option'}
                  onClick={() => setValue('type', 'income')}
                >
                  收入
                </button>
              </div>
            </div>

            <label>
              出账账户
              <select required {...register('fromAccountId')}>
                <option value="">请选择</option>
                {accounts.map((account) => {
                  const supported = (account.allowedCurrencies ?? [account.baseCurrency]).join(' / ');
                  return (
                    <option key={account.id} value={account.id}>
                      {`${account.name}｜默认 ${account.baseCurrency}｜支持 ${supported}`}
                    </option>
                  );
                })}
              </select>
            </label>
            {fromAccount ? (
              <div className="account-meta-grid">
                <div className="account-meta-item">
                  <span>默认币种</span>
                  <p className="account-meta-value">{formatCurrencyLabel(fromAccount.baseCurrency)}</p>
                </div>
                <div className="account-meta-item">
                  <span>支持币种</span>
                  <div className="account-meta-list">
                    {supportedSettleCurrencies.map((item) => (
                      <p key={`meta-${item}`}>{formatCurrencyLabel(item)}</p>
                    ))}
                  </div>
                </div>
                <div className="account-meta-item">
                  <span>透支</span>
                  <p className="account-meta-value">{(fromAccount.allowOverdraft ?? true) ? '允许' : '不允许'}</p>
                </div>
                <div className="account-meta-item">
                  <span>当前余额</span>
                  <p className="account-meta-value">{currentBalanceMinor === null ? '-' : formatMoney(currentBalanceMinor, fromAccount.baseCurrency)}</p>
                </div>
              </div>
            ) : null}

            <label>
              分类
              <select required {...register('categoryId')}>
                <option value="">请选择</option>
                {categories.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name}
                  </option>
                ))}
              </select>
            </label>

            <label>
              发生时间（本地时区）
              <input type="datetime-local" {...register('occurredAt')} />
            </label>
          </div>
        </section>

        <section className="form-section">
          <h3>金额与币种</h3>
          <div className="form-grid">
            <label>
              金额
              <input type="number" step="0.01" required {...register('amount', { valueAsNumber: true })} />
            </label>

            <label>
              交易币种
              <select {...register('originalCurrency')} disabled={!accountReady}>
                <option value="">请选择</option>
                {CURRENCY_OPTIONS.map((currency) => (
                  <option key={currency.code} value={currency.code}>
                    {formatCurrencyLabel(currency.code)}
                  </option>
                ))}
              </select>
            </label>

            <label>
              入账币种
              <select {...register('settledCurrency')} disabled={!accountReady || canDirectSettle}>
                <option value="">请选择</option>
                {supportedSettleCurrencies.map((currency) => (
                  <option key={currency} value={currency}>
                    {formatCurrencyLabel(currency)}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {!accountReady ? <p className="hint">请先选择出账账户后再设置币种。</p> : null}
        </section>

        <section className="form-section">
          <h3>返现与优惠</h3>
          <div className="form-grid create-benefit-grid">
            <label>
              优惠
              <input type="number" step="0.01" {...register('discountAmount', { valueAsNumber: true })} />
            </label>
            <label>
              优惠币种
              <select {...register('discountCurrency')} disabled={!accountReady}>
                {CURRENCY_OPTIONS.map((currency) => (
                  <option key={`discount-${currency.code}`} value={currency.code}>
                    {formatCurrencyLabel(currency.code)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              返现
              <input type="number" step="0.01" {...register('cashbackAmount', { valueAsNumber: true })} />
            </label>
            <label>
              返现币种
              <select {...register('cashbackCurrency')} disabled={!accountReady}>
                {CURRENCY_OPTIONS.map((currency) => (
                  <option key={`cashback-${currency.code}`} value={currency.code}>
                    {formatCurrencyLabel(currency.code)}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </section>

        <section className="form-section">
          <h3>费用</h3>
          <div className="form-grid">
            <div className="form-control">
              <span className="fx-label">货币转换费模式</span>
              <div className="fx-segmented type-segmented" role="radiogroup" aria-label="货币转换费模式">
                <button
                  type="button"
                  className={values.conversionFeeMode === 'fixed' ? 'fx-option active' : 'fx-option'}
                  onClick={() => setValue('conversionFeeMode', 'fixed')}
                >
                  固定金额
                </button>
                <button
                  type="button"
                  className={values.conversionFeeMode === 'rate' ? 'fx-option active' : 'fx-option'}
                  onClick={() => setValue('conversionFeeMode', 'rate')}
                >
                  比例
                </button>
              </div>
            </div>
            <label>
              货币转换费
              <div className="input-suffix-wrap">
                <input
                  type="number"
                  step="0.01"
                  value={values.conversionFeeMode === 'rate' ? values.conversionFeeRate : values.conversionFeeAmount}
                  onChange={(event) => {
                    const next = Number(event.target.value || 0);
                    if (values.conversionFeeMode === 'rate') {
                      setValue('conversionFeeRate', next);
                      return;
                    }
                    setValue('conversionFeeAmount', next);
                  }}
                />
                {values.conversionFeeMode === 'rate' ? <span className="input-suffix">%</span> : null}
              </div>
            </label>
            <label>
              货币转换费币种
              <select {...register('conversionFeeCurrency')} disabled={!accountReady || values.conversionFeeMode === 'rate'}>
                {CURRENCY_OPTIONS.map((currency) => (
                  <option key={`conversion-fee-${currency.code}`} value={currency.code}>
                    {formatCurrencyLabel(currency.code)}
                  </option>
                ))}
              </select>
            </label>

            <div className="form-control">
              <span className="fx-label">手续费模式</span>
              <div className="fx-segmented type-segmented" role="radiogroup" aria-label="手续费模式">
                <button
                  type="button"
                  className={values.serviceFeeMode === 'fixed' ? 'fx-option active' : 'fx-option'}
                  onClick={() => setValue('serviceFeeMode', 'fixed')}
                >
                  固定金额
                </button>
                <button
                  type="button"
                  className={values.serviceFeeMode === 'rate' ? 'fx-option active' : 'fx-option'}
                  onClick={() => setValue('serviceFeeMode', 'rate')}
                >
                  比例
                </button>
              </div>
            </div>
            <label>
              手续费
              <div className="input-suffix-wrap">
                <input
                  type="number"
                  step="0.01"
                  value={values.serviceFeeMode === 'rate' ? values.serviceFeeRate : values.serviceFeeAmount}
                  onChange={(event) => {
                    const next = Number(event.target.value || 0);
                    if (values.serviceFeeMode === 'rate') {
                      setValue('serviceFeeRate', next);
                      return;
                    }
                    setValue('serviceFeeAmount', next);
                  }}
                />
                {values.serviceFeeMode === 'rate' ? <span className="input-suffix">%</span> : null}
              </div>
            </label>
            <label>
              手续费币种
              <select {...register('serviceFeeCurrency')} disabled={!accountReady || values.serviceFeeMode === 'rate'}>
                {CURRENCY_OPTIONS.map((currency) => (
                  <option key={`service-fee-${currency.code}`} value={currency.code}>
                    {formatCurrencyLabel(currency.code)}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <p className="hint">比例模式按记账金额计算，固定金额模式按所选币种折算到入账币种。</p>
        </section>

        <section className="form-section">
          <div className="section-title-row">
            <h3>汇率</h3>
          </div>
          <div className="fx-mode-wrap">
            <span className="fx-label">汇率模式</span>
            <div className="fx-segmented type-segmented" role="radiogroup" aria-label="汇率模式">
              <button
                type="button"
                className={fxMode === 'api' ? 'fx-option active' : 'fx-option'}
                onClick={() => setValue('fxMode', 'api')}
                disabled={!accountReady || !hasBothCurrencies}
              >
                自动汇率
              </button>
              <button
                type="button"
                className={fxMode === 'manual' ? 'fx-option active' : 'fx-option'}
                onClick={() => setValue('fxMode', 'manual')}
                disabled={!accountReady || !hasBothCurrencies}
              >
                手动汇率
              </button>
            </div>
          </div>

          <div className="fx-rates-list">
            {requiredRatePairs.map((pair) => (
              <label key={pair.key} className="fx-rate-row">
                <span className="fx-rate-pair">{pair.from} → {pair.to}</span>
                <input
                  type="number"
                  step="0.00001"
                  className="fx-rate-input"
                  value={Number.isFinite(fxRates[pair.key]) ? fxRates[pair.key] : ''}
                  placeholder={isRateLoading && fxMode === 'api' ? '正在获取汇率...' : ''}
                  onChange={(event) =>
                    setFxRates((prev) => ({ ...prev, [pair.key]: Number(event.target.value || 0) }))
                  }
                  disabled={fxMode === 'api' || isRateLoading}
                />
                <span className="section-extra">
                  {fxMode === 'api' ? `来源：${(fxProviders[pair.key] ?? rateProvider) || '-'}` : ''}
                </span>
              </label>
            ))}
            {requiredRatePairs.length === 0 ? (
              accountReady ? <p className="hint">当前币种组合无需汇率。</p> : null
            ) : null}
            {isRateLoading && fxMode === 'api' ? (
              <p className="hint">正在获取汇率...</p>
            ) : null}
          </div>
          {!accountReady ? <p className="hint">请先选择出账账户后再计算汇率。</p> : null}
          {accountReady && !hasBothCurrencies ? <p className="hint">请选择交易币种和入账币种后自动加载汇率。</p> : null}
          {rateError ? <p className="error-text">{rateError}</p> : null}
        </section>

        <section className="form-section">
          <h3>备注与确认</h3>
          <div className="form-grid">
            <label>
              备注
              <input {...register('note')} placeholder="可选" />
            </label>
          </div>

          <div className="result-box">
            {estimatedMinor === null
              ? '入账金额：-'
              : canDirectSettle
                ? `入账金额：${formatMoney(estimatedMinor, originalCurrency)}（实际）`
                : `入账金额：${formatMoney(estimatedMinor, settledCurrency)}（预估）`}
            {formulaText ? <p className="calc-formula">计算：{formulaText}</p> : null}
          </div>
        </section>

        {submitMessage ? <p className="success-text">{submitMessage}</p> : null}
        {balanceError ? <p className="error-text">{balanceError}</p> : null}
        {isInsufficientBalance ? (
          <p className="error-text">
            预计余额不足（预计变动后余额 {projectedBalanceMinor !== null && fromAccount ? formatMoney(projectedBalanceMinor, fromAccount.baseCurrency) : '-'}），该账户不允许透支。
          </p>
        ) : null}
        <input type="hidden" {...register('type')} />
        <input type="hidden" {...register('fxMode')} />
        <input type="hidden" {...register('fxRate', { valueAsNumber: true })} />
        <input type="hidden" {...register('conversionFeeMode')} />
        <input type="hidden" {...register('serviceFeeMode')} />
        <p className="hint quick-save-hint">小提示：填写完成后按回车键可快速保存。</p>
        <button type="submit" disabled={isInsufficientBalance}>保存记录</button>
      </form>
    </PageCard>
  );
};
