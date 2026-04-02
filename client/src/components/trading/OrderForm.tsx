import { useState, useRef, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '../ui/Button';
import { TRADING_CONSTANTS } from '../../config/constants';
import { formatUSD, calculateMargin, calculateLiquidationPrice } from '../../lib/utils';
import { useToast } from '../../context/ToastContext';
import { useAuthStore } from '../../hooks/useAuth';
import { cn } from '../../lib/utils';
import type { OrderSide, OrderType } from '../../types/trading';

interface OrderFormProps {
  selectedAsset: string;
  currentPrice: number;
  availableBalance: number;
  onPlaceOrder: (order: { 
    asset: string; 
    side: OrderSide; 
    size: number; 
    leverage: number;
    type?: OrderType;
    price?: number;
  }) => Promise<void>;
  isPlacingOrder: boolean;
  compact?: boolean;
  externalLimitPrice?: number | null;
}

export function OrderForm({
  selectedAsset,
  currentPrice,
  availableBalance,
  onPlaceOrder,
  isPlacingOrder,
  compact = false,
  externalLimitPrice,
}: OrderFormProps) {
  const { isAuthenticated } = useAuthStore();
  const [side, setSide] = useState<OrderSide>('long');
  const [orderType, setOrderType] = useState<OrderType>('market');
  const [size, setSize] = useState('');
  const [limitPrice, setLimitPrice] = useState('');
  const [leverage, setLeverage] = useState<number>(TRADING_CONSTANTS.DEFAULT_LEVERAGE);
  const [selectedPercent, setSelectedPercent] = useState<number | null>(null);
  const [hasError, setHasError] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const { addToast } = useToast();

  useEffect(() => {
    if (externalLimitPrice && externalLimitPrice > 0) {
      setLimitPrice(externalLimitPrice.toString());
      setOrderType('limit');
    }
  }, [externalLimitPrice]);

  const sizeNum = parseFloat(size) || 0;
  const limitPriceNum = parseFloat(limitPrice) || currentPrice;
  const effectivePrice = orderType === 'limit' ? limitPriceNum : currentPrice;
  const notionalValue = sizeNum * effectivePrice;
  const margin = calculateMargin(sizeNum, effectivePrice, leverage);
  const liquidationPrice = calculateLiquidationPrice(effectivePrice, leverage, side);
  const canAfford = margin <= availableBalance;

  useEffect(() => {
    if (orderType === 'limit' && !limitPrice && currentPrice > 0) {
      setLimitPrice(currentPrice.toFixed(2));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPrice, orderType]);

  useEffect(() => {
    setSelectedPercent(null);
  }, [size]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (sizeNum <= 0) {
      setHasError(true);
      setTimeout(() => setHasError(false), 500);
      return;
    }

    if (orderType === 'limit' && limitPriceNum <= 0) {
      setHasError(true);
      setTimeout(() => setHasError(false), 500);
      addToast({ type: 'error', title: 'Invalid Price', message: 'Please enter a valid limit price' });
      return;
    }

    if (!canAfford) {
      setHasError(true);
      setTimeout(() => setHasError(false), 500);
      addToast({
        type: 'error',
        title: 'Insufficient Margin',
        message: `Required: ${formatUSD(margin)}, Available: ${formatUSD(availableBalance)}`,
      });
      return;
    }

    try {
      await onPlaceOrder({
        asset: selectedAsset,
        side,
        size: sizeNum,
        leverage,
        type: orderType,
        price: orderType === 'limit' ? limitPriceNum : undefined,
      });
      
      setShowSuccess(true);
      setTimeout(() => setShowSuccess(false), 1000);
      
      addToast({
        type: 'success',
        title: `${side === 'long' ? 'Long' : 'Short'} ${sizeNum.toFixed(4)} ${selectedAsset}`,
        message: `${leverage}x leverage`,
      });
      
      setSize('');
      setSelectedPercent(null);
      if (orderType === 'limit') setLimitPrice('');
    } catch (error) {
      addToast({
        type: 'error',
        title: 'Order Failed',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  };

  const setPercentage = (percent: number) => {
    const maxSize = (availableBalance * leverage) / effectivePrice;
    const newSize = (maxSize * percent) / 100;
    setSize(newSize.toFixed(6));
    setSelectedPercent(percent);
  };

  const handleLeverageChange = (value: number) => {
    setLeverage(value);
  };

  if (compact) {
    // Mobile compact layout - better spacing to fill screen
    return (
      <div className="h-full flex flex-col bg-bg-secondary p-4 relative">
        {/* Side selector */}
        <div className="grid grid-cols-2 gap-2 mb-4">
          <button
            onClick={() => setSide('long')}
            className={cn(
              'py-3 rounded text-sm font-semibold transition-all',
              side === 'long' ? 'bg-accent-green text-black' : 'bg-bg-tertiary text-gray-400'
            )}
          >
            Buy/Long
          </button>
          <button
            onClick={() => setSide('short')}
            className={cn(
              'py-3 rounded text-sm font-semibold transition-all',
              side === 'short' ? 'bg-accent-red text-white' : 'bg-bg-tertiary text-gray-400'
            )}
          >
            Sell/Short
          </button>
        </div>

        {/* Order type */}
        <div className="flex gap-2 mb-4">
          {(['market', 'limit'] as OrderType[]).map((type) => (
            <button
              key={type}
              onClick={() => setOrderType(type)}
              className={cn(
                'flex-1 py-2.5 text-sm font-medium rounded transition-all capitalize',
                orderType === type ? 'bg-bg-elevated text-white' : 'bg-bg-tertiary text-gray-500'
              )}
            >
              {type}
            </button>
          ))}
        </div>

        {/* Price */}
        <div className="flex items-center justify-between text-sm mb-4 px-1">
          <span className="text-gray-500">Price</span>
          {orderType === 'market' ? (
            <span className="text-accent-cyan font-mono text-base">${currentPrice.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
          ) : (
            <input
              type="number"
              value={limitPrice}
              onChange={(e) => setLimitPrice(e.target.value)}
              className="w-32 bg-bg-tertiary border border-border rounded px-3 py-2 text-right text-white font-mono text-sm focus:outline-none focus:border-accent-cyan"
              placeholder="0.00"
            />
          )}
        </div>

        {/* Leverage */}
        <div className="mb-4">
          <div className="flex items-center justify-between text-sm mb-2 px-1">
            <span className="text-gray-500">Leverage</span>
            <span className="text-white font-mono text-base">{leverage}x</span>
          </div>
          <input
            type="range"
            min="1"
            max="50"
            value={leverage}
            onChange={(e) => handleLeverageChange(parseInt(e.target.value))}
            className="w-full touch-slider"
          />
          <div className="flex justify-between text-xs text-gray-600 px-1 mt-1.5">
            <span>1x</span>
            <span>10x</span>
            <span>25x</span>
            <span>50x</span>
          </div>
        </div>

        {/* Size input */}
        <div className="mb-4">
          <div className="flex items-center justify-between text-sm mb-2 px-1">
            <span className="text-gray-500">Size ({selectedAsset})</span>
            {sizeNum > 0 && <span className="text-gray-400 font-mono">= {formatUSD(notionalValue)}</span>}
          </div>
          <input
            ref={inputRef}
            type="number"
            value={size}
            onChange={(e) => setSize(e.target.value)}
            className={cn(
              'w-full bg-bg-tertiary border rounded px-3 py-3 text-white font-mono text-base focus:outline-none',
              hasError ? 'border-accent-red' : 'border-border focus:border-accent-cyan'
            )}
            placeholder="0.00"
            step="0.000001"
          />
        </div>

        {/* Quick percentages */}
        <div className="grid grid-cols-4 gap-2 mb-4">
          {[25, 50, 75, 100].map((percent) => (
            <button
              key={percent}
              type="button"
              onClick={() => setPercentage(percent)}
              className={cn(
                'py-2.5 text-sm font-medium rounded transition-all',
                selectedPercent === percent ? 'bg-accent-cyan/20 text-accent-cyan' : 'bg-bg-tertiary text-gray-500'
              )}
            >
              {percent}%
            </button>
          ))}
        </div>

        {/* Order details */}
        {sizeNum > 0 && (
          <div className="flex justify-between text-sm text-gray-500 mb-4 px-1">
            <span>Margin: <span className={cn('font-mono', canAfford ? 'text-white' : 'text-accent-red')}>{formatUSD(margin)}</span></span>
            <span>Liq: <span className="text-accent-yellow font-mono">${liquidationPrice.toFixed(2)}</span></span>
          </div>
        )}

        {/* Available */}
        <div className="flex items-center justify-between text-sm mb-4 px-1">
          <span className="text-gray-500">Available</span>
          <span className="text-white font-mono">{formatUSD(availableBalance)}</span>
        </div>

        {/* Submit button */}
        <Button
          onClick={handleSubmit}
          variant={side === 'long' ? 'success' : 'danger'}
          className="w-full py-3.5 text-sm font-semibold mt-auto"
          isLoading={isPlacingOrder}
          disabled={sizeNum <= 0 || !canAfford || isPlacingOrder}
        >
          {isPlacingOrder ? 'Placing...' : `${side === 'long' ? 'Buy' : 'Sell'} ${selectedAsset}`}
        </Button>

        {/* Login overlay */}
        {!isAuthenticated && (
          <div className="absolute inset-0 bg-bg-secondary/95 backdrop-blur-sm flex flex-col items-center justify-center p-4">
            <div className="w-12 h-12 mb-4 bg-accent-cyan/20 rounded-full flex items-center justify-center">
              <svg className="w-6 h-6 text-accent-cyan" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
              </svg>
            </div>
            <h3 className="text-white font-semibold mb-1">Login to Trade</h3>
            <p className="text-gray-500 text-sm mb-4 text-center">Create a free account to start</p>
            <div className="flex flex-col gap-2 w-full max-w-[160px]">
              <Link to="/register">
                <Button variant="primary" size="sm" className="w-full">Create Account</Button>
              </Link>
              <Link to="/login">
                <Button variant="ghost" size="sm" className="w-full text-gray-400">Login</Button>
              </Link>
            </div>
          </div>
        )}
      </div>
    );
  }

  // Desktop layout
  return (
    <div className={cn(
      'bg-bg-secondary rounded-xl border border-border transition-all duration-300 relative p-4',
      showSuccess && 'border-accent-green/50'
    )}>
      <div className="grid grid-cols-2 gap-1 mb-3">
        <button
          onClick={() => setSide('long')}
          className={cn(
            'py-2.5 rounded-lg font-semibold text-sm transition-all',
            side === 'long' ? 'bg-accent-green text-black' : 'bg-bg-tertiary text-gray-400 hover:text-accent-green'
          )}
        >
          Buy/Long
        </button>
        <button
          onClick={() => setSide('short')}
          className={cn(
            'py-2.5 rounded-lg font-semibold text-sm transition-all',
            side === 'short' ? 'bg-accent-red text-white' : 'bg-bg-tertiary text-gray-400 hover:text-accent-red'
          )}
        >
          Sell/Short
        </button>
      </div>

      <div className="flex items-center gap-1 mb-3 bg-bg-tertiary rounded-lg p-0.5">
        {(['market', 'limit'] as OrderType[]).map((type) => (
          <button
            key={type}
            onClick={() => setOrderType(type)}
            className={cn(
              'flex-1 py-1.5 text-xs font-medium rounded-md transition-all capitalize',
              orderType === type ? 'bg-bg-elevated text-white' : 'text-gray-500 hover:text-gray-300'
            )}
          >
            {type}
          </button>
        ))}
      </div>

      <form onSubmit={handleSubmit} className="space-y-3">
        {orderType === 'market' ? (
          <div className="flex items-center justify-between text-sm py-2 px-3 bg-bg-tertiary rounded-lg">
            <span className="text-gray-500">Price</span>
            <span className="text-accent-cyan font-mono font-semibold">
              ${currentPrice.toLocaleString(undefined, { minimumFractionDigits: 2 })}
            </span>
          </div>
        ) : (
          <div>
            <label className="block text-xs text-gray-500 mb-1">Limit Price</label>
            <input
              type="number"
              value={limitPrice}
              onChange={(e) => setLimitPrice(e.target.value)}
              className="w-full bg-bg-tertiary border border-border rounded-lg px-3 py-2 text-white font-mono focus:outline-none focus:border-accent-cyan"
              placeholder="0.00"
            />
          </div>
        )}

        <div className="space-y-1">
          <div className="flex items-center justify-between text-xs text-gray-500">
            <span>Leverage</span>
            <span className="font-mono text-white">{leverage}x</span>
          </div>
          <input
            type="range"
            min="1"
            max="50"
            value={leverage}
            onChange={(e) => setLeverage(parseInt(e.target.value))}
            className="w-full touch-slider"
          />
          <div className="flex justify-between text-[10px] text-gray-600">
            <span>1x</span>
            <span>10x</span>
            <span>25x</span>
            <span>50x</span>
          </div>
        </div>

        <div className="space-y-1">
          <label className="block text-xs text-gray-500">Size ({selectedAsset})</label>
          <input
            ref={inputRef}
            type="number"
            value={size}
            onChange={(e) => setSize(e.target.value)}
            className={cn(
              'w-full bg-bg-tertiary border rounded-lg px-3 py-2 text-white font-mono focus:outline-none',
              hasError ? 'border-accent-red animate-shake' : 'border-border focus:border-accent-cyan'
            )}
            placeholder="0.00"
            step="0.000001"
          />
          {sizeNum > 0 && (
            <div className="text-xs text-gray-500 text-right">= {formatUSD(notionalValue)}</div>
          )}
        </div>

        <div className="grid grid-cols-4 gap-1">
          {[25, 50, 75, 100].map((percent) => (
            <button
              key={percent}
              type="button"
              onClick={() => setPercentage(percent)}
              className={cn(
                'py-1 text-xs font-medium rounded transition-all',
                selectedPercent === percent ? 'bg-accent-cyan/20 text-accent-cyan' : 'bg-bg-tertiary text-gray-500 hover:text-white'
              )}
            >
              {percent}%
            </button>
          ))}
        </div>

        {sizeNum > 0 && (
          <div className="p-2 bg-bg-tertiary rounded-lg space-y-1 text-xs">
            <div className="flex justify-between">
              <span className="text-gray-500">Margin</span>
              <span className={cn('font-mono', canAfford ? 'text-white' : 'text-accent-red')}>{formatUSD(margin)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Liq. Price</span>
              <span className="text-accent-yellow font-mono">${liquidationPrice.toFixed(2)}</span>
            </div>
          </div>
        )}

        <div className="flex items-center justify-between text-xs">
          <span className="text-gray-500">Available</span>
          <span className="text-white font-mono">{formatUSD(availableBalance)}</span>
        </div>

        <Button
          type="submit"
          variant={side === 'long' ? 'success' : 'danger'}
          className="w-full"
          isLoading={isPlacingOrder}
          disabled={sizeNum <= 0 || !canAfford || isPlacingOrder}
        >
          {isPlacingOrder ? 'Placing...' : (
            orderType === 'limit' ? 'Place Limit Order' : `${side === 'long' ? 'Buy' : 'Sell'} ${selectedAsset}`
          )}
        </Button>
      </form>

      {!isAuthenticated && (
        <div className="absolute inset-0 bg-bg-secondary/95 backdrop-blur-sm rounded-xl flex flex-col items-center justify-center p-4">
          <div className="text-center">
            <div className="w-12 h-12 mx-auto mb-3 bg-accent-cyan/20 rounded-full flex items-center justify-center">
              <svg className="w-6 h-6 text-accent-cyan" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
              </svg>
            </div>
            <h3 className="text-white font-semibold mb-1">Login to Trade</h3>
            <p className="text-gray-500 text-sm mb-4">Create a free account to start paper trading</p>
            <div className="flex flex-col gap-2">
              <Link to="/register">
                <Button variant="primary" size="sm" className="w-full">Create Account</Button>
              </Link>
              <Link to="/login">
                <Button variant="ghost" size="sm" className="w-full text-gray-400">Already have an account? Login</Button>
              </Link>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
