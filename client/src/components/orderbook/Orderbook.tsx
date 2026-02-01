import { cn } from '../../lib/utils';
import type { Orderbook as OrderbookType } from '../../types/market';

interface OrderbookProps {
  orderbook: OrderbookType | null;
  asset: string;
  isLoading?: boolean;
  compact?: boolean;
  onPriceClick?: (price: number) => void;
}

// Format price with appropriate decimals
function formatPrice(price: number): string {
  if (price >= 10000) return price.toFixed(1);
  if (price >= 1000) return price.toFixed(2);
  if (price >= 100) return price.toFixed(3);
  if (price >= 1) return price.toFixed(3);
  return price.toFixed(6);
}

// Format size compactly
function formatTotal(size: number): string {
  if (size >= 1000000) return (size / 1000000).toFixed(2) + 'M';
  if (size >= 1000) return (size / 1000).toFixed(2) + 'K';
  if (size >= 100) return size.toFixed(1);
  if (size >= 1) return size.toFixed(2);
  return size.toFixed(2);
}

export function Orderbook({ orderbook, asset, isLoading, compact = false, onPriceClick }: OrderbookProps) {
  // Show loading or empty state
  if (!orderbook || (orderbook.bids.length === 0 && orderbook.asks.length === 0)) {
    return (
      <div className="h-full bg-[#0d0f11] flex flex-col overflow-hidden">
        <div className="px-3 py-2 border-b border-[#1e2126] flex-shrink-0">
          <div className="flex items-center justify-between">
            <span className="text-xs text-gray-500">0.001</span>
            <span className="text-xs font-medium text-gray-400 uppercase">{asset}</span>
          </div>
        </div>
        <div className="flex-1 flex items-center justify-center">
          <div className="flex flex-col items-center gap-2">
            <div className="w-5 h-5 border-2 border-[#00d4ff]/50 border-t-[#00d4ff] rounded-full animate-spin" />
            <span className="text-xs text-gray-500">Loading...</span>
          </div>
        </div>
      </div>
    );
  }

  // Calculate max totals for depth visualization
  const displayLevels = compact ? 12 : 14;
  const bids = orderbook.bids.slice(0, displayLevels);
  const asks = orderbook.asks.slice(0, displayLevels);
  
  const maxBidTotal = bids.length > 0 ? Math.max(...bids.map(b => b.total)) : 1;
  const maxAskTotal = asks.length > 0 ? Math.max(...asks.map(a => a.total)) : 1;
  const maxTotal = Math.max(maxBidTotal, maxAskTotal);

  // Pad arrays to same length
  const maxLength = Math.max(bids.length, asks.length, displayLevels);
  const paddedBids = [...bids, ...Array(maxLength - bids.length).fill(null)];
  const paddedAsks = [...asks, ...Array(maxLength - asks.length).fill(null)];

  return (
    <div className="h-full bg-[#0d0f11] flex flex-col overflow-hidden">
      {/* Header */}
      <div className="px-3 py-2 border-b border-[#1e2126] flex-shrink-0">
        <div className="flex items-center justify-between">
          <span className="text-xs text-gray-500">0.001 ↓</span>
          <span className="text-xs font-medium text-gray-400 uppercase">{asset}</span>
        </div>
      </div>

      {/* Column Headers */}
      <div className="grid grid-cols-4 px-2 py-1.5 text-[10px] text-gray-500 border-b border-[#1e2126] flex-shrink-0">
        <span>Total ({asset})</span>
        <span className="text-center">Price</span>
        <span className="text-center">Price</span>
        <span className="text-right">Total ({asset})</span>
      </div>

      {/* Order Book Rows */}
      <div className="flex-1 overflow-y-auto min-h-0">
        {paddedBids.map((bid, index) => {
          const ask = paddedAsks[index];
          const bidDepth = bid ? (bid.total / maxTotal) * 100 : 0;
          const askDepth = ask ? (ask.total / maxTotal) * 100 : 0;

          return (
            <div 
              key={index} 
              className="grid grid-cols-4 relative font-mono text-[11px]"
              style={{ height: compact ? '24px' : '26px' }}
            >
              {/* Bid depth bar (from right to left) */}
              {bid && (
                <div 
                  className="absolute left-0 top-0 bottom-0 bg-[#3dd9a4]/15"
                  style={{ width: `${Math.min(bidDepth, 50)}%` }}
                />
              )}
              
              {/* Ask depth bar (from left to right on right side) */}
              {ask && (
                <div 
                  className="absolute right-0 top-0 bottom-0 bg-[#f6465d]/15"
                  style={{ width: `${Math.min(askDepth, 50)}%` }}
                />
              )}

              {/* Bid Total */}
              <div 
                className={cn(
                  "relative z-10 flex items-center px-2 text-gray-400 tabular-nums",
                  bid && onPriceClick && "cursor-pointer hover:bg-[#1a1d21]"
                )}
                onClick={() => bid && onPriceClick?.(bid.price)}
              >
                {bid ? formatTotal(bid.total) : ''}
              </div>

              {/* Bid Price */}
              <div 
                className={cn(
                  "relative z-10 flex items-center justify-center text-[#3dd9a4] tabular-nums",
                  bid && onPriceClick && "cursor-pointer hover:bg-[#1a1d21]"
                )}
                onClick={() => bid && onPriceClick?.(bid.price)}
              >
                {bid ? formatPrice(bid.price) : ''}
              </div>

              {/* Ask Price */}
              <div 
                className={cn(
                  "relative z-10 flex items-center justify-center text-[#f6465d] tabular-nums",
                  ask && onPriceClick && "cursor-pointer hover:bg-[#1a1d21]"
                )}
                onClick={() => ask && onPriceClick?.(ask.price)}
              >
                {ask ? formatPrice(ask.price) : ''}
              </div>

              {/* Ask Total */}
              <div 
                className={cn(
                  "relative z-10 flex items-center justify-end px-2 text-gray-400 tabular-nums",
                  ask && onPriceClick && "cursor-pointer hover:bg-[#1a1d21]"
                )}
                onClick={() => ask && onPriceClick?.(ask.price)}
              >
                {ask ? formatTotal(ask.total) : ''}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
