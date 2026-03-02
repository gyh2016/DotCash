import { useEffect, useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { accountsRepository } from '@/db/repositories/accounts.repository';
import { transactionsRepository } from '@/db/repositories/transactions.repository';
import { calculateAccountBalanceMinor } from '@/domain/accounts/balance';
import type { Account, AccountType, RecordWithAmount } from '@/domain/types';
import { CURRENCY_OPTIONS, formatCurrencyLabel } from '@/shared/constants/currencies';
import { accountTypeLabelMap } from '@/shared/constants/labels';
import { PageCard } from '@/shared/components/PageCard';
import { formatMoney, toMinor } from '@/shared/utils/money';

interface AccountFormValues {
  name: string;
  type: AccountType;
  baseCurrency: string;
  initialBalance: number;
  allowedCurrencies: string[];
  allowOverdraft: boolean;
}

export const AccountsPage = () => {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [records, setRecords] = useState<RecordWithAmount[]>([]);
  const [currencyQuery, setCurrencyQuery] = useState('');
  const [currencyDropdownOpen, setCurrencyDropdownOpen] = useState(false);

  const { register, handleSubmit, reset, watch, setValue } = useForm<AccountFormValues>({
    defaultValues: {
      type: 'debit_card',
      baseCurrency: 'CNY',
      initialBalance: 0,
      allowedCurrencies: ['CNY'],
      allowOverdraft: true,
    },
  });

  const baseCurrency = watch('baseCurrency');
  const selectedCurrencies = watch('allowedCurrencies');

  const filteredCurrencyOptions = useMemo(() => {
    const keyword = currencyQuery.trim().toLowerCase();
    if (!keyword) return CURRENCY_OPTIONS;
    return CURRENCY_OPTIONS.filter((item) => {
      const label = `${item.code} ${item.nameZh}`.toLowerCase();
      return label.includes(keyword);
    });
  }, [currencyQuery]);

  useEffect(() => {
    const exists = selectedCurrencies.includes(baseCurrency);
    if (!exists) {
      setValue('allowedCurrencies', [baseCurrency, ...selectedCurrencies]);
    }
  }, [baseCurrency, selectedCurrencies, setValue]);

  const toggleCurrency = (currency: string) => {
    if (currency === baseCurrency) return;
    if (selectedCurrencies.includes(currency)) {
      setValue(
        'allowedCurrencies',
        selectedCurrencies.filter((item) => item !== currency),
      );
      return;
    }
    setValue('allowedCurrencies', [...selectedCurrencies, currency]);
  };

  const loadData = async () => {
    const [accountList, allRecords] = await Promise.all([
      accountsRepository.listActive(),
      transactionsRepository.listAll(),
    ]);
    setAccounts(accountList);
    setRecords(allRecords as RecordWithAmount[]);
  };

  useEffect(() => {
    void loadData();
  }, []);

  const onSubmit = handleSubmit(async (values) => {
    const uniqueAllowed = Array.from(new Set([...values.allowedCurrencies, values.baseCurrency]));

    await accountsRepository.create({
      name: values.name.trim(),
      type: values.type,
      baseCurrency: values.baseCurrency,
      initialBalanceMinor: toMinor(values.initialBalance),
      allowedCurrencies: uniqueAllowed,
      allowOverdraft: values.allowOverdraft,
    });

    reset({
      ...values,
      name: '',
      initialBalance: 0,
      allowedCurrencies: [values.baseCurrency],
      allowOverdraft: values.allowOverdraft,
    });
    setCurrencyQuery('');
    await loadData();
  });

  return (
    <div className="stack">
      <PageCard>
        <h2>新建账户</h2>
        <form className="form-grid" onSubmit={onSubmit}>
          <label>
            名称
            <input required {...register('name')} placeholder="例如：招商银行储蓄卡" />
          </label>
          <label>
            类型
            <select {...register('type')}>
              <option value="cash">现金</option>
              <option value="debit_card">储蓄卡</option>
              <option value="credit_card">信用卡</option>
              <option value="ewallet">电子钱包</option>
              <option value="other">其他</option>
            </select>
          </label>
          <label>
            默认入账币种
            <select {...register('baseCurrency')}>
              {CURRENCY_OPTIONS.map((currency) => (
                <option key={currency.code} value={currency.code}>
                  {formatCurrencyLabel(currency.code)}
                </option>
              ))}
            </select>
          </label>
          <label>
            初始余额（元）
            <input type="number" step="0.01" {...register('initialBalance', { valueAsNumber: true })} />
          </label>

          <label className="inline-check">
            <input type="checkbox" {...register('allowOverdraft')} />
            <span>允许透支</span>
          </label>

          <div className="multi-select-wrap">
            <span className="multi-title">支持的入账币种（可搜索多选）</span>
            <button
              type="button"
              className="select-trigger"
              onClick={() => setCurrencyDropdownOpen((current) => !current)}
            >
              {selectedCurrencies.length > 0
                ? selectedCurrencies.map((item) => formatCurrencyLabel(item)).join('、')
                : '请选择币种'}
            </button>
            {currencyDropdownOpen ? (
              <div className="select-panel">
                <input
                  value={currencyQuery}
                  onChange={(event) => setCurrencyQuery(event.target.value)}
                  placeholder="搜索币种代码或中文名"
                />
                <ul className="select-list">
                  {filteredCurrencyOptions.map((currency) => (
                    <li key={currency.code}>
                      <label className="inline-check">
                        <input
                          type="checkbox"
                          checked={selectedCurrencies.includes(currency.code)}
                          onChange={() => toggleCurrency(currency.code)}
                          disabled={currency.code === baseCurrency}
                        />
                        <span>
                          {formatCurrencyLabel(currency.code)}
                          {currency.code === baseCurrency ? '（默认）' : ''}
                        </span>
                      </label>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>

          <button type="submit">保存账户</button>
        </form>
      </PageCard>

      <PageCard>
        <h2>账户列表</h2>
        <ul className="list">
          {accounts.map((account) => {
            const currentBalanceMinor = calculateAccountBalanceMinor(account.initialBalanceMinor, account.id, records);
            return (
              <li key={account.id}>
                <div>
                  <strong>{account.name}</strong>
                  <p>
                    {accountTypeLabelMap[account.type]} | 默认入账币种 {formatCurrencyLabel(account.baseCurrency)}
                  </p>
                  <p>
                    支持入账币种：
                    {(account.allowedCurrencies ?? [account.baseCurrency]).map((item) => formatCurrencyLabel(item)).join('、')}
                  </p>
                  <p>透支：{(account.allowOverdraft ?? true) ? '允许' : '不允许'}</p>
                  <p>初始余额：{formatMoney(account.initialBalanceMinor, account.baseCurrency)}</p>
                </div>
                <span className="balance-main">当前余额：{formatMoney(currentBalanceMinor, account.baseCurrency)}</span>
              </li>
            );
          })}
          {accounts.length === 0 ? <li>还没有账户，先创建一个。</li> : null}
        </ul>
      </PageCard>
    </div>
  );
};
