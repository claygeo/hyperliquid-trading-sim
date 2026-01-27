import { create } from 'zustand';
import { api } from '../lib/api';
import type { Account } from '../types/trading';
import type { UserStats } from '../types/user';
import { TRADING_CONSTANTS } from '../config/constants';

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
}

export const useAccountStore = create<AccountState>((set, get) => ({
  account: null,
  stats: null,
  isLoading: false,
  isResetting: false,
  error: null,

  fetchAccount: async () => {
    set({ isLoading: true, error: null });
    try {
      const account = await api.getAccount();
      set({ account, isLoading: false });
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Failed to fetch account',
        isLoading: false,
      });
    }
  },

  fetchStats: async () => {
    try {
      const stats = await api.getUserStats();
      set({ stats });
    } catch (error) {
      console.error('Failed to fetch stats:', error);
    }
  },

  resetAccount: async () => {
    set({ isResetting: true, error: null });
    try {
      const account = await api.resetAccount();
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
}));

export function useAccount() {
  return useAccountStore();
}
