import { create } from 'zustand';
import { api } from '../lib/api';
import { wsClient } from '../lib/websocket';
import type { Candle, Orderbook, OrderbookLevel, Trade, MarketData } from '../types/market';
import type { WSMessage } from '../types/websocket';
import { UI_CONSTANTS } from '../config/constants';

// Track in-flight requests to prevent duplicates
const pendingRequests = new Map<string, Promise<Candle[]>>();

// Track active handler cleanup functions to prevent memory leaks
let activeHandlerCleanups: Array<() => void> = [];

interface MarketDataState {
  // Current asset
  selectedAsset: string;
  selectedTimeframe: string;

  // Market data
  candles: Map<string, Candle[]>;
  orderbook: Orderbook | null;
  trades: Trade[];
  marketData: Map<string, MarketData>;
  currentPrice: number;

  // Loading states
  isLoadingCandles: boolean;
  isLoadingOrderbook: boolean;

  // Track current subscription
  currentSubscribedAsset: string | null;

  // Actions
  setSelectedAsset: (asset: string) => void;
  setSelectedTimeframe: (timeframe: string) => void;
  fetchCandles: (asset: string, timeframe: string) => Promise<void>;
  updateCandle: (asset: string, candle: Candle) => void;
  updateOrderbook: (asset: string, data: { bids: [number, number][]; asks: [number, number][]; timestamp: number }) => void;
  addTrade: (asset: string, trade: Trade) => void;
  updatePrice: (price: number) => void;
  subscribeToAsset: (asset: string) => void;
  unsubscribeFromAsset: (asset: string) => void;
}

