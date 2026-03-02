import dayjs from 'dayjs';
import type { RecordWithAmount } from '@/domain/types';

export interface MonthlySummary {
  incomeMinor: number;
  expenseMinor: number;
  netMinor: number;
}

export const buildMonthlySummary = (records: RecordWithAmount[], reference = dayjs()): MonthlySummary => {
  const monthStart = reference.startOf('month');
  const monthEnd = reference.endOf('month');

  const summary = records.reduce(
    (acc, record) => {
      const occurred = dayjs(record.transaction.occurredAt);
      if (occurred.isBefore(monthStart) || occurred.isAfter(monthEnd)) return acc;

      const value = record.amount.actualSettledAmountMinor ?? record.amount.settledAmountMinor;
      if (record.transaction.type === 'income') acc.incomeMinor += value;
      if (record.transaction.type === 'expense') acc.expenseMinor += value;
      return acc;
    },
    { incomeMinor: 0, expenseMinor: 0, netMinor: 0 },
  );

  summary.netMinor = summary.incomeMinor - summary.expenseMinor;
  return summary;
};
