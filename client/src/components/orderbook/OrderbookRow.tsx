import { cn } from '../../lib/utils';

interface OrderbookRowProps {
  price: number;
  size: number;
  total: number;
  maxTotal: number;
  side: 'bid' | 'ask';
  compact?: boolean;
  onClick?: (price: number) => void;
}

// Format price with appropriate decimals
function formatPrice(price: number): string {
  if (price >= 10000) return price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (price >= 1000) return price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (price >= 100) return price.toLocaleString(undefined, { minimumFractionDigits: 3, maximumFractionDigits: 3 });
  if (price >= 1) return price.toLocaleString(undefined, { minimumFractionDigits: 4, maximumFractionDigits: 4 });
  return price.toLocaleString(undefined, { minimumFractionDigits: 6, maximumFractionDigits: 6 });
}

// Format size compactly
function formatSize(size: number): string {
  if (size >= 1000000) return (size / 1000000).toFixed(2) + 'M';
  if (size >= 1000) return (size / 1000).toFixed(2) + 'K';
  if (size >= 1) return size.toFixed(4);
  return size.toFixed(6);
}

export function OrderbookRow({ price, size, total, maxTotal, side, compact = false, onClick }: OrderbookRowProps) {
  const percentage = (total / maxTotal) * 100;
  const isBid = side === 'bid';

  const handleClick = () => {
    if (onClick) {
      onClick(price);
    }
  };

  return (
    <div 
      className={cn(
        'relative grid grid-cols-2 gap-1 font-mono transition-colors cursor-pointer',
        // More vertical padding to fill space
        compact ? 'px-2 py-[6px] text-[11px]' : 'px-3 py-[5px] text-xs',
        onClick && 'hover:bg-bg-tertiary active:bg-bg-elevated'
      )}
      onClick={handleClick}
    >
      {/* Depth bar */}
      <div
        className={cn(
          'absolute inset-y-0 right-0 transition-all duration-150',
          isBid ? 'bg-accent-green/15' : 'bg-accent-red/15'
        )}
        style={{ width: `${Math.min(percentage, 100)}%` }}
      />

      {/* Price */}
      <span className={cn(
        'relative z-10 tabular-nums',
        isBid ? 'text-accent-green' : 'text-accent-red'
      )}>
        {formatPrice(price)}
      </span>

      {/* Size */}
      <span className="relative z-10 text-right text-gray-300 tabular-nums">
        {formatSize(size)}
      </span>
    </div>
  );
}
