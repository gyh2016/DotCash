export type AccountType = 'cash' | 'debit_card' | 'credit_card' | 'ewallet' | 'other';
export type AccountNetwork = 'unionpay' | 'visa' | 'mastercard' | 'jcb' | 'amex' | 'other';
export type TransactionType = 'income' | 'expense' | 'transfer';
export type CategoryKind = 'income' | 'expense';
export type FxSource = 'api' | 'manual';

export interface Account {
  id: string;
  name: string;
  type: AccountType;
  baseCurrency: string;
  allowedCurrencies: string[];
  network: AccountNetwork | null;
  allowOverdraft: boolean;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface Category {
  id: string;
  name: string;
  kind: CategoryKind;
  isSystem: boolean;
  isArchived: boolean;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface Transaction {
  id: string;
  type: TransactionType;
  fromAccountId: string;
  toAccountId: string | null;
  categoryId: string | null;
  note: string | null;
  occurredAt: string;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface TransactionAmount {
  transactionId: string;
  originalAmountMinor: number;
  originalCurrency: string;
  settledAmountMinor: number;
  settledCurrency: string;
  cashbackAmountMinor: number;
  cashbackCurrency: string;
  discountAmountMinor: number;
  discountCurrency: string;
  actualSettledAmountMinor: number | null;
  isEstimated: boolean;
  fxRate: number | null;
  fxSource: FxSource | null;
  fxProvider: string | null;
  fxTimestamp: string | null;
}

export interface RecordWithAmount {
  transaction: Transaction;
  amount: TransactionAmount;
}
