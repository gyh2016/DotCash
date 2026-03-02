import type { RecordWithAmount } from '@/domain/types';

export const calculateAccountBalanceMinor = (
  initialBalanceMinor: number,
  accountId: string,
  records: RecordWithAmount[],
) => {
  return records.reduce((balance, record) => {
    const amount = record.amount.actualSettledAmountMinor ?? record.amount.settledAmountMinor;
    const { transaction } = record;

    if (transaction.type === 'income' && transaction.fromAccountId === accountId) {
      return balance + amount;
    }

    if (transaction.type === 'expense' && transaction.fromAccountId === accountId) {
      return balance - amount;
    }

    if (transaction.type === 'transfer') {
      if (transaction.fromAccountId === accountId) return balance - amount;
      if (transaction.toAccountId === accountId) return balance + amount;
    }

    return balance;
  }, initialBalanceMinor);
};
