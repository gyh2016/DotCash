import type { RecordWithAmount } from '@/domain/types';

export const calculateAccountBalanceMinor = (
  accountId: string,
  records: RecordWithAmount[],
) => {
  return records.reduce((balance, record) => {
    const amount = record.amount.actualSettledAmountMinor ?? record.amount.settledAmountMinor;
    const { transaction } = record;
    if (transaction.deletedAt !== null) return balance;

    if (transaction.type === 'income' && transaction.fromAccountId === accountId) {
      return balance + amount;
    }

    if (transaction.type === 'expense' && transaction.fromAccountId === accountId) {
      return balance - amount;
    }

    return balance;
  }, 0);
};
