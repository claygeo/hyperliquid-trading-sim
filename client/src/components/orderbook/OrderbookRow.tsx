import { formatPrice, formatSize } from '../../lib/utils';

interface OrderbookRowProps {
  price: number;
  size: number;
  total: number;
  maxTotal: number;
  side: 'bid' | 'ask';
}

export function OrderbookRow({ price, size, total, maxTotal, side }: OrderbookRowProps) {
  const percentage = (total / maxTotal) * 100;
  const isBid = side === 'bid';

  return (
    <div className="relative grid grid-cols-3 gap-2 px-4 py-1 text-xs font-mono hover:bg-bg-tertiary transition-colors">
      {/* Depth bar */}
      <div
        className={`absolute inset-y-0 ${isBid ? 'right-0' : 'right-0'} ${
          isBid ? 'bg-accent-green/10' : 'bg-accent-red/10'
        }`}
        style={{ width: `${percentage}%` }}
      />

      {/* Price */}
      <span className={`relative z-10 ${isBid ? 'text-accent-green' : 'text-accent-red'}`}>
        {formatPrice(price)}
      </span>

      {/* Size */}
      <span className="relative z-10 text-right text-text-primary">
        {formatSize(size)}
      </span>

      {/* Total */}
      <span className="relative z-10 text-right text-text-secondary">
        {formatSize(total)}
      </span>
    </div>
  );
}