export const useMarketDataStore = create<MarketDataState>((set, get) => ({
  selectedAsset: 'BTC',
  selectedTimeframe: '1h',
  candles: new Map(),
  orderbook: null,
  trades: [],
  marketData: new Map(),
  currentPrice: 0,
  isLoadingCandles: false,
  isLoadingOrderbook: false,
  currentSubscribedAsset: null,

  setSelectedAsset: (asset) => {
    const currentAsset = get().selectedAsset;
    if (currentAsset !== asset) {
      // Unsubscribe from old asset
      if (get().currentSubscribedAsset) {
        get().unsubscribeFromAsset(get().currentSubscribedAsset);
      }
      // Clear orderbook and trades, reset price
      set({ 
        selectedAsset: asset, 
        orderbook: null, 
        trades: [], 
        currentPrice: 0,
        currentSubscribedAsset: null 
      });
      // Subscribe to new asset
      get().subscribeToAsset(asset);
      // Fetch candles for new asset
      get().fetchCandles(asset, get().selectedTimeframe);
    }
  },

  setSelectedTimeframe: (timeframe) => {
    const currentTimeframe = get().selectedTimeframe;
    if (currentTimeframe !== timeframe) {
      set({ selectedTimeframe: timeframe });
      get().fetchCandles(get().selectedAsset, timeframe);
    }
  },

  fetchCandles: async (asset, timeframe) => {
    const cacheKey = `${asset}-${timeframe}`;
    
    // Check if we already have recent data (within 5 seconds)
    const existingCandles = get().candles.get(cacheKey);
    if (existingCandles && existingCandles.length > 0) {
      // Check if last candle is recent enough (within 60 seconds for 1m, scaled for other timeframes)
      const lastCandle = existingCandles[existingCandles.length - 1];
      const staleness = Date.now() - lastCandle.time;
      const maxStaleness = timeframe === '1m' ? 60000 : timeframe === '5m' ? 120000 : 180000;
      
      if (staleness < maxStaleness) {
        // Data is fresh, just update the price
        set({ currentPrice: lastCandle.close, isLoadingCandles: false });
        return;
      }
    }
    
    // If there's already a pending request for this exact key, wait for it
    if (pendingRequests.has(cacheKey)) {
      try {
        await pendingRequests.get(cacheKey);
      } catch {
        // Ignore - the original request handler will deal with errors
      }
      return;
    }
    
    set({ isLoadingCandles: true });
    
    const fetchWithRetry = async (retries = 2): Promise<Candle[]> => {
      try {
        const candles = await api.getCandles(asset, timeframe, UI_CONSTANTS.CHART_CANDLE_LIMIT);
        return candles;
      } catch (error) {
        if (retries > 0) {
          console.log(`Retrying fetch for ${asset}... (${retries} left)`);
          await new Promise(resolve => setTimeout(resolve, 1500));
          return fetchWithRetry(retries - 1);
        }
        throw error;
      }
    };
    
    // Create the promise and store it
    const fetchPromise = fetchWithRetry();
    pendingRequests.set(cacheKey, fetchPromise);
    
    try {
      const candles = await fetchPromise;
      const candlesMap = new Map(get().candles);
      candlesMap.set(cacheKey, candles);
      
      // Only update price if this is still the selected asset
      if (get().selectedAsset === asset && candles.length > 0) {
        set({ 
          candles: candlesMap, 
          currentPrice: candles[candles.length - 1].close,
          isLoadingCandles: false 
        });
      } else {
        set({ candles: candlesMap, isLoadingCandles: false });
      }
    } catch (error) {
      console.error('Failed to fetch candles:', error);
      set({ isLoadingCandles: false });
    } finally {
      // Remove from pending requests after a short delay to prevent immediate re-fetches
      setTimeout(() => pendingRequests.delete(cacheKey), 2000);
    }
  },

  updateCandle: (asset, candle) => {
    const { selectedAsset, selectedTimeframe, candles } = get();
    // Only update if this is the selected asset
    if (asset !== selectedAsset) return;
    
    const key = `${asset}-${selectedTimeframe}`;
    const currentCandles = candles.get(key) || [];
    
    const lastCandle = currentCandles[currentCandles.length - 1];
    if (lastCandle && lastCandle.time === candle.time) {
      const updatedCandles = [...currentCandles.slice(0, -1), candle];
      const newMap = new Map(candles);
      newMap.set(key, updatedCandles);
      set({ candles: newMap, currentPrice: candle.close });
    } else {
      const updatedCandles = [...currentCandles, candle].slice(-UI_CONSTANTS.CHART_CANDLE_LIMIT);
      const newMap = new Map(candles);
      newMap.set(key, updatedCandles);
      set({ candles: newMap, currentPrice: candle.close });
    }
  },

  updateOrderbook: (asset, data) => {
    // Only update if this is the selected asset
    if (asset !== get().selectedAsset) return;
    
    const bids: OrderbookLevel[] = data.bids
      .slice(0, UI_CONSTANTS.ORDERBOOK_LEVELS)
      .reduce((acc, [price, size], i) => {
        const total = i === 0 ? size : acc[i - 1].total + size;
        acc.push({ price, size, total });
        return acc;
      }, [] as OrderbookLevel[]);

    const asks: OrderbookLevel[] = data.asks
      .slice(0, UI_CONSTANTS.ORDERBOOK_LEVELS)
      .reduce((acc, [price, size], i) => {
        const total = i === 0 ? size : acc[i - 1].total + size;
        acc.push({ price, size, total });
        return acc;
      }, [] as OrderbookLevel[]);

    const bestBid = bids[0]?.price || 0;
    const bestAsk = asks[0]?.price || 0;
    const spread = bestAsk - bestBid;
    const midPrice = (bestBid + bestAsk) / 2;
    const spreadPercent = midPrice > 0 ? (spread / midPrice) * 100 : 0;

    set({
      orderbook: {
        bids,
        asks,
        spread,
        spreadPercent,
        midPrice,
        timestamp: data.timestamp,
      },
      currentPrice: midPrice,
    });
  },

  addTrade: (asset, trade) => {
    // Only update if this is the selected asset
    if (asset !== get().selectedAsset) return;
    
    set((state) => ({
      trades: [trade, ...state.trades].slice(0, UI_CONSTANTS.RECENT_TRADES_LIMIT),
      currentPrice: trade.price,
    }));
  },

  updatePrice: (price) => {
    set({ currentPrice: price });
  },

  subscribeToAsset: (asset) => {
    // Skip if already subscribed to this asset
    if (get().currentSubscribedAsset === asset) {
      return;
    }
    
    // Mark as subscribed
    set({ currentSubscribedAsset: asset });
    
    wsClient.subscribe(`candles:${asset}`);
    wsClient.subscribe(`orderbook:${asset}`);
    wsClient.subscribe(`trades:${asset}`);

    // Create handlers that check the asset
    const handleCandle = (msg: WSMessage) => {
      if (msg.channel === `candles:${asset}` && msg.data) {
        get().updateCandle(asset, msg.data as Candle);
      }
    };

    const handleOrderbook = (msg: WSMessage) => {
      if (msg.channel === `orderbook:${asset}` && msg.data) {
        get().updateOrderbook(asset, msg.data as { bids: [number, number][]; asks: [number, number][]; timestamp: number });
      }
    };

    const handleTrade = (msg: WSMessage) => {
      if (msg.channel === `trades:${asset}` && msg.data) {
        get().addTrade(asset, msg.data as Trade);
      }
    };

    // Register handlers and store cleanup functions to prevent memory leaks
    const cleanupCandle = wsClient.on('candle', handleCandle);
    const cleanupOrderbook = wsClient.on('orderbook', handleOrderbook);
    const cleanupTrade = wsClient.on('trade', handleTrade);

    activeHandlerCleanups.push(cleanupCandle, cleanupOrderbook, cleanupTrade);
  },

  unsubscribeFromAsset: (asset) => {
    // Remove event handlers to prevent memory leak
    activeHandlerCleanups.forEach((cleanup) => cleanup());
    activeHandlerCleanups = [];

    wsClient.unsubscribe(`candles:${asset}`);
    wsClient.unsubscribe(`orderbook:${asset}`);
    wsClient.unsubscribe(`trades:${asset}`);
    set({ currentSubscribedAsset: null });
  },
}));

export function useMarketData() {
  return useMarketDataStore();
}
