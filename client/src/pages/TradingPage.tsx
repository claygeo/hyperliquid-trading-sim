import { useEffect, useState, useCallback, useMemo } from 'react';
import { Link, useLocation } from 'react-router-dom';
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

type MobileView = 'markets' | 'trade';
type MarketsTab = 'chart' | 'orderbook';

export function TradingPage() {
  const location = useLocation();
  const initialTab = (location.state as { activeTab?: MobileView })?.activeTab || 'markets';
  const [mobileView, setMobileView] = useState<MobileView>(initialTab);
  const [marketsTab, setMarketsTab] = useState<MarketsTab>('chart');
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isConnected, selectedAsset, isAuthenticated]);

  useEffect(() => {
    fetchCandles(selectedAsset, selectedTimeframe);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (isAuthenticated) {
      fetchPositions();
      fetchAccount();
      fetchStats();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    if (closeType === 'limit') {
      return; // Limit close not supported — button is visually disabled
    }
    
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
        message: 'Market close executed',
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

  const handleAssetSelect = useCallback((symbol: string) => {
    setSelectedAsset(symbol);
    setShowAssetSearch(false);
    setSearchQuery('');
  }, [setSelectedAsset, setSearchQuery]);

  const handleOrderbookPriceClick = useCallback((price: number) => {
    setLimitPriceFromOrderbook(price);
  }, []);

  const filteredAssets = useMemo(() => getFilteredAssets(), [getFilteredAssets]);
  const openPositions = positions.filter(p => p.status === 'open');

  // Trophy Icon - Gray to match unselected nav items
  const TrophyIcon = () => (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 18.75h-9m9 0a3 3 0 013 3h-15a3 3 0 013-3m9 0v-3.375c0-.621-.503-1.125-1.125-1.125h-.871M7.5 18.75v-3.375c0-.621.504-1.125 1.125-1.125h.872m5.007 0H9.497m5.007 0a7.454 7.454 0 01-.982-3.172M9.497 14.25a7.454 7.454 0 00.981-3.172M5.25 4.236c-.982.143-1.954.317-2.916.52A6.003 6.003 0 007.73 9.728M5.25 4.236V4.5c0 2.108.966 3.99 2.48 5.228M5.25 4.236V2.721C7.456 2.41 9.71 2.25 12 2.25c2.291 0 4.545.16 6.75.47v1.516M18.75 4.236c.982.143 1.954.317 2.916.52A6.003 6.003 0 0116.27 9.728M18.75 4.236V4.5c0 2.108-.966 3.99-2.48 5.228m0 0a7.454 7.454 0 01-.982 3.172M7.73 9.728a7.454 7.454 0 00.981 3.172" />
    </svg>
  );

  // Position Card with smaller fonts and text link close buttons
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
          className="w-full px-2 py-2 touch-manipulation"
        >
          {/* Three columns: 20% Coin, 35% Size, 45% PNL */}
          <div className="flex items-start">
            {/* Coin column - 20% */}
            <div className="w-[20%] text-left flex-shrink-0">
              <div className="text-[9px] text-gray-500 mb-0.5">Coin</div>
              <div className="flex items-baseline gap-0.5">
                <span className={cn(
                  'text-[11px] font-medium',
                  isLong ? 'text-[#3dd9a4]' : 'text-[#f6465d]'
                )}>
                  {position.asset}
                </span>
                <span className={cn(
                  'text-[8px] leading-none',
                  isLong ? 'text-[#3dd9a4]' : 'text-[#f6465d]'
                )}>
                  {position.leverage}x
                </span>
              </div>
            </div>
            
            {/* Size column - 35% */}
            <div className="w-[35%] text-left flex-shrink-0">
              <div className="text-[9px] text-gray-500 mb-0.5">Size</div>
              <div className="text-[10px] text-white font-mono">{formatSize(position.size)} {position.asset}</div>
            </div>
            
            {/* PNL column - 45% */}
            <div className="w-[45%] text-left flex items-center justify-between">
              <div className="min-w-0">
                <div className="text-[9px] text-gray-500 mb-0.5">PNL (ROE %)</div>
                <div className={cn(
                  'text-[10px] font-mono font-medium',
                  isProfitable ? 'text-[#3dd9a4]' : 'text-[#f6465d]'
                )}>
                  <AnimatedNumber value={position.unrealizedPnl} format={formatUSD} duration={200} />
                  <span className="text-[8px] ml-0.5">
                    (<AnimatedNumber value={position.unrealizedPnlPercent} format={formatPercent} duration={200} />)
                  </span>
                </div>
              </div>
              <svg 
                className={cn(
                  'w-3 h-3 text-gray-500 transition-transform flex-shrink-0 ml-1',
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
          <div className="px-2 pb-2 space-y-2">
            <div className="grid grid-cols-3 gap-2 text-[10px]">
              <div>
                <div className="text-gray-500 text-[9px]">Entry Price</div>
                <div className="text-white font-mono">{formatPrice(position.entryPrice)}</div>
              </div>
              <div>
                <div className="text-gray-500 text-[9px]">Mark Price</div>
                <div className="text-white font-mono">{formatPrice(position.currentPrice || currentPrice)}</div>
              </div>
              <div>
                <div className="text-gray-500 text-[9px]">Liq. Price</div>
                <div className="text-[#f6465d] font-mono">{formatPrice(liqPrice)}</div>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2 text-[10px]">
              <div>
                <div className="text-gray-500 text-[9px]">Margin</div>
                <div className="text-white font-mono">{formatUSD(margin)}</div>
              </div>
              <div>
                <div className="text-gray-500 text-[9px]">Notional</div>
                <div className="text-white font-mono">{formatUSD(position.size * position.entryPrice)}</div>
              </div>
            </div>
            {/* Text link close buttons like Hyperliquid */}
            <div className="flex items-center justify-center gap-3 pt-1">
              <span
                className="text-[11px] text-gray-600 cursor-not-allowed select-none"
                title="Limit close orders are not supported"
              >
                Limit Close
              </span>
              <span className="text-gray-600">|</span>
              <button
                onClick={() => handleClosePosition(position.id, 'market')}
                disabled={isClosing}
                className="text-[11px] text-[#f6465d] hover:text-[#ff6b6b] transition-colors touch-manipulation disabled:opacity-50"
              >
                {isClosing ? 'Closing...' : 'Market Close'}
              </button>
            </div>
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
        <div className="flex items-center gap-2">
          <Link 
            to="/leaderboard"
            className="p-1.5 text-gray-500 hover:text-gray-400 transition-colors"
            title="Leaderboard"
          >
            <TrophyIcon />
          </Link>
          <span className={cn(
            'text-xl font-mono font-semibold',
            currentPrice > 0 && currentCandles.length > 0 && currentPrice >= currentCandles[currentCandles.length - 1]?.open 
              ? 'text-[#3dd9a4]' 
              : 'text-[#f6465d]'
          )}>
            {currentPrice > 0 ? formatPrice(currentPrice) : '--'}
          </span>
        </div>
      </div>
      <div className="flex items-center gap-3">
        <div className={cn(
          'w-2 h-2 rounded-full',
          isConnected ? 'bg-[#3dd9a4]' : 'bg-[#f6465d]'
        )} />
      </div>
    </div>
  );

  return (
    <div className="h-full overflow-hidden flex flex-col bg-[#0d0f11]">
      {/* Asset Search Modal */}
      {showAssetSearch && (
        <div className="fixed inset-0 z-50 bg-[#0d0f11]">
          <div className="flex flex-col h-full">
            <div className="flex-shrink-0 p-3 border-b border-[#1e2126]">
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
            
            <div 
              className="flex-1 overflow-y-auto overscroll-contain"
              style={{ WebkitOverflowScrolling: 'touch' }}
            >
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
      )}

      {/* Mobile Layout */}
      <div className="md:hidden flex flex-col h-[100dvh] pb-12">
        {/* Header with gray trophy LEFT of price */}
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
            {/* Gray trophy icon */}
            <Link 
              to="/leaderboard"
              className="p-1.5 text-gray-500 hover:text-gray-400 active:text-gray-400 transition-colors touch-manipulation"
            >
              <TrophyIcon />
            </Link>
            <span className={cn(
              'text-base font-semibold tabular-nums',
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

        {/* Main content based on mobile view */}
        <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
          {/* MARKETS VIEW */}
          {mobileView === 'markets' && (
            <div className="flex flex-col h-full">
              {/* Markets sub-tabs: Chart | Order Book */}
              <div className="flex border-b border-[#1e2126] bg-[#0d0f11] flex-shrink-0">
                {[
                  { id: 'chart', label: 'Chart' },
                  { id: 'orderbook', label: 'Order Book' },
                ].map((tab) => (
                  <button
                    key={tab.id}
                    onClick={() => setMarketsTab(tab.id as MarketsTab)}
                    className={cn(
                      'flex-1 py-2.5 text-sm font-medium transition-colors touch-manipulation',
                      marketsTab === tab.id 
                        ? 'text-white border-b-2 border-[#00d4ff]' 
                        : 'text-gray-500'
                    )}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>

              {/* Markets content */}
              <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
                {marketsTab === 'chart' && (
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
                    <div className="flex-shrink-0 border-t border-[#1e2126]">
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
                        openPositions.length === 0 ? 'h-16' : 'h-[120px]'
                      )}>
                        {openPositions.length === 0 ? (
                          <div className="flex flex-col items-center justify-center h-full text-gray-500 text-sm">
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

                {marketsTab === 'orderbook' && (
                  <div className="flex-1 overflow-hidden">
                    <Orderbook 
                      orderbook={orderbook} 
                      asset={selectedAsset} 
                      onPriceClick={handleOrderbookPriceClick}
                    />
                  </div>
                )}
              </div>
            </div>
          )}
          
          {/* TRADE VIEW */}
          {mobileView === 'trade' && (
            <div className="flex-1 flex min-h-0">
              {/* Left side: Orderbook */}
              <div className="w-[45%] border-r border-[#1e2126] overflow-hidden">
                <Orderbook 
                  orderbook={orderbook} 
                  asset={selectedAsset} 
                  compact 
                  onPriceClick={handleOrderbookPriceClick}
                />
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