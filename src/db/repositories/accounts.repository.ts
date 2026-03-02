import { db } from '@/db';
import type { Account } from '@/domain/types';
import { newId } from '@/shared/utils/id';

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
  async listActive() {
    return db.accounts.filter((item) => item.deletedAt === null).toArray();
  },

  async create(input: CreateAccountInput) {
    const now = new Date().toISOString();
    const account: Account = {
      id: newId(),
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
};
