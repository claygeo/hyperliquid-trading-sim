import { useEffect, useState } from 'react';
import { useAuthStore } from '../hooks/useAuth';
import { useAccountStore } from '../hooks/useAccount';
import { Button } from '../components/ui/Button';
import { Modal } from '../components/ui/Modal';
import { formatUSD, formatPercent, formatDate } from '../lib/utils';
import { Spinner } from '../components/ui/Spinner';

export function ProfilePage() {
  const { user, profile } = useAuthStore();
  const { account, stats, isLoading, isResetting, fetchAccount, fetchStats, resetAccount } = useAccountStore();
  const [showResetModal, setShowResetModal] = useState(false);

  useEffect(() => {
    fetchAccount();
    fetchStats();
  }, []);

  const handleReset = async () => {
    try {
      await resetAccount();
      setShowResetModal(false);
    } catch (error) {
      console.error('Failed to reset account:', error);
    }
  };

  if (isLoading) {
    return (
      <div className="h-full flex items-center justify-center">
        <Spinner size="lg" />
      </div>
    );
  }

  return (
    <div className="h-full p-6 overflow-auto">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold font-display mb-2">
            <span className="text-accent-purple">Pro</span>file
          </h1>
          <p className="text-text-secondary">
            View your stats and manage your account
          </p>
        </div>

        <div className="grid md:grid-cols-2 gap-6">
          {/* Account Info */}
          <div className="bg-bg-secondary rounded-xl border border-border p-6">
            <h2 className="text-lg font-semibold mb-4">Account Info</h2>
            
            <div className="flex items-center gap-4 mb-6">
              <div className="w-16 h-16 bg-accent-purple/20 rounded-full flex items-center justify-center">
                <span className="text-2xl font-bold text-accent-purple">
                  {user?.username?.charAt(0).toUpperCase()}
                </span>
              </div>
              <div>
                <h3 className="text-xl font-semibold text-text-primary">{user?.username}</h3>
                <p className="text-text-muted">{user?.email}</p>
              </div>
            </div>

            <div className="space-y-3">
              <div className="flex justify-between py-2 border-b border-border">
                <span className="text-text-muted">Member Since</span>
                <span className="text-text-primary">{user?.createdAt ? formatDate(user.createdAt) : '-'}</span>
              </div>
              <div className="flex justify-between py-2 border-b border-border">
                <span className="text-text-muted">Account Resets</span>
                <span className="text-text-primary">{account?.resetCount || 0}</span>
              </div>
            </div>
          </div>

          {/* Balance Info */}
          <div className="bg-bg-secondary rounded-xl border border-border p-6">
            <h2 className="text-lg font-semibold mb-4">Balance</h2>

            <div className="bg-bg-tertiary rounded-lg p-4 mb-4">
              <p className="text-text-muted text-sm mb-1">Current Balance</p>
              <p className="text-3xl font-bold font-mono text-accent-cyan">
                {formatUSD(account?.balance || 0)}
              </p>
            </div>

            <div className="grid grid-cols-2 gap-4 mb-6">
              <div className="bg-bg-tertiary rounded-lg p-3">
                <p className="text-text-muted text-xs mb-1">Initial Balance</p>
                <p className="text-lg font-mono text-text-primary">
                  {formatUSD(account?.initialBalance || 100000)}
                </p>
              </div>
              <div className="bg-bg-tertiary rounded-lg p-3">
                <p className="text-text-muted text-xs mb-1">Total P&L</p>
                <p className={`text-lg font-mono ${(stats?.totalPnl || 0) >= 0 ? 'text-accent-green' : 'text-accent-red'}`}>
                  {formatUSD(stats?.totalPnl || 0)}
                </p>
              </div>
            </div>

            <Button
              variant="danger"
              className="w-full"
              onClick={() => setShowResetModal(true)}
            >
              Reset Account
            </Button>
          </div>

          {/* Trading Stats */}
          <div className="bg-bg-secondary rounded-xl border border-border p-6 md:col-span-2">
            <h2 className="text-lg font-semibold mb-4">Trading Statistics</h2>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <StatCard
                label="Total Trades"
                value={stats?.tradeCount?.toString() || '0'}
              />
              <StatCard
                label="Win Rate"
                value={formatPercent(stats?.winRate || 0, false)}
                valueClass={(stats?.winRate || 0) >= 50 ? 'text-accent-green' : 'text-accent-red'}
              />
              <StatCard
                label="Max Drawdown"
                value={formatPercent(stats?.maxDrawdown || 0, false)}
                valueClass="text-accent-red"
              />
              <StatCard
                label="Profit Factor"
                value={(stats?.profitFactor || 0).toFixed(2)}
                valueClass={(stats?.profitFactor || 0) >= 1 ? 'text-accent-green' : 'text-accent-red'}
              />
              <StatCard
                label="Winning Trades"
                value={stats?.winningTrades?.toString() || '0'}
                valueClass="text-accent-green"
              />
              <StatCard
                label="Losing Trades"
                value={stats?.losingTrades?.toString() || '0'}
                valueClass="text-accent-red"
              />
              <StatCard
                label="Best Trade"
                value={formatUSD(stats?.bestTrade || 0)}
                valueClass="text-accent-green"
              />
              <StatCard
                label="Worst Trade"
                value={formatUSD(stats?.worstTrade || 0)}
                valueClass="text-accent-red"
              />
            </div>
          </div>
        </div>
      </div>

      {/* Reset confirmation modal */}
      <Modal
        isOpen={showResetModal}
        onClose={() => setShowResetModal(false)}
        title="Reset Account"
      >
        <p className="text-text-secondary mb-6">
          Are you sure you want to reset your account? This will:
        </p>
        <ul className="list-disc list-inside text-text-secondary mb-6 space-y-2">
          <li>Close all open positions</li>
          <li>Reset your balance to $100,000</li>
          <li>Clear your trade history</li>
          <li>Reset all statistics</li>
        </ul>
        <p className="text-accent-yellow text-sm mb-6">
          This action cannot be undone.
        </p>
        <div className="flex gap-3">
          <Button
            variant="secondary"
            className="flex-1"
            onClick={() => setShowResetModal(false)}
          >
            Cancel
          </Button>
          <Button
            variant="danger"
            className="flex-1"
            onClick={handleReset}
            isLoading={isResetting}
          >
            Reset Account
          </Button>
        </div>
      </Modal>
    </div>
  );
}

function StatCard({
  label,
  value,
  valueClass = 'text-text-primary',
}: {
  label: string;
  value: string;
  valueClass?: string;
}) {
  return (
    <div className="bg-bg-tertiary rounded-lg p-4">
      <p className="text-text-muted text-xs mb-1">{label}</p>
      <p className={`text-xl font-mono font-semibold ${valueClass}`}>{value}</p>
    </div>
  );
}
