import Dexie, { type Table } from 'dexie';
import type { Account, Category, Transaction, TransactionAmount } from '@/domain/types';

export class DotCashDB extends Dexie {
  accounts!: Table<Account, string>;
  categories!: Table<Category, string>;
  transactions!: Table<Transaction, string>;
  transactionAmounts!: Table<TransactionAmount, string>;

  constructor() {
    super('dotcash-db');
    this.version(1).stores({
      accounts: 'id, name, isArchived, deletedAt',
      categories: 'id, kind, isSystem, isArchived, deletedAt',
      transactions: 'id, type, fromAccountId, toAccountId, categoryId, occurredAt, deletedAt',
      transactionAmounts: 'transactionId, settledCurrency, isEstimated',
    });

    this.version(2)
      .stores({
        accounts: 'id, name, isArchived, deletedAt',
        categories: 'id, kind, isSystem, isArchived, deletedAt',
        transactions: 'id, type, fromAccountId, toAccountId, categoryId, occurredAt, deletedAt',
        transactionAmounts: 'transactionId, settledCurrency, isEstimated',
      })
      .upgrade(async (tx) => {
        await tx.table('accounts').toCollection().modify((account: { allowOverdraft?: boolean }) => {
          if (typeof account.allowOverdraft !== 'boolean') {
            account.allowOverdraft = true;
          }
        });
      });

    this.version(3)
      .stores({
        accounts: 'id, name, deletedAt',
        categories: 'id, kind, isSystem, isArchived, deletedAt',
        transactions: 'id, type, fromAccountId, toAccountId, categoryId, occurredAt, deletedAt',
        transactionAmounts: 'transactionId, settledCurrency, isEstimated',
      })
      .upgrade(async (tx) => {
        await tx.table('accounts').toCollection().modify((account: {
          allowOverdraft?: boolean;
          initialBalanceMinor?: number;
          isArchived?: boolean;
          network?: string | null;
        }) => {
          if (typeof account.allowOverdraft !== 'boolean') {
            account.allowOverdraft = true;
          }
          if (typeof account.network === 'undefined') {
            account.network = null;
          }
          delete account.initialBalanceMinor;
          delete account.isArchived;
        });
      });

    this.version(4)
      .stores({
        accounts: 'id, name, deletedAt',
        categories: 'id, kind, isSystem, isArchived, deletedAt',
        transactions: 'id, type, fromAccountId, toAccountId, categoryId, occurredAt, deletedAt',
        transactionAmounts: 'transactionId, settledCurrency, isEstimated',
      })
      .upgrade(async (tx) => {
        await tx.table('accounts').toCollection().modify((account: {
          type?: string;
          network?: string | null;
        }) => {
          const isCard = account.type === 'debit_card' || account.type === 'credit_card';
          if (!isCard) {
            account.network = null;
            return;
          }
          if (!account.network) {
            account.network = 'unionpay';
          }
        });
      });

    this.version(5)
      .stores({
        accounts: 'id, name, deletedAt',
        categories: 'id, kind, isSystem, isArchived, deletedAt',
        transactions: 'id, type, fromAccountId, toAccountId, categoryId, occurredAt, deletedAt',
        transactionAmounts: 'transactionId, settledCurrency, isEstimated',
      })
      .upgrade(async (tx) => {
        await tx.table('transactionAmounts').toCollection().modify((amount: {
          settledCurrency?: string;
          cashbackAmountMinor?: number;
          cashbackCurrency?: string;
          discountAmountMinor?: number;
          discountCurrency?: string;
        }) => {
          if (typeof amount.cashbackAmountMinor !== 'number') {
            amount.cashbackAmountMinor = 0;
          }
          if (typeof amount.discountAmountMinor !== 'number') {
            amount.discountAmountMinor = 0;
          }
          if (!amount.cashbackCurrency) {
            amount.cashbackCurrency = amount.settledCurrency ?? 'CNY';
          }
          if (!amount.discountCurrency) {
            amount.discountCurrency = amount.settledCurrency ?? 'CNY';
          }
        });
      });

    this.version(6)
      .stores({
        accounts: 'id, name, deletedAt',
        categories: 'id, kind, isSystem, isArchived, deletedAt',
        transactions: 'id, type, fromAccountId, toAccountId, categoryId, occurredAt, deletedAt',
        transactionAmounts: 'transactionId, settledCurrency, isEstimated',
      })
      .upgrade(async (tx) => {
        await tx.table('transactionAmounts').toCollection().modify((amount: {
          settledCurrency?: string;
          conversionFeeMode?: 'fixed' | 'rate';
          conversionFeeAmountMinor?: number;
          conversionFeeRate?: number;
          conversionFeeCurrency?: string | null;
          serviceFeeMode?: 'fixed' | 'rate';
          serviceFeeAmountMinor?: number;
          serviceFeeRate?: number;
          serviceFeeCurrency?: string | null;
        }) => {
          if (!amount.conversionFeeMode) {
            amount.conversionFeeMode = 'fixed';
          }
          if (typeof amount.conversionFeeAmountMinor !== 'number') {
            amount.conversionFeeAmountMinor = 0;
          }
          if (typeof amount.conversionFeeRate !== 'number') {
            amount.conversionFeeRate = 0;
          }
          if (typeof amount.conversionFeeCurrency === 'undefined') {
            amount.conversionFeeCurrency = amount.settledCurrency ?? 'CNY';
          }
          if (!amount.serviceFeeMode) {
            amount.serviceFeeMode = 'fixed';
          }
          if (typeof amount.serviceFeeAmountMinor !== 'number') {
            amount.serviceFeeAmountMinor = 0;
          }
          if (typeof amount.serviceFeeRate !== 'number') {
            amount.serviceFeeRate = 0;
          }
          if (typeof amount.serviceFeeCurrency === 'undefined') {
            amount.serviceFeeCurrency = amount.settledCurrency ?? 'CNY';
          }
        });

        await tx.table('transactions').toCollection().modify((transaction: {
          type?: string;
          deletedAt?: string | null;
          updatedAt?: string;
        }) => {
          if (transaction.type === 'transfer') {
            const now = new Date().toISOString();
            transaction.deletedAt = transaction.deletedAt ?? now;
            transaction.updatedAt = now;
          }
        });
      });
  }
}
