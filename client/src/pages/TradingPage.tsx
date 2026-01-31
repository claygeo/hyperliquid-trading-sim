import { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { PriceChart } from '../components/chart/PriceChart';
import { Orderbook } from '../components/orderbook/Orderbook';
import { RecentTrades } from '../components/trades/RecentTrades';
import { OrderForm } from '../components/trading/OrderForm';
import { AccountStats } from '../components/trading/AccountStats';
import { OpenOrders } from '../components/trading/OpenOrders';
import { MobileNav } from '../components/ui/MobileNav';
import { useMarketDataStore } from '../hooks/useMarketData';
import { usePositionsStore } from '../hooks/usePositions';
import { useAccountStore } from '../hooks/useAccount';
import { useWebSocket } from '../hooks/useWebSocket';
import { useAuthStore } from '../hooks/useAuth';
import { useAssetsStore } from '../hooks/useAssets';
import { useToast } from '../context/ToastContext';
import { cn, formatPrice, formatSize, formatUSD, formatPercent } from '../lib/utils';
import { AnimatedNumber } from '../components/ui/AnimatedNumber';
import type { Position } from '../types/trading';

type MobileTab = 'chart' | 'orderbook';

export function TradingPage() {
  const [mobileTab, setMobileTab] = useState<MobileTab>('chart');
  const [limitPriceFromOrderbook, setLimitPriceFromOrderbook] = useState<number | null>(null);
  const [expandedPositionId, setExpandedPositionId] = useState<string | null>(null);
  const [closingPositionId, setClosingPositionId] = useState<string | null>(null);
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

  // Initial fetch on mount
  useEffect(() => {
    fetchCandles(selectedAsset, selectedTimeframe);
  }, []); // Only on mount

  // Fetch account data when authenticated
  useEffect(() => {
    if (isAuthenticated) {
      fetchPositions();
      fetchAccount();
      fetchStats();
    }
  }, [isAuthenticated]);

  // Note: subsequent fetches are handled by setSelectedAsset and setSelectedTimeframe
  // The deduplication in useMarketData prevents duplicate requests

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

  const handleClosePosition = async (positionId: string, closeType: 'market' | 'limit' = 'market') => {
    setClosingPositionId(positionId);
    try {
      await closePosition(positionId);
      fetchAccount();
      fetchStats();
      fetchPositions();
      setExpandedPositionId(null);
      addToast({
        type: 'success',
        title: 'Position Closed',
        message: closeType === 'market' ? 'Market close executed' : 'Limit close placed',
      });
    } finally {
      setClosingPositionId(null);
    }
  };

  const handleCloseAllPositions = async () => {
    if (openPositions.length === 0) return;
    
    try {
      for (const pos of openPositions) {
        await closePosition(pos.id);
      }
      fetchAccount();
      fetchStats();
      fetchPositions();
      addToast({
        type: 'success',
        title: 'All Positions Closed',
        message: `Closed ${openPositions.length} position(s)`,
      });
    } catch (error) {
      addToast({
        type: 'error',
        title: 'Error',
        message: 'Failed to close all positions',
      });
    }
  };

  const handleAssetSelect = (symbol: string) => {
    setSelectedAsset(symbol);
    setShowAssetSearch(false);
    setSearchQuery('');
  };

  const handleOrderbookPriceClick = useCallback((price: number) => {
    setLimitPriceFromOrderbook(price);
    setMobileTab('orderbook');
  }, []);

  const filteredAssets = getFilteredAssets();
  const openPositions = positions.filter(p => p.status === 'open');

  // Asset Search Modal
  const AssetSearchModal = () => (
    <div className="fixed inset-0 z-50 bg-[#0d0f11]">
      <div className="flex flex-col h-full">
        <div className="p-3 border-b border-[#1e2126]">
          <div className="flex items-center gap-3">
            <button 
              onClick={() => { setShowAssetSearch(false); setSearchQuery(''); }}
              className="p-2 text-gray-400 hover:text-white touch-manipulation"
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
              className="flex-1 bg-[#1a1d21] border border-[#1e2126] rounded-lg px-3 py-2 text-white placeholder-gray-500 focus:outline-none focus:border-[#3dd9a4] text-sm"
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
                'w-full flex items-center justify-between px-4 py-3 border-b border-[#1e2126]/50 transition-colors touch-manipulation',
                asset.symbol === selectedAsset ? 'bg-[#3dd9a4]/10' : 'active:bg-[#1a1d21]'
              )}
            >
              <div className="flex items-center gap-3">
                <span className="text-white font-medium">{asset.symbol}</span>
                <span className="text-gray-500 text-sm">PERP</span>
              </div>
              {asset.symbol === selectedAsset && (
                <svg className="w-5 h-5 text-[#3dd9a4]" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                </svg>
              )}
            </button>
          ))}
        </div>
      </div>
    </div>
  );

  // Expandable Position Card
  const PositionCard = ({ position }: { position: Position }) => {
    const isExpanded = expandedPositionId === position.id;
    const isClosing = closingPositionId === position.id;
    const isProfitable = position.unrealizedPnl >= 0;
    const isLong = position.side === 'long';

    const margin = (position.size * position.entryPrice) / position.leverage;
    const liqPrice = isLong 
      ? position.entryPrice * (1 - 0.9 / position.leverage)
      : position.entryPrice * (1 + 0.9 / position.leverage);

    return (
      <div className={cn(
        'border-b border-[#1e2126]/50',
        isClosing && 'opacity-50'
      )}>
        <button
          onClick={() => setExpandedPositionId(isExpanded ? null : position.id)}
          className="w-full px-3 py-3 touch-manipulation"
        >
          <div className="grid grid-cols-3 gap-2 text-xs">
            <div className="text-left">
              <div className="text-gray-500 mb-0.5">Coin</div>
              <div className="flex items-center gap-1">
                <span className="text-white font-medium">{position.asset}</span>
                <span className={cn(
                  'text-[10px]',
                  isLong ? 'text-[#3dd9a4]' : 'text-[#f6465d]'
                )}>
                  {position.leverage}x
                </span>
              </div>
            </div>
            <div className="text-left">
              <div className="text-gray-500 mb-0.5">Size</div>
              <div className="text-white font-mono">{formatSize(position.size)} {position.asset}</div>
            </div>
            <div className="text-left flex items-center justify-between">
              <div>
                <div className="text-gray-500 mb-0.5">PNL (ROE %)</div>
                <div className={cn(
                  'font-mono font-medium',
                  isProfitable ? 'text-[#3dd9a4]' : 'text-[#f6465d]'
                )}>
                  <AnimatedNumber value={position.unrealizedPnl} format={formatUSD} duration={200} />
                  <span className="text-[10px] ml-1">
                    (<AnimatedNumber value={position.unrealizedPnlPercent} format={formatPercent} duration={200} />)
                  </span>
                </div>
              </div>
              <svg 
                className={cn(
                  'w-4 h-4 text-gray-500 transition-transform',
                  isExpanded && 'rotate-180'
                )} 
                fill="none" 
                stroke="currentColor" 
                viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </div>
          </div>
        </button>

        {isExpanded && (
          <div className="px-3 pb-3 space-y-3 border-t border-[#1e2126]/30 pt-3">
            <div className="grid grid-cols-3 gap-y-3 gap-x-2 text-xs">
              <div>
                <div className="text-gray-500">Entry Price</div>
                <div className="text-white font-mono">{formatPrice(position.entryPrice)}</div>
              </div>
              <div>
                <div className="text-gray-500">Mark Price</div>
                <div className="text-white font-mono">{formatPrice(position.currentPrice)}</div>
              </div>
              <div>
                <div className="text-gray-500">Liq. Price</div>
                <div className="text-[#f0b90b] font-mono">{formatPrice(liqPrice)}</div>
              </div>
              <div>
                <div className="text-gray-500">Position Value</div>
                <div className="text-white font-mono">{formatUSD(position.size * position.currentPrice)}</div>
              </div>
              <div>
                <div className="text-gray-500">Margin</div>
                <div className="text-white font-mono">{formatUSD(margin)}</div>
              </div>
              <div>
                <div className="text-gray-500">TP/SL</div>
                <div className="text-gray-400">-- / --</div>
              </div>
            </div>

            <div className="flex gap-4 pt-2">
              <button
                onClick={() => handleClosePosition(position.id, 'limit')}
                disabled={isClosing}
                className="text-[#3dd9a4] text-sm font-medium touch-manipulation"
              >
                Limit Close
              </button>
              <button
                onClick={() => handleClosePosition(position.id, 'market')}
                disabled={isClosing}
                className="text-[#f6465d] text-sm font-medium touch-manipulation"
              >
                Market Close
              </button>
            </div>
          </div>
        )}
      </div>
    );
  };

  // Desktop Asset Selector
  const DesktopAssetSelector = () => (
    <div className="flex items-center gap-2 bg-[#0d0f11] rounded-lg p-2 border border-[#1e2126] overflow-x-auto">
      <button
        onClick={() => setShowAssetSearch(true)}
        className="flex items-center gap-2 px-3 py-1.5 bg-[#1a1d21] rounded-lg hover:bg-[#22262c] transition-colors"
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
          className="px-3 py-1.5 text-sm text-gray-400 hover:text-white hover:bg-[#1a1d21] rounded-lg transition-colors"
        >
          {symbol}
        </button>
      ))}

      <div className="ml-auto flex items-center gap-2">
        <div className={cn(
          'w-2 h-2 rounded-full',
          isConnected ? 'bg-[#3dd9a4]' : 'bg-[#f6465d]'
        )} />
        <span className="text-xs text-gray-500">{isConnected ? 'Live' : 'Offline'}</span>
      </div>
    </div>
  );

  return (
    <div className="h-full overflow-hidden flex flex-col bg-[#0d0f11]">
      {showAssetSearch && <AssetSearchModal />}

      {/* Mobile Layout */}
      <div className="md:hidden flex flex-col h-[100dvh] pb-12">
        {/* Header */}
        <div className="flex items-center justify-between px-3 py-2.5 bg-[#0d0f11] border-b border-[#1e2126]">
          <button 
            onClick={() => setShowAssetSearch(true)}
            className="flex items-center gap-1.5 touch-manipulation"
          >
            <span className="text-white font-semibold">{selectedAsset}-USDC</span>
            <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>
          <div className="flex items-center gap-3">
            <span className={cn(
              'font-mono font-semibold',
              currentPrice > 0 && currentCandles.length > 0 && currentPrice >= currentCandles[currentCandles.length - 1]?.open 
                ? 'text-[#3dd9a4]' 
                : 'text-[#f6465d]'
            )}>
              {currentPrice > 0 ? formatPrice(currentPrice) : '--'}
            </span>
            <div className={cn(
              'w-2 h-2 rounded-full',
              isConnected ? 'bg-[#3dd9a4]' : 'bg-[#f6465d]'
            )} />
          </div>
        </div>

        {/* Tab bar: Chart | Order Book */}
        <div className="flex border-b border-[#1e2126] bg-[#0d0f11]">
          {[
            { id: 'chart', label: 'Chart' },
            { id: 'orderbook', label: 'Order Book' },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setMobileTab(tab.id as MobileTab)}
              className={cn(
                'flex-1 py-2.5 text-sm font-medium transition-colors touch-manipulation',
                mobileTab === tab.id 
                  ? 'text-white border-b-2 border-[#3dd9a4]' 
                  : 'text-gray-500'
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Main content */}
        <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
          {mobileTab === 'chart' && (
            <>
              {/* Chart - expands when no positions */}
              <div className="flex-1 min-h-[200px]">
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

              {/* Positions section - dynamic */}
              <div className="flex flex-col border-t border-[#1e2126]">
                {/* Positions header */}
                <div className="flex items-center gap-3 px-3 py-2 bg-[#0d0f11] border-b border-[#1e2126]">
                  <span className="text-sm font-medium text-white">
                    Positions ({openPositions.length})
                  </span>
                  {openPositions.length > 0 && (
                    <>
                      <span className="text-gray-600">|</span>
                      <button
                        onClick={handleCloseAllPositions}
                        className="text-xs text-[#f6465d] touch-manipulation"
                      >
                        Close All Positions
                      </button>
                    </>
                  )}
                </div>

                {/* Positions list - scrollable only when needed */}
                <div className={cn(
                  'overflow-y-auto',
                  openPositions.length === 0 ? 'py-4' : 'max-h-[40vh]'
                )}>
                  {openPositions.length === 0 ? (
                    <div className="flex flex-col items-center text-gray-500 text-sm">
                      <p>No open positions</p>
                      {!isAuthenticated && (
                        <Link to="/login" className="text-[#3dd9a4] mt-1 touch-manipulation">Login to trade</Link>
                      )}
                    </div>
                  ) : (
                    openPositions.map((position) => (
                      <PositionCard key={position.id} position={positionsWithLivePnl.find(p => p.id === position.id) || position} />
                    ))
                  )}
                </div>
              </div>
            </>
          )}
          
          {mobileTab === 'orderbook' && (
            <div className="h-full flex">
              <div className="w-[45%] border-r border-[#1e2126] overflow-hidden">
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

        <MobileNav />
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

          {isAuthenticated && openPositions.length > 0 && (
            <div className="flex-shrink-0 max-h-48 overflow-y-auto bg-[#0d0f11] rounded-lg border border-[#1e2126]">
              <div className="flex items-center justify-between px-4 py-2 border-b border-[#1e2126]">
                <span className="text-sm font-medium text-white">Positions ({openPositions.length})</span>
                <button
                  onClick={handleCloseAllPositions}
                  className="text-xs text-[#f6465d]"
                >
                  Close All
                </button>
              </div>
              {openPositions.map((position) => (
                <PositionCard key={position.id} position={positionsWithLivePnl.find(p => p.id === position.id) || position} />
              ))}
            </div>
          )}
        </div>

        <div className="w-80 flex-shrink-0 flex flex-col gap-2 overflow-y-auto">
          {isAuthenticated && (
            <AccountStats
              account={account}
              stats={stats}
              positions={positionsWithLivePnl}
              onReset={async () => {
                await resetAccount();
                fetchPositions();
                addToast({
                  type: 'success',
                  title: 'Account Reset',
                  message: 'Your account has been reset to $100,000',
                });
              }}
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
