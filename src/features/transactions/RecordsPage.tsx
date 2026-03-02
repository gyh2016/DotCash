import { useEffect, useMemo, useRef, useState } from 'react';
import { accountsRepository } from '@/db/repositories/accounts.repository';
import { categoriesRepository } from '@/db/repositories/categories.repository';
import { transactionsRepository } from '@/db/repositories/transactions.repository';
import { fetchAutoRate } from '@/domain/fx/provider';
import { calculateAccountBalanceMinor } from '@/domain/accounts/balance';
import type { Account, Category, RecordWithAmount, TransactionType } from '@/domain/types';
import { CURRENCY_OPTIONS, formatCurrencyLabel } from '@/shared/constants/currencies';
import { transactionTypeLabelMap } from '@/shared/constants/labels';
import { PageCard } from '@/shared/components/PageCard';
import { formatUtcToLocal, localInputToUtcIso, toLocalInputValue } from '@/shared/utils/datetime';
import { formatMoney, toMinor } from '@/shared/utils/money';

interface RecordFilters {
  type: 'all' | TransactionType;
  accountId: string;
  categoryId: string;
  keyword: string;
  dateFrom: string;
  dateTo: string;
  minAmount: string;
  maxAmount: string;
  showDeleted: boolean;
}

interface EditForm {
  transactionId: string;
  type: TransactionType;
  fromAccountId: string;
  toAccountId: string;
  categoryId: string;
  amount: number;
  originalCurrency: string;
  settledCurrency: string;
  fxMode: 'api' | 'manual';
  fxRate: number;
  occurredAt: string;
  note: string;
}

const DEFAULT_FILTERS: RecordFilters = {
  type: 'all',
  accountId: '',
  categoryId: '',
  keyword: '',
  dateFrom: '',
  dateTo: '',
  minAmount: '',
  maxAmount: '',
  showDeleted: false,
};

const PAGE_SIZE_OPTIONS = [10, 20, 50, 100];

