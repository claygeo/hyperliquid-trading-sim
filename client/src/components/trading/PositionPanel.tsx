import { useState } from 'react';
import { PositionRow } from './PositionRow';
import { ClosePositionModal } from './ClosePositionModal';
import { useToast } from '../../context/ToastContext';
import { formatUSD } from '../../lib/utils';
import type { Position } from '../../types/trading';
import { Spinner } from '../ui/Spinner';

interface PositionPanelProps {
  positions: Position[];
  onClosePosition: (positionId: string) => Promise<void>;
  isLoading?: boolean;
  compact?: boolean;
}

export function PositionPanel({ positions, onClosePosition, isLoading, compact = false }: PositionPanelProps) {
  const [closingPosition, setClosingPosition] = useState<Position | null>(null);
  const [closingIds, setClosingIds] = useState<Set<string>>(new Set());
  const { addToast } = useToast();

  const openPositions = positions.filter((p) => p.status === 'open');

  const handleClose = async () => {
    if (!closingPosition) return;
    
    const positionId = closingPosition.id;
    const pnl = closingPosition.unrealizedPnl;
    const asset = closingPosition.asset;
    const side = closingPosition.side;
    
    // Optimistically mark as closing
    setClosingIds((prev) => new Set(prev).add(positionId));
    setClosingPosition(null);
    
    try {
      await onClosePosition(positionId);
      
      // Success toast
      addToast({
        type: pnl >= 0 ? 'success' : 'error',
        title: `Closed ${side} ${asset}`,
        message: `${pnl >= 0 ? '+' : ''}${formatUSD(pnl)} realized`,
      });
    } catch (error) {
      // Remove from closing state on error
      setClosingIds((prev) => {
        const next = new Set(prev);
        next.delete(positionId);
        return next;
      });
      
      addToast({
        type: 'error',
        title: 'Failed to close position',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  };

  if (isLoading) {
    return (
      <div className="bg-bg-primary rounded-xl border border-border p-4 flex items-center justify-center h-full">
        <Spinner />
      </div>
    );
  }

  return (
    <>
      <div className={`bg-bg-primary rounded-xl border border-border h-full flex flex-col ${compact ? 'text-xs' : ''}`}>
        {/* Header */}
        <div className={`${compact ? 'px-2 py-2' : 'px-4 py-3'} border-b border-border flex items-center justify-between flex-shrink-0`}>
          <h3 className={`${compact ? 'text-xs' : 'text-sm'} font-semibold text-text-primary`}>
            Positions ({openPositions.length})
          </h3>
        </div>

        {/* Desktop column headers */}
        <div className="hidden md:grid grid-cols-8 gap-2 px-4 py-2 text-xs text-text-muted border-b border-border flex-shrink-0">
          <span>Asset</span>
          <span>Side</span>
          <span className="text-right">Size</span>
          <span className="text-right">Entry</span>
          <span className="text-right">Current</span>
          <span className="text-right">PnL</span>
          <span className="text-right">Liq. Price</span>
          <span className="text-right">Action</span>
        </div>

        {/* Positions list */}
        <div className="flex-1 overflow-y-auto">
          {openPositions.length === 0 ? (
            <div className="flex items-center justify-center h-full text-text-muted text-sm py-8">
              No open positions
            </div>
          ) : (
            openPositions.map((position) => (
              <PositionRow
                key={position.id}
                position={position}
                onClose={() => setClosingPosition(position)}
                isClosing={closingIds.has(position.id)}
              />
            ))
          )}
        </div>
      </div>

      {/* Close confirmation modal */}
      <ClosePositionModal
        isOpen={!!closingPosition}
        onClose={() => setClosingPosition(null)}
        onConfirm={handleClose}
        position={closingPosition}
        isClosing={closingIds.has(closingPosition?.id || '')}
      />
    </>
  );
}