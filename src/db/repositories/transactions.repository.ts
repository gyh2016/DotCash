import { db } from '@/db';
import type { Transaction, TransactionAmount, TransactionType } from '@/domain/types';
import { newTransactionId } from '@/shared/utils/id';

export interface CreateTransactionInput {
  type: TransactionType;
  fromAccountId: string;
  toAccountId: string | null;
  categoryId: string | null;
  note: string | null;
  occurredAt: string;
  amount: Omit<TransactionAmount, 'transactionId'>;
}

export interface UpdateTransactionInput {
  type: TransactionType;
  fromAccountId: string;
  toAccountId: string | null;
  categoryId: string | null;
  note: string | null;
  occurredAt: string;
  amount: Omit<TransactionAmount, 'transactionId'>;
}

export const transactionsRepository = {
  async listLatest(limit = 50) {
    const rows = await db.transactions.filter((item) => item.deletedAt === null).sortBy('occurredAt');
    const latest = rows.reverse().slice(0, limit);
    return Promise.all(
      latest.map(async (tx) => {
        const amount = await db.transactionAmounts.get(tx.id);
        return amount ? { transaction: tx, amount } : null;
      }),
    ).then((items) => items.filter((item): item is { transaction: Transaction; amount: TransactionAmount } => item !== null));
  },

  async listAll(options?: { includeDeleted?: boolean }) {
    const includeDeleted = options?.includeDeleted ?? false;
    const rows = await db.transactions
      .filter((item) => (includeDeleted ? true : item.deletedAt === null))
      .sortBy('occurredAt');
    return Promise.all(
      rows.map(async (tx) => {
        const amount = await db.transactionAmounts.get(tx.id);
        return amount ? { transaction: tx, amount } : null;
      }),
    ).then((items) => items.filter((item): item is { transaction: Transaction; amount: TransactionAmount } => item !== null));
  },

  async create(input: CreateTransactionInput) {
    const now = new Date().toISOString();
    const transaction: Transaction = {
      id: newTransactionId(),
      type: input.type,
      fromAccountId: input.fromAccountId,
      toAccountId: input.toAccountId,
      categoryId: input.categoryId,
      note: input.note,
      occurredAt: input.occurredAt,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    };

    const amount: TransactionAmount = {
      transactionId: transaction.id,
      ...input.amount,
    };

    await db.transaction('rw', db.transactions, db.transactionAmounts, async () => {
      await db.transactions.add(transaction);
      await db.transactionAmounts.add(amount);
    });

    return { transaction, amount };
  },

  async update(transactionId: string, input: UpdateTransactionInput) {
    const now = new Date().toISOString();

    await db.transaction('rw', db.transactions, db.transactionAmounts, async () => {
      await db.transactions.update(transactionId, {
        type: input.type,
        fromAccountId: input.fromAccountId,
        toAccountId: input.toAccountId,
        categoryId: input.categoryId,
        note: input.note,
        occurredAt: input.occurredAt,
        updatedAt: now,
      });

      await db.transactionAmounts.put({
        transactionId,
        ...input.amount,
      });
    });
  },

  async softDelete(transactionId: string) {
    const now = new Date().toISOString();
    await db.transactions.update(transactionId, {
      deletedAt: now,
      updatedAt: now,
    });
  },

  async restore(transactionId: string) {
    const now = new Date().toISOString();
    await db.transactions.update(transactionId, {
      deletedAt: null,
      updatedAt: now,
    });
  },

  async hardDelete(transactionId: string) {
    await db.transaction('rw', db.transactions, db.transactionAmounts, async () => {
      await db.transactionAmounts.delete(transactionId);
      await db.transactions.delete(transactionId);
    });
  },
};
