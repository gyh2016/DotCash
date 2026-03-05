import { useEffect, useMemo, useState } from 'react';
import dayjs from 'dayjs';
import {
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { accountsRepository } from '@/db/repositories/accounts.repository';
import { categoriesRepository } from '@/db/repositories/categories.repository';
import { transactionsRepository } from '@/db/repositories/transactions.repository';
import { calculateAccountBalanceMinor } from '@/domain/accounts/balance';
import type { Account, Category, RecordWithAmount } from '@/domain/types';
import { PageCard } from '@/shared/components/PageCard';
import { formatMoney } from '@/shared/utils/money';

type RangePreset = 'this_month' | 'last_month' | 'last_30_days' | 'custom';
type TrendGranularity = 'day' | 'week' | 'month';
type CategoryMode = 'expense' | 'income';

const COLORS = ['#1d4ed8', '#0f766e', '#ca8a04', '#dc2626', '#7c3aed', '#0891b2', '#16a34a'];

export const StatsPage = () => {
  const [records, setRecords] = useState<RecordWithAmount[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [rangePreset, setRangePreset] = useState<RangePreset>('this_month');
  const [customFrom, setCustomFrom] = useState(dayjs().startOf('month').format('YYYY-MM-DD'));
  const [customTo, setCustomTo] = useState(dayjs().format('YYYY-MM-DD'));
  const [granularity, setGranularity] = useState<TrendGranularity>('day');
  const [categoryMode, setCategoryMode] = useState<CategoryMode>('expense');
  const [topN, setTopN] = useState(5);

  useEffect(() => {
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
    void load();
  }, []);

  const range = useMemo(() => {
    if (rangePreset === 'this_month') return { from: dayjs().startOf('month'), to: dayjs().endOf('month') };
    if (rangePreset === 'last_month') {
      const prev = dayjs().subtract(1, 'month');
      return { from: prev.startOf('month'), to: prev.endOf('month') };
    }
    if (rangePreset === 'last_30_days') return { from: dayjs().subtract(29, 'day').startOf('day'), to: dayjs().endOf('day') };
    return { from: dayjs(customFrom).startOf('day'), to: dayjs(customTo).endOf('day') };
  }, [rangePreset, customFrom, customTo]);

  const filteredRecords = useMemo(() => {
    return records.filter((record) => {
      const occurred = dayjs(record.transaction.occurredAt);
      return !occurred.isBefore(range.from) && !occurred.isAfter(range.to);
    });
  }, [records, range]);

  const trendData = useMemo(() => {
    const bucket = new Map<string, { income: number; expense: number }>();
    for (const record of filteredRecords) {
      const occurred = dayjs(record.transaction.occurredAt);
      const key = granularity === 'day'
        ? occurred.format('YYYY-MM-DD')
        : granularity === 'week'
          ? occurred.startOf('week').format('YYYY-MM-DD')
          : occurred.startOf('month').format('YYYY-MM');
      const row = bucket.get(key) ?? { income: 0, expense: 0 };
      const amount = record.amount.actualSettledAmountMinor ?? record.amount.settledAmountMinor;
      if (record.transaction.type === 'income') row.income += amount;
      if (record.transaction.type === 'expense') row.expense += amount;
      bucket.set(key, row);
    }
    return Array.from(bucket.entries())
      .sort((a, b) => dayjs(a[0]).valueOf() - dayjs(b[0]).valueOf())
      .map(([label, value]) => ({
        label,
        income: Number((value.income / 100).toFixed(2)),
        expense: Number((value.expense / 100).toFixed(2)),
      }));
  }, [filteredRecords, granularity]);

  const categoryMap = useMemo(() => Object.fromEntries(categories.map((item) => [item.id, item.name])), [categories]);
  const categorySummary = useMemo(() => {
    const grouped = new Map<string, { amountMinor: number; count: number }>();
    for (const record of filteredRecords) {
      if (record.transaction.type !== categoryMode) continue;
      const categoryId = record.transaction.categoryId ?? 'uncategorized';
      const row = grouped.get(categoryId) ?? { amountMinor: 0, count: 0 };
      const amount = record.amount.actualSettledAmountMinor ?? record.amount.settledAmountMinor;
      row.amountMinor += amount;
      row.count += 1;
      grouped.set(categoryId, row);
    }
    const total = Array.from(grouped.values()).reduce((sum, item) => sum + item.amountMinor, 0);
    return Array.from(grouped.entries())
      .map(([categoryId, value]) => ({
        categoryId,
        categoryName: categoryId === 'uncategorized' ? '未分类' : (categoryMap[categoryId] ?? '未分类'),
        ...value,
        percentage: total > 0 ? (value.amountMinor / total) * 100 : 0,
      }))
      .sort((a, b) => b.amountMinor - a.amountMinor);
  }, [filteredRecords, categoryMode, categoryMap]);

  const pieData = categorySummary.map((item) => ({
    name: item.categoryName,
    value: Number((item.amountMinor / 100).toFixed(2)),
  }));
  const topCategories = categorySummary.slice(0, topN);

  const accountNetflow = useMemo(() => {
    return accounts.map((account) => {
      let inflow = 0;
      let outflow = 0;
      for (const record of filteredRecords) {
        const amount = record.amount.actualSettledAmountMinor ?? record.amount.settledAmountMinor;
        if (record.transaction.type === 'income' && record.transaction.fromAccountId === account.id) inflow += amount;
        if (record.transaction.type === 'expense' && record.transaction.fromAccountId === account.id) outflow += amount;
        if (record.transaction.type === 'transfer') {
          if (record.transaction.toAccountId === account.id) inflow += amount;
          if (record.transaction.fromAccountId === account.id) outflow += amount;
        }
      }
      return { accountId: account.id, accountName: account.name, inflow, outflow, net: inflow - outflow };
    });
  }, [accounts, filteredRecords]);

  const accountTrend = useMemo(() => {
    const sorted = [...filteredRecords].sort((a, b) => dayjs(a.transaction.occurredAt).valueOf() - dayjs(b.transaction.occurredAt).valueOf());
    const byDay = new Map<string, Record<string, number>>();
    const running = new Map<string, number>();
    for (const account of accounts) running.set(account.id, 0);
    for (const record of sorted) {
      const dayKey = dayjs(record.transaction.occurredAt).format('YYYY-MM-DD');
      const amount = record.amount.actualSettledAmountMinor ?? record.amount.settledAmountMinor;
      if (record.transaction.type === 'income') {
        running.set(record.transaction.fromAccountId, (running.get(record.transaction.fromAccountId) ?? 0) + amount);
      } else if (record.transaction.type === 'expense') {
        running.set(record.transaction.fromAccountId, (running.get(record.transaction.fromAccountId) ?? 0) - amount);
      } else {
        running.set(record.transaction.fromAccountId, (running.get(record.transaction.fromAccountId) ?? 0) - amount);
        if (record.transaction.toAccountId) {
          running.set(record.transaction.toAccountId, (running.get(record.transaction.toAccountId) ?? 0) + amount);
        }
      }
      byDay.set(dayKey, Object.fromEntries(Array.from(running.entries()).map(([id, value]) => [id, Number((value / 100).toFixed(2))])));
    }
    return Array.from(byDay.entries())
      .sort((a, b) => dayjs(a[0]).valueOf() - dayjs(b[0]).valueOf())
      .map(([day, value]) => ({ day, ...value }));
  }, [accounts, filteredRecords]);

  const currentBalances = useMemo(() => {
    return accounts.map((account) => ({
      id: account.id,
      balanceMinor: calculateAccountBalanceMinor(account.id, records),
      baseCurrency: account.baseCurrency,
    }));
  }, [accounts, records]);

  return (
    <div className="stats-layout">
      <PageCard>
        <div className="filter-grid">
          <label>
            时间范围
            <select value={rangePreset} onChange={(event) => setRangePreset(event.target.value as RangePreset)}>
              <option value="this_month">本月</option>
              <option value="last_month">上月</option>
              <option value="last_30_days">近30天</option>
              <option value="custom">自定义</option>
            </select>
          </label>
          {rangePreset === 'custom' ? (
            <>
              <label>
                开始日期
                <input type="date" value={customFrom} onChange={(event) => setCustomFrom(event.target.value)} />
              </label>
              <label>
                结束日期
                <input type="date" value={customTo} onChange={(event) => setCustomTo(event.target.value)} />
              </label>
            </>
          ) : null}
        </div>
      </PageCard>

      <div className="stats-main-grid">
        <div className="stats-left-stack">
          <PageCard>
            <div className="record-actions-row">
              <h2>收支趋势</h2>
              <div className="fx-segmented stats-trend-segmented">
                <button type="button" className={granularity === 'day' ? 'fx-option active' : 'fx-option'} onClick={() => setGranularity('day')}>按日</button>
                <button type="button" className={granularity === 'week' ? 'fx-option active' : 'fx-option'} onClick={() => setGranularity('week')}>按周</button>
                <button type="button" className={granularity === 'month' ? 'fx-option active' : 'fx-option'} onClick={() => setGranularity('month')}>按月</button>
              </div>
            </div>
            <div style={{ width: '100%', height: 300 }}>
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

          <PageCard>
            <h2>账户余额趋势</h2>
            <div style={{ width: '100%', height: 320 }}>
              <ResponsiveContainer>
                <LineChart data={accountTrend}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(60,60,67,0.16)" />
                  <XAxis dataKey="day" />
                  <YAxis />
                  <Tooltip />
                  <Legend />
                  {accounts.slice(0, 5).map((account, idx) => (
                    <Line
                      key={account.id}
                      type="monotone"
                      dataKey={account.id}
                      name={account.name}
                      stroke={COLORS[idx % COLORS.length]}
                      strokeWidth={2}
                      dot={false}
                    />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </div>
          </PageCard>
        </div>

        <div className="stats-right-stack">
          <PageCard>
            <div className="record-actions-row">
              <h2>分类占比</h2>
              <div className="fx-segmented">
                <button type="button" className={categoryMode === 'expense' ? 'fx-option active' : 'fx-option'} onClick={() => setCategoryMode('expense')}>支出</button>
                <button type="button" className={categoryMode === 'income' ? 'fx-option active' : 'fx-option'} onClick={() => setCategoryMode('income')}>收入</button>
              </div>
            </div>
            <div style={{ width: '100%', height: 280 }}>
              <ResponsiveContainer>
                <PieChart>
                  <Pie data={pieData} dataKey="value" nameKey="name" outerRadius={96} innerRadius={46}>
                    {pieData.map((entry, idx) => (
                      <Cell key={entry.name} fill={COLORS[idx % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </PageCard>

          <PageCard>
            <div className="record-actions-row">
              <h2>分类排行</h2>
              <label className="page-size">
                Top
                <select value={topN} onChange={(event) => setTopN(Number(event.target.value))}>
                  <option value={5}>5</option>
                  <option value={10}>10</option>
                </select>
              </label>
            </div>
            <div className="table-wrap">
              <table className="records-table">
                <thead>
                  <tr>
                    <th>分类</th>
                    <th>金额</th>
                    <th>笔数</th>
                    <th>占比</th>
                  </tr>
                </thead>
                <tbody>
                  {topCategories.map((item) => (
                    <tr key={item.categoryId}>
                      <td>{item.categoryName}</td>
                      <td>{formatMoney(item.amountMinor)}</td>
                      <td>{item.count}</td>
                      <td>{item.percentage.toFixed(1)}%</td>
                    </tr>
                  ))}
                  {topCategories.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="table-empty">暂无数据</td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </PageCard>

          <PageCard>
            <h2>账户净流入/净流出</h2>
            <div className="table-wrap">
              <table className="records-table">
                <thead>
                  <tr>
                    <th>账户</th>
                    <th>流入</th>
                    <th>流出</th>
                    <th>净额</th>
                    <th>当前余额</th>
                  </tr>
                </thead>
                <tbody>
                  {accountNetflow.map((item) => {
                    const current = currentBalances.find((row) => row.id === item.accountId);
                    return (
                      <tr key={item.accountId}>
                        <td>{item.accountName}</td>
                        <td>{formatMoney(item.inflow)}</td>
                        <td>{formatMoney(item.outflow)}</td>
                        <td>{formatMoney(item.net)}</td>
                        <td>{current ? formatMoney(current.balanceMinor, current.baseCurrency) : '-'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </PageCard>
        </div>
      </div>
    </div>
  );
};
