import { create } from 'zustand';
import { api, isAuthSessionChangedError } from '../lib/api';
import { usePositionsStore } from './usePositions';
import type { Account } from '../types/trading';
import type { UserStats } from '../types/user';


interface AccountState {
  account: Account | null;
  stats: UserStats | null;
  isLoading: boolean;
  isResetting: boolean;
  error: string | null;

  fetchAccount: () => Promise<void>;
  fetchStats: () => Promise<void>;
  resetAccount: () => Promise<void>;
  updateBalance: (balance: number) => void;
  clear: () => void;
}

let accountGeneration = 0;

export const useAccountStore = create<AccountState>((set, get) => ({
  account: null,
  stats: null,
  isLoading: false,
  isResetting: false,
  error: null,

  fetchAccount: async () => {
    const generation = accountGeneration;
    set({ isLoading: true, error: null });
    try {
      const account = await api.getAccount();
      if (generation !== accountGeneration) return;
      set({ account, isLoading: false });
    } catch (error) {
      if (isAuthSessionChangedError(error) || generation !== accountGeneration) return;
      set({
        account: null,
        error: error instanceof Error ? error.message : 'Failed to fetch account',
        isLoading: false,
      });
    }
  },

  fetchStats: async () => {
    const generation = accountGeneration;
    try {
      const stats = await api.getUserStats();
      if (generation !== accountGeneration) return;
      set({ stats });
    } catch (error) {
      if (isAuthSessionChangedError(error) || generation !== accountGeneration) return;
      console.error('Failed to fetch stats:', error);
      set({ stats: null });
    }
  },

  resetAccount: async () => {
    const generation = ++accountGeneration;
    set({ isResetting: true, error: null });
    try {
      const account = await api.resetAccount();
      if (generation !== accountGeneration) return;
      // A reset closes the account's positions server-side and starts a new
      // trading generation. Drop both visible positions and any retained
      // idempotency keys from the previous generation before new orders resume.
      usePositionsStore.getState().clear();
      set({ 
        account, 
        isResetting: false,
        stats: {
          totalPnl: 0,
          totalPnlPercent: 0,
          winRate: 0,
          maxDrawdown: 0,
          tradeCount: 0,
          winningTrades: 0,
          losingTrades: 0,
          bestTrade: 0,
          worstTrade: 0,
          averageTrade: 0,
          averageWin: 0,
          averageLoss: 0,
          profitFactor: 0,
        }
      });
    } catch (error) {
      if (isAuthSessionChangedError(error)) throw error;
      if (generation !== accountGeneration) return;
      set({
        error: error instanceof Error ? error.message : 'Failed to reset account',
        isResetting: false,
      });
      throw error;
    }
  },

  updateBalance: (balance) => {
    const { account } = get();
    if (account) {
      set({ account: { ...account, balance } });
    }
  },

  clear: () => {
    accountGeneration += 1;
    set({
      account: null,
      stats: null,
      isLoading: false,
      isResetting: false,
      error: null,
    });
  },
}));

export function useAccount() {
  return useAccountStore();
}
