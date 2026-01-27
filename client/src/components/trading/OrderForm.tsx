import { useState, useRef, useEffect } from 'react';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { Select } from '../ui/Select';
import { ASSETS } from '../../config/assets';
import { TRADING_CONSTANTS } from '../../config/constants';
import { formatUSD, calculateMargin, calculateLiquidationPrice } from '../../lib/utils';
import { useToast } from '../../context/ToastContext';
import { cn } from '../../lib/utils';
import type { OrderSide } from '../../types/trading';

interface OrderFormProps {
  selectedAsset: string;
  currentPrice: number;
  availableBalance: number;
  onPlaceOrder: (order: { asset: string; side: OrderSide; size: number; leverage: number }) => Promise<void>;
  isPlacingOrder: boolean;
}

export function OrderForm({
  selectedAsset,
  currentPrice,
  availableBalance,
  onPlaceOrder,
  isPlacingOrder,
}: OrderFormProps) {
  const [side, setSide] = useState<OrderSide>('long');
  const [size, setSize] = useState('');
  const [leverage, setLeverage] = useState(TRADING_CONSTANTS.DEFAULT_LEVERAGE);
  const [selectedPercent, setSelectedPercent] = useState<number | null>(null);
  const [hasError, setHasError] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const { addToast } = useToast();

  const sizeNum = parseFloat(size) || 0;
  const notionalValue = sizeNum * currentPrice;
  const margin = calculateMargin(sizeNum, currentPrice, leverage);
  const liquidationPrice = calculateLiquidationPrice(currentPrice, leverage, side);
  const canAfford = margin <= availableBalance;

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
      });
      
      // Success feedback
      setShowSuccess(true);
      setTimeout(() => setShowSuccess(false), 1000);
      
      addToast({
        type: 'success',
        title: `${side === 'long' ? 'Long' : 'Short'} ${sizeNum.toFixed(4)} ${selectedAsset}`,
        message: `Entry @ $${currentPrice.toLocaleString()} • ${leverage}x leverage`,
      });
      
      setSize('');
      setSelectedPercent(null);
    } catch (error) {
      addToast({
        type: 'error',
        title: 'Order Failed',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  };

  const leverageOptions = [1, 2, 5, 10, 20, 25, 50].map((l) => ({
    value: l.toString(),
    label: `${l}x`,
  }));

  const setPercentage = (percent: number) => {
    const maxSize = (availableBalance * leverage) / currentPrice;
    const newSize = (maxSize * percent) / 100;
    setSize(newSize.toFixed(6));
    setSelectedPercent(percent);
  };

  // Handle Enter key
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e as unknown as React.FormEvent);
    }
  };

  return (
    <div className={cn(
      'bg-bg-secondary rounded-xl border border-border p-4 transition-all duration-300',
      showSuccess && 'border-accent-green/50 shadow-[0_0_20px_rgba(0,255,136,0.1)]'
    )}>
      <h3 className="text-sm font-semibold text-text-primary mb-4">Place Order</h3>

      {/* Side selector */}
      <div className="grid grid-cols-2 gap-2 mb-4">
        <button
          onClick={() => setSide('long')}
          className={cn(
            'py-3 rounded-lg font-semibold transition-all duration-200',
            side === 'long'
              ? 'bg-accent-green text-bg-primary shadow-[0_0_15px_rgba(0,255,136,0.2)]'
              : 'bg-bg-tertiary text-text-secondary hover:text-accent-green hover:bg-bg-tertiary/80'
          )}
        >
          Long
        </button>
        <button
          onClick={() => setSide('short')}
          className={cn(
            'py-3 rounded-lg font-semibold transition-all duration-200',
            side === 'short'
              ? 'bg-accent-red text-white shadow-[0_0_15px_rgba(255,51,102,0.2)]'
              : 'bg-bg-tertiary text-text-secondary hover:text-accent-red hover:bg-bg-tertiary/80'
          )}
        >
          Short
        </button>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4" onKeyDown={handleKeyDown}>
        {/* Asset display */}
        <div className="flex items-center justify-between text-sm">
          <span className="text-text-muted">Asset</span>
          <span className="text-text-primary font-medium">
            {ASSETS[selectedAsset]?.icon} {selectedAsset}/USD
          </span>
        </div>

        {/* Current price */}
        <div className="flex items-center justify-between text-sm">
          <span className="text-text-muted">Market Price</span>
          <span className="text-accent-cyan font-mono font-semibold transition-all duration-200">
            ${currentPrice.toLocaleString(undefined, { minimumFractionDigits: 2 })}
          </span>
        </div>

        {/* Leverage */}
        <Select
          label="Leverage"
          options={leverageOptions}
          value={leverage.toString()}
          onChange={(e) => setLeverage(parseInt(e.target.value))}
        />

        {/* Size */}
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
            className={cn(
              hasError && 'animate-shake border-accent-red focus:border-accent-red'
            )}
          />
          {/* USD value preview */}
          {sizeNum > 0 && (
            <div className="text-xs text-text-muted text-right pr-1 transition-all duration-200">
              ≈ {formatUSD(notionalValue)}
            </div>
          )}
        </div>

        {/* Quick size buttons */}
        <div className="grid grid-cols-4 gap-2">
          {[25, 50, 75, 100].map((percent) => (
            <button
              key={percent}
              type="button"
              onClick={() => setPercentage(percent)}
              className={cn(
                'py-1.5 text-xs font-medium rounded-lg transition-all duration-200',
                selectedPercent === percent
                  ? 'bg-accent-cyan/20 text-accent-cyan border border-accent-cyan/50'
                  : 'bg-bg-tertiary text-text-secondary hover:text-text-primary hover:bg-bg-tertiary/80'
              )}
            >
              {percent}%
            </button>
          ))}
        </div>

        {/* Order details */}
        {sizeNum > 0 && (
          <div className="p-3 bg-bg-tertiary rounded-lg space-y-2 text-sm animate-fadeIn">
            <div className="flex justify-between">
              <span className="text-text-muted">Notional Value</span>
              <span className="text-text-primary font-mono">{formatUSD(notionalValue)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-text-muted">Required Margin</span>
              <span className={cn(
                'font-mono transition-colors duration-200',
                canAfford ? 'text-text-primary' : 'text-accent-red'
              )}>
                {formatUSD(margin)}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-text-muted">Liquidation Price</span>
              <span className="text-accent-yellow font-mono">
                ${liquidationPrice.toFixed(2)}
              </span>
            </div>
          </div>
        )}

        {/* Available balance */}
        <div className="flex items-center justify-between text-sm">
          <span className="text-text-muted">Available</span>
          <span className="text-text-primary font-mono transition-all duration-300">
            {formatUSD(availableBalance)}
          </span>
        </div>

        {/* Submit button */}
        <Button
          type="submit"
          variant={side === 'long' ? 'success' : 'danger'}
          className={cn(
            'w-full transition-all duration-200',
            showSuccess && 'scale-[0.98]'
          )}
          isLoading={isPlacingOrder}
          disabled={sizeNum <= 0 || !canAfford || isPlacingOrder}
        >
          {isPlacingOrder ? 'Placing Order...' : (
            <>{side === 'long' ? 'Buy / Long' : 'Sell / Short'} {selectedAsset}</>
          )}
        </Button>

        {!canAfford && sizeNum > 0 && (
          <p className="text-xs text-accent-red text-center animate-fadeIn">
            Insufficient margin
          </p>
        )}
      </form>
    </div>
  );
}
