import { db } from '@/db';
import type { Account } from '@/domain/types';
import { newId } from '@/shared/utils/id';

export interface CreateAccountInput {
  name: string;
  type: Account['type'];
  baseCurrency: string;
  initialBalanceMinor: number;
  allowedCurrencies: string[];
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
      isArchived: false,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    };

    await db.accounts.add(account);
    return account;
  },
};
