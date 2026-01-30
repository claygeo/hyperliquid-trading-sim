import { OrderbookRow } from './OrderbookRow';
import { OrderbookSpread } from './OrderbookSpread';
import { getMaxTotal } from './orderbook.utils';
import type { Orderbook as OrderbookType } from '../../types/market';
import { Spinner } from '../ui/Spinner';

interface OrderbookProps {
  orderbook: OrderbookType | null;
  asset: string;
  isLoading?: boolean;
  compact?: boolean;
  onPriceClick?: (price: number) => void;
}

export function Orderbook({ orderbook, asset, isLoading, compact = false, onPriceClick }: OrderbookProps) {
  if (isLoading || !orderbook) {
    return (
      <div className="h-full bg-bg-primary rounded-xl border border-border p-4 flex items-center justify-center">
        <Spinner />
      </div>
    );
  }

  const maxTotal = getMaxTotal(orderbook.bids, orderbook.asks);

  // For mobile compact view, show fewer levels
  const displayLevels = compact ? 8 : 10;
  const asks = orderbook.asks.slice(0, displayLevels);
  const bids = orderbook.bids.slice(0, displayLevels);

  return (
    <div className="h-full bg-bg-primary flex flex-col overflow-hidden">
      {/* Header */}
      <div className={compact ? "px-2 py-1.5 border-b border-border flex-shrink-0" : "px-4 py-2 border-b border-border flex-shrink-0"}>
        <h3 className={compact ? "text-[10px] font-semibold text-gray-400 uppercase tracking-wide" : "text-xs font-semibold text-gray-400"}>Order Book</h3>
      </div>

      {/* Column headers */}
      <div className={`grid grid-cols-2 gap-1 ${compact ? 'px-2 py-1' : 'px-3 py-1.5'} text-[10px] text-gray-500 border-b border-border flex-shrink-0`}>
        <span>Price</span>
        <span className="text-right">Size</span>
      </div>

      {/* Asks (sells) - reversed so lowest ask is at bottom */}
      <div className="flex-1 overflow-hidden flex flex-col-reverse min-h-0">
        {asks.slice().reverse().map((level, index) => (
          <OrderbookRow
            key={`ask-${index}`}
            price={level.price}
            size={level.size}
            total={level.total}
            maxTotal={maxTotal}
            side="ask"
            compact={compact}
            onClick={onPriceClick}
          />
        ))}
      </div>

      {/* Spread */}
      <OrderbookSpread
        spread={orderbook.spread}
        spreadPercent={orderbook.spreadPercent}
        midPrice={orderbook.midPrice}
        compact={compact}
      />

      {/* Bids (buys) */}
      <div className="flex-1 overflow-hidden min-h-0">
        {bids.map((level, index) => (
          <OrderbookRow
            key={`bid-${index}`}
            price={level.price}
            size={level.size}
            total={level.total}
            maxTotal={maxTotal}
            side="bid"
            compact={compact}
            onClick={onPriceClick}
          />
        ))}
      </div>
    </div>
  );
}
