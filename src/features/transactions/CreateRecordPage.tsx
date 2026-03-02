import { useEffect, useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { accountsRepository } from '@/db/repositories/accounts.repository';
import { categoriesRepository } from '@/db/repositories/categories.repository';
import { transactionsRepository } from '@/db/repositories/transactions.repository';
import { fetchAutoRate } from '@/domain/fx/provider';
import { calculateAccountBalanceMinor } from '@/domain/accounts/balance';
import type { Account, Category, RecordWithAmount, TransactionType } from '@/domain/types';
import { CURRENCY_OPTIONS, formatCurrencyLabel } from '@/shared/constants/currencies';
import { PageCard } from '@/shared/components/PageCard';
import { localInputToUtcIso, toLocalInputValue } from '@/shared/utils/datetime';
import { formatMoney, toMinor } from '@/shared/utils/money';

interface RecordFormValues {
  type: TransactionType;
  fromAccountId: string;
  toAccountId: string;
  categoryId: string;
  amount: number;
  originalCurrency: string;
  settledCurrency: string;
  occurredAt: string;
  note: string;
  fxMode: 'api' | 'manual';
  fxRate: number;
}

export const CreateRecordPage = () => {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [allRecords, setAllRecords] = useState<RecordWithAmount[]>([]);
  const [estimatedMinor, setEstimatedMinor] = useState<number | null>(null);
  const [submitMessage, setSubmitMessage] = useState('');
  const [rateError, setRateError] = useState('');
  const [balanceError, setBalanceError] = useState('');
  const [rateProvider, setRateProvider] = useState('');
  const [isRateLoading, setIsRateLoading] = useState(false);

  const { register, handleSubmit, watch, setValue, reset } = useForm<RecordFormValues>({
    defaultValues: {
      type: 'expense',
      fromAccountId: '',
      toAccountId: '',
      categoryId: '',
      amount: 0,
      originalCurrency: '',
      settledCurrency: '',
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
  const canUseFx = accountReady && hasBothCurrencies && !canDirectSettle;
  const currentBalanceMinor = useMemo(() => {
    if (!fromAccount) return null;
    return calculateAccountBalanceMinor(fromAccount.id, allRecords);
  }, [fromAccount, allRecords]);
  const willSpend = type === 'expense' || type === 'transfer';
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
      if (type === 'transfer') {
        setCategories([]);
        setValue('categoryId', '');
        return;
      }
      const items = await categoriesRepository.listByKind(type === 'income' ? 'income' : 'expense');
      setCategories(items);
      if (items.length > 0) setValue('categoryId', items[0].id);
    };
    void loadCategories();
  }, [type, setValue]);

  useEffect(() => {
    setValue('originalCurrency', '');
    setValue('settledCurrency', defaultSettleCurrency);
    setValue('fxRate', 1);
    setRateError('');
    setRateProvider('');
    setEstimatedMinor(null);
    setIsRateLoading(false);
  }, [fromAccountId, defaultSettleCurrency, setValue]);

  useEffect(() => {
    if (canDirectSettle) {
      setValue('settledCurrency', originalCurrency);
      setValue('fxRate', 1);
    }
  }, [canDirectSettle, originalCurrency, setValue]);

  useEffect(() => {
    const loadRate = async () => {
      if (!canUseFx || fxMode !== 'api') {
        setIsRateLoading(false);
        if (!canUseFx) {
          setRateError('');
          setRateProvider('');
        }
        return;
      }

      try {
        setIsRateLoading(true);
        setValue('fxRate', Number.NaN);
        const quote = await fetchAutoRate(originalCurrency, settledCurrency);
        setValue('fxRate', quote.rate);
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
  }, [canUseFx, fxMode, originalCurrency, settledCurrency, setValue]);

  useEffect(() => {
    if (!accountReady || values.amount <= 0 || !hasBothCurrencies) {
      setEstimatedMinor(null);
      return;
    }

    const amountMinor = toMinor(values.amount);

    if (canDirectSettle) {
      setEstimatedMinor(amountMinor);
      return;
    }

    if (fxMode === 'manual') {
      setEstimatedMinor(Math.round(amountMinor * values.fxRate));
      return;
    }

    if (rateError || isRateLoading) {
      setEstimatedMinor(null);
      return;
    }

    setEstimatedMinor(Math.round(amountMinor * values.fxRate));
  }, [accountReady, hasBothCurrencies, canDirectSettle, values.amount, values.fxRate, fxMode, rateError, isRateLoading]);

  const onSubmit = handleSubmit(async (submitValues) => {
    const amountMinor = toMinor(submitValues.amount);
    const settledAmountMinor = canDirectSettle ? amountMinor : Math.round(amountMinor * submitValues.fxRate);

    if ((submitValues.type === 'expense' || submitValues.type === 'transfer') && fromAccount && !(fromAccount.allowOverdraft ?? true)) {
      const latestRecords = await transactionsRepository.listAll();
      const latestBalanceMinor = calculateAccountBalanceMinor(fromAccount.id, latestRecords);
      const latestProjectedMinor = latestBalanceMinor - settledAmountMinor;
      if (latestProjectedMinor < 0) {
        setBalanceError(`余额不足：当前余额 ${formatMoney(latestBalanceMinor, fromAccount.baseCurrency)}。`);
        return;
      }
    }

    setBalanceError('');

    await transactionsRepository.create({
      type: submitValues.type,
      fromAccountId: submitValues.fromAccountId,
      toAccountId: submitValues.type === 'transfer' ? submitValues.toAccountId : null,
      categoryId: submitValues.type === 'transfer' ? null : submitValues.categoryId,
      note: submitValues.note || null,
      occurredAt: localInputToUtcIso(submitValues.occurredAt),
      amount: {
        originalAmountMinor: amountMinor,
        originalCurrency: submitValues.originalCurrency,
        settledAmountMinor,
        settledCurrency: submitValues.settledCurrency,
        actualSettledAmountMinor: null,
        isEstimated: !canDirectSettle,
        fxRate: canDirectSettle ? 1 : submitValues.fxRate,
        fxSource: canDirectSettle ? null : submitValues.fxMode,
        fxProvider: canDirectSettle ? null : submitValues.fxMode === 'api' ? rateProvider || 'auto' : 'manual',
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
      toAccountId: '',
      categoryId: '',
      amount: 0,
      originalCurrency: '',
      settledCurrency: '',
      occurredAt: toLocalInputValue(new Date().toISOString()),
      note: '',
      fxMode: 'api',
      fxRate: 1,
    });
    setAllRecords(await transactionsRepository.listAll());
  });

  return (
    <PageCard>
      <h2>新增记录</h2>
      <form className="record-form" onSubmit={onSubmit}>
        <section className="form-section">
          <h3>基础信息</h3>
          <div className="form-grid">
            <label>
              记录类型
              <select {...register('type')}>
                <option value="expense">支出</option>
                <option value="income">收入</option>
                <option value="transfer">转账（同币种）</option>
              </select>
            </label>

            <label>
              出账账户
              <select required {...register('fromAccountId')}>
                <option value="">请选择</option>
                {accounts.map((account) => {
                  const supported = (account.allowedCurrencies ?? [account.baseCurrency])
                    .map((item) => formatCurrencyLabel(item))
                    .join('、');
                  return (
                    <option key={account.id} value={account.id}>
                      {`${account.name}｜默认 ${formatCurrencyLabel(account.baseCurrency)}｜支持 ${supported}`}
                    </option>
                  );
                })}
              </select>
            </label>
            {fromAccount ? (
              <p className="hint account-meta">
                账户信息：默认入账币种 {formatCurrencyLabel(fromAccount.baseCurrency)}；
                支持入账币种 {supportedSettleCurrencies.map((item) => formatCurrencyLabel(item)).join('、')}；
                透支 {(fromAccount.allowOverdraft ?? true) ? '允许' : '不允许'}；
                当前余额 {currentBalanceMinor === null ? '-' : formatMoney(currentBalanceMinor, fromAccount.baseCurrency)}
              </p>
            ) : null}

            {type === 'transfer' ? (
              <label>
                入账账户
                <select required {...register('toAccountId')}>
                  <option value="">请选择</option>
                  {accounts.map((account) => (
                    <option key={account.id} value={account.id}>
                      {account.name}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
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
            )}

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
          {accountReady ? (
            <p className="hint">
              账户支持入账币种：{supportedSettleCurrencies.map((item) => formatCurrencyLabel(item)).join('、')}
              ；默认入账币种：{formatCurrencyLabel(defaultSettleCurrency)}
            </p>
          ) : null}
        </section>

        <section className="form-section">
          <h3>汇率</h3>
          <div className="form-grid">
            <div className="fx-mode-wrap">
              <span className="fx-label">汇率模式</span>
              <div className="fx-segmented" role="radiogroup" aria-label="汇率模式">
                <button
                  type="button"
                  className={fxMode === 'api' ? 'fx-option active' : 'fx-option'}
                  onClick={() => setValue('fxMode', 'api')}
                  disabled={!canUseFx}
                >
                  自动汇率
                </button>
                <button
                  type="button"
                  className={fxMode === 'manual' ? 'fx-option active' : 'fx-option'}
                  onClick={() => setValue('fxMode', 'manual')}
                  disabled={!canUseFx}
                >
                  手动汇率
                </button>
              </div>
            </div>

            <label>
              汇率
              <div className="rate-input-wrap">
                <input
                  type="number"
                  step="0.0001"
                  placeholder={isRateLoading ? '正在获取汇率...' : ''}
                  {...register('fxRate', { valueAsNumber: true })}
                  disabled={!canUseFx || fxMode === 'api' || isRateLoading}
                />
                {isRateLoading ? <span className="rate-loading-text">正在获取汇率...</span> : null}
              </div>
            </label>
          </div>
          {!accountReady ? <p className="hint">请先选择出账账户后再计算汇率。</p> : null}
          {accountReady && !hasBothCurrencies ? <p className="hint">请选择交易币种和入账币种后自动加载汇率。</p> : null}
          {accountReady && canDirectSettle ? <p className="hint">两个币种一致，无需汇率，按实际金额入账。</p> : null}
          {rateProvider && fxMode === 'api' && canUseFx ? <p className="hint">汇率来源：{rateProvider}</p> : null}
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
          </div>
        </section>

        {submitMessage ? <p className="success-text">{submitMessage}</p> : null}
        {balanceError ? <p className="error-text">{balanceError}</p> : null}
        {isInsufficientBalance ? (
          <p className="error-text">
            预计余额不足（预计变动后余额 {projectedBalanceMinor !== null && fromAccount ? formatMoney(projectedBalanceMinor, fromAccount.baseCurrency) : '-'}），该账户不允许透支。
          </p>
        ) : null}
        <button type="submit" disabled={isInsufficientBalance}>保存记录</button>
      </form>
    </PageCard>
  );
};
