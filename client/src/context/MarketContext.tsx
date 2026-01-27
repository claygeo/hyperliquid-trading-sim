import { createContext, useContext, useEffect, type ReactNode } from 'react';
import { useMarketDataStore } from '../hooks/useMarketData';
import { useWebSocket } from '../hooks/useWebSocket';
import type { Candle, Orderbook, Trade } from '../types/market';

interface MarketContextValue {
  selectedAsset: string;
  selectedTimeframe: string;
  candles: Candle[];
  orderbook: Orderbook | null;
  trades: Trade[];
  currentPrice: number;
  isLoadingCandles: boolean;
  setSelectedAsset: (asset: string) => void;
  setSelectedTimeframe: (timeframe: string) => void;
}

const MarketContext = createContext<MarketContextValue | null>(null);

export function MarketProvider({ children }: { children: ReactNode }) {
  const store = useMarketDataStore();
  const { isConnected } = useWebSocket();

  const candles = store.candles.get(`${store.selectedAsset}-${store.selectedTimeframe}`) || [];

  useEffect(() => {
    if (isConnected) {
      store.subscribeToAsset(store.selectedAsset);
      store.fetchCandles(store.selectedAsset, store.selectedTimeframe);
    }

    return () => {
      store.unsubscribeFromAsset(store.selectedAsset);
    };
  }, [isConnected, store.selectedAsset]);

  return (
    <MarketContext.Provider
      value={{
        selectedAsset: store.selectedAsset,
        selectedTimeframe: store.selectedTimeframe,
        candles,
        orderbook: store.orderbook,
        trades: store.trades,
        currentPrice: store.currentPrice,
        isLoadingCandles: store.isLoadingCandles,
        setSelectedAsset: store.setSelectedAsset,
        setSelectedTimeframe: store.setSelectedTimeframe,
      }}
    >
      {children}
    </MarketContext.Provider>
  );
}

export function useMarket() {
  const context = useContext(MarketContext);
  if (!context) {
    throw new Error('useMarket must be used within MarketProvider');
  }
  return context;
}
