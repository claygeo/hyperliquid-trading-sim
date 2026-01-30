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
  compact?: boolean;
}

export function PositionRow({ position, onClose, isClosing, compact = false }: PositionRowProps) {
  const isLong = position.side === 'long';
  const isProfitable = position.unrealizedPnl >= 0;

  if (compact) {
    // Ultra compact mobile layout
    return (
      <div className={cn(
        'px-2 py-2 border-b border-border/30 transition-all',
        isClosing && 'opacity-50'
      )}>
        <div className="flex items-center justify-between">
          {/* Left: Asset info */}
          <div className="flex items-center gap-1.5">
            <span className="font-medium text-white text-sm">{position.asset}</span>
            <span className={cn(
              'text-[10px] px-1 py-0.5 rounded font-medium',
              isLong ? 'bg-accent-green/20 text-accent-green' : 'bg-accent-red/20 text-accent-red'
            )}>
              {position.leverage}x {isLong ? 'L' : 'S'}
            </span>
          </div>
          
          {/* Right: PnL + Close */}
          <div className="flex items-center gap-2">
            <div className={cn(
              'text-right font-mono text-sm font-semibold',
              isProfitable ? 'text-accent-green' : 'text-accent-red'
            )}>
              <AnimatedNumber value={position.unrealizedPnl} format={formatUSD} duration={200} />
              <span className="text-[10px] opacity-75 ml-1">
                (<AnimatedNumber value={position.unrealizedPnlPercent} format={formatPercent} duration={200} />)
              </span>
            </div>
            <button
              onClick={onClose}
              disabled={isClosing}
              className="px-2 py-1 text-[10px] font-medium text-accent-red bg-accent-red/10 rounded hover:bg-accent-red/20 transition-colors"
            >
              {isClosing ? '...' : 'Close'}
            </button>
          </div>
        </div>
        
        {/* Bottom row: Entry/Current/Size */}
        <div className="flex items-center justify-between mt-1 text-[10px] text-gray-500">
          <span>Entry: <span className="text-gray-300 font-mono">${formatPrice(position.entryPrice)}</span></span>
          <span>Now: <span className="text-white font-mono">${formatPrice(position.currentPrice)}</span></span>
          <span>Size: <span className="text-gray-300 font-mono">{formatSize(position.size)}</span></span>
        </div>
      </div>
    );
  }

  return (
    <>
      {/* Mobile card layout */}
      <div className={cn(
        'md:hidden px-3 py-2.5 border-b border-border/50 transition-all duration-300',
        isClosing ? 'opacity-50 bg-bg-tertiary/50' : ''
      )}>
        {/* Top row: Asset, Side, PnL */}
        <div className="flex items-center justify-between mb-1.5">
          <div className="flex items-center gap-2">
            <span className="font-medium text-white text-sm">{position.asset}</span>
            <Badge size="sm" variant="info">{position.leverage}x</Badge>
            <Badge size="sm" variant={isLong ? 'success' : 'danger'}>
              {isLong ? 'LONG' : 'SHORT'}
            </Badge>
          </div>
          <div className={cn(
            'text-right font-mono font-semibold text-sm',
            isProfitable ? 'text-accent-green' : 'text-accent-red'
          )}>
            <AnimatedNumber value={position.unrealizedPnl} format={formatUSD} duration={200} />
            <div className="text-[10px] opacity-75">
              <AnimatedNumber value={position.unrealizedPnlPercent} format={formatPercent} duration={200} />
            </div>
          </div>
        </div>

        {/* Middle row: Price info */}
        <div className="flex items-center justify-between text-[11px] text-gray-500 mb-2">
          <span>Entry: <span className="text-gray-300 font-mono">${formatPrice(position.entryPrice)}</span></span>
          <span>Current: <span className="text-white font-mono">${formatPrice(position.currentPrice)}</span></span>
          <span>Size: <span className="text-gray-300 font-mono">{formatSize(position.size)}</span></span>
        </div>

        {/* Bottom row: Liq price + Close button */}
        <div className="flex items-center justify-between">
          <span className="text-[11px] text-gray-500">
            Liq: <span className="text-accent-yellow font-mono">${formatPrice(position.liquidationPrice)}</span>
          </span>
          <Button 
            variant="danger" 
            size="sm" 
            onClick={onClose}
            disabled={isClosing}
            className="text-xs px-3 py-1"
          >
            {isClosing ? 'Closing...' : 'Close'}
          </Button>
        </div>
      </div>

      {/* Desktop table layout */}
      <div className={cn(
        'hidden md:grid grid-cols-8 gap-2 px-4 py-2.5 text-sm border-b border-border/50 transition-all duration-300',
        isClosing ? 'opacity-50 bg-bg-tertiary/50' : 'hover:bg-bg-tertiary'
      )}>
        <div className="flex items-center gap-2">
          <span className="font-medium text-white">{position.asset}</span>
          <Badge size="sm" variant="info">{position.leverage}x</Badge>
        </div>

        <div>
          <Badge variant={isLong ? 'success' : 'danger'}>
            {isLong ? 'LONG' : 'SHORT'}
          </Badge>
        </div>

        <div className="text-right font-mono text-gray-300">
          {formatSize(position.size)}
        </div>

        <div className="text-right font-mono text-gray-400">
          ${formatPrice(position.entryPrice)}
        </div>

        <div className="text-right font-mono text-white">
          <AnimatedNumber value={position.currentPrice} format={(v) => `$${formatPrice(v)}`} duration={200} />
        </div>

        <div className={cn(
          'text-right font-mono font-semibold',
          isProfitable ? 'text-accent-green' : 'text-accent-red'
        )}>
          <div>
            <AnimatedNumber value={position.unrealizedPnl} format={formatUSD} duration={200} />
          </div>
          <div className="text-xs opacity-75">
            <AnimatedNumber value={position.unrealizedPnlPercent} format={formatPercent} duration={200} />
          </div>
        </div>

        <div className="text-right font-mono text-accent-yellow">
          ${formatPrice(position.liquidationPrice)}
        </div>

        <div className="text-right">
          <Button 
            variant="ghost" 
            size="sm" 
            onClick={onClose}
            disabled={isClosing}
            className="text-xs"
          >
            {isClosing ? 'Closing...' : 'Close'}
          </Button>
        </div>
      </div>
    </>
  );
}
