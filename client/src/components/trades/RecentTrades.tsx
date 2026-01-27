import { TradeRow } from './TradeRow';
import type { Trade } from '../../types/market';
import { Spinner } from '../ui/Spinner';

interface RecentTradesProps {
  trades: Trade[];
  asset: string;
  isLoading?: boolean;
}

export function RecentTrades({ trades, asset, isLoading }: RecentTradesProps) {
  if (isLoading) {
    return (
      <div className="h-full bg-bg-secondary rounded-xl border border-border p-4 flex items-center justify-center">
        <Spinner />
      </div>
    );
  }

  return (
    <div className="h-full bg-bg-secondary rounded-xl border border-border flex flex-col">
      {/* Header */}
      <div className="px-4 py-3 border-b border-border">
        <h3 className="text-sm font-semibold text-text-primary">Recent Trades</h3>
      </div>

      {/* Column headers */}
      <div className="grid grid-cols-3 gap-2 px-4 py-2 text-xs text-text-muted border-b border-border">
        <span>Price (USD)</span>
        <span className="text-right">Size ({asset})</span>
        <span className="text-right">Time</span>
      </div>

      {/* Trades list */}
      <div className="flex-1 overflow-y-auto">
        {trades.length === 0 ? (
          <div className="flex items-center justify-center h-full text-text-muted text-sm">
            No recent trades
          </div>
        ) : (
          trades.map((trade, index) => (
            <TradeRow key={`${trade.id}-${index}`} trade={trade} />
          ))
        )}
      </div>
    </div>
  );
}
