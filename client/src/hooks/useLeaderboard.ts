import { create } from 'zustand';
import { api } from '../lib/api';
import type { LeaderboardEntry } from '../types/user';

interface LeaderboardState {
  entries: LeaderboardEntry[];
  period: 'daily' | 'alltime';
  total: number;
  page: number;
  pageSize: number;
  isLoading: boolean;
  error: string | null;

  fetchLeaderboard: (page?: number) => Promise<void>;
  setPeriod: (period: 'daily' | 'alltime') => void;
  nextPage: () => void;
  prevPage: () => void;
}

export const useLeaderboardStore = create<LeaderboardState>((set, get) => ({
  entries: [],
  period: 'alltime',
  total: 0,
  page: 1,
  pageSize: 20,
  isLoading: false,
  error: null,

  fetchLeaderboard: async (page) => {
    const { period, pageSize } = get();
    const currentPage = page ?? get().page;
    const offset = (currentPage - 1) * pageSize;

    set({ isLoading: true, error: null });
    try {
      const { entries, total } = await api.getLeaderboard(period, pageSize, offset);
      set({ entries, total, page: currentPage, isLoading: false });
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Failed to fetch leaderboard',
        isLoading: false,
      });
    }
  },

  setPeriod: (period) => {
    set({ period, page: 1 });
    get().fetchLeaderboard(1);
  },

  nextPage: () => {
    const { page, total, pageSize } = get();
    const maxPage = Math.ceil(total / pageSize);
    if (page < maxPage) {
      get().fetchLeaderboard(page + 1);
    }
  },

  prevPage: () => {
    const { page } = get();
    if (page > 1) {
      get().fetchLeaderboard(page - 1);
    }
  },
}));

export function useLeaderboard() {
  return useLeaderboardStore();
}
