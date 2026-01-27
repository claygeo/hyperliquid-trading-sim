import { create } from 'zustand';
import { api } from '../lib/api';
import { wsClient } from '../lib/websocket';
import type { Candle, Orderbook, OrderbookLevel, Trade, MarketData } from '../types/market';
import type { WSMessage } from '../types/websocket';
import { UI_CONSTANTS } from '../config/constants';

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

  // Actions
  setSelectedAsset: (asset: string) => void;
  setSelectedTimeframe: (timeframe: string) => void;
  fetchCandles: (asset: string, timeframe: string) => Promise<void>;
  updateCandle: (candle: Candle) => void;
  updateOrderbook: (data: { bids: [number, number][]; asks: [number, number][]; timestamp: number }) => void;
  addTrade: (trade: Trade) => void;
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

  setSelectedAsset: (asset) => {
    const currentAsset = get().selectedAsset;
    if (currentAsset !== asset) {
      get().unsubscribeFromAsset(currentAsset);
      set({ selectedAsset: asset, orderbook: null, trades: [] });
      get().subscribeToAsset(asset);
      get().fetchCandles(asset, get().selectedTimeframe);
    }
  },

  setSelectedTimeframe: (timeframe) => {
    set({ selectedTimeframe: timeframe });
    get().fetchCandles(get().selectedAsset, timeframe);
  },

  fetchCandles: async (asset, timeframe) => {
    set({ isLoadingCandles: true });
    try {
      const candles = await api.getCandles(asset, timeframe, UI_CONSTANTS.CHART_CANDLE_LIMIT);
      const candlesMap = new Map(get().candles);
      candlesMap.set(`${asset}-${timeframe}`, candles);
      
      if (candles.length > 0) {
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
    }
  },

  updateCandle: (candle) => {
    const { selectedAsset, selectedTimeframe, candles } = get();
    const key = `${selectedAsset}-${selectedTimeframe}`;
    const currentCandles = candles.get(key) || [];
    
    const lastCandle = currentCandles[currentCandles.length - 1];
    if (lastCandle && lastCandle.time === candle.time) {
      // Update existing candle
      const updatedCandles = [...currentCandles.slice(0, -1), candle];
      const newMap = new Map(candles);
      newMap.set(key, updatedCandles);
      set({ candles: newMap, currentPrice: candle.close });
    } else {
      // New candle
      const updatedCandles = [...currentCandles, candle].slice(-UI_CONSTANTS.CHART_CANDLE_LIMIT);
      const newMap = new Map(candles);
      newMap.set(key, updatedCandles);
      set({ candles: newMap, currentPrice: candle.close });
    }
  },

  updateOrderbook: (data) => {
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

  addTrade: (trade) => {
    set((state) => ({
      trades: [trade, ...state.trades].slice(0, UI_CONSTANTS.RECENT_TRADES_LIMIT),
      currentPrice: trade.price,
    }));
  },

  updatePrice: (price) => {
    set({ currentPrice: price });
  },

  subscribeToAsset: (asset) => {
    wsClient.subscribe(`candles:${asset}`);
    wsClient.subscribe(`orderbook:${asset}`);
    wsClient.subscribe(`trades:${asset}`);

    wsClient.on('candle', (msg: WSMessage) => {
      if (msg.channel === `candles:${asset}` && msg.data) {
        get().updateCandle(msg.data as Candle);
      }
    });

    wsClient.on('orderbook', (msg: WSMessage) => {
      if (msg.channel === `orderbook:${asset}` && msg.data) {
        get().updateOrderbook(msg.data as { bids: [number, number][]; asks: [number, number][]; timestamp: number });
      }
    });

    wsClient.on('trade', (msg: WSMessage) => {
      if (msg.channel === `trades:${asset}` && msg.data) {
        get().addTrade(msg.data as Trade);
      }
    });
  },

  unsubscribeFromAsset: (asset) => {
    wsClient.unsubscribe(`candles:${asset}`);
    wsClient.unsubscribe(`orderbook:${asset}`);
    wsClient.unsubscribe(`trades:${asset}`);
  },
}));

export function useMarketData() {
  return useMarketDataStore();
}
