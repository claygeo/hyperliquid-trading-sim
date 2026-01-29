import { LeaderboardRow } from './LeaderboardRow';
import type { LeaderboardEntry } from '../../types/user';

interface LeaderboardProps {
  entries: LeaderboardEntry[];
}

export function Leaderboard({ entries }: LeaderboardProps) {
  if (entries.length === 0) {
    return (
      <div className="bg-bg-secondary rounded-xl border border-border">
        <div className="flex items-center justify-center h-64 text-text-muted">
          No traders on the leaderboard yet
        </div>
      </div>
    );
  }

  return (
    <div className="bg-bg-secondary rounded-xl border border-border overflow-hidden">
      {/* Desktop column headers */}
      <div className="hidden md:grid grid-cols-7 gap-4 px-4 py-3 text-xs text-text-muted border-b border-border">
        <span>Rank</span>
        <span>Trader</span>
        <span className="text-right">Total PnL</span>
        <span className="text-right">Return %</span>
        <span className="text-right">Win Rate</span>
        <span className="text-right">Max Drawdown</span>
        <span className="text-right">Trades</span>
      </div>

      {/* Mobile header */}
      <div className="md:hidden px-4 py-3 text-xs text-text-muted border-b border-border">
        Top Traders
      </div>

      {/* Leaderboard entries */}
      <div className="divide-y divide-border/50">
        {entries.map((entry) => (
          <LeaderboardRow key={entry.userId} entry={entry} />
        ))}
      </div>
    </div>
  );
}