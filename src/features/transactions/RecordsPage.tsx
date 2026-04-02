import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, FilePenLine, RotateCcw, Trash2 } from 'lucide-react';
import { accountsRepository } from '@/db/repositories/accounts.repository';
import { categoriesRepository } from '@/db/repositories/categories.repository';
import { transactionsRepository } from '@/db/repositories/transactions.repository';
import { calculateTransactionSettlement, collectSettlementSourceCurrencies } from '@/domain/transactions/settlement';
import { fetchAutoRatesToTarget } from '@/domain/fx/provider';
import { calculateAccountBalanceMinor } from '@/domain/accounts/balance';
import type { Account, Category, FeeMode, RecordWithAmount, TransactionType } from '@/domain/types';
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
  showDeletedAccountRecords: boolean;
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
  fxMode: 'api' | 'manual';
  fxRate: number;
  occurredAt: string;
  note: string;
}

interface ActualSettleForm {
  transactionId: string;
  settledCurrency: string;
  amount: number;
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
  showDeletedAccountRecords: false,
};

const PAGE_SIZE_OPTIONS = [10, 20, 50, 100];

export const RecordsPage = () => {
  const toPairKey = (from: string, to: string) => `${from}->${to}`;
  const [records, setRecords] = useState<RecordWithAmount[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [filters, setFilters] = useState<RecordFilters>(DEFAULT_FILTERS);
  const [editing, setEditing] = useState<EditForm | null>(null);
  const [actualEditing, setActualEditing] = useState<ActualSettleForm | null>(null);
  const [saving, setSaving] = useState(false);
  const [savingActual, setSavingActual] = useState(false);
  const [editRateLoading, setEditRateLoading] = useState(false);
  const [editRateError, setEditRateError] = useState('');
  const [editRateProvider, setEditRateProvider] = useState('');
  const [editFxRates, setEditFxRates] = useState<Record<string, number>>({});
  const [editFxProviders, setEditFxProviders] = useState<Record<string, string>>({});
  const [editBalanceError, setEditBalanceError] = useState('');
  const [actualEditError, setActualEditError] = useState('');
  const [dateRangeError, setDateRangeError] = useState('');
  const [pageSize, setPageSize] = useState(20);
  const [page, setPage] = useState(1);
  const editRateRequestRef = useRef(0);
  const editRateFetchKeyRef = useRef('');
  const canPortal = typeof document !== 'undefined';

  const accountNameMap = useMemo(
    () => Object.fromEntries(accounts.map((account) => [account.id, account.name])),
    [accounts],
  );
  const accountDeletedMap = useMemo(
    () => Object.fromEntries(accounts.map((account) => [account.id, account.deletedAt !== null])),
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
  const actualEditingRecord = useMemo(
    () => records.find((item) => item.transaction.id === (actualEditing?.transactionId ?? '')) ?? null,
    [records, actualEditing?.transactionId],
  );
  const actualEditingAccount = useMemo(
    () => accounts.find((account) => account.id === (actualEditingRecord?.transaction.fromAccountId ?? '')) ?? null,
    [accounts, actualEditingRecord?.transaction.fromAccountId],
  );
  const actualAllowedCurrencies = useMemo(() => {
    if (!actualEditingAccount) return [];
    const source = actualEditingAccount.allowedCurrencies?.length
      ? actualEditingAccount.allowedCurrencies
      : [actualEditingAccount.baseCurrency];
    return Array.from(new Set(source));
  }, [actualEditingAccount]);

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
  const editingDefaultSettleCurrency = editingFromAccount?.baseCurrency ?? '';
  const editingRequiredRatePairs = useMemo(() => {
    if (!editing || !editingAccountReady || !editing.settledCurrency) return [] as Array<{ from: string; to: string; key: string }>;
    const candidates = collectSettlementSourceCurrencies({
      originalAmountMinor: toMinor(editing.amount || 0),
      originalCurrency: editing.originalCurrency,
      settledCurrency: editing.settledCurrency,
      cashbackAmountMinor: toMinor(editing.cashbackAmount || 0),
      cashbackCurrency: editing.cashbackCurrency || editing.settledCurrency,
      discountAmountMinor: toMinor(editing.discountAmount || 0),
      discountCurrency: editing.discountCurrency || editing.settledCurrency,
      conversionFeeMode: editing.conversionFeeMode,
      conversionFeeAmountMinor: toMinor(editing.conversionFeeAmount || 0),
      conversionFeeRate: editing.conversionFeeRate || 0,
      conversionFeeCurrency: editing.conversionFeeCurrency || editing.settledCurrency,
      serviceFeeMode: editing.serviceFeeMode,
      serviceFeeAmountMinor: toMinor(editing.serviceFeeAmount || 0),
      serviceFeeRate: editing.serviceFeeRate || 0,
      serviceFeeCurrency: editing.serviceFeeCurrency || editing.settledCurrency,
    });
    const uniqueSources = Array.from(new Set(candidates));
    return uniqueSources
      .filter((source) => source !== editing.settledCurrency)
      .map((source) => ({ from: source, to: editing.settledCurrency, key: toPairKey(source, editing.settledCurrency) }));
  }, [
    editingAccountReady,
    editing?.originalCurrency,
    editing?.settledCurrency,
    editing?.discountCurrency,
    editing?.cashbackCurrency,
  ]);
  const editingMainRatePairKey = useMemo(() => {
    if (!editing || !editing.originalCurrency || !editing.settledCurrency || editing.originalCurrency === editing.settledCurrency) return '';
    return toPairKey(editing.originalCurrency, editing.settledCurrency);
  }, [editing?.originalCurrency, editing?.settledCurrency]);
  const editingEstimatedMinor = useMemo(() => {
    if (!editing || editing.amount <= 0 || !editingHasBothCurrencies) return null;
    const getRate = (from: string, to: string) => {
      if (from === to) return 1;
      return editFxRates[toPairKey(from, to)];
    };
    const settlement = calculateTransactionSettlement({
      originalAmountMinor: toMinor(editing.amount),
      originalCurrency: editing.originalCurrency,
      settledCurrency: editing.settledCurrency,
      cashbackAmountMinor: toMinor(editing.cashbackAmount || 0),
      cashbackCurrency: editing.cashbackCurrency || editing.settledCurrency,
      discountAmountMinor: toMinor(editing.discountAmount || 0),
      discountCurrency: editing.discountCurrency || editing.settledCurrency,
      conversionFeeMode: editing.conversionFeeMode,
      conversionFeeAmountMinor: toMinor(editing.conversionFeeAmount || 0),
      conversionFeeRate: editing.conversionFeeRate || 0,
      conversionFeeCurrency: editing.conversionFeeCurrency || editing.settledCurrency,
      serviceFeeMode: editing.serviceFeeMode,
      serviceFeeAmountMinor: toMinor(editing.serviceFeeAmount || 0),
      serviceFeeRate: editing.serviceFeeRate || 0,
      serviceFeeCurrency: editing.serviceFeeCurrency || editing.settledCurrency,
    }, getRate);
    return settlement?.settledAmountMinor ?? null;
  }, [editing, editingHasBothCurrencies, editingCanDirectSettle, editFxRates]);
  const editingCurrentBalanceMinor = useMemo(() => {
    if (!editingFromAccount || !editing) return null;
    const recordsWithoutCurrent = records.filter((item) => item.transaction.id !== editing.transactionId);
    return calculateAccountBalanceMinor(editingFromAccount.id, recordsWithoutCurrent);
  }, [editingFromAccount, editing, records]);
  const editingWillSpend = editing?.type === 'expense';
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
      accountsRepository.listAll(),
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
      if (!filters.showDeletedAccountRecords && accountDeletedMap[tx.fromAccountId]) return false;
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
  }, [records, filters, accountNameMap, categoryNameMap, accountDeletedMap]);

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
      cashbackAmount: (record.amount.cashbackAmountMinor ?? 0) / 100,
      cashbackCurrency: record.amount.cashbackCurrency ?? record.amount.settledCurrency,
      discountAmount: (record.amount.discountAmountMinor ?? 0) / 100,
      discountCurrency: record.amount.discountCurrency ?? record.amount.settledCurrency,
      conversionFeeMode: record.amount.conversionFeeMode ?? 'fixed',
      conversionFeeAmount: (record.amount.conversionFeeAmountMinor ?? 0) / 100,
      conversionFeeRate: record.amount.conversionFeeRate ?? 0,
      conversionFeeCurrency: record.amount.conversionFeeCurrency ?? record.amount.settledCurrency,
      serviceFeeMode: record.amount.serviceFeeMode ?? 'fixed',
      serviceFeeAmount: (record.amount.serviceFeeAmountMinor ?? 0) / 100,
      serviceFeeRate: record.amount.serviceFeeRate ?? 0,
      serviceFeeCurrency: record.amount.serviceFeeCurrency ?? record.amount.settledCurrency,
      fxMode,
      fxRate: record.amount.fxRate ?? 1,
      occurredAt: toLocalInputValue(record.transaction.occurredAt),
      note: record.transaction.note ?? '',
    });
    setEditRateError('');
    setEditRateProvider('');
    setEditBalanceError('');
    setEditRateLoading(false);
    const baseKey = record.amount.originalCurrency === record.amount.settledCurrency
      ? ''
      : toPairKey(record.amount.originalCurrency, record.amount.settledCurrency);
    if (baseKey) {
      setEditFxRates({ [baseKey]: Number((record.amount.fxRate ?? 1).toFixed(5)) });
      setEditFxProviders({ [baseKey]: record.amount.fxProvider ?? record.amount.fxSource ?? '' });
    } else {
      setEditFxRates({});
      setEditFxProviders({});
    }
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

  const hardDeleteRecord = async (transactionId: string) => {
    const ok = window.confirm('确认永久删除这条记录？该操作不可恢复。');
    if (!ok) return;
    await transactionsRepository.hardDelete(transactionId);
    await load();
  };

  const beginActualEdit = (record: RecordWithAmount) => {
    if (record.transaction.deletedAt) return;
    const amountMinor = record.amount.actualSettledAmountMinor ?? record.amount.settledAmountMinor;
    setActualEditing({
      transactionId: record.transaction.id,
      settledCurrency: record.amount.settledCurrency,
      amount: amountMinor / 100,
    });
    setActualEditError('');
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
      const allLatest = await transactionsRepository.listAll({ includeDeleted: true });
      const fresh = allLatest.find((item) => item.transaction.id === actualEditing.transactionId);
      if (!fresh) {
        setActualEditError('该记录不存在或已被删除。');
        return;
      }
      const freshAccount = accounts.find((account) => account.id === fresh.transaction.fromAccountId);
      const freshAllowed = freshAccount
        ? Array.from(new Set(freshAccount.allowedCurrencies?.length ? freshAccount.allowedCurrencies : [freshAccount.baseCurrency]))
        : [];
      if (!freshAllowed.includes(actualEditing.settledCurrency)) {
        setActualEditError('实际入账币种必须在该账户支持币种内。');
        return;
      }

      const actualMinor = toMinor(actualEditing.amount);
      await transactionsRepository.update(actualEditing.transactionId, {
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
    if (!editing.categoryId) {
      setEditBalanceError('请选择分类。');
      return;
    }
    if (editing.fxMode === 'api' && editRateLoading) {
      setEditBalanceError('当前汇率不可用，请等待自动汇率完成或切换手动汇率。');
      return;
    }
    const getRate = (from: string, to: string) => {
      if (from === to) return 1;
      return editFxRates[toPairKey(from, to)];
    };
    setSaving(true);
    try {
      const originalAmountMinor = toMinor(editing.amount);
      const originalRow = records.find((item) => item.transaction.id === editing.transactionId);
      const sameCurrency = editingCanDirectSettle;
      const settlement = calculateTransactionSettlement({
        originalAmountMinor,
        originalCurrency: editing.originalCurrency,
        settledCurrency: editing.settledCurrency,
        cashbackAmountMinor: toMinor(editing.cashbackAmount || 0),
        cashbackCurrency: editing.cashbackCurrency || editing.settledCurrency,
        discountAmountMinor: toMinor(editing.discountAmount || 0),
        discountCurrency: editing.discountCurrency || editing.settledCurrency,
        conversionFeeMode: editing.conversionFeeMode,
        conversionFeeAmountMinor: toMinor(editing.conversionFeeAmount || 0),
        conversionFeeRate: editing.conversionFeeRate || 0,
        conversionFeeCurrency: editing.conversionFeeCurrency || editing.settledCurrency,
        serviceFeeMode: editing.serviceFeeMode,
        serviceFeeAmountMinor: toMinor(editing.serviceFeeAmount || 0),
        serviceFeeRate: editing.serviceFeeRate || 0,
        serviceFeeCurrency: editing.serviceFeeCurrency || editing.settledCurrency,
      }, getRate);
      if (!settlement) {
        setEditBalanceError('存在未配置的汇率，请补全后再保存。');
        return;
      }
      const originalAmount = originalRow?.amount;
      const forceReEstimate = !!originalAmount && (
        originalAmount.originalAmountMinor !== originalAmountMinor
        || originalAmount.originalCurrency !== editing.originalCurrency
        || originalAmount.settledCurrency !== editing.settledCurrency
      );
      const involvedRates = editingRequiredRatePairs
        .map((pair) => editFxRates[pair.key])
        .filter((rate): rate is number => Number.isFinite(rate));
      const hasDifferentRate = involvedRates.some((rate) => Math.abs(rate - settlement.mainRate) > 0.0000001);
      const nextIsEstimated = forceReEstimate ? true : (!sameCurrency || hasDifferentRate);
      const nextActualSettled = forceReEstimate ? null : (originalAmount?.actualSettledAmountMinor ?? null);

      if (editing.type === 'expense' && editingFromAccount && !(editingFromAccount.allowOverdraft ?? true)) {
        const latestRecords = await transactionsRepository.listAll();
        const recordsWithoutCurrent = latestRecords.filter((item) => item.transaction.id !== editing.transactionId);
        const latestBalanceMinor = calculateAccountBalanceMinor(editingFromAccount.id, recordsWithoutCurrent);
        const latestProjectedMinor = latestBalanceMinor - settlement.settledAmountMinor;
        if (latestProjectedMinor < 0) {
          setEditBalanceError(`余额不足：当前余额 ${formatMoney(latestBalanceMinor, editingFromAccount.baseCurrency)}。`);
          return;
        }
      }
      setEditBalanceError('');

      await transactionsRepository.update(editing.transactionId, {
        type: editing.type,
        fromAccountId: editing.fromAccountId,
        toAccountId: null,
        categoryId: editing.categoryId || null,
        note: editing.note.trim() || null,
        occurredAt: localInputToUtcIso(editing.occurredAt),
        amount: {
          originalAmountMinor,
          originalCurrency: editing.originalCurrency,
          settledAmountMinor: settlement.settledAmountMinor,
          settledCurrency: editing.settledCurrency,
          cashbackAmountMinor: toMinor(editing.cashbackAmount || 0),
          cashbackCurrency: editing.cashbackCurrency || editing.settledCurrency,
          discountAmountMinor: toMinor(editing.discountAmount || 0),
          discountCurrency: editing.discountCurrency || editing.settledCurrency,
          conversionFeeMode: editing.conversionFeeMode,
          conversionFeeAmountMinor: toMinor(editing.conversionFeeAmount || 0),
          conversionFeeRate: editing.conversionFeeRate || 0,
          conversionFeeCurrency: editing.conversionFeeMode === 'fixed'
            ? (editing.conversionFeeCurrency || editing.settledCurrency)
            : null,
          serviceFeeMode: editing.serviceFeeMode,
          serviceFeeAmountMinor: toMinor(editing.serviceFeeAmount || 0),
          serviceFeeRate: editing.serviceFeeRate || 0,
          serviceFeeCurrency: editing.serviceFeeMode === 'fixed'
            ? (editing.serviceFeeCurrency || editing.settledCurrency)
            : null,
          actualSettledAmountMinor: nextActualSettled,
          isEstimated: nextIsEstimated,
          fxRate: settlement.mainRate,
          fxSource: sameCurrency ? null : editing.fxMode,
          fxProvider: sameCurrency ? null : editing.fxMode === 'api' ? ((editFxProviders[editingMainRatePairKey] ?? editRateProvider) || 'auto') : 'manual',
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
      setEditFxRates({});
      setEditFxProviders({});
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
    if (!editing) return;
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
      if (!editing || editing.fxMode !== 'api') {
        setEditRateLoading(false);
        editRateFetchKeyRef.current = '';
        return;
      }
      if (editingRequiredRatePairs.length === 0) {
        setEditRateLoading(false);
        setEditRateError('');
        setEditRateProvider('');
        editRateFetchKeyRef.current = '';
        return;
      }

      const fetchKey = `${editing.settledCurrency}|${editingRequiredRatePairs.map((pair) => pair.from).sort().join(',')}`;
      if (editRateFetchKeyRef.current === fetchKey) {
        return;
      }
      editRateFetchKeyRef.current = fetchKey;

      const requestId = ++editRateRequestRef.current;
      try {
        setEditRateLoading(true);
        const sources = editingRequiredRatePairs.map((pair) => pair.from);
        const quote = await fetchAutoRatesToTarget(editing.settledCurrency, sources);
        if (requestId !== editRateRequestRef.current) return;
        const nextRates: Record<string, number> = {};
        const nextProviders: Record<string, string> = {};
        for (const pair of editingRequiredRatePairs) {
          const nextRate = quote.rates[pair.from];
          if (!nextRate || nextRate <= 0) continue;
          nextRates[pair.key] = Number(nextRate.toFixed(5));
          nextProviders[pair.key] = quote.providers[pair.from] ?? quote.provider;
        }
        setEditFxRates((prev) => ({ ...prev, ...nextRates }));
        setEditFxProviders((prev) => ({ ...prev, ...nextProviders }));
        if (editingMainRatePairKey && nextRates[editingMainRatePairKey]) {
          const nextMainRate = nextRates[editingMainRatePairKey];
          setEditing((prev) => {
            if (!prev) return prev;
            if (Math.abs(prev.fxRate - nextMainRate) <= 0.0000001) return prev;
            return { ...prev, fxRate: nextMainRate };
          });
        }
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
  }, [editing?.originalCurrency, editing?.settledCurrency, editing?.fxMode, editingRequiredRatePairs, editingMainRatePairKey]);

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

        <div className="filter-check-row">
          <label className="inline-check">
            <input
              type="checkbox"
              checked={filters.showDeleted}
              onChange={(event) => setFilters((prev) => ({ ...prev, showDeleted: event.target.checked }))}
            />
            <span>显示已删除记录</span>
          </label>
          <label className="inline-check">
            <input
              type="checkbox"
              checked={filters.showDeletedAccountRecords}
              onChange={(event) => setFilters((prev) => ({ ...prev, showDeletedAccountRecords: event.target.checked }))}
            />
            <span>显示已删除账户的记录</span>
          </label>
        </div>

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

      {editing && canPortal ? createPortal((
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
                          originalCurrency: fallbackCurrency,
                          settledCurrency: fallbackCurrency,
                          conversionFeeCurrency: fallbackCurrency,
                          serviceFeeCurrency: fallbackCurrency,
                          fxMode: 'api',
                          fxRate: 1,
                        }
                      : prev));
                    setEditRateError('');
                    setEditRateProvider('');
                    setEditFxRates({});
                    setEditFxProviders({});
                  }}
                >
                  {accounts.map((account) => (
                    <option key={account.id} value={account.id}>
                      {`${account.name}｜默认 ${account.baseCurrency}｜支持 ${(account.allowedCurrencies ?? [account.baseCurrency]).join(' / ')}`}
                    </option>
                  ))}
                </select>
              </label>
              {editingFromAccount ? (
                <div className="account-meta-grid">
                  <div className="account-meta-item">
                    <span>默认币种</span>
                    <p className="account-meta-value">{formatCurrencyLabel(editingFromAccount.baseCurrency)}</p>
                  </div>
                  <div className="account-meta-item">
                    <span>支持币种</span>
                    <div className="account-meta-list">
                      {editingSupportedCurrencies.map((item) => (
                        <p key={`edit-meta-${item}`}>{formatCurrencyLabel(item)}</p>
                      ))}
                    </div>
                  </div>
                  <div className="account-meta-item">
                    <span>透支</span>
                    <p className="account-meta-value">{(editingFromAccount.allowOverdraft ?? true) ? '允许' : '不允许'}</p>
                  </div>
                  <div className="account-meta-item">
                    <span>当前余额</span>
                    <p className="account-meta-value">
                      {editingCurrentBalanceMinor === null ? '-' : formatMoney(editingCurrentBalanceMinor, editingFromAccount.baseCurrency)}
                    </p>
                  </div>
                </div>
              ) : null}

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
          </section>

          <section className="form-section">
            <h3>返现与优惠</h3>
            <div className="form-grid">
              <label>
                返现
                <input
                  type="number"
                  step="0.01"
                  value={editing.cashbackAmount}
                  onChange={(event) =>
                    setEditing((prev) => (prev ? { ...prev, cashbackAmount: Number(event.target.value || 0) } : prev))
                  }
                />
              </label>
              <label>
                返现币种
                <select
                  value={editing.cashbackCurrency}
                  onChange={(event) => setEditing((prev) => (prev ? { ...prev, cashbackCurrency: event.target.value } : prev))}
                >
                  {CURRENCY_OPTIONS.map((currency) => (
                    <option key={`cb-${currency.code}`} value={currency.code}>
                      {formatCurrencyLabel(currency.code)}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                优惠
                <input
                  type="number"
                  step="0.01"
                  value={editing.discountAmount}
                  onChange={(event) =>
                    setEditing((prev) => (prev ? { ...prev, discountAmount: Number(event.target.value || 0) } : prev))
                  }
                />
              </label>
              <label>
                优惠币种
                <select
                  value={editing.discountCurrency}
                  onChange={(event) => setEditing((prev) => (prev ? { ...prev, discountCurrency: event.target.value } : prev))}
                >
                  {CURRENCY_OPTIONS.map((currency) => (
                    <option key={`dc-${currency.code}`} value={currency.code}>
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
                    className={editing.conversionFeeMode === 'fixed' ? 'fx-option active' : 'fx-option'}
                    onClick={() => setEditing((prev) => (prev ? { ...prev, conversionFeeMode: 'fixed' } : prev))}
                  >
                    固定金额
                  </button>
                  <button
                    type="button"
                    className={editing.conversionFeeMode === 'rate' ? 'fx-option active' : 'fx-option'}
                    onClick={() => setEditing((prev) => (prev ? { ...prev, conversionFeeMode: 'rate' } : prev))}
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
                    value={editing.conversionFeeMode === 'rate' ? editing.conversionFeeRate : editing.conversionFeeAmount}
                    onChange={(event) =>
                      setEditing((prev) => (prev
                        ? {
                            ...prev,
                            ...(prev.conversionFeeMode === 'rate'
                              ? { conversionFeeRate: Number(event.target.value || 0) }
                              : { conversionFeeAmount: Number(event.target.value || 0) }),
                          }
                        : prev))
                    }
                  />
                  {editing.conversionFeeMode === 'rate' ? <span className="input-suffix">%</span> : null}
                </div>
              </label>
              <label>
                货币转换费币种
                <select
                  value={editing.conversionFeeCurrency}
                  disabled={editing.conversionFeeMode === 'rate'}
                  onChange={(event) => setEditing((prev) => (prev ? { ...prev, conversionFeeCurrency: event.target.value } : prev))}
                >
                  {CURRENCY_OPTIONS.map((currency) => (
                    <option key={`edit-conversion-fee-${currency.code}`} value={currency.code}>
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
                    className={editing.serviceFeeMode === 'fixed' ? 'fx-option active' : 'fx-option'}
                    onClick={() => setEditing((prev) => (prev ? { ...prev, serviceFeeMode: 'fixed' } : prev))}
                  >
                    固定金额
                  </button>
                  <button
                    type="button"
                    className={editing.serviceFeeMode === 'rate' ? 'fx-option active' : 'fx-option'}
                    onClick={() => setEditing((prev) => (prev ? { ...prev, serviceFeeMode: 'rate' } : prev))}
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
                    value={editing.serviceFeeMode === 'rate' ? editing.serviceFeeRate : editing.serviceFeeAmount}
                    onChange={(event) =>
                      setEditing((prev) => (prev
                        ? {
                            ...prev,
                            ...(prev.serviceFeeMode === 'rate'
                              ? { serviceFeeRate: Number(event.target.value || 0) }
                              : { serviceFeeAmount: Number(event.target.value || 0) }),
                          }
                        : prev))
                    }
                  />
                  {editing.serviceFeeMode === 'rate' ? <span className="input-suffix">%</span> : null}
                </div>
              </label>
              <label>
                手续费币种
                <select
                  value={editing.serviceFeeCurrency}
                  disabled={editing.serviceFeeMode === 'rate'}
                  onChange={(event) => setEditing((prev) => (prev ? { ...prev, serviceFeeCurrency: event.target.value } : prev))}
                >
                  {CURRENCY_OPTIONS.map((currency) => (
                    <option key={`edit-service-fee-${currency.code}`} value={currency.code}>
                      {formatCurrencyLabel(currency.code)}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <p className="hint">比例模式按记账金额计算，固定金额模式按所选币种折算到入账币种。</p>
          </section>

          <section className="form-section">
            <h3>汇率</h3>
            <div className="fx-mode-wrap">
              <span className="fx-label">汇率模式</span>
              <div className="fx-segmented type-segmented" role="radiogroup" aria-label="汇率模式">
                <button
                  type="button"
                  className={editing.fxMode === 'api' ? 'fx-option active' : 'fx-option'}
                  onClick={() => setEditing((prev) => (prev ? { ...prev, fxMode: 'api' } : prev))}
                  disabled={!editingAccountReady || !editingHasBothCurrencies}
                >
                  自动汇率
                </button>
                <button
                  type="button"
                  className={editing.fxMode === 'manual' ? 'fx-option active' : 'fx-option'}
                  onClick={() => setEditing((prev) => (prev ? { ...prev, fxMode: 'manual' } : prev))}
                  disabled={!editingAccountReady || !editingHasBothCurrencies}
                >
                  手动汇率
                </button>
              </div>
            </div>

            <div className="fx-rates-list">
              {editingRequiredRatePairs.map((pair) => (
                <label key={`edit-${pair.key}`} className="fx-rate-row">
                  <span className="fx-rate-pair">{pair.from} → {pair.to}</span>
                  <input
                    type="number"
                    step="0.00001"
                    className="fx-rate-input"
                    value={Number.isFinite(editFxRates[pair.key]) ? editFxRates[pair.key] : ''}
                    placeholder={editRateLoading && editing.fxMode === 'api' ? '正在获取汇率...' : ''}
                    onChange={(event) =>
                      setEditFxRates((prev) => ({ ...prev, [pair.key]: Number(event.target.value || 0) }))
                    }
                    disabled={editing.fxMode === 'api' || editRateLoading}
                  />
                  <span className="section-extra">
                    {editing.fxMode === 'api' ? `来源：${(editFxProviders[pair.key] ?? editRateProvider) || '-'}` : ''}
                  </span>
                </label>
              ))}
              {editingRequiredRatePairs.length === 0 ? (
                editingAccountReady ? <p className="hint">当前币种组合无需汇率。</p> : null
              ) : null}
              {editRateLoading && editing.fxMode === 'api' ? (
                <p className="hint">正在获取汇率...</p>
              ) : null}
            </div>
            {!editingAccountReady ? <p className="hint">请先选择出账账户后再计算汇率。</p> : null}
            {editingAccountReady && !editingHasBothCurrencies ? <p className="hint">请选择交易币种和入账币种后自动加载汇率。</p> : null}
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
      ), document.body) : null}

      {actualEditing && actualEditingRecord && canPortal ? createPortal((
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
      ), document.body) : null}

      <div className="table-wrap records-desktop-table">
        <table className="records-table">
            <thead>
              <tr>
                <th>类型</th>
                <th>账户</th>
                <th>分类</th>
                <th>发生时间</th>
                <th>记账金额</th>
                <th>返现</th>
                <th>优惠</th>
                <th>转换费</th>
                <th>手续费</th>
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
                <td>{(item.amount.cashbackAmountMinor ?? 0) > 0 ? formatMoney(item.amount.cashbackAmountMinor, item.amount.cashbackCurrency) : '-'}</td>
                <td>{(item.amount.discountAmountMinor ?? 0) > 0 ? formatMoney(item.amount.discountAmountMinor, item.amount.discountCurrency) : '-'}</td>
                <td>
                  {item.amount.conversionFeeMode === 'rate'
                    ? `${item.amount.conversionFeeRate ?? 0}%`
                    : ((item.amount.conversionFeeAmountMinor ?? 0) > 0
                      ? formatMoney(item.amount.conversionFeeAmountMinor, item.amount.conversionFeeCurrency ?? item.amount.settledCurrency)
                      : '-')}
                </td>
                <td>
                  {item.amount.serviceFeeMode === 'rate'
                    ? `${item.amount.serviceFeeRate ?? 0}%`
                    : ((item.amount.serviceFeeAmountMinor ?? 0) > 0
                      ? formatMoney(item.amount.serviceFeeAmountMinor, item.amount.serviceFeeCurrency ?? item.amount.settledCurrency)
                      : '-')}
                </td>
                <td>
                  {formatMoney(item.amount.actualSettledAmountMinor ?? item.amount.settledAmountMinor, item.amount.settledCurrency)}
                  {item.amount.isEstimated ? <span className="estimated-tag">预估</span> : null}
                </td>
                <td>
                  {item.transaction.note ?? '-'}
                </td>
                <td>
                  {item.transaction.deletedAt ? (
                    <div className="record-actions-inline">
                      <button type="button" className="restore-btn icon-btn" title="恢复" onClick={() => void restoreRecord(item.transaction.id)}>
                        <RotateCcw size={16} />
                      </button>
                      <button type="button" className="danger-btn icon-btn" title="永久删除" onClick={() => void hardDeleteRecord(item.transaction.id)}>
                        <Trash2 size={16} />
                      </button>
                    </div>
                  ) : (
                    <div className="record-actions-inline">
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
                  )}
                </td>
              </tr>
            ))}
            {pagedRecords.length === 0 ? (
              <tr>
                <td colSpan={12} className="table-empty">没有符合条件的记录。</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <ul className="list records-mobile-list">
        {pagedRecords.map((item) => (
          <li key={`mobile-${item.transaction.id}`} className={`transaction-card ${item.transaction.deletedAt ? 'deleted-row' : ''}`}>
            <div className="transaction-card-head">
              <div className="transaction-card-head-left">
                <strong className="transaction-card-type">
                  {transactionTypeLabelMap[item.transaction.type]}
                  <span className={item.transaction.deletedAt ? 'deleted-tag' : 'deleted-tag deleted-tag-hidden'}>已删除</span>
                </strong>
                <span className="transaction-card-time">{formatUtcToLocal(item.transaction.occurredAt)}</span>
              </div>
              <div className="transaction-card-actions">
                {item.transaction.deletedAt ? (
                  <>
                    <button type="button" className="restore-btn icon-btn" title="恢复" onClick={() => void restoreRecord(item.transaction.id)}>
                      <RotateCcw size={16} />
                    </button>
                    <button type="button" className="danger-btn icon-btn" title="永久删除" onClick={() => void hardDeleteRecord(item.transaction.id)}>
                      <Trash2 size={16} />
                    </button>
                  </>
                ) : (
                  <>
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
                  </>
                )}
              </div>
            </div>
            <div className="transaction-card-amount-row">
              <strong className="transaction-card-amount">
                {formatMoney(item.amount.actualSettledAmountMinor ?? item.amount.settledAmountMinor, item.amount.settledCurrency)}
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
              <p>账户：{accountNameMap[item.transaction.fromAccountId] ?? '未知账户'} ｜ 分类：{item.transaction.categoryId ? (categoryNameMap[item.transaction.categoryId] ?? '未分类') : '-'}</p>
              {(item.amount.conversionFeeMode === 'rate' && (item.amount.conversionFeeRate ?? 0) > 0)
                || (item.amount.conversionFeeMode !== 'rate' && (item.amount.conversionFeeAmountMinor ?? 0) > 0)
                ? (
                  <p>
                    转换费：
                    {item.amount.conversionFeeMode === 'rate'
                      ? `${item.amount.conversionFeeRate}%`
                      : formatMoney(item.amount.conversionFeeAmountMinor, item.amount.conversionFeeCurrency ?? item.amount.settledCurrency)}
                  </p>
                ) : null}
              {(item.amount.serviceFeeMode === 'rate' && (item.amount.serviceFeeRate ?? 0) > 0)
                || (item.amount.serviceFeeMode !== 'rate' && (item.amount.serviceFeeAmountMinor ?? 0) > 0)
                ? (
                  <p>
                    手续费：
                    {item.amount.serviceFeeMode === 'rate'
                      ? `${item.amount.serviceFeeRate}%`
                      : formatMoney(item.amount.serviceFeeAmountMinor, item.amount.serviceFeeCurrency ?? item.amount.settledCurrency)}
                  </p>
                ) : null}
              {item.transaction.note ? <p>备注：{item.transaction.note}</p> : null}
            </div>
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
