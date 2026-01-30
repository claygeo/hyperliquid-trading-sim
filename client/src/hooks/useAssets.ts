import { create } from 'zustand';
import { api } from '../lib/api';
import { DEFAULT_ASSETS, type Asset } from '../config/assets';

interface AssetsState {
  assets: Asset[];
  isLoading: boolean;
  error: string | null;
  searchQuery: string;
  fetchAssets: () => Promise<void>;
  setSearchQuery: (query: string) => void;
  getFilteredAssets: () => Asset[];
  getAsset: (symbol: string) => Asset | undefined;
}

export const useAssetsStore = create<AssetsState>((set, get) => ({
  assets: DEFAULT_ASSETS,
  isLoading: false,
  error: null,
  searchQuery: '',

  fetchAssets: async () => {
    set({ isLoading: true, error: null });
    try {
      const assets = await api.getAssets();
      if (assets && assets.length > 0) {
        set({ assets, isLoading: false });
      } else {
        set({ assets: DEFAULT_ASSETS, isLoading: false });
      }
    } catch (error) {
      console.error('Failed to fetch assets:', error);
      set({ 
        error: error instanceof Error ? error.message : 'Failed to fetch assets',
        isLoading: false,
        // Keep default assets on error
        assets: DEFAULT_ASSETS 
      });
    }
  },

  setSearchQuery: (query) => set({ searchQuery: query }),

  getFilteredAssets: () => {
    const { assets, searchQuery } = get();
    if (!searchQuery.trim()) return assets;
    
    const query = searchQuery.toLowerCase();
    return assets.filter(
      a => a.symbol.toLowerCase().includes(query) || 
           a.name.toLowerCase().includes(query)
    );
  },

  getAsset: (symbol) => {
    const { assets } = get();
    return assets.find(a => a.symbol === symbol.toUpperCase());
  },
}));

export function useAssets() {
  return useAssetsStore();
}
