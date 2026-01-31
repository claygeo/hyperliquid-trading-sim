import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { formatPrice, formatSize, formatUSD, formatPercent } from '../../lib/utils';
import type { Position } from '../../types/trading';

interface ClosePositionModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  position: Position | null;
  isClosing: boolean;
}

export function ClosePositionModal({
  isOpen,
  onClose,
  onConfirm,
  position,
  isClosing,
}: ClosePositionModalProps) {
  if (!position) return null;

  const isProfitable = position.unrealizedPnl >= 0;

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Close Position">
      <div className="space-y-4">
        <p className="text-text-secondary">
          Are you sure you want to close this position?
        </p>

        <div className="p-4 bg-bg-tertiary rounded-lg space-y-3">
          <div className="flex justify-between text-sm">
            <span className="text-text-muted">Asset</span>
            <span className="text-text-primary font-medium">{position.asset}</span>
          </div>

          <div className="flex justify-between text-sm">
            <span className="text-text-muted">Side</span>
            <span className={position.side === 'long' ? 'text-accent-green' : 'text-accent-red'}>
              {position.side.toUpperCase()}
            </span>
          </div>

          <div className="flex justify-between text-sm">
            <span className="text-text-muted">Size</span>
            <span className="text-text-primary font-mono">{formatSize(position.size)}</span>
          </div>

          <div className="flex justify-between text-sm">
            <span className="text-text-muted">Entry Price</span>
            <span className="text-text-primary font-mono">${formatPrice(position.entryPrice)}</span>
          </div>

          <div className="flex justify-between text-sm">
            <span className="text-text-muted">Current Price</span>
            <span className="text-text-primary font-mono">${formatPrice(position.currentPrice)}</span>
          </div>

          <div className="pt-3 border-t border-border">
            <div className="flex justify-between">
              <span className="text-text-muted">Realized PnL</span>
              <div className={`font-mono font-semibold ${isProfitable ? 'text-accent-green' : 'text-accent-red'}`}>
                <span>{formatUSD(position.unrealizedPnl)}</span>
                <span className="ml-2 text-sm opacity-75">
                  ({formatPercent(position.unrealizedPnlPercent)})
                </span>
              </div>
            </div>
          </div>
        </div>

        <div className="flex gap-3 pt-2">
          <Button variant="secondary" className="flex-1 py-3 touch-manipulation" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant={isProfitable ? 'success' : 'danger'}
            className="flex-1 py-3 touch-manipulation"
            onClick={onConfirm}
            isLoading={isClosing}
          >
            {isProfitable ? 'Take Profit' : 'Close at Loss'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
