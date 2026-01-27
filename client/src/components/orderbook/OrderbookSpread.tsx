import { formatPrice } from '../../lib/utils';
import { AnimatedNumber } from '../ui/AnimatedNumber';

interface OrderbookSpreadProps {
  spread: number;
  spreadPercent: number;
  midPrice: number;
}

export function OrderbookSpread({ spread, spreadPercent, midPrice }: OrderbookSpreadProps) {
  return (
    <div className="px-4 py-2 bg-bg-tertiary border-y border-border">
      <div className="flex items-center justify-between text-xs">
        <span className="text-text-muted">Spread</span>
        <div className="flex items-center gap-2">
          <span className="text-text-primary font-mono">
            $<AnimatedNumber 
              value={spread} 
              format={(v) => formatPrice(v, 4)} 
              duration={150}
            />
          </span>
          <span className="text-text-muted">
            (<AnimatedNumber 
              value={spreadPercent} 
              format={(v) => v.toFixed(4)} 
              duration={150}
            />%)
          </span>
        </div>
      </div>
      <div className="mt-1 text-center">
        <span className="text-lg font-bold font-mono text-accent-cyan">
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
