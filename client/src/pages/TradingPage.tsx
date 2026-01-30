import { useEffect, useState, useCallback } from 'react';
import { PriceChart } from '../components/chart/PriceChart';
import { Orderbook } from '../components/orderbook/Orderbook';
import { RecentTrades } from '../components/trades/RecentTrades';
import { OrderForm } from '../components/trading/OrderForm';
import { PositionPanel } from '../components/trading/PositionPanel';
import { AccountStats } from '../components/trading/AccountStats';
import { OpenOrders } from '../components/trading/OpenOrders';
import { useMarketDataStore } from '../hooks/useMarketData';
import { usePositionsStore } from '../hooks/usePositions';
import { useAccountStore } from '../hooks/useAccount';
import { useWebSocket } from '../hooks/useWebSocket';
import { useAuthStore } from '../hooks/useAuth';
import { useAssetsStore } from '../hooks/useAssets';
import { useToast } from '../context/ToastContext';
import { cn } from '../lib/utils';
import type { Position } from '../types/trading';

type MobileView = 'chart' | 'trade';

export function TradingPage() {
  const [mobileView, setMobileView] = useState<MobileView>('chart');
  const [limitPriceFromOrderbook, setLimitPriceFromOrderbook] = useState<number | null>(null);
  const { addToast } = useToast();
  const { isAuthenticated } = useAuthStore();
  const { fetchAssets, getFilteredAssets, searchQuery, setSearchQuery } = useAssetsStore();
  const [showAssetSearch, setShowAssetSearch] = useState(false);
  
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

  useEffect(() => {
    fetchAssets();
  }, []);

  const positionsWithLivePnl: Position[] = positions.map((position) => {
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
      if (isAuthenticated) {
        subscribeToPositions();
      }
    }
  }, [isConnected, selectedAsset, isAuthenticated]);

  useEffect(() => {
    fetchCandles(selectedAsset, selectedTimeframe);
    if (isAuthenticated) {
      fetchPositions();
      fetchAccount();
      fetchStats();
    }
  }, [selectedAsset, selectedTimeframe, isAuthenticated]);

  const handlePlaceOrder = async (order: Parameters<typeof placeOrder>[0]) => {
    if (!isAuthenticated) {
      addToast({
        type: 'error',
        title: 'Login Required',
        message: 'Please login to place orders',
      });
      return;
    }
    await placeOrder(order);
    fetchAccount();
    fetchPositions();
    setLimitPriceFromOrderbook(null);
  };

  const handleClosePosition = async (positionId: string) => {
    await closePosition(positionId);
    fetchAccount();
    fetchStats();
    fetchPositions();
  };

  const handleResetAccount = async () => {
    await resetAccount();
    fetchPositions();
    addToast({
      type: 'success',
      title: 'Account Reset',
      message: 'Your account has been reset to $100,000',
    });
  };

  const handleAssetSelect = (symbol: string) => {
    setSelectedAsset(symbol);
    setShowAssetSearch(false);
    setSearchQuery('');
  };

  const handleOrderbookPriceClick = useCallback((price: number) => {
    setLimitPriceFromOrderbook(price);
  }, []);

  const filteredAssets = getFilteredAssets();
  const openPositions = positions.filter(p => p.status === 'open');

  const AssetSearchModal = () => (
    <div className="fixed inset-0 z-50 bg-black/95">
      <div className="flex flex-col h-full">
        <div className="p-3 border-b border-border">
          <div className="flex items-center gap-3">
            <button 
              onClick={() => { setShowAssetSearch(false); setSearchQuery(''); }}
              className="p-2 text-gray-400 hover:text-white"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
            <input
              type="text"
              placeholder="Search markets..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="flex-1 bg-bg-tertiary border border-border rounded-lg px-3 py-2 text-white placeholder-gray-500 focus:outline-none focus:border-accent-cyan text-sm"
              autoFocus
            />
          </div>
        </div>
        
        <div className="flex-1 overflow-y-auto">
          {filteredAssets.map((asset) => (
            <button
              key={asset.symbol}
              onClick={() => handleAssetSelect(asset.symbol)}
              className={cn(
                'w-full flex items-center justify-between px-4 py-3 border-b border-border/50 transition-colors',
                asset.symbol === selectedAsset ? 'bg-accent-cyan/10' : 'active:bg-bg-tertiary'
              )}
            >
              <div className="flex items-center gap-3">
                <span className="text-white font-medium">{asset.symbol}</span>
                <span className="text-gray-500 text-sm">PERP</span>
              </div>
              {asset.symbol === selectedAsset && (
                <svg className="w-5 h-5 text-accent-cyan" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                </svg>
              )}
            </button>
          ))}
        </div>
      </div>
    </div>
  );

  // Mobile Header - Asset on left, toggle left-aligned, dot on right
  const MobileHeader = () => (
    <div className="md:hidden flex items-center justify-between px-2 py-1.5 bg-black border-b border-border">
      {/* Left side: Asset + Toggle */}
      <div className="flex items-center gap-2">
        {/* Asset selector */}
        <button 
          onClick={() => setShowAssetSearch(true)}
          className="flex items-center gap-1"
        >
          <span className="text-white font-semibold text-sm">{selectedAsset}</span>
          <span className="text-gray-500 text-xs">PERP</span>
          <svg className="w-3 h-3 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>

        {/* View toggles - left aligned */}
        <div className="flex items-center gap-0.5 bg-bg-secondary rounded-md p-0.5 ml-2">
          <button
            onClick={() => setMobileView('chart')}
            className={cn(
              'px-2.5 py-1 rounded text-xs font-medium transition-colors',
              mobileView === 'chart' ? 'bg-bg-tertiary text-white' : 'text-gray-500'
            )}
          >
            Chart
          </button>
          <button
            onClick={() => setMobileView('trade')}
            className={cn(
              'px-2.5 py-1 rounded text-xs font-medium transition-colors',
              mobileView === 'trade' ? 'bg-bg-tertiary text-white' : 'text-gray-500'
            )}
          >
            Trade
          </button>
        </div>
      </div>

      {/* Right side: Connection status */}
      <div className={cn(
        'w-2 h-2 rounded-full',
        isConnected ? 'bg-accent-green' : 'bg-accent-red'
      )} />
    </div>
  );

  const DesktopAssetSelector = () => (
    <div className="flex items-center gap-2 bg-bg-secondary rounded-lg p-2 border border-border overflow-x-auto">
      <button
        onClick={() => setShowAssetSearch(true)}
        className="flex items-center gap-2 px-3 py-1.5 bg-bg-tertiary rounded-lg hover:bg-bg-elevated transition-colors"
      >
        <span className="text-white font-medium">{selectedAsset}</span>
        <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {['BTC', 'ETH', 'SOL', 'DOGE', 'PEPE'].filter(s => s !== selectedAsset).slice(0, 4).map((symbol) => (
        <button
          key={symbol}
          onClick={() => setSelectedAsset(symbol)}
          className="px-3 py-1.5 text-sm text-gray-400 hover:text-white hover:bg-bg-tertiary rounded-lg transition-colors"
        >
          {symbol}
        </button>
      ))}

      <div className="ml-auto flex items-center gap-2">
        <div className={cn(
          'w-2 h-2 rounded-full',
          isConnected ? 'bg-accent-green' : 'bg-accent-red'
        )} />
        <span className="text-xs text-gray-500">{isConnected ? 'Live' : 'Offline'}</span>
      </div>
    </div>
  );

  return (
    <div className="h-full overflow-hidden flex flex-col bg-black">
      {showAssetSearch && <AssetSearchModal />}

      {/* Mobile Layout */}
      <div className="md:hidden flex flex-col h-[100dvh]">
        <MobileHeader />
        
        <div className="flex-1 min-h-0 overflow-hidden">
          {mobileView === 'chart' ? (
            <div className="h-full flex flex-col">
              {/* Chart takes remaining space minus positions */}
              <div className={cn(
                'min-h-0',
                openPositions.length > 0 ? 'flex-1' : 'h-full'
              )}>
                <PriceChart
                  candles={currentCandles}
                  selectedAsset={selectedAsset}
                  selectedTimeframe={selectedTimeframe}
                  onTimeframeChange={setSelectedTimeframe}
                  isLoading={isLoadingCandles}
                  currentPrice={currentPrice}
                  compact
                />
              </div>
              {/* Positions at bottom */}
              {isAuthenticated && openPositions.length > 0 && (
                <div className="flex-shrink-0 border-t border-border bg-bg-secondary max-h-32 overflow-y-auto">
                  <PositionPanel
                    positions={positionsWithLivePnl}
                    onClosePosition={handleClosePosition}
                    compact
                  />
                </div>
              )}
            </div>
          ) : (
            <div className="h-full flex">
              <div className="w-[45%] border-r border-border overflow-hidden">
                <Orderbook 
                  orderbook={orderbook} 
                  asset={selectedAsset} 
                  compact 
                  onPriceClick={handleOrderbookPriceClick}
                />
              </div>
              
              <div className="w-[55%] overflow-hidden">
                <OrderForm
                  selectedAsset={selectedAsset}
                  currentPrice={currentPrice}
                  availableBalance={account?.availableMargin || 100000}
                  onPlaceOrder={handlePlaceOrder}
                  isPlacingOrder={isPlacingOrder}
                  compact
                  externalLimitPrice={limitPriceFromOrderbook}
                />
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Desktop Layout */}
      <div className="hidden md:flex h-full p-2 gap-2">
        <div className="w-64 flex-shrink-0 flex flex-col gap-2">
          <div className="flex-1 min-h-0 overflow-hidden">
            <Orderbook 
              orderbook={orderbook} 
              asset={selectedAsset}
              onPriceClick={handleOrderbookPriceClick}
            />
          </div>
          <div className="flex-1 min-h-0 overflow-hidden">
            <RecentTrades trades={trades} asset={selectedAsset} />
          </div>
        </div>

        <div className="flex-1 flex flex-col gap-2 min-w-0">
          <DesktopAssetSelector />
          
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

          {isAuthenticated && (
            <div className="flex-shrink-0 h-44">
              <PositionPanel
                positions={positionsWithLivePnl}
                onClosePosition={handleClosePosition}
              />
            </div>
          )}
        </div>

        <div className="w-80 flex-shrink-0 flex flex-col gap-2 overflow-y-auto">
          {isAuthenticated && (
            <AccountStats
              account={account}
              stats={stats}
              positions={positionsWithLivePnl}
              onReset={handleResetAccount}
            />
          )}

          <OrderForm
            selectedAsset={selectedAsset}
            currentPrice={currentPrice}
            availableBalance={account?.availableMargin || 100000}
            onPlaceOrder={handlePlaceOrder}
            isPlacingOrder={isPlacingOrder}
            externalLimitPrice={limitPriceFromOrderbook}
          />

          {isAuthenticated && <OpenOrders />}
        </div>
      </div>
    </div>
  );
}
