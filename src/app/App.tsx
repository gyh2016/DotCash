import { useEffect } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { seedDefaults } from '@/db/seed';
import { AccountsPage } from '@/features/accounts/AccountsPage';
import { CategoriesPage } from '@/features/categories/CategoriesPage';
import { SettingsPage } from '@/features/settings/SettingsPage';
import { HomePage } from '@/features/stats/HomePage';
import { StatsPage } from '@/features/stats/StatsPage';
import { CreateRecordPage } from '@/features/transactions/CreateRecordPage';
import { RecordsPage } from '@/features/transactions/RecordsPage';
import { Layout } from '@/shared/components/Layout';

export const App = () => {
  useEffect(() => {
    void seedDefaults();
  }, []);

  return (
    <Layout>
      <Routes>
        <Route path="/" element={<Navigate to="/home" replace />} />
        <Route path="/home" element={<HomePage />} />
        <Route path="/records" element={<RecordsPage />} />
        <Route path="/create" element={<CreateRecordPage />} />
        <Route path="/accounts" element={<AccountsPage />} />
        <Route path="/stats" element={<StatsPage />} />
        <Route path="/categories" element={<CategoriesPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="*" element={<Navigate to="/home" replace />} />
      </Routes>
    </Layout>
  );
};
