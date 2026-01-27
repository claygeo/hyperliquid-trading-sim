import { useEffect, useState } from 'react';
import { PriceChart } from '../components/chart/PriceChart';
import { Orderbook } from '../components/orderbook/Orderbook';
import { RecentTrades } from '../components/trades/RecentTrades';
import { OrderForm } from '../components/trading/OrderForm';
import { PositionPanel } from '../components/trading/PositionPanel';
import { AccountStats } from '../components/trading/AccountStats';
import { StressTestPanel } from '../components/stress-test/StressTestPanel';
import { useMarketDataStore } from '../hooks/useMarketData';
import { usePositionsStore } from '../hooks/usePositions';
import { useAccountStore } from '../hooks/useAccount';
import { useWebSocket } from '../hooks/useWebSocket';
import { useToast } from '../context/ToastContext';
import { ASSET_LIST } from '../config/assets';
import { cn } from '../lib/utils';
import type { Position } from '../types/trading';

export function TradingPage() {
  const [showStressTest, setShowStressTest] = useState(false);
  const { addToast } = useToast();
  
  const {
    selectedAsset,
    selectedTimeframe,
    candles,
    orderbook,
    trades,
    currentPrice,
    isLoadingCandles,
    setSelectedAsset,
    setSelectedTimeframe,
    subscribeToAsset,
    fetchCandles,
  } = useMarketDataStore();

  const { positions, isPlacingOrder, placeOrder, closePosition, fetchPositions, subscribeToPositions } = usePositionsStore();
  const { account, stats, fetchAccount, fetchStats, resetAccount } = useAccountStore();
  const { isConnected } = useWebSocket();

  const currentCandles = candles.get(`${selectedAsset}-${selectedTimeframe}`) || [];

  // Calculate live PnL for positions using current market price
  const positionsWithLivePnl: Position[] = positions.map((position) => {
    // Use current price from market data if available and matches asset
    if (position.asset !== selectedAsset || currentPrice <= 0) {
      return position;
    }
    
    const priceDiff = currentPrice - position.entryPrice;
    const direction = position.side === 'long' ? 1 : -1;
    const unrealizedPnl = priceDiff * position.size * direction;
    const unrealizedPnlPercent = (priceDiff / position.entryPrice) * 100 * direction * position.leverage;
    
    return {
      ...position,
      currentPrice,
      unrealizedPnl,
      unrealizedPnlPercent,
    };
  });

  useEffect(() => {
    if (isConnected) {
      subscribeToAsset(selectedAsset);
      subscribeToPositions();
    }
  }, [isConnected, selectedAsset]);

  useEffect(() => {
    fetchCandles(selectedAsset, selectedTimeframe);
    fetchPositions();
    fetchAccount();
    fetchStats();
  }, [selectedAsset, selectedTimeframe]);

  const handlePlaceOrder = async (order: Parameters<typeof placeOrder>[0]) => {
    await placeOrder(order);
    // Refresh account after order
    fetchAccount();
    fetchPositions();
  };

  const handleClosePosition = async (positionId: string) => {
    await closePosition(positionId);
    // Refresh account and stats after close
    fetchAccount();
    fetchStats();
    fetchPositions();
  };

  const handleResetAccount = async () => {
    await resetAccount();
    // Refresh positions (should be empty now)
    fetchPositions();
    addToast({
      type: 'success',
      title: 'Account Reset',
      message: 'Your account has been reset to $100,000',
    });
  };

  return (
    <div className="h-full p-4 overflow-hidden">
      <div className="h-full grid grid-cols-12 gap-4">
        {/* Left column - Orderbook & Recent Trades */}
        <div className="col-span-2 flex flex-col gap-4 min-h-0">
          <div className="flex-1 min-h-0 overflow-hidden">
            <Orderbook orderbook={orderbook} asset={selectedAsset} />
          </div>
          <div className="flex-1 min-h-0 overflow-hidden">
            <RecentTrades trades={trades} asset={selectedAsset} />
          </div>
        </div>

        {/* Center - Chart & Positions */}
        <div className="col-span-7 flex flex-col gap-4 min-h-0">
          {/* Asset selector */}
          <div className="flex-shrink-0 flex items-center gap-2 bg-bg-secondary rounded-lg p-2 border border-border">
            {ASSET_LIST.map((asset) => (
              <button
                key={asset.symbol}
                onClick={() => setSelectedAsset(asset.symbol)}
                className={cn(
                  'flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-all duration-200',
                  selectedAsset === asset.symbol
                    ? 'bg-accent-cyan text-bg-primary shadow-[0_0_15px_rgba(0,212,255,0.2)]'
                    : 'text-text-secondary hover:text-text-primary hover:bg-bg-tertiary'
                )}
              >
                <span className="text-lg">{asset.icon}</span>
                <span>{asset.symbol}</span>
              </button>
            ))}

            <div className="ml-auto flex items-center gap-2">
              <div className={cn(
                'w-2 h-2 rounded-full transition-all duration-300',
                isConnected ? 'bg-accent-green shadow-[0_0_8px_rgba(0,255,136,0.5)]' : 'bg-accent-red'
              )} />
              <span className="text-xs text-text-muted">
                {isConnected ? 'Connected' : 'Disconnected'}
              </span>
            </div>
          </div>

          {/* Chart - takes remaining space */}
          <div className="flex-1 min-h-[300px]">
            <PriceChart
              candles={currentCandles}
              selectedAsset={selectedAsset}
              selectedTimeframe={selectedTimeframe}
              onTimeframeChange={setSelectedTimeframe}
              isLoading={isLoadingCandles}
              currentPrice={currentPrice}
            />
          </div>

          {/* Positions - fixed height */}
          <div className="flex-shrink-0 h-48 min-h-[192px]">
            <PositionPanel
              positions={positionsWithLivePnl}
              onClosePosition={handleClosePosition}
            />
          </div>
        </div>

        {/* Right column - Order Form & Stats */}
        <div className="col-span-3 flex flex-col gap-4 min-h-0 overflow-y-auto">
          <div className="flex-shrink-0">
            <AccountStats
              account={account}
              stats={stats}
              positions={positionsWithLivePnl}
              onReset={handleResetAccount}
            />
          </div>

          <div className="flex-shrink-0">
            <OrderForm
              selectedAsset={selectedAsset}
              currentPrice={currentPrice}
              availableBalance={account?.availableMargin || 0}
              onPlaceOrder={handlePlaceOrder}
              isPlacingOrder={isPlacingOrder}
            />
          </div>

          {/* Stress Test Toggle */}
          <button
            onClick={() => setShowStressTest(!showStressTest)}
            className="flex-shrink-0 flex items-center justify-between px-4 py-3 bg-bg-secondary rounded-xl border border-border hover:border-accent-purple/50 transition-all duration-200"
          >
            <span className="text-sm font-medium text-text-primary">Stress Test</span>
            <span className="text-xs text-text-muted">
              {showStressTest ? 'Hide' : 'Show'}
            </span>
          </button>

          {showStressTest && <StressTestPanel />}
        </div>
      </div>
    </div>
  );
}
