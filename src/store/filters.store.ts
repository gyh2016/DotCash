import { create } from 'zustand';

interface FiltersState {
  accountId: string | null;
  setAccountId: (accountId: string | null) => void;
}

export const useFiltersStore = create<FiltersState>((set) => ({
  accountId: null,
  setAccountId: (accountId) => set({ accountId }),
}));
