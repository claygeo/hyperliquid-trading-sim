import { formatUSD, formatPercent, cn } from '../../lib/utils';
import type { LeaderboardEntry } from '../../types/user';

interface LeaderboardRowProps {
  entry: LeaderboardEntry;
}

// SVG Rank Badge Component
function RankBadge({ rank }: { rank: number }) {
  if (rank === 1) {
    return (
      <div className="w-7 h-7 rounded-full bg-gradient-to-br from-[#ffd700] to-[#ffaa00] flex items-center justify-center shadow-lg shadow-[#ffd700]/20">
        <span className="text-xs font-bold text-black">1</span>
      </div>
    );
  }
  if (rank === 2) {
    return (
      <div className="w-7 h-7 rounded-full bg-gradient-to-br from-[#c0c0c0] to-[#a0a0a0] flex items-center justify-center shadow-lg shadow-gray-400/20">
        <span className="text-xs font-bold text-black">2</span>
      </div>
    );
  }
  if (rank === 3) {
    return (
      <div className="w-7 h-7 rounded-full bg-gradient-to-br from-[#cd7f32] to-[#b87333] flex items-center justify-center shadow-lg shadow-orange-400/20">
        <span className="text-xs font-bold text-black">3</span>
      </div>
    );
  }
  return (
    <div className="w-7 h-7 rounded-full bg-[#1e2126] flex items-center justify-center">
      <span className="text-xs font-medium text-gray-400 font-mono">{rank}</span>
    </div>
  );
}

export function LeaderboardRow({ entry }: LeaderboardRowProps) {
  const isProfitable = entry.totalPnl >= 0;

  return (
    <>
      {/* Mobile card layout */}
      <div className="md:hidden px-4 py-3 hover:bg-[#1a1d21]/50 transition-colors">
        <div className="flex items-center justify-between mb-2">
          {/* Left: Rank + Trader */}
          <div className="flex items-center gap-3">
            <RankBadge rank={entry.rank} />
            <div className="flex items-center">
              <div className="w-8 h-8 bg-[#00d4ff]/15 rounded-full flex items-center justify-center mr-2">
                <span className="text-[#00d4ff] font-medium text-sm">
                  {entry.username.charAt(0).toUpperCase()}
                </span>
              </div>
              <span className="text-white font-medium">{entry.username}</span>
            </div>
          </div>
          
          {/* Right: PnL */}
          <div className="text-right">
            <div className={cn(
              'font-mono font-medium',
              isProfitable ? 'text-[#3dd9a4]' : 'text-[#f6465d]/85'
            )}>
              {formatUSD(entry.totalPnl)}
            </div>
            <div className={cn(
              'text-xs font-mono',
              isProfitable ? 'text-[#3dd9a4]/80' : 'text-[#f6465d]/70'
            )}>
              {formatPercent(entry.totalPnlPercent)}
            </div>
          </div>
        </div>
        
        {/* Stats row */}
        <div className="flex items-center justify-between text-xs text-gray-500 mt-2 pt-2 border-t border-[#1e2126]/30">
          <span>Win: <span className="text-white font-mono">{entry.winRate.toFixed(1)}%</span></span>
          <span>Trades: <span className="text-white font-mono">{entry.tradeCount}</span></span>
          <span>DD: <span className="text-[#f6465d]/70 font-mono">{formatPercent(-Math.abs(entry.maxDrawdown), false)}</span></span>
        </div>
      </div>

      {/* Desktop table layout */}
      <div className="hidden md:grid grid-cols-7 gap-4 px-4 py-3 text-sm hover:bg-[#1a1d21]/50 transition-colors">
        {/* Rank */}
        <div className="flex items-center">
          <RankBadge rank={entry.rank} />
        </div>

        {/* Trader */}
        <div className="flex items-center">
          <div className="w-8 h-8 bg-[#00d4ff]/15 rounded-full flex items-center justify-center mr-2">
            <span className="text-[#00d4ff] font-medium text-sm">
              {entry.username.charAt(0).toUpperCase()}
            </span>
          </div>
          <span className="text-white font-medium">{entry.username}</span>
        </div>

        {/* Total PnL */}
        <div className={cn(
          'text-right font-mono font-medium',
          isProfitable ? 'text-[#3dd9a4]' : 'text-[#f6465d]/85'
        )}>
          {formatUSD(entry.totalPnl)}
        </div>

        {/* Return % */}
        <div className={cn(
          'text-right font-mono',
          isProfitable ? 'text-[#3dd9a4]' : 'text-[#f6465d]/85'
        )}>
          {formatPercent(entry.totalPnlPercent)}
        </div>

        {/* Win Rate */}
        <div className="text-right font-mono text-white">
          {entry.winRate.toFixed(1)}%
        </div>

        {/* Max Drawdown */}
        <div className="text-right font-mono text-[#f6465d]/70">
          {formatPercent(-Math.abs(entry.maxDrawdown), false)}
        </div>

        {/* Trades */}
        <div className="text-right font-mono text-gray-400">
          {entry.tradeCount}
        </div>
      </div>
    </>
  );
}
