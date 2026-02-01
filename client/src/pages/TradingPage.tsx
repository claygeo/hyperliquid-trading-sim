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

type MobileView = 'chart' | 'trade';
type TradeTab = 'orderbook' | 'trades';

export function TradingPage() {
  const [mobileView, setMobileView] = useState<MobileView>('chart');
  const [tradeTab, setTradeTab] = useState<TradeTab>('orderbook');
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

  useEffect(() => {
    fetchCandles(selectedAsset, selectedTimeframe);
  }, []);

  useEffect(() => {
    if (isAuthenticated) {
      fetchPositions();
      fetchAccount();
      fetchStats();
    }
  }, [isAuthenticated]);

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
              className="flex-1 bg-[#1a1d21] border border-[#1e2126] rounded-lg px-3 py-2 text-white placeholder-gray-500 focus:outline-none focus:border-[#00d4ff] text-sm"
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
                asset.symbol === selectedAsset ? 'bg-[#00d4ff]/10' : 'active:bg-[#1a1d21]'
              )}
            >
              <div className="flex items-center gap-3">
                <span className="text-white font-medium">{asset.symbol}</span>
                <span className="text-gray-500 text-sm">PERP</span>
              </div>
              {asset.symbol === selectedAsset && (
                <svg className="w-5 h-5 text-[#00d4ff]" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                </svg>
              )}
            </button>
          ))}
        </div>
      </div>
    </div>
  );

  // Position Card Component
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
              <div className="flex items-baseline gap-1">
                <span className="text-white font-medium">{position.asset}</span>
                <span className={cn(
                  'text-[10px] leading-none',
                  isLong ? 'text-[#00d4ff]' : 'text-[#f6465d]'
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
          <div className="px-3 pb-3 space-y-3">
            <div className="grid grid-cols-3 gap-2 text-xs">
              <div>
                <div className="text-gray-500">Entry Price</div>
                <div className="text-white font-mono">{formatPrice(position.entryPrice)}</div>
              </div>
              <div>
                <div className="text-gray-500">Mark Price</div>
                <div className="text-white font-mono">{formatPrice(position.currentPrice || currentPrice)}</div>
              </div>
              <div>
                <div className="text-gray-500">Liq. Price</div>
                <div className="text-[#f6465d] font-mono">{formatPrice(liqPrice)}</div>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div>
                <div className="text-gray-500">Margin</div>
                <div className="text-white font-mono">{formatUSD(margin)}</div>
              </div>
              <div>
                <div className="text-gray-500">Notional</div>
                <div className="text-white font-mono">{formatUSD(position.size * position.entryPrice)}</div>
              </div>
            </div>
            <button
              onClick={() => handleClosePosition(position.id, 'market')}
              disabled={isClosing}
              className="w-full py-2.5 bg-[#f6465d] text-white rounded-lg text-sm font-medium touch-manipulation disabled:opacity-50"
            >
              {isClosing ? 'Closing...' : 'Market Close'}
            </button>
          </div>
        )}
      </div>
    );
  };

  // Desktop Asset Selector
  const DesktopAssetSelector = () => (
    <div className="hidden md:flex items-center justify-between px-4 py-2 bg-[#0d0f11] border border-[#1e2126] rounded-lg">
      <div className="flex items-center gap-4">
        <button 
          onClick={() => setShowAssetSearch(true)}
          className="flex items-center gap-2 hover:bg-[#1a1d21] px-2 py-1 rounded transition-colors"
        >
          <span className="text-white font-semibold text-lg">{selectedAsset}-USDC</span>
          <span className="text-xs px-1.5 py-0.5 bg-[#1a1d21] rounded text-gray-400">PERP</span>
          <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>
        <div className={cn(
          'text-xl font-mono font-semibold',
          currentPrice > 0 && currentCandles.length > 0 && currentPrice >= currentCandles[currentCandles.length - 1]?.open 
            ? 'text-[#3dd9a4]' 
            : 'text-[#f6465d]'
        )}>
          {currentPrice > 0 ? formatPrice(currentPrice) : '--'}
        </div>
      </div>
      <div className="flex items-center gap-3">
        <Link 
          to="/leaderboard"
          className="p-2 text-gray-400 hover:text-[#ffd700] transition-colors"
          title="Leaderboard"
        >
          <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M5 2a1 1 0 011 1v1h1a1 1 0 010 2H6v1a1 1 0 01-2 0V6H3a1 1 0 010-2h1V3a1 1 0 011-1zm0 10a1 1 0 011 1v1h1a1 1 0 110 2H6v1a1 1 0 11-2 0v-1H3a1 1 0 110-2h1v-1a1 1 0 011-1zM12 2a1 1 0 01.967.744L14.146 7.2 17.5 9.134a1 1 0 010 1.732l-3.354 1.935-1.18 4.455a1 1 0 01-1.933 0L9.854 12.8 6.5 10.866a1 1 0 010-1.732l3.354-1.935 1.18-4.455A1 1 0 0112 2z" clipRule="evenodd" />
          </svg>
        </Link>
        <div className={cn(
          'w-2 h-2 rounded-full',
          isConnected ? 'bg-[#3dd9a4]' : 'bg-[#f6465d]'
        )} />
      </div>
    </div>
  );

  return (
    <div className="h-full overflow-hidden flex flex-col bg-[#0d0f11]">
      {showAssetSearch && <AssetSearchModal />}

      {/* Mobile Layout */}
      <div className="md:hidden flex flex-col h-[100dvh] pb-14">
        {/* Header with trophy icon */}
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
          <div className="flex items-center gap-2">
            <span className={cn(
              'font-sans text-base font-semibold tabular-nums',
              currentPrice > 0 && currentCandles.length > 0 && currentPrice >= currentCandles[currentCandles.length - 1]?.open 
                ? 'text-[#3dd9a4]' 
                : 'text-[#f6465d]'
            )}>
              {currentPrice > 0 ? formatPrice(currentPrice) : '--'}
            </span>
            {/* Trophy icon for leaderboard */}
            <Link 
              to="/leaderboard"
              className="p-1.5 text-gray-400 hover:text-[#ffd700] active:text-[#ffd700] transition-colors touch-manipulation"
            >
              <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M5 2a1 1 0 011 1v1h1a1 1 0 010 2H6v1a1 1 0 01-2 0V6H3a1 1 0 010-2h1V3a1 1 0 011-1zm0 10a1 1 0 011 1v1h1a1 1 0 110 2H6v1a1 1 0 11-2 0v-1H3a1 1 0 110-2h1v-1a1 1 0 011-1zM12 2a1 1 0 01.967.744L14.146 7.2 17.5 9.134a1 1 0 010 1.732l-3.354 1.935-1.18 4.455a1 1 0 01-1.933 0L9.854 12.8 6.5 10.866a1 1 0 010-1.732l3.354-1.935 1.18-4.455A1 1 0 0112 2z" clipRule="evenodd" />
              </svg>
            </Link>
            <div className={cn(
              'w-2 h-2 rounded-full',
              isConnected ? 'bg-[#3dd9a4]' : 'bg-[#f6465d]'
            )} />
          </div>
        </div>

        {/* Main content based on mobile view */}
        <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
          {mobileView === 'chart' && (
            <>
              {/* Chart */}
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

              {/* Positions section */}
              <div className="flex flex-col border-t border-[#1e2126]">
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

                <div className={cn(
                  'overflow-y-auto',
                  openPositions.length === 0 ? 'py-4' : 'max-h-[40vh]'
                )}>
                  {openPositions.length === 0 ? (
                    <div className="flex flex-col items-center text-gray-500 text-sm">
                      <p>No open positions</p>
                      {!isAuthenticated && (
                        <Link to="/login" className="text-[#00d4ff] mt-1 touch-manipulation">Login to trade</Link>
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
          
          {mobileView === 'trade' && (
            <div className="flex flex-col h-full">
              {/* Trade view tabs: Order Book | Trades */}
              <div className="flex border-b border-[#1e2126] bg-[#0d0f11] flex-shrink-0">
                {[
                  { id: 'orderbook', label: 'Order Book' },
                  { id: 'trades', label: 'Trades' },
                ].map((tab) => (
                  <button
                    key={tab.id}
                    onClick={() => setTradeTab(tab.id as TradeTab)}
                    className={cn(
                      'flex-1 py-2 text-sm font-medium transition-colors touch-manipulation',
                      tradeTab === tab.id 
                        ? 'text-white border-b-2 border-[#00d4ff]' 
                        : 'text-gray-500'
                    )}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>

              {/* Trade content */}
              <div className="flex-1 flex min-h-0">
                {/* Left side: Order Book or Trades */}
                <div className="w-[45%] border-r border-[#1e2126] overflow-hidden">
                  {tradeTab === 'orderbook' ? (
                    <Orderbook 
                      orderbook={orderbook} 
                      asset={selectedAsset} 
                      compact 
                      onPriceClick={handleOrderbookPriceClick}
                    />
                  ) : (
                    <RecentTrades trades={trades} asset={selectedAsset} />
                  )}
                </div>
                
                {/* Right side: Order Form */}
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
            </div>
          )}
        </div>

        <MobileNav activeTab={mobileView} onTabChange={setMobileView} />
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
