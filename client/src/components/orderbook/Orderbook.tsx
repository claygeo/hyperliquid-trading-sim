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
}

export function Orderbook({ orderbook, asset, isLoading, compact = false }: OrderbookProps) {
  if (isLoading || !orderbook) {
    return (
      <div className="h-full bg-bg-primary rounded-xl border border-border p-4 flex items-center justify-center">
        <Spinner />
      </div>
    );
  }

  const maxTotal = getMaxTotal(orderbook.bids, orderbook.asks);

  return (
    <div className="h-full bg-bg-primary rounded-xl border border-border flex flex-col">
      {/* Header */}
      <div className={compact ? "px-2 py-2 border-b border-border" : "px-4 py-3 border-b border-border"}>
        <h3 className={compact ? "text-xs font-semibold text-text-primary" : "text-sm font-semibold text-text-primary"}>Order Book</h3>
      </div>

      {/* Column headers */}
      <div className={`grid grid-cols-2 gap-1 ${compact ? 'px-2 py-1' : 'px-4 py-2'} text-xs text-text-muted border-b border-border`}>
        <span>Price</span>
        <span className="text-right">Size</span>
      </div>

      {/* Asks (sells) - reversed so lowest ask is at bottom */}
      <div className="flex-1 overflow-hidden flex flex-col-reverse">
        {orderbook.asks.slice().reverse().map((level, index) => (
          <OrderbookRow
            key={`ask-${index}`}
            price={level.price}
            size={level.size}
            total={level.total}
            maxTotal={maxTotal}
            side="ask"
          />
        ))}
      </div>

      {/* Spread */}
      <OrderbookSpread
        spread={orderbook.spread}
        spreadPercent={orderbook.spreadPercent}
        midPrice={orderbook.midPrice}
      />

      {/* Bids (buys) */}
      <div className="flex-1 overflow-hidden">
        {orderbook.bids.map((level, index) => (
          <OrderbookRow
            key={`bid-${index}`}
            price={level.price}
            size={level.size}
            total={level.total}
            maxTotal={maxTotal}
            side="bid"
          />
        ))}
      </div>
    </div>
  );
}
