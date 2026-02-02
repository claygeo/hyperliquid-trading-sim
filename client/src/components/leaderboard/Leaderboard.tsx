import { LeaderboardRow } from './LeaderboardRow';
import type { LeaderboardEntry } from '../../types/user';

interface LeaderboardProps {
  entries: LeaderboardEntry[];
}

export function Leaderboard({ entries }: LeaderboardProps) {
  if (entries.length === 0) {
    return (
      <div className="bg-[#13161a] rounded-xl border border-[#1e2126]">
        <div className="flex flex-col items-center justify-center h-64 text-gray-500">
          <svg className="w-12 h-12 mb-3 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
          </svg>
          <p className="text-sm">No traders on the leaderboard yet</p>
          <p className="text-xs text-gray-600 mt-1">Complete a trade to appear here</p>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-[#13161a] rounded-xl border border-[#1e2126] overflow-hidden">
      {/* Desktop column headers */}
      <div className="hidden md:grid grid-cols-7 gap-4 px-4 py-3 text-xs text-gray-500 border-b border-[#1e2126]">
        <span>Rank</span>
        <span>Trader</span>
        <span className="text-right">Total PnL</span>
        <span className="text-right">Return %</span>
        <span className="text-right">Win Rate</span>
        <span className="text-right">Max DD</span>
        <span className="text-right">Trades</span>
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
