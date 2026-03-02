import { useEffect, useState } from 'react';
import { Pie, PieChart, Cell, ResponsiveContainer } from 'recharts';
import { transactionsRepository } from '@/db/repositories/transactions.repository';
import { buildMonthlySummary } from '@/domain/stats/monthly';
import type { RecordWithAmount } from '@/domain/types';
import { PageCard } from '@/shared/components/PageCard';
import { formatMoney } from '@/shared/utils/money';

const COLORS = ['#1d4ed8', '#0f766e', '#ca8a04', '#dc2626', '#7c3aed'];

export const StatsPage = () => {
  const [records, setRecords] = useState<RecordWithAmount[]>([]);

  useEffect(() => {
    const load = async () => {
      const rows = (await transactionsRepository.listLatest(500)) as RecordWithAmount[];
      setRecords(rows);
    };

    void load();
  }, []);

  const summary = buildMonthlySummary(records);

  const pieData = [
    { name: '收入', value: summary.incomeMinor },
    { name: '支出', value: summary.expenseMinor },
  ].filter((item) => item.value > 0);

  return (
    <div className="stack">
      <PageCard>
        <h2>本月汇总</h2>
        <p>收入：{formatMoney(summary.incomeMinor)}</p>
        <p>支出：{formatMoney(summary.expenseMinor)}</p>
        <p>结余：{formatMoney(summary.netMinor)}</p>
      </PageCard>
      <PageCard>
        <h2>收入/支出占比</h2>
        <div style={{ width: '100%', height: 240 }}>
          <ResponsiveContainer>
            <PieChart>
              <Pie data={pieData} dataKey="value" nameKey="name" outerRadius={78} innerRadius={38}>
                {pieData.map((entry, idx) => (
                  <Cell key={entry.name} fill={COLORS[idx % COLORS.length]} />
                ))}
              </Pie>
            </PieChart>
          </ResponsiveContainer>
        </div>
      </PageCard>
    </div>
  );
};
