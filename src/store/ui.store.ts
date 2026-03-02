import { create } from 'zustand';

export type MainTab = 'home' | 'records' | 'create' | 'accounts' | 'stats';

interface UiStore {
  tab: MainTab;
  setTab: (tab: MainTab) => void;
}

export const useUiStore = create<UiStore>((set) => ({
  tab: 'home',
  setTab: (tab) => set({ tab }),
}));
