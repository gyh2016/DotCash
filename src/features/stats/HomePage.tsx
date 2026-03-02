import { useEffect, useState } from 'react';
import { transactionsRepository } from '@/db/repositories/transactions.repository';
import { buildMonthlySummary } from '@/domain/stats/monthly';
import type { RecordWithAmount } from '@/domain/types';
import { PageCard } from '@/shared/components/PageCard';
import { formatMoney } from '@/shared/utils/money';

export const HomePage = () => {
  const [records, setRecords] = useState<RecordWithAmount[]>([]);

  useEffect(() => {
    const load = async () => {
      const rows = (await transactionsRepository.listLatest(200)) as RecordWithAmount[];
      setRecords(rows);
    };
    void load();
  }, []);

  const summary = buildMonthlySummary(records);

  return (
    <div className="stack">
      <PageCard>
        <h2>本月总览</h2>
        <p>收入：{formatMoney(summary.incomeMinor)}</p>
        <p>支出：{formatMoney(summary.expenseMinor)}</p>
        <p>结余：{formatMoney(summary.netMinor)}</p>
      </PageCard>
    </div>
  );
};
