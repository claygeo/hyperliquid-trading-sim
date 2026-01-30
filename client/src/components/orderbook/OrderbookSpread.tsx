import { formatPrice } from '../../lib/utils';
import { AnimatedNumber } from '../ui/AnimatedNumber';
import { cn } from '../../lib/utils';

interface OrderbookSpreadProps {
  spread: number;
  spreadPercent: number;
  midPrice: number;
  compact?: boolean;
}

export function OrderbookSpread({ spread, spreadPercent, midPrice, compact = false }: OrderbookSpreadProps) {
  return (
    <div className={cn(
      'bg-bg-tertiary border-y border-border flex-shrink-0',
      compact ? 'px-2 py-1.5' : 'px-4 py-2'
    )}>
      <div className={cn(
        'flex items-center justify-between',
        compact ? 'text-[10px]' : 'text-xs'
      )}>
        <span className="text-gray-500">Spread</span>
        <div className="flex items-center gap-1">
          <span className="text-gray-300 font-mono">
            $<AnimatedNumber 
              value={spread} 
              format={(v) => formatPrice(v, 4)} 
              duration={150}
            />
          </span>
          <span className="text-gray-500">
            (<AnimatedNumber 
              value={spreadPercent} 
              format={(v) => v.toFixed(4)} 
              duration={150}
            />%)
          </span>
        </div>
      </div>
      <div className={cn('text-center', compact ? 'mt-0.5' : 'mt-1')}>
        <span className={cn(
          'font-bold font-mono text-accent-cyan',
          compact ? 'text-base' : 'text-lg'
        )}>
          $<AnimatedNumber 
            value={midPrice} 
            format={formatPrice} 
            duration={150}
          />
        </span>
      </div>
    </div>
  );
}
