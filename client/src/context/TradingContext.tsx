import { createContext, useContext, useEffect, type ReactNode } from 'react';
import { usePositionsStore } from '../hooks/usePositions';
import { useAccountStore } from '../hooks/useAccount';
import { useWebSocket } from '../hooks/useWebSocket';
import type { Position, Account, PlaceOrderRequest } from '../types/trading';
import type { UserStats } from '../types/user';

interface TradingContextValue {
  positions: Position[];
  account: Account | null;
  stats: UserStats | null;
  isLoading: boolean;
  isPlacingOrder: boolean;
  isResetting: boolean;
  error: string | null;
  placeOrder: (order: PlaceOrderRequest) => Promise<Position>;
  closePosition: (positionId: string) => Promise<void>;
  resetAccount: () => Promise<void>;
  refreshData: () => Promise<void>;
}

const TradingContext = createContext<TradingContextValue | null>(null);

export function TradingProvider({ children }: { children: ReactNode }) {
  const positionsStore = usePositionsStore();
  const accountStore = useAccountStore();
  const { isConnected } = useWebSocket();

  useEffect(() => {
    if (isConnected) {
      positionsStore.subscribeToPositions();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isConnected]);

  useEffect(() => {
    accountStore.fetchAccount();
    accountStore.fetchStats();
    positionsStore.fetchPositions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const refreshData = async () => {
    await Promise.all([
      accountStore.fetchAccount(),
      accountStore.fetchStats(),
      positionsStore.fetchPositions(),
    ]);
  };

  return (
    <TradingContext.Provider
      value={{
        positions: positionsStore.positions,
        account: accountStore.account,
        stats: accountStore.stats,
        isLoading: positionsStore.isLoading || accountStore.isLoading,
        isPlacingOrder: positionsStore.isPlacingOrder,
        isResetting: accountStore.isResetting,
        error: positionsStore.error || accountStore.error,
        placeOrder: positionsStore.placeOrder,
        closePosition: positionsStore.closePosition,
        resetAccount: accountStore.resetAccount,
        refreshData,
      }}
    >
      {children}
    </TradingContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useTrading() {
  const context = useContext(TradingContext);
  if (!context) {
    throw new Error('useTrading must be used within TradingProvider');
  }
  return context;
}