export const RecordsPage = () => {
  const [records, setRecords] = useState<RecordWithAmount[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [filters, setFilters] = useState<RecordFilters>(DEFAULT_FILTERS);
  const [editing, setEditing] = useState<EditForm | null>(null);
  const [saving, setSaving] = useState(false);
  const [editRateLoading, setEditRateLoading] = useState(false);
  const [editRateError, setEditRateError] = useState('');
  const [editRateProvider, setEditRateProvider] = useState('');
  const [editBalanceError, setEditBalanceError] = useState('');
  const [dateRangeError, setDateRangeError] = useState('');
  const [pageSize, setPageSize] = useState(20);
  const [page, setPage] = useState(1);
  const editRateRequestRef = useRef(0);

  const accountNameMap = useMemo(
    () => Object.fromEntries(accounts.map((account) => [account.id, account.name])),
    [accounts],
  );

  const categoryNameMap = useMemo(
    () => Object.fromEntries(categories.map((category) => [category.id, category.name])),
    [categories],
  );

  const editingFromAccount = useMemo(
    () => accounts.find((account) => account.id === (editing?.fromAccountId ?? '')),
    [accounts, editing?.fromAccountId],
  );

  const editingSupportedCurrencies = useMemo(() => {
    if (!editingFromAccount) return CURRENCY_OPTIONS.map((item) => item.code);
    const source = editingFromAccount.allowedCurrencies?.length
      ? editingFromAccount.allowedCurrencies
      : [editingFromAccount.baseCurrency];
    return Array.from(new Set(source));
  }, [editingFromAccount]);

  const editingAccountReady = !!editingFromAccount && !!editing;
  const editingHasBothCurrencies = !!editing && editing.originalCurrency !== '' && editing.settledCurrency !== '';
  const editingCanDirectSettle =
    !!editing && editing.originalCurrency !== '' && editingSupportedCurrencies.includes(editing.originalCurrency);
  const editingCanUseFx = editingAccountReady && editingHasBothCurrencies && !editingCanDirectSettle;
  const editingDefaultSettleCurrency = editingFromAccount?.baseCurrency ?? '';
  const editingEstimatedMinor = useMemo(() => {
    if (!editing || editing.amount <= 0 || !editingHasBothCurrencies) return null;
    const originalMinor = toMinor(editing.amount);
    if (editingCanDirectSettle) return originalMinor;
    if (!Number.isFinite(editing.fxRate) || editing.fxRate <= 0) return null;
    return Math.round(originalMinor * editing.fxRate);
  }, [editing, editingHasBothCurrencies, editingCanDirectSettle]);
  const editingCurrentBalanceMinor = useMemo(() => {
    if (!editingFromAccount || !editing) return null;
    const recordsWithoutCurrent = records.filter((item) => item.transaction.id !== editing.transactionId);
    return calculateAccountBalanceMinor(editingFromAccount.initialBalanceMinor, editingFromAccount.id, recordsWithoutCurrent);
  }, [editingFromAccount, editing, records]);
  const editingWillSpend = editing?.type === 'expense' || editing?.type === 'transfer';
  const editingProjectedBalanceMinor = useMemo(() => {
    if (!editingWillSpend || editingCurrentBalanceMinor === null || editingEstimatedMinor === null) return null;
    return editingCurrentBalanceMinor - editingEstimatedMinor;
  }, [editingWillSpend, editingCurrentBalanceMinor, editingEstimatedMinor]);
  const editingIsInsufficientBalance =
    !!editing &&
    !!editingFromAccount &&
    !(editingFromAccount.allowOverdraft ?? true) &&
    editingProjectedBalanceMinor !== null &&
    editingProjectedBalanceMinor < 0;

  const load = async () => {
    const [allRecords, accountRows, categoryRows] = await Promise.all([
      transactionsRepository.listAll({ includeDeleted: true }),
      accountsRepository.listActive(),
      categoriesRepository.listAllActive(),
    ]);

    const sortedRecords = [...allRecords].sort(
      (a, b) => new Date(b.transaction.occurredAt).getTime() - new Date(a.transaction.occurredAt).getTime(),
    );

    setRecords(sortedRecords);
    setAccounts(accountRows);
    setCategories(categoryRows);
  };

  useEffect(() => {
    void load();
  }, []);

  const filteredRecords = useMemo(() => {
    return records.filter((record) => {
      const tx = record.transaction;
      const amountMinor = record.amount.actualSettledAmountMinor ?? record.amount.settledAmountMinor;
      const noteText = tx.note ?? '';

      if (!filters.showDeleted && tx.deletedAt !== null) return false;
      if (filters.type !== 'all' && tx.type !== filters.type) return false;
      if (filters.accountId && tx.fromAccountId !== filters.accountId) return false;
      if (filters.categoryId && tx.categoryId !== filters.categoryId) return false;

      if (filters.keyword) {
        const keyword = filters.keyword.trim().toLowerCase();
        const accountText = (accountNameMap[tx.fromAccountId] ?? '').toLowerCase();
        const categoryText = (categoryNameMap[tx.categoryId ?? ''] ?? '').toLowerCase();
        const raw = `${noteText} ${accountText} ${categoryText}`.toLowerCase();
        if (!raw.includes(keyword)) return false;
      }

      if (filters.dateFrom) {
        const fromTs = new Date(`${filters.dateFrom}T00:00:00`).getTime();
        if (new Date(tx.occurredAt).getTime() < fromTs) return false;
      }

      if (filters.dateTo) {
        const toTs = new Date(`${filters.dateTo}T23:59:59`).getTime();
        if (new Date(tx.occurredAt).getTime() > toTs) return false;
      }

      if (filters.minAmount) {
        const minMinor = toMinor(Number(filters.minAmount));
        if (amountMinor < minMinor) return false;
      }

      if (filters.maxAmount) {
        const maxMinor = toMinor(Number(filters.maxAmount));
        if (amountMinor > maxMinor) return false;
      }

      return true;
    });
  }, [records, filters, accountNameMap, categoryNameMap]);

  const totalPages = Math.max(1, Math.ceil(filteredRecords.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const pagedRecords = filteredRecords.slice((safePage - 1) * pageSize, safePage * pageSize);

  useEffect(() => {
    setPage(1);
  }, [filters, pageSize]);

  const beginEdit = (record: RecordWithAmount) => {
    if (record.transaction.deletedAt) return;
    const fxMode = record.amount.fxSource === 'manual' ? 'manual' : 'api';
    setEditing({
      transactionId: record.transaction.id,
      type: record.transaction.type,
      fromAccountId: record.transaction.fromAccountId,
      toAccountId: record.transaction.toAccountId ?? '',
      categoryId: record.transaction.categoryId ?? '',
      amount: record.amount.originalAmountMinor / 100,
      originalCurrency: record.amount.originalCurrency,
      settledCurrency: record.amount.settledCurrency,
      fxMode,
      fxRate: record.amount.fxRate ?? 1,
      occurredAt: toLocalInputValue(record.transaction.occurredAt),
      note: record.transaction.note ?? '',
    });
    setEditRateError('');
    setEditRateProvider('');
    setEditBalanceError('');
    setEditRateLoading(false);
  };

  const removeRecord = async (transactionId: string) => {
    const ok = window.confirm('确认删除这条记录？该操作为软删除，可后续恢复。');
    if (!ok) return;
    await transactionsRepository.softDelete(transactionId);
    await load();
  };

  const restoreRecord = async (transactionId: string) => {
    await transactionsRepository.restore(transactionId);
    await load();
  };

  const submitEdit = async () => {
    if (!editing) return;
    if (!editing.fromAccountId) {
      setEditBalanceError('请选择出账账户。');
      return;
    }
    if (!editing.originalCurrency || !editing.settledCurrency) {
      setEditBalanceError('请选择交易币种和入账币种。');
      return;
    }
    if (editing.type === 'transfer' && !editing.toAccountId) {
      setEditBalanceError('转账记录必须选择入账账户。');
      return;
    }
    if (editing.type !== 'transfer' && !editing.categoryId) {
      setEditBalanceError('请选择分类。');
      return;
    }
    if (editingCanUseFx && (!Number.isFinite(editing.fxRate) || editing.fxRate <= 0 || editRateLoading)) {
      setEditBalanceError('当前汇率不可用，请等待自动汇率完成或切换手动汇率。');
      return;
    }
    setSaving(true);
    try {
      const originalAmountMinor = toMinor(editing.amount);
      const sameCurrency = editingCanDirectSettle;
      const settledAmountMinor = sameCurrency
        ? originalAmountMinor
        : Math.round(originalAmountMinor * editing.fxRate);

      if ((editing.type === 'expense' || editing.type === 'transfer') && editingFromAccount && !(editingFromAccount.allowOverdraft ?? true)) {
        const latestRecords = await transactionsRepository.listAll();
        const recordsWithoutCurrent = latestRecords.filter((item) => item.transaction.id !== editing.transactionId);
        const latestBalanceMinor = calculateAccountBalanceMinor(
          editingFromAccount.initialBalanceMinor,
          editingFromAccount.id,
          recordsWithoutCurrent,
        );
        const latestProjectedMinor = latestBalanceMinor - settledAmountMinor;
        if (latestProjectedMinor < 0) {
          setEditBalanceError(`余额不足：当前余额 ${formatMoney(latestBalanceMinor, editingFromAccount.baseCurrency)}。`);
          return;
        }
      }
      setEditBalanceError('');

      await transactionsRepository.update(editing.transactionId, {
        type: editing.type,
        fromAccountId: editing.fromAccountId,
        toAccountId: editing.type === 'transfer' ? editing.toAccountId || null : null,
        categoryId: editing.type === 'transfer' ? null : editing.categoryId || null,
        note: editing.note.trim() || null,
        occurredAt: localInputToUtcIso(editing.occurredAt),
        amount: {
          originalAmountMinor,
          originalCurrency: editing.originalCurrency,
          settledAmountMinor,
          settledCurrency: editing.settledCurrency,
          actualSettledAmountMinor: null,
          isEstimated: !sameCurrency,
          fxRate: sameCurrency ? 1 : editing.fxRate,
          fxSource: sameCurrency ? null : editing.fxMode,
          fxProvider: sameCurrency ? null : editing.fxMode === 'api' ? editRateProvider || 'auto' : 'manual',
          fxTimestamp: new Date().toISOString(),
        },
      });

      setEditing(null);
      await load();
    } finally {
      setSaving(false);
    }
  };

  useEffect(() => {
    if (!editing) return;

    if (editingCanDirectSettle) {
      if (editing.settledCurrency !== editing.originalCurrency || editing.fxRate !== 1) {
        setEditing((prev) => (prev ? { ...prev, settledCurrency: prev.originalCurrency, fxRate: 1 } : prev));
      }
      setEditRateError('');
      setEditRateProvider('');
      setEditRateLoading(false);
      return;
    }

    if (!editing.settledCurrency && editingDefaultSettleCurrency) {
      setEditing((prev) => (prev ? { ...prev, settledCurrency: editingDefaultSettleCurrency } : prev));
      return;
    }

    if (!editingSupportedCurrencies.includes(editing.settledCurrency) && editingSupportedCurrencies.length > 0) {
      setEditing((prev) => (prev ? { ...prev, settledCurrency: editingSupportedCurrencies[0] } : prev));
    }
  }, [editing, editingCanDirectSettle, editingSupportedCurrencies, editingDefaultSettleCurrency]);

  useEffect(() => {
    if (!editing || editing.type === 'transfer') return;
    const options = categories.filter((category) => category.kind === editing.type);
    if (options.length === 0) {
      if (editing.categoryId !== '') {
        setEditing((prev) => (prev ? { ...prev, categoryId: '' } : prev));
      }
      return;
    }
    if (!options.some((item) => item.id === editing.categoryId)) {
      setEditing((prev) => (prev ? { ...prev, categoryId: options[0].id } : prev));
    }
  }, [editing?.type, editing?.categoryId, categories]);

  useEffect(() => {
    const loadEditRate = async () => {
      if (!editing || !editingCanUseFx || editing.fxMode !== 'api') {
        setEditRateLoading(false);
        if (!editingCanUseFx) {
          setEditRateError('');
          setEditRateProvider('');
        }
        return;
      }

      const requestId = ++editRateRequestRef.current;
      try {
        setEditRateLoading(true);
        setEditing((prev) => (prev ? { ...prev, fxRate: Number.NaN } : prev));
        const quote = await fetchAutoRate(editing.originalCurrency, editing.settledCurrency);
        if (requestId !== editRateRequestRef.current) return;
        setEditing((prev) => (prev ? { ...prev, fxRate: quote.rate } : prev));
        setEditRateProvider(quote.provider);
        setEditRateError('');
      } catch {
        if (requestId !== editRateRequestRef.current) return;
        setEditRateProvider('');
        setEditRateError('自动汇率暂不可用，请切换到手动汇率录入。');
      } finally {
        if (requestId !== editRateRequestRef.current) return;
        setEditRateLoading(false);
      }
    };

    void loadEditRate();
  }, [editing?.originalCurrency, editing?.settledCurrency, editing?.fxMode, editingCanUseFx]);

  const updateDateFrom = (value: string) => {
    setFilters((prev) => {
      const next = { ...prev, dateFrom: value };
      if (next.dateTo && value && next.dateTo < value) {
        next.dateTo = value;
      }
      return next;
    });
    setDateRangeError('');
  };

  const updateDateTo = (value: string) => {
    if (filters.dateFrom && value && value < filters.dateFrom) {
      setDateRangeError('结束日期不能小于开始日期。');
      return;
    }
    setDateRangeError('');
    setFilters((prev) => ({ ...prev, dateTo: value }));
  };

  return (
    <PageCard className="records-card">
      <h2>记录列表</h2>

      <section className="filters-block">
        <div className="filter-grid">
          <label>
            类型
            <select
              value={filters.type}
              onChange={(event) => setFilters((prev) => ({ ...prev, type: event.target.value as RecordFilters['type'] }))}
            >
              <option value="all">全部</option>
              <option value="income">收入</option>
              <option value="expense">支出</option>
              <option value="transfer">转账</option>
            </select>
          </label>

          <label>
            账户
            <select
              value={filters.accountId}
              onChange={(event) => setFilters((prev) => ({ ...prev, accountId: event.target.value }))}
            >
              <option value="">全部</option>
              {accounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.name}
                </option>
              ))}
            </select>
          </label>

          <label>
            分类
            <select
              value={filters.categoryId}
              onChange={(event) => setFilters((prev) => ({ ...prev, categoryId: event.target.value }))}
            >
              <option value="">全部</option>
              {categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </select>
          </label>

          <label>
            关键词
            <input
              value={filters.keyword}
              onChange={(event) => setFilters((prev) => ({ ...prev, keyword: event.target.value }))}
              placeholder="备注/账户/分类"
            />
          </label>

          <label>
            起始日期
            <input type="date" value={filters.dateFrom} onChange={(event) => updateDateFrom(event.target.value)} />
          </label>

          <label>
            结束日期
            <input
              type="date"
              min={filters.dateFrom || undefined}
              value={filters.dateTo}
              onChange={(event) => updateDateTo(event.target.value)}
            />
          </label>

          <label>
            最小金额
            <input
              type="number"
              step="0.01"
              value={filters.minAmount}
              onChange={(event) => setFilters((prev) => ({ ...prev, minAmount: event.target.value }))}
            />
          </label>

          <label>
            最大金额
            <input
              type="number"
              step="0.01"
              value={filters.maxAmount}
              onChange={(event) => setFilters((prev) => ({ ...prev, maxAmount: event.target.value }))}
            />
          </label>
        </div>

        <label className="inline-check">
          <input
            type="checkbox"
            checked={filters.showDeleted}
            onChange={(event) => setFilters((prev) => ({ ...prev, showDeleted: event.target.checked }))}
          />
          <span>显示已删除记录</span>
        </label>

        {dateRangeError ? <p className="error-text">{dateRangeError}</p> : null}

        <div className="record-actions-row">
          <button type="button" className="ghost-btn" onClick={() => setFilters(DEFAULT_FILTERS)}>
            重置筛选
          </button>
          <label className="page-size">
            每页
            <select value={pageSize} onChange={(event) => setPageSize(Number(event.target.value))}>
              {PAGE_SIZE_OPTIONS.map((size) => (
                <option key={size} value={size}>
                  {size}
                </option>
              ))}
            </select>
            条
          </label>
        </div>
      </section>

      {editing ? (
        <div className="modal-overlay" onClick={() => setEditing(null)}>
          <section className="edit-block modal-card" onClick={(event) => event.stopPropagation()}>
          <h3>编辑记录</h3>

          <section className="form-section">
            <h3>基础信息</h3>
            <div className="form-grid">
              <label>
                记录类型
                <select
                  value={editing.type}
                  onChange={(event) =>
                    setEditing((prev) => (prev ? { ...prev, type: event.target.value as TransactionType } : prev))
                  }
                >
                  <option value="income">收入</option>
                  <option value="expense">支出</option>
                  <option value="transfer">转账</option>
                </select>
              </label>

              <label>
                出账账户
                <select
                  value={editing.fromAccountId}
                  onChange={(event) => {
                    const accountId = event.target.value;
                    const account = accounts.find((item) => item.id === accountId);
                    const fallbackCurrency = account?.baseCurrency ?? '';
                    setEditing((prev) => (prev
                      ? {
                          ...prev,
                          fromAccountId: accountId,
                          originalCurrency: '',
                          settledCurrency: fallbackCurrency,
                          fxMode: 'api',
                          fxRate: 1,
                        }
                      : prev));
                    setEditRateError('');
                    setEditRateProvider('');
                  }}
                >
                  {accounts.map((account) => (
                    <option key={account.id} value={account.id}>
                      {`${account.name}｜默认 ${formatCurrencyLabel(account.baseCurrency)}｜支持 ${(account.allowedCurrencies ?? [account.baseCurrency]).map((item) => formatCurrencyLabel(item)).join('、')}`}
                    </option>
                  ))}
                </select>
              </label>
              {editingFromAccount ? (
                <p className="hint account-meta">
                  账户信息：默认入账币种 {formatCurrencyLabel(editingFromAccount.baseCurrency)}；
                  支持入账币种 {editingSupportedCurrencies.map((item) => formatCurrencyLabel(item)).join('、')}；
                  透支 {(editingFromAccount.allowOverdraft ?? true) ? '允许' : '不允许'}；
                  当前余额 {editingCurrentBalanceMinor === null ? '-' : formatMoney(editingCurrentBalanceMinor, editingFromAccount.baseCurrency)}
                </p>
              ) : null}

              {editing.type === 'transfer' ? (
                <label>
                  入账账户
                  <select
                    value={editing.toAccountId}
                    onChange={(event) => setEditing((prev) => (prev ? { ...prev, toAccountId: event.target.value } : prev))}
                  >
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
                  <select
                    value={editing.categoryId}
                    onChange={(event) => setEditing((prev) => (prev ? { ...prev, categoryId: event.target.value } : prev))}
                  >
                    <option value="">请选择</option>
                    {categories
                      .filter((category) => category.kind === editing.type)
                      .map((category) => (
                        <option key={category.id} value={category.id}>
                          {category.name}
                        </option>
                      ))}
                  </select>
                </label>
              )}

              <label>
                发生时间（本地时区）
                <input
                  type="datetime-local"
                  value={editing.occurredAt}
                  onChange={(event) => setEditing((prev) => (prev ? { ...prev, occurredAt: event.target.value } : prev))}
                />
              </label>
            </div>
          </section>

          <section className="form-section">
            <h3>金额与币种</h3>
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
                交易币种
                <select
                  value={editing.originalCurrency}
                  onChange={(event) => setEditing((prev) => (prev ? { ...prev, originalCurrency: event.target.value } : prev))}
                >
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
                <select
                  value={editing.settledCurrency}
                  disabled={!editingAccountReady || editingCanDirectSettle}
                  onChange={(event) => setEditing((prev) => (prev ? { ...prev, settledCurrency: event.target.value } : prev))}
                >
                  <option value="">请选择</option>
                  {editingSupportedCurrencies.map((currency) => (
                    <option key={currency} value={currency}>
                      {formatCurrencyLabel(currency)}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            {!editingAccountReady ? <p className="hint">请先选择出账账户后再设置币种。</p> : null}
            {editingAccountReady ? (
              <p className="hint">
                账户支持入账币种：{editingSupportedCurrencies.map((item) => formatCurrencyLabel(item)).join('、')}
                ；默认入账币种：{formatCurrencyLabel(editingDefaultSettleCurrency)}
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
                    className={editing.fxMode === 'api' ? 'fx-option active' : 'fx-option'}
                    onClick={() => setEditing((prev) => (prev ? { ...prev, fxMode: 'api' } : prev))}
                    disabled={!editingCanUseFx}
                  >
                    自动汇率
                  </button>
                  <button
                    type="button"
                    className={editing.fxMode === 'manual' ? 'fx-option active' : 'fx-option'}
                    onClick={() => setEditing((prev) => (prev ? { ...prev, fxMode: 'manual' } : prev))}
                    disabled={!editingCanUseFx}
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
                    value={Number.isNaN(editing.fxRate) ? '' : editing.fxRate}
                    placeholder={editRateLoading ? '正在获取汇率...' : ''}
                    onChange={(event) =>
                      setEditing((prev) => (prev ? { ...prev, fxRate: Number(event.target.value || 1) } : prev))
                    }
                    disabled={!editingCanUseFx || editing.fxMode === 'api' || editRateLoading}
                  />
                  {editRateLoading ? <span className="rate-loading-text">正在获取汇率...</span> : null}
                </div>
              </label>
            </div>
            {!editingAccountReady ? <p className="hint">请先选择出账账户后再计算汇率。</p> : null}
            {editingAccountReady && !editingHasBothCurrencies ? <p className="hint">请选择交易币种和入账币种后自动加载汇率。</p> : null}
            {editingCanDirectSettle ? <p className="hint">两个币种一致，无需汇率，按实际金额入账。</p> : null}
            {editRateProvider && editing.fxMode === 'api' && editingCanUseFx ? <p className="hint">汇率来源：{editRateProvider}</p> : null}
            {editRateError ? <p className="error-text">{editRateError}</p> : null}
          </section>

          <section className="form-section">
            <h3>备注与确认</h3>
            <div className="form-grid">
              <label>
                备注
                <input
                  value={editing.note}
                  onChange={(event) => setEditing((prev) => (prev ? { ...prev, note: event.target.value } : prev))}
                />
              </label>
            </div>
            <div className="result-box">
              {editingEstimatedMinor === null
                ? '入账金额：-'
                : editingCanDirectSettle
                  ? `入账金额：${formatMoney(editingEstimatedMinor, editing.originalCurrency)}（实际）`
                  : `入账金额：${formatMoney(editingEstimatedMinor, editing.settledCurrency)}（预估）`}
            </div>
          </section>

          <div className="record-actions-row">
            <button type="button" className="ghost-btn" onClick={() => setEditing(null)}>
              取消
            </button>
            <button type="button" onClick={() => void submitEdit()} disabled={saving || editingIsInsufficientBalance}>
              {saving ? '保存中...' : '保存修改'}
            </button>
          </div>
          {editBalanceError ? <p className="error-text">{editBalanceError}</p> : null}
          {editingIsInsufficientBalance ? (
            <p className="error-text">
              预计余额不足（预计变动后余额 {editingProjectedBalanceMinor !== null && editingFromAccount ? formatMoney(editingProjectedBalanceMinor, editingFromAccount.baseCurrency) : '-'}），该账户不允许透支。
            </p>
          ) : null}
          </section>
        </div>
      ) : null}

      <div className="table-wrap records-desktop-table">
        <table className="records-table">
          <thead>
            <tr>
              <th>类型</th>
              <th>账户</th>
              <th>分类</th>
              <th>发生时间</th>
              <th>记账金额</th>
              <th>入账金额</th>
              <th>备注</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {pagedRecords.map((item) => (
              <tr key={item.transaction.id} className={item.transaction.deletedAt ? 'deleted-row' : ''}>
                <td>
                  {transactionTypeLabelMap[item.transaction.type]}
                  <span className={item.transaction.deletedAt ? 'deleted-tag' : 'deleted-tag deleted-tag-hidden'}>已删除</span>
                </td>
                <td>{accountNameMap[item.transaction.fromAccountId] ?? '未知账户'}</td>
                <td>{item.transaction.categoryId ? (categoryNameMap[item.transaction.categoryId] ?? '未分类') : '-'}</td>
                <td>{formatUtcToLocal(item.transaction.occurredAt)}</td>
                <td>{formatMoney(item.amount.originalAmountMinor, item.amount.originalCurrency)}</td>
                <td>
                  {formatMoney(item.amount.settledAmountMinor, item.amount.settledCurrency)}
                  {item.amount.isEstimated ? <span className="estimated-tag">预估</span> : null}
                </td>
                <td>{item.transaction.note ?? '-'}</td>
                <td>
                  {item.transaction.deletedAt ? (
                    <div className="record-actions-inline">
                      <button type="button" className="restore-btn" onClick={() => void restoreRecord(item.transaction.id)}>
                        恢复
                      </button>
                    </div>
                  ) : (
                    <div className="record-actions-inline">
                      <button type="button" className="ghost-btn" onClick={() => beginEdit(item)}>
                        编辑
                      </button>
                      <button type="button" className="danger-btn" onClick={() => void removeRecord(item.transaction.id)}>
                        删除
                      </button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
            {pagedRecords.length === 0 ? (
              <tr>
                <td colSpan={8} className="table-empty">没有符合条件的记录。</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <ul className="list records-mobile-list">
        {pagedRecords.map((item) => (
          <li key={`mobile-${item.transaction.id}`} className={item.transaction.deletedAt ? 'deleted-row' : ''}>
            <div>
              <strong>
                {transactionTypeLabelMap[item.transaction.type]}
                <span className={item.transaction.deletedAt ? 'deleted-tag' : 'deleted-tag deleted-tag-hidden'}>已删除</span>
              </strong>
              <p>账户：{accountNameMap[item.transaction.fromAccountId] ?? '未知账户'}</p>
              <p>分类：{item.transaction.categoryId ? (categoryNameMap[item.transaction.categoryId] ?? '未分类') : '-'}</p>
              <p>发生时间：{formatUtcToLocal(item.transaction.occurredAt)}</p>
              <p>记账金额：{formatMoney(item.amount.originalAmountMinor, item.amount.originalCurrency)}</p>
              <p>
                入账金额：{formatMoney(item.amount.settledAmountMinor, item.amount.settledCurrency)}
                {item.amount.isEstimated ? <span className="estimated-tag">预估</span> : null}
              </p>
              {item.transaction.note ? <p>备注：{item.transaction.note}</p> : null}
            </div>
            {item.transaction.deletedAt ? (
              <div className="record-actions-inline">
                <button type="button" className="restore-btn" onClick={() => void restoreRecord(item.transaction.id)}>
                  恢复
                </button>
              </div>
            ) : (
              <div className="record-actions-inline">
                <button type="button" className="ghost-btn" onClick={() => beginEdit(item)}>
                  编辑
                </button>
                <button type="button" className="danger-btn" onClick={() => void removeRecord(item.transaction.id)}>
                  删除
                </button>
              </div>
            )}
          </li>
        ))}
        {pagedRecords.length === 0 ? <li>没有符合条件的记录。</li> : null}
      </ul>

      <div className="pagination-row">
        <span>
          共 {filteredRecords.length} 条，第 {safePage}/{totalPages} 页
        </span>
        <div className="record-actions-inline">
          <button type="button" className="ghost-btn" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={safePage <= 1}>
            上一页
          </button>
          <button
            type="button"
            className="ghost-btn"
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={safePage >= totalPages}
          >
            下一页
          </button>
        </div>
      </div>
    </PageCard>
  );
};
