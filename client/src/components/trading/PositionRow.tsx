import { useState } from 'react';
import { formatPrice, formatSize, formatUSD, formatPercent } from '../../lib/utils';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { AnimatedNumber } from '../ui/AnimatedNumber';
import { cn } from '../../lib/utils';
import type { Position } from '../../types/trading';

interface PositionRowProps {
  position: Position;
  onClose: () => void;
  isClosing?: boolean;
}

export function PositionRow({ position, onClose, isClosing }: PositionRowProps) {
  const isLong = position.side === 'long';
  const isProfitable = position.unrealizedPnl >= 0;

  return (
    <div className={cn(
      'grid grid-cols-8 gap-2 px-4 py-3 text-sm border-b border-border/50 transition-all duration-300',
      isClosing ? 'opacity-50 scale-[0.98] bg-bg-tertiary/50' : 'hover:bg-bg-tertiary'
    )}>
      {/* Asset */}
      <div className="flex items-center gap-2">
        <span className="font-medium text-text-primary">{position.asset}</span>
        <Badge size="sm" variant="info">{position.leverage}x</Badge>
      </div>

      {/* Side */}
      <div>
        <Badge variant={isLong ? 'success' : 'danger'}>
          {isLong ? 'LONG' : 'SHORT'}
        </Badge>
      </div>

      {/* Size */}
      <div className="text-right font-mono text-text-primary">
        {formatSize(position.size)}
      </div>

      {/* Entry Price */}
      <div className="text-right font-mono text-text-secondary">
        ${formatPrice(position.entryPrice)}
      </div>

      {/* Current Price */}
      <div className="text-right font-mono text-text-primary">
        <AnimatedNumber
          value={position.currentPrice}
          format={(v) => `$${formatPrice(v)}`}
          duration={200}
        />
      </div>

      {/* PnL */}
      <div className={cn(
        'text-right font-mono font-semibold transition-colors duration-200',
        isProfitable ? 'text-accent-green' : 'text-accent-red'
      )}>
        <div>
          <AnimatedNumber
            value={position.unrealizedPnl}
            format={formatUSD}
            duration={200}
          />
        </div>
        <div className="text-xs opacity-75">
          <AnimatedNumber
            value={position.unrealizedPnlPercent}
            format={formatPercent}
            duration={200}
          />
        </div>
      </div>

      {/* Liquidation Price */}
      <div className="text-right font-mono text-accent-yellow">
        ${formatPrice(position.liquidationPrice)}
      </div>

      {/* Action */}
      <div className="text-right">
        <Button 
          variant="ghost" 
          size="sm" 
          onClick={onClose}
          disabled={isClosing}
          className={cn(
            'transition-all duration-200',
            isClosing && 'opacity-50'
          )}
        >
          {isClosing ? 'Closing...' : 'Close'}
        </Button>
      </div>
    </div>
  );
}
