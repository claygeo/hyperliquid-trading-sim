import { useState, useRef, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
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
}

export function OrderForm({
  selectedAsset,
  currentPrice,
  availableBalance,
  onPlaceOrder,
  isPlacingOrder,
  compact = false,
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

  const sizeNum = parseFloat(size) || 0;
  const limitPriceNum = parseFloat(limitPrice) || currentPrice;
  const effectivePrice = orderType === 'limit' ? limitPriceNum : currentPrice;
  const notionalValue = sizeNum * effectivePrice;
  const margin = calculateMargin(sizeNum, effectivePrice, leverage);
  const liquidationPrice = calculateLiquidationPrice(effectivePrice, leverage, side);
  const canAfford = margin <= availableBalance;

  // Update limit price when current price changes significantly
  useEffect(() => {
    if (orderType === 'limit' && !limitPrice) {
      setLimitPrice(currentPrice.toFixed(2));
    }
  }, [currentPrice, orderType]);

  // Clear selected percent when size is manually edited
  useEffect(() => {
    setSelectedPercent(null);
  }, [size]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (sizeNum <= 0) {
      setHasError(true);
      setTimeout(() => setHasError(false), 500);
      inputRef.current?.focus();
      return;
    }

    if (orderType === 'limit' && limitPriceNum <= 0) {
      setHasError(true);
      setTimeout(() => setHasError(false), 500);
      addToast({
        type: 'error',
        title: 'Invalid Price',
        message: 'Please enter a valid limit price',
      });
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
      
      const priceStr = orderType === 'limit' ? `Limit @ $${limitPriceNum.toLocaleString()}` : `Market @ $${currentPrice.toLocaleString()}`;
      addToast({
        type: 'success',
        title: `${side === 'long' ? 'Long' : 'Short'} ${sizeNum.toFixed(4)} ${selectedAsset}`,
        message: `${priceStr} - ${leverage}x leverage`,
      });
      
      setSize('');
      setSelectedPercent(null);
      if (orderType === 'limit') {
        setLimitPrice('');
      }
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

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e as unknown as React.FormEvent);
    }
  };

  return (
    <div className={cn(
      'bg-bg-secondary rounded-xl border border-border transition-all duration-300 relative',
      compact ? 'p-3' : 'p-4',
      showSuccess && 'border-accent-green/50 shadow-[0_0_20px_rgba(0,255,136,0.1)]'
    )}>
      {/* Side selector - Binance style */}
      <div className="grid grid-cols-2 gap-1 mb-3">
        <button
          onClick={() => setSide('long')}
          className={cn(
            'py-2.5 rounded-lg font-semibold text-sm transition-all duration-200',
            side === 'long'
              ? 'bg-accent-green text-bg-primary'
              : 'bg-bg-tertiary text-text-secondary hover:text-accent-green'
          )}
        >
          Buy/Long
        </button>
        <button
          onClick={() => setSide('short')}
          className={cn(
            'py-2.5 rounded-lg font-semibold text-sm transition-all duration-200',
            side === 'short'
              ? 'bg-accent-red text-white'
              : 'bg-bg-tertiary text-text-secondary hover:text-accent-red'
          )}
        >
          Sell/Short
        </button>
      </div>

      {/* Order type selector */}
      <div className="flex items-center gap-1 mb-3 bg-bg-tertiary rounded-lg p-0.5">
        {(['market', 'limit'] as OrderType[]).map((type) => (
          <button
            key={type}
            onClick={() => setOrderType(type)}
            className={cn(
              'flex-1 py-1.5 text-xs font-medium rounded-md transition-all capitalize',
              orderType === type
                ? 'bg-bg-elevated text-text-primary'
                : 'text-text-muted hover:text-text-secondary'
            )}
          >
            {type}
          </button>
        ))}
      </div>

      <form onSubmit={handleSubmit} className="space-y-3" onKeyDown={handleKeyDown}>
        {/* Price display / input */}
        {orderType === 'market' ? (
          <div className="flex items-center justify-between text-sm py-2 px-3 bg-bg-tertiary rounded-lg">
            <span className="text-text-muted">Price</span>
            <span className="text-accent-cyan font-mono font-semibold">
              ${currentPrice.toLocaleString(undefined, { minimumFractionDigits: 2 })}
            </span>
          </div>
        ) : (
          <Input
            label="Limit Price"
            type="number"
            step="0.01"
            min="0"
            placeholder="0.00"
            value={limitPrice}
            onChange={(e) => setLimitPrice(e.target.value)}
            className={cn(hasError && !limitPriceNum && 'animate-shake border-accent-red')}
          />
        )}

        {/* Leverage selector */}
        <div className="space-y-1">
          <div className="flex items-center justify-between text-xs text-text-muted">
            <span>Leverage</span>
            <span className="font-mono text-text-primary">{leverage}x</span>
          </div>
          <input
            type="range"
            min="1"
            max="50"
            value={leverage}
            onChange={(e) => setLeverage(parseInt(e.target.value))}
            className="w-full h-1.5 bg-bg-tertiary rounded-lg appearance-none cursor-pointer accent-accent-cyan"
          />
          <div className="flex justify-between text-[10px] text-text-muted">
            <span>1x</span>
            <span>10x</span>
            <span>25x</span>
            <span>50x</span>
          </div>
        </div>

        {/* Size input */}
        <div className="space-y-1">
          <Input
            ref={inputRef}
            label={`Size (${selectedAsset})`}
            type="number"
            step="0.000001"
            min="0"
            placeholder="0.00"
            value={size}
            onChange={(e) => setSize(e.target.value)}
            className={cn(hasError && 'animate-shake border-accent-red')}
          />
          {sizeNum > 0 && (
            <div className="text-xs text-text-muted text-right pr-1">
              = {formatUSD(notionalValue)}
            </div>
          )}
        </div>

        {/* Quick size buttons */}
        <div className="grid grid-cols-4 gap-1">
          {[25, 50, 75, 100].map((percent) => (
            <button
              key={percent}
              type="button"
              onClick={() => setPercentage(percent)}
              className={cn(
                'py-1 text-xs font-medium rounded transition-all',
                selectedPercent === percent
                  ? 'bg-accent-cyan/20 text-accent-cyan'
                  : 'bg-bg-tertiary text-text-muted hover:text-text-primary'
              )}
            >
              {percent}%
            </button>
          ))}
        </div>

        {/* Order details */}
        {sizeNum > 0 && (
          <div className="p-2 bg-bg-tertiary rounded-lg space-y-1 text-xs">
            <div className="flex justify-between">
              <span className="text-text-muted">Margin</span>
              <span className={cn('font-mono', canAfford ? 'text-text-primary' : 'text-accent-red')}>
                {formatUSD(margin)}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-text-muted">Liq. Price</span>
              <span className="text-accent-yellow font-mono">${liquidationPrice.toFixed(2)}</span>
            </div>
          </div>
        )}

        {/* Available balance */}
        <div className="flex items-center justify-between text-xs">
          <span className="text-text-muted">Available</span>
          <span className="text-text-primary font-mono">{formatUSD(availableBalance)}</span>
        </div>

        {/* Submit button */}
        <Button
          type="submit"
          variant={side === 'long' ? 'success' : 'danger'}
          className={cn('w-full', showSuccess && 'scale-[0.98]')}
          isLoading={isPlacingOrder}
          disabled={sizeNum <= 0 || !canAfford || isPlacingOrder}
        >
          {isPlacingOrder ? 'Placing...' : (
            <span>
              {orderType === 'limit' ? 'Place Limit Order' : (
                side === 'long' ? `Buy ${selectedAsset}` : `Sell ${selectedAsset}`
              )}
            </span>
          )}
        </Button>
      </form>

      {/* Login prompt overlay for non-authenticated users */}
      {!isAuthenticated && (
        <div className="absolute inset-0 bg-bg-secondary/95 backdrop-blur-sm rounded-xl flex flex-col items-center justify-center p-4">
          <div className="text-center">
            <div className="w-12 h-12 mx-auto mb-3 bg-gradient-to-br from-accent-cyan to-accent-purple rounded-full flex items-center justify-center">
              <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
              </svg>
            </div>
            <h3 className="text-white font-semibold mb-1">Login to Trade</h3>
            <p className="text-text-muted text-sm mb-4">Create a free account to start paper trading</p>
            <div className="flex flex-col gap-2">
              <Link to="/register">
                <Button variant="primary" size="sm" className="w-full">
                  Create Account
                </Button>
              </Link>
              <Link to="/login">
                <Button variant="ghost" size="sm" className="w-full text-gray-400">
                  Already have an account? Login
                </Button>
              </Link>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}