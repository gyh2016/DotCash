import { useEffect, useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { accountsRepository } from '@/db/repositories/accounts.repository';
import { transactionsRepository } from '@/db/repositories/transactions.repository';
import { calculateAccountBalanceMinor } from '@/domain/accounts/balance';
import type { Account, AccountNetwork, AccountType, RecordWithAmount } from '@/domain/types';
import { CURRENCY_OPTIONS, formatCurrencyLabel } from '@/shared/constants/currencies';
import { accountTypeLabelMap } from '@/shared/constants/labels';
import { PageCard } from '@/shared/components/PageCard';
import { formatMoney } from '@/shared/utils/money';

interface AccountCreateFormValues {
  name: string;
  type: AccountType;
  baseCurrency: string;
  allowedCurrencies: string[];
  network: AccountNetwork | '';
  allowOverdraft: boolean;
}

interface AccountEditFormValues {
  name: string;
  type: AccountType;
  network: AccountNetwork | '';
  allowOverdraft: boolean;
}

const ACCOUNT_CREATE_DEFAULTS: AccountCreateFormValues = {
  name: '',
  type: 'debit_card',
  baseCurrency: 'CNY',
  allowedCurrencies: ['CNY'],
  network: 'unionpay',
  allowOverdraft: true,
};

const NETWORK_OPTIONS: Array<{ value: AccountNetwork; label: string }> = [
  { value: 'unionpay', label: '银联' },
  { value: 'visa', label: 'VISA' },
  { value: 'mastercard', label: 'Mastercard' },
  { value: 'jcb', label: 'JCB' },
  { value: 'amex', label: 'AE' },
];
const NETWORK_LOGO_URL: Record<AccountNetwork, string> = {
  unionpay: 'https://cdn.simpleicons.org/chinaunionpay/CC0000',
  visa: 'https://cdn.simpleicons.org/visa/1A1F71',
  mastercard: 'https://cdn.simpleicons.org/mastercard/EB001B',
  jcb: 'https://cdn.simpleicons.org/jcb/0B4EA2',
  amex: 'https://cdn.simpleicons.org/americanexpress/2E77BC',
};

const isCardType = (type: AccountType) => type === 'debit_card' || type === 'credit_card';

const normalizeName = (name: string) => name.trim().toLowerCase();

export const AccountsPage = () => {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [records, setRecords] = useState<RecordWithAmount[]>([]);
  const [currencyQuery, setCurrencyQuery] = useState('');
  const [currencyDropdownOpen, setCurrencyDropdownOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [editingAccountId, setEditingAccountId] = useState<string | null>(null);
  const [createError, setCreateError] = useState('');
  const [editError, setEditError] = useState('');
  const [viewMode, setViewMode] = useState<'cards' | 'table'>('cards');
  const [savingCreate, setSavingCreate] = useState(false);
  const [savingEdit, setSavingEdit] = useState(false);

  const {
    register: registerCreate,
    handleSubmit: handleCreateSubmit,
    reset: resetCreate,
    watch: watchCreate,
    setValue: setCreateValue,
  } = useForm<AccountCreateFormValues>({
    defaultValues: ACCOUNT_CREATE_DEFAULTS,
  });

  const {
    register: registerEdit,
    handleSubmit: handleEditSubmit,
    reset: resetEdit,
    watch: watchEdit,
    setValue: setEditValue,
  } = useForm<AccountEditFormValues>({
    defaultValues: {
      name: '',
      type: 'debit_card',
      network: 'unionpay',
      allowOverdraft: true,
    },
  });

  const createBaseCurrency = watchCreate('baseCurrency');
  const createSelectedCurrencies = watchCreate('allowedCurrencies');
  const createType = watchCreate('type');
  const createNetwork = watchCreate('network');
  const editType = watchEdit('type');
  const editNetwork = watchEdit('network');
  const editAllowOverdraft = watchEdit('allowOverdraft');

  const editingAccount = useMemo(
    () => accounts.find((account) => account.id === editingAccountId) ?? null,
    [accounts, editingAccountId],
  );

  const accountRows = useMemo(() => {
    return accounts.map((account) => {
      const currentBalanceMinor = calculateAccountBalanceMinor(account.id, records);
      return { account, currentBalanceMinor, isOverdrawn: currentBalanceMinor < 0 };
    });
  }, [accounts, records]);

  const editingAccountRow = useMemo(
    () => accountRows.find((row) => row.account.id === editingAccountId) ?? null,
    [accountRows, editingAccountId],
  );

  const isEditingOverdrawn = !!editingAccountRow?.isOverdrawn;
  const isEditOverdraftCloseBlocked =
    !!editingAccount &&
    isEditingOverdrawn &&
    (editingAccount.allowOverdraft ?? true) &&
    !editAllowOverdraft;

  const filteredCurrencyOptions = useMemo(() => {
    const keyword = currencyQuery.trim().toLowerCase();
    if (!keyword) return CURRENCY_OPTIONS;
    return CURRENCY_OPTIONS.filter((item) => {
      const label = `${item.code} ${item.nameZh}`.toLowerCase();
      return label.includes(keyword);
    });
  }, [currencyQuery]);

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

  useEffect(() => {
    if (!isCardType(createType)) {
      setCreateValue('network', '');
      return;
    }
    if (!createNetwork) {
      setCreateValue('network', 'unionpay');
    }
  }, [createType, createNetwork, setCreateValue]);

  useEffect(() => {
    if (!isCardType(editType)) {
      setEditValue('network', '');
      return;
    }
    if (!editNetwork) {
      setEditValue('network', 'unionpay');
    }
  }, [editType, editNetwork, setEditValue]);

  useEffect(() => {
    const exists = createSelectedCurrencies.includes(createBaseCurrency);
    if (!exists) {
      setCreateValue('allowedCurrencies', [createBaseCurrency, ...createSelectedCurrencies]);
    }
  }, [createBaseCurrency, createSelectedCurrencies, setCreateValue]);

  const toggleCurrency = (currency: string) => {
    if (currency === createBaseCurrency) return;
    if (createSelectedCurrencies.includes(currency)) {
      setCreateValue(
        'allowedCurrencies',
        createSelectedCurrencies.filter((item) => item !== currency),
      );
      return;
    }
    setCreateValue('allowedCurrencies', [...createSelectedCurrencies, currency]);
  };

  const hasDuplicateName = (name: string, options?: { excludeId?: string }) => {
    const normalized = normalizeName(name);
    return accounts.some((account) => {
      if (options?.excludeId && account.id === options.excludeId) return false;
      return normalizeName(account.name) === normalized;
    });
  };

  const openCreateModal = () => {
    setCreateOpen(true);
    setCreateError('');
    setCurrencyDropdownOpen(false);
    setCurrencyQuery('');
    resetCreate(ACCOUNT_CREATE_DEFAULTS);
  };

  const closeCreateModal = () => {
    setCreateOpen(false);
    setCreateError('');
    setCurrencyDropdownOpen(false);
    setCurrencyQuery('');
    resetCreate(ACCOUNT_CREATE_DEFAULTS);
  };

  const openEditModal = (account: Account) => {
    setEditingAccountId(account.id);
    setEditError('');
    resetEdit({
      name: account.name,
      type: account.type,
      network: account.network ?? '',
      allowOverdraft: account.allowOverdraft ?? true,
    });
  };

  const closeEditModal = () => {
    setEditingAccountId(null);
    setEditError('');
  };

  const onSubmitCreate = handleCreateSubmit(async (values) => {
    const trimmedName = values.name.trim();
    if (!trimmedName) {
      setCreateError('账户名称不能为空。');
      return;
    }
    if (hasDuplicateName(trimmedName)) {
      setCreateError('账户名称不能重复。');
      return;
    }
    if (isCardType(values.type) && !values.network) {
      setCreateError('信用卡和储蓄卡必须选择卡组织。');
      return;
    }

    setSavingCreate(true);
    try {
      const latestAccounts = await accountsRepository.listActive();
      const latestDuplicate = latestAccounts.some((account) => normalizeName(account.name) === normalizeName(trimmedName));
      if (latestDuplicate) {
        setCreateError('账户名称不能重复。');
        return;
      }

      const uniqueAllowed = Array.from(new Set([values.baseCurrency, ...values.allowedCurrencies]));
      await accountsRepository.create({
        name: trimmedName,
        type: values.type,
        baseCurrency: values.baseCurrency,
        allowedCurrencies: uniqueAllowed,
        network: isCardType(values.type) ? (values.network as AccountNetwork) : null,
        allowOverdraft: values.allowOverdraft,
      });

      closeCreateModal();
      await loadData();
    } finally {
      setSavingCreate(false);
    }
  });

  const onSubmitEdit = handleEditSubmit(async (values) => {
    if (!editingAccount) return;
    const trimmedName = values.name.trim();
    if (!trimmedName) {
      setEditError('账户名称不能为空。');
      return;
    }
    if (hasDuplicateName(trimmedName, { excludeId: editingAccount.id })) {
      setEditError('账户名称不能重复。');
      return;
    }
    if (isCardType(values.type) && !values.network) {
      setEditError('信用卡和储蓄卡必须选择卡组织。');
      return;
    }
    if (isEditingOverdrawn && (editingAccount.allowOverdraft ?? true) && !values.allowOverdraft) {
      setEditError('当前账户余额为负，不允许关闭透支开关。');
      return;
    }

    setSavingEdit(true);
    try {
      const [latestAccounts, latestRecords] = await Promise.all([
        accountsRepository.listActive(),
        transactionsRepository.listAll(),
      ]);
      const latestAccount = latestAccounts.find((item) => item.id === editingAccount.id);
      if (!latestAccount) {
        setEditError('账户不存在或已被删除。');
        return;
      }
      const latestDuplicate = latestAccounts.some(
        (account) => account.id !== latestAccount.id && normalizeName(account.name) === normalizeName(trimmedName),
      );
      if (latestDuplicate) {
        setEditError('账户名称不能重复。');
        return;
      }
      const latestBalanceMinor = calculateAccountBalanceMinor(latestAccount.id, latestRecords as RecordWithAmount[]);
      if (latestBalanceMinor < 0 && (latestAccount.allowOverdraft ?? true) && !values.allowOverdraft) {
        setEditError('当前账户余额为负，不允许关闭透支开关。');
        return;
      }

      await accountsRepository.update(latestAccount.id, {
        name: trimmedName,
        type: values.type,
        network: isCardType(values.type) ? (values.network as AccountNetwork) : null,
        allowOverdraft: values.allowOverdraft,
      });

      closeEditModal();
      await loadData();
    } finally {
      setSavingEdit(false);
    }
  });

  return (
    <PageCard className="accounts-shell">
      <div className="accounts-page">
        <section className="accounts-toolbar">
          <h2>账户列表</h2>
          <div className="accounts-toolbar-actions">
            <div className="fx-segmented desktop-only" role="radiogroup" aria-label="账户列表视图">
              <button
                type="button"
                className={viewMode === 'cards' ? 'fx-option active' : 'fx-option'}
                onClick={() => setViewMode('cards')}
              >
                卡片
              </button>
              <button
                type="button"
                className={viewMode === 'table' ? 'fx-option active' : 'fx-option'}
                onClick={() => setViewMode('table')}
              >
                表格
              </button>
            </div>
            <button type="button" className="create-account-btn" onClick={openCreateModal}>
              + 新建账户
            </button>
          </div>
        </section>

        <div className={`table-wrap accounts-desktop-table ${viewMode === 'table' ? 'desktop-show-table' : 'desktop-hide-table'}`}>
          <table className="records-table">
            <thead>
              <tr>
                <th>账户名称</th>
                <th>类型</th>
                <th>默认币种</th>
                <th>支持币种</th>
                <th>透支</th>
                <th>当前余额</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {accountRows.map(({ account, currentBalanceMinor }) => (
                <tr key={account.id}>
                  <td>{account.name}</td>
                  <td>{accountTypeLabelMap[account.type]}</td>
                  <td>{formatCurrencyLabel(account.baseCurrency)}</td>
                  <td>{(account.allowedCurrencies ?? [account.baseCurrency]).map((item) => formatCurrencyLabel(item)).join('、')}</td>
                  <td>{(account.allowOverdraft ?? true) ? '允许' : '不允许'}</td>
                  <td>{formatMoney(currentBalanceMinor, account.baseCurrency)}</td>
                  <td>
                    <button type="button" className="ghost-btn" onClick={() => openEditModal(account)}>
                      编辑
                    </button>
                  </td>
                </tr>
              ))}
              {accountRows.length === 0 ? (
                <tr>
                  <td colSpan={7} className="table-empty">还没有账户，先创建一个。</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>

        <ul className={`accounts-card-grid ${viewMode === 'cards' ? 'desktop-show-cards' : 'desktop-hide-cards'}`}>
          {accountRows.map(({ account, currentBalanceMinor }) => (
            <li key={`card-${account.id}`} className="account-credit-card">
              <div className="account-card-top">
                <strong className="account-card-name">{account.name}</strong>
                <span className="account-card-type">{accountTypeLabelMap[account.type]}</span>
              </div>
              <p className="account-card-balance">{formatMoney(currentBalanceMinor, account.baseCurrency)}</p>
              <div className="account-card-meta">
                <p>默认币种：{formatCurrencyLabel(account.baseCurrency)}</p>
                <p
                  className="account-supported-currencies"
                  title={(account.allowedCurrencies ?? [account.baseCurrency]).map((item) => formatCurrencyLabel(item)).join('、')}
                >
                  支持币种：{(account.allowedCurrencies ?? [account.baseCurrency]).map((item) => formatCurrencyLabel(item)).join('、')}
                </p>
                <p>透支：{(account.allowOverdraft ?? true) ? '允许' : '不允许'}</p>
              </div>
              {isCardType(account.type) && account.network ? (
                <div className="account-network-logo">
                  <img
                    className="network-logo-image"
                    src={NETWORK_LOGO_URL[account.network]}
                    alt={`${account.network} logo`}
                    loading="lazy"
                  />
                </div>
              ) : null}
              <button
                type="button"
                className="account-edit-icon"
                aria-label={`编辑${account.name}`}
                title="编辑"
                onClick={() => openEditModal(account)}
              >
                ✎
              </button>
            </li>
          ))}
          {accountRows.length === 0 ? <li className="account-empty-card">还没有账户，先创建一个。</li> : null}
        </ul>
      </div>

      {createOpen ? (
        <div className="modal-overlay" onClick={closeCreateModal}>
          <section className="modal-card" onClick={(event) => event.stopPropagation()}>
            <h3>新建账户</h3>
            <form className="record-form" onSubmit={onSubmitCreate}>
              <section className="form-section">
                <h3>基础信息</h3>
                <div className="form-grid">
                  <label>
                    名称
                    <input required {...registerCreate('name')} placeholder="例如：招商银行储蓄卡" />
                  </label>
                  <label>
                    类型
                    <select {...registerCreate('type')}>
                      <option value="cash">现金</option>
                      <option value="debit_card">储蓄卡</option>
                      <option value="credit_card">信用卡</option>
                      <option value="ewallet">电子钱包</option>
                      <option value="other">其他</option>
                    </select>
                  </label>
                  {isCardType(createType) ? (
                    <label>
                      卡组织
                      <select {...registerCreate('network')}>
                        {NETWORK_OPTIONS.map((network) => (
                          <option key={network.value} value={network.value}>
                            {network.label}
                          </option>
                        ))}
                      </select>
                    </label>
                  ) : null}
                  <label>
                    默认入账币种
                    <select {...registerCreate('baseCurrency')}>
                      {CURRENCY_OPTIONS.map((currency) => (
                        <option key={currency.code} value={currency.code}>
                          {formatCurrencyLabel(currency.code)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="inline-check">
                    <input type="checkbox" {...registerCreate('allowOverdraft')} />
                    <span>允许透支</span>
                  </label>
                </div>
              </section>

              <section className="form-section">
                <h3>入账币种设置</h3>
                <div className="multi-select-wrap">
                  <span className="multi-title">支持的入账币种（可搜索多选）</span>
                  <button
                    type="button"
                    className="select-trigger"
                    onClick={() => setCurrencyDropdownOpen((current) => !current)}
                  >
                    {createSelectedCurrencies.length > 0
                      ? createSelectedCurrencies.map((item) => formatCurrencyLabel(item)).join('、')
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
                                checked={createSelectedCurrencies.includes(currency.code)}
                                onChange={() => toggleCurrency(currency.code)}
                                disabled={currency.code === createBaseCurrency}
                              />
                              <span>
                                {formatCurrencyLabel(currency.code)}
                                {currency.code === createBaseCurrency ? '（默认）' : ''}
                              </span>
                            </label>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                </div>
              </section>

              {createError ? <p className="error-text">{createError}</p> : null}
              <div className="record-actions-row">
                <button type="button" className="ghost-btn" onClick={closeCreateModal}>
                  取消
                </button>
                <button type="submit" disabled={savingCreate}>
                  {savingCreate ? '保存中...' : '保存账户'}
                </button>
              </div>
            </form>
          </section>
        </div>
      ) : null}

      {editingAccount ? (
        <div className="modal-overlay" onClick={closeEditModal}>
          <section className="modal-card" onClick={(event) => event.stopPropagation()}>
            <h3>编辑账户</h3>
            <form className="record-form" onSubmit={onSubmitEdit}>
              <section className="form-section">
                <h3>基础信息</h3>
                <div className="form-grid">
                  <label>
                    名称
                    <input required {...registerEdit('name')} />
                  </label>
                  <label>
                    类型
                    <select {...registerEdit('type')}>
                      <option value="cash">现金</option>
                      <option value="debit_card">储蓄卡</option>
                      <option value="credit_card">信用卡</option>
                      <option value="ewallet">电子钱包</option>
                      <option value="other">其他</option>
                    </select>
                  </label>
                  {isCardType(editType) ? (
                    <label>
                      卡组织
                      <select {...registerEdit('network')}>
                        {NETWORK_OPTIONS.map((network) => (
                          <option key={network.value} value={network.value}>
                            {network.label}
                          </option>
                        ))}
                      </select>
                    </label>
                  ) : null}
                  <label className="inline-check">
                    <input type="checkbox" {...registerEdit('allowOverdraft')} disabled={isEditOverdraftCloseBlocked} />
                    <span>允许透支</span>
                  </label>
                </div>
                <p className="hint">当前余额：{formatMoney(editingAccountRow?.currentBalanceMinor ?? 0, editingAccount.baseCurrency)}</p>
                {isEditOverdraftCloseBlocked ? <p className="error-text">当前账户余额为负，不允许关闭透支开关。</p> : null}
              </section>
              {editError ? <p className="error-text">{editError}</p> : null}
              <div className="record-actions-row">
                <button type="button" className="ghost-btn" onClick={closeEditModal}>
                  取消
                </button>
                <button type="submit" disabled={savingEdit || isEditOverdraftCloseBlocked}>
                  {savingEdit ? '保存中...' : '保存修改'}
                </button>
              </div>
            </form>
          </section>
        </div>
      ) : null}
    </PageCard>
  );
};
