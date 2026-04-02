import type { AccountType, TransactionType } from '@/domain/types';

export const accountTypeLabelMap: Record<AccountType, string> = {
  cash: '现金',
  debit_card: '储蓄卡',
  credit_card: '信用卡',
  ewallet: '电子钱包',
  other: '其他',
};

export const transactionTypeLabelMap: Record<TransactionType, string> = {
  income: '收入',
  expense: '支出',
};
