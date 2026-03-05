import { db } from '@/db';
import type { Account } from '@/domain/types';
import { newAccountId } from '@/shared/utils/id';

export interface CreateAccountInput {
  name: string;
  type: Account['type'];
  baseCurrency: string;
  allowedCurrencies: string[];
  network: Account['network'];
  allowOverdraft: boolean;
}

export interface UpdateAccountInput {
  name: string;
  type: Account['type'];
  network: Account['network'];
  allowOverdraft: boolean;
}

export const accountsRepository = {
  async listAll() {
    return db.accounts.toArray();
  },

  async listActive() {
    return db.accounts.filter((item) => item.deletedAt === null).toArray();
  },

  async create(input: CreateAccountInput) {
    const now = new Date().toISOString();
    const account: Account = {
      id: newAccountId(),
      ...input,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    };

    await db.accounts.add(account);
    return account;
  },

  async update(accountId: string, input: UpdateAccountInput) {
    const now = new Date().toISOString();
    await db.accounts.update(accountId, {
      ...input,
      updatedAt: now,
    });
  },

  async softDelete(accountId: string) {
    const now = new Date().toISOString();
    await db.transaction('rw', db.accounts, db.transactions, async () => {
      await db.accounts.update(accountId, {
        deletedAt: now,
        updatedAt: now,
      });
      await db.transactions
        .filter((tx) => tx.fromAccountId === accountId || tx.toAccountId === accountId)
        .modify((tx) => {
          tx.deletedAt = now;
          tx.updatedAt = now;
        });
    });
  },

  async restore(accountId: string) {
    const now = new Date().toISOString();
    await db.transaction('rw', db.accounts, db.transactions, async () => {
      await db.accounts.update(accountId, {
        deletedAt: null,
        updatedAt: now,
      });
      await db.transactions
        .filter((tx) => tx.fromAccountId === accountId || tx.toAccountId === accountId)
        .modify((tx) => {
          tx.deletedAt = null;
          tx.updatedAt = now;
        });
    });
  },
};
