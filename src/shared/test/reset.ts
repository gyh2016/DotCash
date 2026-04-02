import { db } from '@/db';
import { seedDefaults } from '@/db/seed';

declare global {
  interface Window {
    __DOTCASH_E2E__?: {
      resetDatabase: () => Promise<void>;
    };
  }
}

export const attachE2EReset = () => {
  if (!import.meta.env.DEV && !import.meta.env.MODE.includes('test')) return;

  window.__DOTCASH_E2E__ = {
    resetDatabase: async () => {
      await db.transaction('rw', db.transactionAmounts, db.transactions, db.accounts, db.categories, async () => {
        await db.transactionAmounts.clear();
        await db.transactions.clear();
        await db.accounts.clear();
        await db.categories.clear();
      });
      await seedDefaults();
    },
  };
};
