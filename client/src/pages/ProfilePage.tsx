import { useEffect, useState } from 'react';
import { useAuthStore } from '../hooks/useAuth';
import { useAccountStore } from '../hooks/useAccount';
import { Button } from '../components/ui/Button';
import { Modal } from '../components/ui/Modal';
import { formatUSD, formatPercent, formatDate } from '../lib/utils';
import { Spinner } from '../components/ui/Spinner';

export function ProfilePage() {
  const { user } = useAuthStore();
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
      <div className="h-full flex items-center justify-center bg-[#0d0f11]">
        <Spinner size="lg" />
      </div>
    );
  }

  return (
    <div className="h-full bg-[#0d0f11] pb-12 md:pb-0">
      <div className="h-full overflow-auto p-4 md:p-6">
        <div className="max-w-4xl mx-auto">
          {/* Header */}
          <div className="mb-6">
            <h1 className="text-2xl font-bold text-white mb-1">Profile</h1>
            <p className="text-gray-500 text-sm">
              View your stats and manage your account
            </p>
          </div>

          <div className="grid md:grid-cols-2 gap-4">
            {/* Account Info */}
            <div className="bg-[#13161a] rounded-lg border border-[#1e2126] p-5">
              <h2 className="text-base font-semibold text-white mb-4">Account Info</h2>
              
              <div className="flex items-center gap-4 mb-5">
                <div className="w-14 h-14 bg-[#3dd9a4]/20 rounded-full flex items-center justify-center">
                  <span className="text-xl font-bold text-[#3dd9a4]">
                    {user?.username?.charAt(0).toUpperCase()}
                  </span>
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-white">{user?.username}</h3>
                </div>
              </div>

              <div className="space-y-0">
                <div className="flex justify-between py-3 border-b border-[#1e2126]">
                  <span className="text-gray-500 text-sm">Member Since</span>
                  <span className="text-white text-sm">{user?.createdAt ? formatDate(user.createdAt) : '-'}</span>
                </div>
                <div className="flex justify-between py-3">
                  <span className="text-gray-500 text-sm">Account Resets</span>
                  <span className="text-white text-sm">{account?.resetCount || 0}</span>
                </div>
              </div>
            </div>

            {/* Balance Info */}
            <div className="bg-[#13161a] rounded-lg border border-[#1e2126] p-5">
              <h2 className="text-base font-semibold text-white mb-4">Balance</h2>

              <div className="bg-[#1a1d21] rounded-lg p-4 mb-4">
                <p className="text-gray-500 text-xs mb-1">Current Balance</p>
                <p className="text-2xl font-bold font-mono text-[#3dd9a4]">
                  {formatUSD(account?.balance || 0)}
                </p>
              </div>

              <div className="grid grid-cols-2 gap-3 mb-5">
                <div className="bg-[#1a1d21] rounded-lg p-3">
                  <p className="text-gray-500 text-xs mb-1">Initial Balance</p>
                  <p className="text-base font-mono text-white">
                    {formatUSD(account?.initialBalance || 100000)}
                  </p>
                </div>
                <div className="bg-[#1a1d21] rounded-lg p-3">
                  <p className="text-gray-500 text-xs mb-1">Total P&L</p>
                  <p className={`text-base font-mono ${(stats?.totalPnl || 0) >= 0 ? 'text-[#3dd9a4]' : 'text-[#f6465d]'}`}>
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
            <div className="bg-[#13161a] rounded-lg border border-[#1e2126] p-5 md:col-span-2">
              <h2 className="text-base font-semibold text-white mb-4">Trading Statistics</h2>

              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <StatCard
                  label="Total Trades"
                  value={stats?.tradeCount?.toString() || '0'}
                />
                <StatCard
                  label="Win Rate"
                  value={formatPercent(stats?.winRate || 0, false)}
                  valueClass={(stats?.winRate || 0) >= 50 ? 'text-[#3dd9a4]' : 'text-[#f6465d]'}
                />
                <StatCard
                  label="Max Drawdown"
                  value={formatPercent(stats?.maxDrawdown || 0, false)}
                  valueClass="text-[#f6465d]"
                />
                <StatCard
                  label="Profit Factor"
                  value={(stats?.profitFactor || 0).toFixed(2)}
                  valueClass={(stats?.profitFactor || 0) >= 1 ? 'text-[#3dd9a4]' : 'text-[#f6465d]'}
                />
                <StatCard
                  label="Winning Trades"
                  value={stats?.winningTrades?.toString() || '0'}
                  valueClass="text-[#3dd9a4]"
                />
                <StatCard
                  label="Losing Trades"
                  value={stats?.losingTrades?.toString() || '0'}
                  valueClass="text-[#f6465d]"
                />
                <StatCard
                  label="Best Trade"
                  value={formatUSD(stats?.bestTrade || 0)}
                  valueClass="text-[#3dd9a4]"
                />
                <StatCard
                  label="Worst Trade"
                  value={formatUSD(stats?.worstTrade || 0)}
                  valueClass="text-[#f6465d]"
                />
              </div>
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
        <p className="text-gray-400 mb-6">
          Are you sure you want to reset your account? This will:
        </p>
        <ul className="list-disc list-inside text-gray-400 mb-6 space-y-2 text-sm">
          <li>Close all open positions</li>
          <li>Reset your balance to $100,000</li>
          <li>Clear your trade history</li>
          <li>Reset all statistics</li>
        </ul>
        <p className="text-[#f0b90b] text-sm mb-6">
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
  valueClass = 'text-white',
}: {
  label: string;
  value: string;
  valueClass?: string;
}) {
  return (
    <div className="bg-[#1a1d21] rounded-lg p-3">
      <p className="text-gray-500 text-xs mb-1">{label}</p>
      <p className={`text-lg font-mono font-semibold ${valueClass}`}>{value}</p>
    </div>
  );
}
