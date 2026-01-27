import { formatUSD, formatPercent } from '../../lib/utils';
import type { LeaderboardEntry } from '../../types/user';

interface LeaderboardRowProps {
  entry: LeaderboardEntry;
}

export function LeaderboardRow({ entry }: LeaderboardRowProps) {
  const isProfitable = entry.totalPnl >= 0;

  const getRankStyle = (rank: number) => {
    if (rank === 1) return 'bg-accent-yellow/20 text-accent-yellow';
    if (rank === 2) return 'bg-gray-400/20 text-gray-300';
    if (rank === 3) return 'bg-orange-400/20 text-orange-400';
    return 'bg-bg-tertiary text-text-secondary';
  };

  const getRankIcon = (rank: number) => {
    if (rank === 1) return '🥇';
    if (rank === 2) return '🥈';
    if (rank === 3) return '🥉';
    return null;
  };

  return (
    <div className="grid grid-cols-7 gap-4 px-4 py-3 text-sm hover:bg-bg-tertiary transition-colors">
      {/* Rank */}
      <div className="flex items-center gap-2">
        {getRankIcon(entry.rank) || (
          <span
            className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold ${getRankStyle(
              entry.rank
            )}`}
          >
            {entry.rank}
          </span>
        )}
      </div>

      {/* Trader */}
      <div className="flex items-center">
        <div className="w-8 h-8 bg-accent-purple/20 rounded-full flex items-center justify-center mr-2">
          <span className="text-accent-purple font-semibold text-sm">
            {entry.username.charAt(0).toUpperCase()}
          </span>
        </div>
        <span className="text-text-primary font-medium">{entry.username}</span>
      </div>

      {/* Total PnL */}
      <div className={`text-right font-mono font-semibold ${isProfitable ? 'text-accent-green' : 'text-accent-red'}`}>
        {formatUSD(entry.totalPnl)}
      </div>

      {/* Return % */}
      <div className={`text-right font-mono ${isProfitable ? 'text-accent-green' : 'text-accent-red'}`}>
        {formatPercent(entry.totalPnlPercent)}
      </div>

      {/* Win Rate */}
      <div className="text-right font-mono text-text-primary">
        {entry.winRate.toFixed(1)}%
      </div>

      {/* Max Drawdown */}
      <div className="text-right font-mono text-accent-red">
        {formatPercent(-Math.abs(entry.maxDrawdown), false)}
      </div>

      {/* Trades */}
      <div className="text-right font-mono text-text-secondary">
        {entry.tradeCount}
      </div>
    </div>
  );
}
