import { useEffect, useMemo, useState } from 'react';
import dayjs from 'dayjs';
import { Check, FilePenLine, Trash2 } from 'lucide-react';
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { accountsRepository } from '@/db/repositories/accounts.repository';
import { categoriesRepository } from '@/db/repositories/categories.repository';
import { transactionsRepository } from '@/db/repositories/transactions.repository';
import { calculateAccountBalanceMinor } from '@/domain/accounts/balance';
import type { Account, Category, RecordWithAmount } from '@/domain/types';
import { formatCurrencyLabel } from '@/shared/constants/currencies';
import { PageCard } from '@/shared/components/PageCard';
import { formatUtcToLocal, localInputToUtcIso, toLocalInputValue } from '@/shared/utils/datetime';
import { formatMoney, toMinor } from '@/shared/utils/money';

interface QuickEditForm {
  transactionId: string;
  amount: number;
  note: string;
  occurredAt: string;
}

interface ActualSettleForm {
  transactionId: string;
  settledCurrency: string;
  amount: number;
}

export const HomePage = () => {
  const [records, setRecords] = useState<RecordWithAmount[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [trendWindow, setTrendWindow] = useState<7 | 30>(7);
  const [editing, setEditing] = useState<QuickEditForm | null>(null);
  const [actualEditing, setActualEditing] = useState<ActualSettleForm | null>(null);
  const [editError, setEditError] = useState('');
  const [actualEditError, setActualEditError] = useState('');
  const [saving, setSaving] = useState(false);
  const [savingActual, setSavingActual] = useState(false);

  const load = async () => {
    const [allRecords, accountRows, categoryRows] = await Promise.all([
      transactionsRepository.listAll(),
      accountsRepository.listActive(),
      categoriesRepository.listAllActive(),
    ]);
    setRecords(allRecords);
    setAccounts(accountRows);
    setCategories(categoryRows);
  };

  useEffect(() => {
    void load();
  }, []);

  const monthSummary = useMemo(() => {
    const start = dayjs().startOf('month');
    const end = dayjs().endOf('month');
    const summary = records.reduce(
      (acc, record) => {
        const occurred = dayjs(record.transaction.occurredAt);
        if (occurred.isBefore(start) || occurred.isAfter(end)) return acc;
        const amount = record.amount.actualSettledAmountMinor ?? record.amount.settledAmountMinor;
        if (record.transaction.type === 'income') acc.income += amount;
        if (record.transaction.type === 'expense') acc.expense += amount;
        return acc;
      },
      { income: 0, expense: 0, net: 0 },
    );
    summary.net = summary.income - summary.expense;
    return summary;
  }, [records]);

  const accountSnapshots = useMemo(() => {
    return accounts.map((account) => ({
      account,
      balanceMinor: calculateAccountBalanceMinor(account.id, records),
    }));
  }, [accounts, records]);

  const assetByCurrency = useMemo(() => {
    const grouped = new Map<string, number>();
    for (const item of accountSnapshots) {
      grouped.set(item.account.baseCurrency, (grouped.get(item.account.baseCurrency) ?? 0) + item.balanceMinor);
    }
    return Array.from(grouped.entries()).map(([currency, amountMinor]) => ({ currency, amountMinor }));
  }, [accountSnapshots]);

  const recentRecords = useMemo(() => {
    return [...records]
      .sort((a, b) => dayjs(b.transaction.occurredAt).valueOf() - dayjs(a.transaction.occurredAt).valueOf())
      .slice(0, 10);
  }, [records]);

  const categoryMap = useMemo(
    () => Object.fromEntries(categories.map((item) => [item.id, item.name])),
    [categories],
  );
  const accountMap = useMemo(
    () => Object.fromEntries(accounts.map((item) => [item.id, item.name])),
    [accounts],
  );

  const latestRecord = useMemo(
    () => [...records].sort((a, b) => dayjs(b.transaction.occurredAt).valueOf() - dayjs(a.transaction.occurredAt).valueOf())[0],
    [records],
  );
  const activityText = useMemo(() => {
    if (!latestRecord) return '还没有记账记录，今天开始记下第一笔吧。';
    const days = dayjs().diff(dayjs(latestRecord.transaction.occurredAt), 'day');
    if (days <= 3) return '你最近记账很稳定，做得很棒，继续保持。';
    return `你已经 ${days} 天没有记账了，记一笔让账本保持连续吧。`;
  }, [latestRecord]);

  const trendData = useMemo(() => {
    const end = dayjs().endOf('day');
    const start = end.subtract(trendWindow - 1, 'day').startOf('day');
    const rows: Array<{ label: string; income: number; expense: number }> = [];
    for (let i = 0; i < trendWindow; i += 1) {
      const day = start.add(i, 'day');
      const dayStart = day.startOf('day');
      const dayEnd = day.endOf('day');
      let income = 0;
      let expense = 0;
      for (const record of records) {
        const occurred = dayjs(record.transaction.occurredAt);
        if (occurred.isBefore(dayStart) || occurred.isAfter(dayEnd)) continue;
        const amount = record.amount.actualSettledAmountMinor ?? record.amount.settledAmountMinor;
        if (record.transaction.type === 'income') income += amount;
        if (record.transaction.type === 'expense') expense += amount;
      }
      rows.push({
        label: day.format('MM-DD'),
        income: Number((income / 100).toFixed(2)),
        expense: Number((expense / 100).toFixed(2)),
      });
    }
    return rows;
  }, [records, trendWindow]);

  const actualEditingRecord = useMemo(
    () => records.find((item) => item.transaction.id === (actualEditing?.transactionId ?? '')) ?? null,
    [records, actualEditing?.transactionId],
  );
  const actualEditingAccount = useMemo(
    () => accounts.find((item) => item.id === (actualEditingRecord?.transaction.fromAccountId ?? '')) ?? null,
    [accounts, actualEditingRecord?.transaction.fromAccountId],
  );
  const actualAllowedCurrencies = useMemo(() => {
    if (!actualEditingAccount) return [];
    const source = actualEditingAccount.allowedCurrencies?.length
      ? actualEditingAccount.allowedCurrencies
      : [actualEditingAccount.baseCurrency];
    return Array.from(new Set(source));
  }, [actualEditingAccount]);

  const removeRecord = async (transactionId: string) => {
    const ok = window.confirm('确认删除这条记录？该操作为软删除，可恢复。');
    if (!ok) return;
    await transactionsRepository.softDelete(transactionId);
    await load();
  };

  const beginEdit = (record: RecordWithAmount) => {
    setEditing({
      transactionId: record.transaction.id,
      amount: record.amount.originalAmountMinor / 100,
      note: record.transaction.note ?? '',
      occurredAt: toLocalInputValue(record.transaction.occurredAt),
    });
    setEditError('');
  };

  const beginActualEdit = (record: RecordWithAmount) => {
    setActualEditing({
      transactionId: record.transaction.id,
      settledCurrency: record.amount.settledCurrency,
      amount: record.amount.settledAmountMinor / 100,
    });
    setActualEditError('');
  };

  const submitQuickEdit = async () => {
    if (!editing) return;
    if (editing.amount <= 0) {
      setEditError('金额必须大于 0。');
      return;
    }
    setSaving(true);
    try {
      const fresh = (await transactionsRepository.listAll()).find((item) => item.transaction.id === editing.transactionId);
      if (!fresh) {
        setEditError('该记录不存在或已被删除。');
        return;
      }
      const nextOriginalMinor = toMinor(editing.amount);
      const changedAmount = nextOriginalMinor !== fresh.amount.originalAmountMinor;
      const sameCurrency = fresh.amount.originalCurrency === fresh.amount.settledCurrency;
      const baseSettledMinor = sameCurrency
        ? nextOriginalMinor
        : Math.round(nextOriginalMinor * (fresh.amount.fxRate ?? 1));
      const cashbackMinor = (fresh.amount.cashbackCurrency === fresh.amount.settledCurrency)
        ? (fresh.amount.cashbackAmountMinor ?? 0)
        : 0;
      const discountMinor = (fresh.amount.discountCurrency === fresh.amount.settledCurrency)
        ? (fresh.amount.discountAmountMinor ?? 0)
        : 0;
      const nextSettledMinor = Math.max(0, baseSettledMinor - cashbackMinor - discountMinor);
      await transactionsRepository.update(fresh.transaction.id, {
        type: fresh.transaction.type,
        fromAccountId: fresh.transaction.fromAccountId,
        toAccountId: fresh.transaction.toAccountId,
        categoryId: fresh.transaction.categoryId,
        note: editing.note.trim() || null,
        occurredAt: localInputToUtcIso(editing.occurredAt),
        amount: {
          ...fresh.amount,
          originalAmountMinor: nextOriginalMinor,
          settledAmountMinor: nextSettledMinor,
          actualSettledAmountMinor: changedAmount ? null : fresh.amount.actualSettledAmountMinor,
          isEstimated: changedAmount ? true : fresh.amount.isEstimated,
        },
      });
      setEditing(null);
      await load();
    } finally {
      setSaving(false);
    }
  };

  const submitActualEdit = async () => {
    if (!actualEditing || !actualEditingRecord) return;
    if (!actualEditing.settledCurrency || actualEditing.amount <= 0) {
      setActualEditError('请填写有效的实际入账金额和币种。');
      return;
    }
    if (!actualAllowedCurrencies.includes(actualEditing.settledCurrency)) {
      setActualEditError('实际入账币种必须在该账户支持币种内。');
      return;
    }
    setSavingActual(true);
    try {
      const fresh = (await transactionsRepository.listAll()).find((item) => item.transaction.id === actualEditing.transactionId);
      if (!fresh) {
        setActualEditError('该记录不存在或已被删除。');
        return;
      }
      const actualMinor = toMinor(actualEditing.amount);
      await transactionsRepository.update(fresh.transaction.id, {
        type: fresh.transaction.type,
        fromAccountId: fresh.transaction.fromAccountId,
        toAccountId: fresh.transaction.toAccountId,
        categoryId: fresh.transaction.categoryId,
        note: fresh.transaction.note,
        occurredAt: fresh.transaction.occurredAt,
        amount: {
          ...fresh.amount,
          settledCurrency: actualEditing.settledCurrency,
          settledAmountMinor: actualMinor,
          actualSettledAmountMinor: actualMinor,
          isEstimated: false,
        },
      });
      setActualEditing(null);
      await load();
    } finally {
      setSavingActual(false);
    }
  };

  return (
    <div className="home-layout">
      <p className="home-status-banner">{activityText}</p>

      <div className="home-main-grid">
        <div className="home-left-stack">
          <PageCard>
            <h2>本月总览</h2>
            <div className="summary-grid">
              <div className="summary-item">
                <span>收入</span>
                <strong>{formatMoney(monthSummary.income)}</strong>
              </div>
              <div className="summary-item">
                <span>支出</span>
                <strong>{formatMoney(monthSummary.expense)}</strong>
              </div>
              <div className="summary-item">
                <span>结余</span>
                <strong>{formatMoney(monthSummary.net)}</strong>
              </div>
            </div>
          </PageCard>

          <PageCard>
            <h2>账户总资产</h2>
            <div className="asset-grid">
              <div>
                <p className="sub-title">各账户余额</p>
                <ul className="list compact-list">
                  {accountSnapshots.map((item) => (
                    <li key={item.account.id}>
                      <span>{item.account.name}</span>
                      <strong>{formatMoney(item.balanceMinor, item.account.baseCurrency)}</strong>
                    </li>
                  ))}
                  {accountSnapshots.length === 0 ? <li>暂无账户</li> : null}
                </ul>
              </div>
              <div>
                <p className="sub-title">各币种余额</p>
                <ul className="list compact-list">
                  {assetByCurrency.map((item) => (
                    <li key={item.currency}>
                      <span>{formatCurrencyLabel(item.currency)}</span>
                      <strong>{formatMoney(item.amountMinor, item.currency)}</strong>
                    </li>
                  ))}
                  {assetByCurrency.length === 0 ? <li>暂无账户</li> : null}
                </ul>
              </div>
            </div>
          </PageCard>

          <PageCard>
            <div className="record-actions-row">
              <h2>收支趋势</h2>
              <div className="fx-segmented">
                <button
                  type="button"
                  className={trendWindow === 7 ? 'fx-option active' : 'fx-option'}
                  onClick={() => setTrendWindow(7)}
                >
                  最近 7 天
                </button>
                <button
                  type="button"
                  className={trendWindow === 30 ? 'fx-option active' : 'fx-option'}
                  onClick={() => setTrendWindow(30)}
                >
                  最近 30 天
                </button>
              </div>
            </div>
            <div style={{ width: '100%', height: 250 }}>
              <ResponsiveContainer>
                <LineChart data={trendData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(60,60,67,0.16)" />
                  <XAxis dataKey="label" />
                  <YAxis />
                  <Tooltip />
                  <Legend />
                  <Line type="monotone" dataKey="income" name="收入" stroke="#2eaf7d" strokeWidth={2} dot={false} />
                  <Line type="monotone" dataKey="expense" name="支出" stroke="#e65151" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </PageCard>
        </div>

        <div className="home-right-stack">
          <PageCard className="home-recent-card">
            <h2>最近交易（10 条）</h2>
            <ul className="list home-recent-list">
              {recentRecords.map((item) => (
                <li key={item.transaction.id} className="transaction-card">
                  <div className="transaction-card-head">
                    <div className="transaction-card-head-left">
                      <strong className="transaction-card-type">{item.transaction.type === 'income' ? '收入' : '支出'}</strong>
                      <span className="transaction-card-time">{formatUtcToLocal(item.transaction.occurredAt)}</span>
                    </div>
                    <div className="transaction-card-actions">
                      <button type="button" className="ghost-btn icon-btn" title="编辑" onClick={() => beginEdit(item)}>
                        <FilePenLine size={16} />
                      </button>
                      {item.amount.isEstimated ? (
                        <button type="button" className="ghost-btn icon-btn" title="更正入账" onClick={() => beginActualEdit(item)}>
                          <Check size={16} />
                        </button>
                      ) : null}
                      <button type="button" className="danger-btn icon-btn" title="删除" onClick={() => void removeRecord(item.transaction.id)}>
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </div>
                  <div className="transaction-card-amount-row">
                    <strong className="transaction-card-amount">
                      {formatMoney(
                        item.amount.actualSettledAmountMinor ?? item.amount.settledAmountMinor,
                        item.amount.settledCurrency,
                      )}
                    </strong>
                    {item.amount.isEstimated ? <span className="estimated-tag">预估</span> : null}
                  </div>
                  <div className="transaction-card-metrics">
                    <div className="transaction-metric">
                      <span>记账金额</span>
                      <strong>{formatMoney(item.amount.originalAmountMinor, item.amount.originalCurrency)}</strong>
                    </div>
                    <div className="transaction-metric">
                      <span>优惠</span>
                      <strong>{(item.amount.discountAmountMinor ?? 0) > 0 ? formatMoney(item.amount.discountAmountMinor, item.amount.discountCurrency) : '-'}</strong>
                    </div>
                    <div className="transaction-metric">
                      <span>返现</span>
                      <strong>{(item.amount.cashbackAmountMinor ?? 0) > 0 ? formatMoney(item.amount.cashbackAmountMinor, item.amount.cashbackCurrency) : '-'}</strong>
                    </div>
                  </div>
                  <div className="transaction-card-body">
                    <p>账户：{accountMap[item.transaction.fromAccountId] ?? '未知账户'} ｜ 分类：{item.transaction.categoryId ? categoryMap[item.transaction.categoryId] ?? '未分类' : '-'}</p>
                    {item.transaction.note ? <p>备注：{item.transaction.note}</p> : null}
                  </div>
                </li>
              ))}
              {recentRecords.length === 0 ? <li>暂无交易记录</li> : null}
            </ul>
          </PageCard>
        </div>
      </div>

      {editing ? (
        <div className="modal-overlay" onClick={() => setEditing(null)}>
          <section className="modal-card" onClick={(event) => event.stopPropagation()}>
            <h3>编辑交易</h3>
            <div className="record-form">
              <section className="form-section">
                <h3>基础信息</h3>
                <div className="form-grid">
                  <label>
                    金额
                    <input
                      type="number"
                      step="0.01"
                      value={editing.amount}
                      onChange={(event) =>
                        setEditing((prev) => (prev ? { ...prev, amount: Number(event.target.value || 0) } : prev))
                      }
                    />
                  </label>
                  <label>
                    发生时间（本地时区）
                    <input
                      type="datetime-local"
                      value={editing.occurredAt}
                      onChange={(event) => setEditing((prev) => (prev ? { ...prev, occurredAt: event.target.value } : prev))}
                    />
                  </label>
                  <label>
                    备注
                    <input
                      value={editing.note}
                      onChange={(event) => setEditing((prev) => (prev ? { ...prev, note: event.target.value } : prev))}
                    />
                  </label>
                </div>
              </section>
              {editError ? <p className="error-text">{editError}</p> : null}
              <div className="record-actions-row">
                <button type="button" className="ghost-btn" onClick={() => setEditing(null)}>
                  取消
                </button>
                <button type="button" onClick={() => void submitQuickEdit()} disabled={saving}>
                  {saving ? '保存中...' : '保存修改'}
                </button>
              </div>
            </div>
          </section>
        </div>
      ) : null}

      {actualEditing && actualEditingRecord ? (
        <div className="modal-overlay" onClick={() => setActualEditing(null)}>
          <section className="modal-card modal-card-sm" onClick={(event) => event.stopPropagation()}>
            <h3>更正实际入账</h3>
            <div className="record-form">
              <section className="form-section">
                <h3>实际入账信息</h3>
                <div className="form-grid">
                  <label>
                    实际入账币种
                    <select
                      value={actualEditing.settledCurrency}
                      onChange={(event) =>
                        setActualEditing((prev) => (prev ? { ...prev, settledCurrency: event.target.value } : prev))
                      }
                    >
                      {actualAllowedCurrencies.map((currency) => (
                        <option key={currency} value={currency}>
                          {formatCurrencyLabel(currency)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    实际入账金额
                    <input
                      type="number"
                      step="0.01"
                      value={actualEditing.amount}
                      onChange={(event) =>
                        setActualEditing((prev) => (prev ? { ...prev, amount: Number(event.target.value || 0) } : prev))
                      }
                    />
                  </label>
                </div>
                <p className="hint">
                  原预估：{formatMoney(actualEditingRecord.amount.settledAmountMinor, actualEditingRecord.amount.settledCurrency)}
                </p>
              </section>
              {actualEditError ? <p className="error-text">{actualEditError}</p> : null}
              <div className="record-actions-row">
                <button type="button" className="ghost-btn" onClick={() => setActualEditing(null)}>
                  取消
                </button>
                <button type="button" onClick={() => void submitActualEdit()} disabled={savingActual}>
                  {savingActual ? '保存中...' : '保存更正'}
                </button>
              </div>
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
};
