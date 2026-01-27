import { useState } from 'react';
import { formatUSD, formatPercent } from '../../lib/utils';
import { Tooltip } from '../ui/Tooltip';
import { AnimatedNumber } from '../ui/AnimatedNumber';
import { Button } from '../ui/Button';
import { cn } from '../../lib/utils';
import type { Account } from '../../types/trading';
import type { UserStats } from '../../types/user';

interface AccountStatsProps {
  account: Account | null;
  stats: UserStats | null;
  positions: { unrealizedPnl: number }[];
  onReset?: () => Promise<void>;
}

export function AccountStats({ account, stats, positions, onReset }: AccountStatsProps) {
  const [isResetting, setIsResetting] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  const totalUnrealizedPnl = positions.reduce((sum, p) => sum + p.unrealizedPnl, 0);
  const equity = (account?.balance || 0) + totalUnrealizedPnl;
  const totalPnlPercent = account?.initialBalance
    ? ((equity - account.initialBalance) / account.initialBalance) * 100
    : 0;

  const handleReset = async () => {
    if (!onReset) return;
    setIsResetting(true);
    try {
      await onReset();
      setShowConfirm(false);
    } finally {
      setIsResetting(false);
    }
  };

  return (
    <div className="bg-bg-secondary rounded-xl border border-border p-4">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-text-primary">Account Overview</h3>
        {onReset && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowConfirm(true)}
            className="text-xs text-text-muted hover:text-accent-red"
          >
            Reset
          </Button>
        )}
      </div>

      {/* Reset Confirmation */}
      {showConfirm && (
        <div className="mb-4 p-3 bg-accent-red/10 border border-accent-red/30 rounded-lg">
          <p className="text-sm text-text-primary mb-2">
            Reset account to $100,000? This will close all positions and clear trade history.
          </p>
          <div className="flex gap-2">
            <Button
              variant="danger"
              size="sm"
              onClick={handleReset}
              isLoading={isResetting}
            >
              Confirm Reset
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowConfirm(false)}
              disabled={isResetting}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}
      
      <div className="grid grid-cols-3 gap-3">
        {/* Equity */}
        <Tooltip content="Balance + Unrealized PnL">
          <div className="p-3 bg-bg-tertiary rounded-lg cursor-help">
            <div className="text-xs text-text-muted mb-1">Equity</div>
            <div className="text-lg font-semibold font-mono text-accent-cyan">
              <AnimatedNumber
                value={equity}
                format={formatUSD}
                duration={300}
              />
            </div>
          </div>
        </Tooltip>

        {/* Available Margin */}
        <Tooltip content="Balance minus margin used by open positions">
          <div className="p-3 bg-bg-tertiary rounded-lg cursor-help">
            <div className="text-xs text-text-muted mb-1">Available</div>
            <div className="text-lg font-semibold font-mono text-text-primary">
              <AnimatedNumber
                value={account?.availableMargin || 0}
                format={formatUSD}
                duration={300}
              />
            </div>
          </div>
        </Tooltip>

        {/* Unrealized PnL */}
        <Tooltip content="Profit/Loss on open positions">
          <div className="p-3 bg-bg-tertiary rounded-lg cursor-help">
            <div className="text-xs text-text-muted mb-1">Unrealized PnL</div>
            <div className={cn(
              'text-lg font-semibold font-mono transition-colors duration-200',
              totalUnrealizedPnl >= 0 ? 'text-accent-green' : 'text-accent-red'
            )}>
              <AnimatedNumber
                value={totalUnrealizedPnl}
                format={formatUSD}
                duration={200}
              />
            </div>
          </div>
        </Tooltip>

        {/* Total Return */}
        <Tooltip content="Total return since start">
          <div className="p-3 bg-bg-tertiary rounded-lg cursor-help">
            <div className="text-xs text-text-muted mb-1">Total Return</div>
            <div className={cn(
              'text-lg font-semibold font-mono transition-colors duration-200',
              totalPnlPercent >= 0 ? 'text-accent-green' : 'text-accent-red'
            )}>
              <AnimatedNumber
                value={totalPnlPercent}
                format={formatPercent}
                duration={300}
              />
            </div>
          </div>
        </Tooltip>

        {/* Win Rate */}
        <Tooltip content="Percentage of winning trades">
          <div className="p-3 bg-bg-tertiary rounded-lg cursor-help">
            <div className="text-xs text-text-muted mb-1">Win Rate</div>
            <div className="text-lg font-semibold font-mono text-text-primary">
              {stats?.winRate ? `${stats.winRate.toFixed(1)}%` : '0%'}
            </div>
          </div>
        </Tooltip>

        {/* Trades */}
        <Tooltip content="Total number of closed trades">
          <div className="p-3 bg-bg-tertiary rounded-lg cursor-help">
            <div className="text-xs text-text-muted mb-1">Trades</div>
            <div className="text-lg font-semibold font-mono text-text-primary">
              {stats?.tradeCount?.toString() || '0'}
            </div>
          </div>
        </Tooltip>
      </div>
    </div>
  );
}
