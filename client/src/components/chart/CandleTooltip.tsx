import { useEffect, useState } from 'react';
import { formatPrice, formatCompactNumber } from '../../lib/utils';
import type { Candle } from '../../types/market';

interface CandleTooltipProps {
  candle: Candle;
  position: { x: number; y: number };
  containerWidth: number;
  isMobile?: boolean;
}

export function CandleTooltip({ candle, position, containerWidth, isMobile = false }: CandleTooltipProps) {
  const [isVisible, setIsVisible] = useState(false);
  
  useEffect(() => {
    const timer = setTimeout(() => setIsVisible(true), 10);
    return () => clearTimeout(timer);
  }, []);

  const isGreen = candle.close >= candle.open;
  const change = candle.close - candle.open;
  const changePercent = candle.open !== 0 ? (change / candle.open) * 100 : 0;
  const range = candle.high - candle.low;
  const rangePercent = candle.low !== 0 ? (range / candle.low) * 100 : 0;

  const formatTimestamp = (timestamp: number): string => {
    const date = new Date(timestamp);
    const today = new Date();
    const isToday = date.toDateString() === today.toDateString();
    
    const timeStr = date.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
    
    if (isToday) {
      return timeStr;
    }
    
    const dateStr = date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
    });
    
    return `${dateStr} ${timeStr}`;
  };

  const tooltipWidth = 180;
  const tooltipOffset = 15;
  
  let left: number;
  let top: number;
  
  if (isMobile) {
    left = (containerWidth - tooltipWidth) / 2;
    top = 70;
  } else {
    const shouldFlipX = position.x + tooltipWidth + tooltipOffset > containerWidth;
    left = shouldFlipX 
      ? Math.max(10, position.x - tooltipWidth - tooltipOffset)
      : Math.min(position.x + tooltipOffset, containerWidth - tooltipWidth - 10);
    top = 70;
  }

  return (
    <div
      className={`absolute z-20 bg-bg-elevated/95 backdrop-blur-sm border border-border rounded-lg shadow-xl pointer-events-none transition-opacity duration-150 ${
        isVisible ? 'opacity-100' : 'opacity-0'
      }`}
      style={{
        left,
        top,
        width: tooltipWidth,
      }}
    >
      {/* Header with timestamp */}
      <div className="px-3 py-2 border-b border-border">
        <div className="text-xs text-text-muted font-mono">
          {formatTimestamp(candle.time)}
        </div>
      </div>
      
      {/* OHLC Data */}
      <div className="px-3 py-2">
        <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
          <span className="text-text-muted">Open</span>
          <span className="text-text-primary font-mono text-right">
            ${formatPrice(candle.open)}
          </span>

          <span className="text-text-muted">High</span>
          <span className="text-accent-green font-mono text-right">
            ${formatPrice(candle.high)}
          </span>

          <span className="text-text-muted">Low</span>
          <span className="text-accent-red font-mono text-right">
            ${formatPrice(candle.low)}
          </span>

          <span className="text-text-muted">Close</span>
          <span className={`font-mono text-right ${isGreen ? 'text-accent-green' : 'text-accent-red'}`}>
            ${formatPrice(candle.close)}
          </span>
        </div>
      </div>

      {/* Volume & Range */}
      <div className="px-3 py-2 border-t border-border">
        <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
          {candle.volume > 0 && (
            <>
              <span className="text-text-muted">Volume</span>
              <span className="text-accent-cyan font-mono text-right">
                {formatCompactNumber(candle.volume)}
              </span>
            </>
          )}
          
          <span className="text-text-muted">Range</span>
          <span className="text-text-secondary font-mono text-right">
            ${formatPrice(range)} ({rangePercent.toFixed(2)}%)
          </span>
        </div>
      </div>

      {/* Change Summary */}
      <div className="px-3 py-2 border-t border-border">
        <div className={`text-sm font-semibold text-center ${isGreen ? 'text-accent-green' : 'text-accent-red'}`}>
          {isGreen ? '▲' : '▼'} {isGreen ? '+' : ''}{formatPrice(change)} ({isGreen ? '+' : ''}{changePercent.toFixed(2)}%)
        </div>
      </div>
    </div>
  );
}