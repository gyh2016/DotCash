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
  }
}
