import { formatPrice, formatSize, formatUSD, formatPercent, truncateAddress } from '../../lib/utils';
import { Badge } from '../ui/Badge';
import type { Participant } from '../../types/trading';

interface ParticipantRowProps {
  participant: Participant;
}

export function ParticipantRow({ participant }: ParticipantRowProps) {
  const isLong = participant.side === 'long';
  const isProfitable = participant.unrealizedPnl >= 0;

  return (
    <div className="grid grid-cols-9 gap-2 px-4 py-2.5 text-xs border-b border-border/50 hover:bg-bg-tertiary transition-colors">
      {/* Trader */}
      <div className="flex items-center gap-2">
        {participant.isWhale && (
          <span className="text-accent-yellow" title="Whale">🐋</span>
        )}
        <span className="font-mono text-text-primary">
          {participant.username || truncateAddress(participant.address)}
        </span>
      </div>

      {/* Asset */}
      <div className="text-text-primary font-medium">
        {participant.asset}
      </div>

      {/* Side */}
      <div>
        <Badge size="sm" variant={isLong ? 'success' : 'danger'}>
          {isLong ? 'LONG' : 'SHORT'}
        </Badge>
      </div>

      {/* Size */}
      <div className="text-right font-mono text-text-primary">
        {formatSize(participant.size)}
      </div>

      {/* Entry Price */}
      <div className="text-right font-mono text-text-secondary">
        ${formatPrice(participant.entryPrice)}
      </div>

      {/* Current Price */}
      <div className="text-right font-mono text-text-primary">
        ${formatPrice(participant.currentPrice)}
      </div>

      {/* PnL */}
      <div className={`text-right font-mono ${isProfitable ? 'text-accent-green' : 'text-accent-red'}`}>
        <div>{formatUSD(participant.unrealizedPnl)}</div>
        <div className="opacity-75">
          {formatPercent(participant.unrealizedPnlPercent)}
        </div>
      </div>

      {/* Liquidation Price */}
      <div className="text-right font-mono text-accent-yellow">
        ${formatPrice(participant.liquidationPrice)}
      </div>

      {/* Margin */}
      <div className="text-right font-mono text-text-secondary">
        {formatUSD(participant.margin)}
      </div>
    </div>
  );
}
