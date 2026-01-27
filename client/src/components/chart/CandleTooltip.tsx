import { formatPrice, formatTimestamp } from '../../lib/utils';
import type { Candle } from '../../types/market';

interface CandleTooltipProps {
  candle: Candle;
  position: { x: number; y: number };
}

export function CandleTooltip({ candle, position }: CandleTooltipProps) {
  const isGreen = candle.close >= candle.open;
  const change = candle.close - candle.open;
  const changePercent = (change / candle.open) * 100;

  // Position tooltip with proper offset from cursor
  // Keep it in the upper left area of the chart for consistency
  return (
    <div
      className="absolute z-20 bg-bg-elevated/95 backdrop-blur-sm border border-border rounded-lg p-3 shadow-xl pointer-events-none"
      style={{
        left: Math.min(position.x + 15, 300), // Limit how far right it can go
        top: 70, // Fixed position below header
      }}
    >
      <div className="text-xs text-text-muted mb-2 font-mono">
        {formatTimestamp(candle.time)}
      </div>
      
      <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
        <span className="text-text-muted">Open:</span>
        <span className="text-text-primary font-mono text-right">
          ${formatPrice(candle.open)}
        </span>

        <span className="text-text-muted">High:</span>
        <span className="text-accent-green font-mono text-right">
          ${formatPrice(candle.high)}
        </span>

        <span className="text-text-muted">Low:</span>
        <span className="text-accent-red font-mono text-right">
          ${formatPrice(candle.low)}
        </span>

        <span className="text-text-muted">Close:</span>
        <span className={`font-mono text-right ${isGreen ? 'text-accent-green' : 'text-accent-red'}`}>
          ${formatPrice(candle.close)}
        </span>

        {candle.volume > 0 && (
          <>
            <span className="text-text-muted">Volume:</span>
            <span className="text-text-primary font-mono text-right">
              {candle.volume.toLocaleString()}
            </span>
          </>
        )}
      </div>

      <div className="mt-2 pt-2 border-t border-border">
        <span className={`text-sm font-semibold ${isGreen ? 'text-accent-green' : 'text-accent-red'}`}>
          {isGreen ? '+' : ''}{formatPrice(change)} ({isGreen ? '+' : ''}{changePercent.toFixed(2)}%)
        </span>
      </div>
    </div>
  );
}
