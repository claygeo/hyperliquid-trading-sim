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
    <>
      {/* Mobile card layout */}
      <div className={cn(
        'md:hidden px-4 py-3 border-b border-border/50 transition-all duration-300',
        isClosing ? 'opacity-50 bg-bg-tertiary/50' : ''
      )}>
        {/* Top row: Asset, Side, PnL */}
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <span className="font-medium text-text-primary text-base">{position.asset}</span>
            <Badge size="sm" variant="info">{position.leverage}x</Badge>
            <Badge size="sm" variant={isLong ? 'success' : 'danger'}>
              {isLong ? 'LONG' : 'SHORT'}
            </Badge>
          </div>
          <div className={cn(
            'text-right font-mono font-semibold',
            isProfitable ? 'text-accent-green' : 'text-accent-red'
          )}>
            <AnimatedNumber
              value={position.unrealizedPnl}
              format={formatUSD}
              duration={200}
            />
            <div className="text-xs opacity-75">
              <AnimatedNumber
                value={position.unrealizedPnlPercent}
                format={formatPercent}
                duration={200}
              />
            </div>
          </div>
        </div>

        {/* Middle row: Price info */}
        <div className="flex items-center justify-between text-xs text-text-muted mb-3">
          <span>Entry: <span className="text-text-secondary font-mono">${formatPrice(position.entryPrice)}</span></span>
          <span>Current: <span className="text-text-primary font-mono">${formatPrice(position.currentPrice)}</span></span>
          <span>Size: <span className="text-text-primary font-mono">{formatSize(position.size)}</span></span>
        </div>

        {/* Bottom row: Liq price + Close button */}
        <div className="flex items-center justify-between">
          <span className="text-xs text-text-muted">
            Liq: <span className="text-accent-yellow font-mono">${formatPrice(position.liquidationPrice)}</span>
          </span>
          <Button 
            variant="danger" 
            size="sm" 
            onClick={onClose}
            disabled={isClosing}
          >
            {isClosing ? 'Closing...' : 'Close Position'}
          </Button>
        </div>
      </div>

      {/* Desktop table layout */}
      <div className={cn(
        'hidden md:grid grid-cols-8 gap-2 px-4 py-3 text-sm border-b border-border/50 transition-all duration-300',
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
    </>
  );
}