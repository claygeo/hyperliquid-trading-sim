import { formatPrice, formatSize, formatTimestamp } from '../../lib/utils';
import { cn } from '../../lib/utils';
import type { Trade } from '../../types/market';

interface TradeRowProps {
  trade: Trade;
  isNew?: boolean;
}

export function TradeRow({ trade, isNew }: TradeRowProps) {
  const isBuy = trade.side === 'buy';

  return (
    <div className={cn(
      'grid grid-cols-3 gap-2 px-4 py-1.5 text-xs font-mono border-b border-border/50 transition-all duration-200',
      isNew && 'animate-fadeIn',
      trade.isSimulated && 'bg-accent-purple/5'
    )}>
      {/* Price */}
      <span className={cn(
        'transition-colors duration-150',
        isBuy ? 'text-accent-green' : 'text-accent-red'
      )}>
        {formatPrice(trade.price)}
      </span>

      {/* Size */}
      <span className="text-right text-text-primary">
        {formatSize(trade.size)}
      </span>

      {/* Time */}
      <span className="text-right text-text-muted">
        {formatTimestamp(trade.timestamp)}
      </span>
    </div>
  );
}
