import { LeaderboardRow } from './LeaderboardRow';
import type { LeaderboardEntry } from '../../types/user';

interface LeaderboardProps {
  entries: LeaderboardEntry[];
}

export function Leaderboard({ entries }: LeaderboardProps) {
  if (entries.length === 0) {
    return (
      <div className="bg-[#13161a] rounded-lg border border-[#1e2126]">
        <div className="flex items-center justify-center h-64 text-gray-500">
          No traders on the leaderboard yet
        </div>
      </div>
    );
  }

  return (
    <div className="bg-[#13161a] rounded-lg border border-[#1e2126] overflow-hidden">
      {/* Desktop column headers */}
      <div className="hidden md:grid grid-cols-7 gap-4 px-4 py-3 text-xs text-gray-500 border-b border-[#1e2126]">
        <span>Rank</span>
        <span>Trader</span>
        <span className="text-right">Total PnL</span>
        <span className="text-right">Return %</span>
        <span className="text-right">Win Rate</span>
        <span className="text-right">Max Drawdown</span>
        <span className="text-right">Trades</span>
      </div>

      {/* Mobile header */}
      <div className="md:hidden px-4 py-3 text-xs text-gray-500 border-b border-[#1e2126]">
        Top Traders
      </div>

      {/* Leaderboard entries */}
      <div className="divide-y divide-[#1e2126]/50">
        {entries.map((entry) => (
          <LeaderboardRow key={entry.userId} entry={entry} />
        ))}
      </div>
    </div>
  );
}