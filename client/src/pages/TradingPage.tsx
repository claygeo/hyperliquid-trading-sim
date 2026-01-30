import { useEffect, useState } from 'react';
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
  const { addToast } = useToast();
  const { isAuthenticated } = useAuthStore();
  const { assets, fetchAssets, getFilteredAssets, searchQuery, setSearchQuery } = useAssetsStore();
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

  // Fetch assets on mount
  useEffect(() => {
    fetchAssets();
  }, []);

  // Calculate live PnL for positions
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

  const filteredAssets = getFilteredAssets();

  // Asset search modal
  const AssetSearchModal = () => (
    <div className="fixed inset-0 z-50 bg-black/90 backdrop-blur-sm">
      <div className="flex flex-col h-full">
        {/* Search header */}
        <div className="p-4 border-b border-gray-800">
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
              className="flex-1 bg-gray-900 border border-gray-700 rounded-lg px-4 py-2 text-white placeholder-gray-500 focus:outline-none focus:border-accent-cyan"
              autoFocus
            />
          </div>
        </div>
        
        {/* Asset list */}
        <div className="flex-1 overflow-y-auto">
          {filteredAssets.map((asset) => (
            <button
              key={asset.symbol}
              onClick={() => handleAssetSelect(asset.symbol)}
              className={cn(
                'w-full flex items-center justify-between px-4 py-3 border-b border-gray-800/50 transition-colors',
                asset.symbol === selectedAsset ? 'bg-accent-cyan/10' : 'hover:bg-gray-900'
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

  // Mobile Header with asset selector and view toggles
  const MobileHeader = () => (
    <div className="md:hidden flex items-center justify-between px-3 py-2 bg-bg-primary border-b border-border">
      {/* Asset selector */}
      <button 
        onClick={() => setShowAssetSearch(true)}
        className="flex items-center gap-2"
      >
        <span className="text-white font-semibold">{selectedAsset}</span>
        <span className="text-gray-500 text-sm">PERP</span>
        <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* View toggles - Binance style icons */}
      <div className="flex items-center gap-1 bg-bg-secondary rounded-lg p-1">
        <button
          onClick={() => setMobileView('chart')}
          className={cn(
            'p-2 rounded-md transition-colors',
            mobileView === 'chart' ? 'bg-bg-tertiary text-white' : 'text-gray-500'
          )}
          title="Chart View"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 12l3-3 3 3 4-4M8 21l4-4 4 4M3 4h18M4 4v16" />
          </svg>
        </button>
        <button
          onClick={() => setMobileView('trade')}
          className={cn(
            'p-2 rounded-md transition-colors',
            mobileView === 'trade' ? 'bg-bg-tertiary text-white' : 'text-gray-500'
          )}
          title="Trade View"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 7h6m0 10v-3m-3 3h.01M9 17h.01M9 14h.01M12 14h.01M15 11h.01M12 11h.01M9 11h.01M7 21h10a2 2 0 002-2V5a2 2 0 00-2-2H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
          </svg>
        </button>
      </div>

      {/* Connection status */}
      <div className={cn(
        'w-2 h-2 rounded-full',
        isConnected ? 'bg-accent-green' : 'bg-accent-red'
      )} />
    </div>
  );

  // Desktop asset selector
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

      {/* Quick asset buttons */}
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
      {/* Asset search modal */}
      {showAssetSearch && <AssetSearchModal />}

      {/* Mobile Layout */}
      <div className="md:hidden flex flex-col h-full">
        <MobileHeader />
        
        <div className="flex-1 min-h-0 overflow-hidden">
          {mobileView === 'chart' ? (
            <div className="h-full flex flex-col">
              <div className="flex-1 min-h-0">
                <PriceChart
                  candles={currentCandles}
                  selectedAsset={selectedAsset}
                  selectedTimeframe={selectedTimeframe}
                  onTimeframeChange={setSelectedTimeframe}
                  isLoading={isLoadingCandles}
                  currentPrice={currentPrice}
                />
              </div>
              {/* Positions below chart on mobile */}
              {isAuthenticated && positions.length > 0 && (
                <div className="flex-shrink-0 max-h-32 overflow-y-auto border-t border-border">
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
              {/* Orderbook - left side */}
              <div className="w-1/2 border-r border-border overflow-hidden">
                <Orderbook orderbook={orderbook} asset={selectedAsset} compact />
              </div>
              
              {/* Order form - right side */}
              <div className="w-1/2 p-2 overflow-y-auto">
                <OrderForm
                  selectedAsset={selectedAsset}
                  currentPrice={currentPrice}
                  availableBalance={account?.availableMargin || 100000}
                  onPlaceOrder={handlePlaceOrder}
                  isPlacingOrder={isPlacingOrder}
                  compact
                />
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Desktop Layout */}
      <div className="hidden md:flex h-full p-2 gap-2">
        {/* Left column - Orderbook & Recent Trades */}
        <div className="w-64 flex-shrink-0 flex flex-col gap-2">
          <div className="flex-1 min-h-0 overflow-hidden">
            <Orderbook orderbook={orderbook} asset={selectedAsset} />
          </div>
          <div className="flex-1 min-h-0 overflow-hidden">
            <RecentTrades trades={trades} asset={selectedAsset} />
          </div>
        </div>

        {/* Center - Chart & Positions */}
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

        {/* Right column - Order Form & Stats */}
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
          />

          {isAuthenticated && <OpenOrders />}
        </div>
      </div>
    </div>
  );
}
