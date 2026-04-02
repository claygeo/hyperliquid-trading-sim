import { useEffect, useState } from 'react';
import { useAuthStore } from '../hooks/useAuth';
import { useAccountStore } from '../hooks/useAccount';
import { Button } from '../components/ui/Button';
import { Modal } from '../components/ui/Modal';
import { MobileNav } from '../components/ui/MobileNav';
import { formatUSD, formatPercent, formatDate } from '../lib/utils';
import { Spinner } from '../components/ui/Spinner';
import { cn } from '../lib/utils';

export function ProfilePage() {
  const { user } = useAuthStore();
  const { account, stats, isLoading, isResetting, fetchAccount, fetchStats, resetAccount } = useAccountStore();
  const [showResetModal, setShowResetModal] = useState(false);

  useEffect(() => {
    fetchAccount();
    fetchStats();
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
        <MobileNav activeTab="account" />
      </div>
    );
  }

  const totalPnl = account ? account.balance - (account.initialBalance || 100000) : 0;
  const isProfitable = totalPnl >= 0;
  const winRate = stats?.winRate || 0;
  const isGoodWinRate = winRate >= 50;
  const profitFactor = stats?.profitFactor || 0;

  return (
    <div className="h-[100dvh] bg-[#0d0f11] flex flex-col pb-12 md:pb-0">
      {/* Mobile: Single page layout with better spacing */}
      <div className="md:hidden flex-1 flex flex-col p-4 gap-4 overflow-hidden">
        {/* User Header */}
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-full bg-[#00d4ff]/20 flex items-center justify-center text-lg font-semibold text-[#00d4ff]">
            {user?.username?.[0]?.toUpperCase() || 'U'}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-white font-medium">{user?.username || 'Trader'}</p>
            <p className="text-gray-500 text-xs">
              Since {account?.createdAt ? formatDate(account.createdAt) : 'N/A'}
            </p>
          </div>
          <div className="text-right">
            <p className="text-gray-500 text-xs">Resets</p>
            <p className="text-white font-mono text-sm">{account?.resetCount || 0}</p>
          </div>
        </div>

        {/* Balance Card */}
        <div className="bg-[#13161a] rounded-xl border border-[#1e2126] p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-gray-400 text-sm">Current Balance</span>
            <span className={cn(
              'text-xs px-2 py-0.5 rounded font-mono',
              isProfitable 
                ? 'bg-[#3dd9a4]/10 text-[#3dd9a4]/90' 
                : 'bg-[#f6465d]/10 text-[#f6465d]/80'
            )}>
              {isProfitable ? '+' : ''}{formatPercent((totalPnl / 100000) * 100)}
            </span>
          </div>
          <p className={cn(
            'text-3xl font-semibold font-mono mb-3',
            isProfitable ? 'text-[#3dd9a4]' : 'text-[#f6465d]/85'
          )}>
            {formatUSD(account?.balance || 0)}
          </p>
          <div className="flex items-center gap-6 text-sm">
            <div>
              <span className="text-gray-500">Start: </span>
              <span className="text-white font-mono">{formatUSD(account?.initialBalance || 100000)}</span>
            </div>
            <div>
              <span className="text-gray-500">P&L: </span>
              <span className={cn(
                'font-mono',
                isProfitable ? 'text-[#3dd9a4]' : 'text-[#f6465d]/85'
              )}>
                {isProfitable ? '+' : ''}{formatUSD(totalPnl)}
              </span>
            </div>
          </div>
        </div>

        {/* Stats Grid - 2x3 */}
        <div className="grid grid-cols-3 gap-3">
          <StatBox label="Trades" value={String(stats?.tradeCount || 0)} />
          <StatBox 
            label="Win Rate" 
            value={formatPercent(winRate)} 
            valueClass={isGoodWinRate ? 'text-[#3dd9a4]' : 'text-[#f6465d]/80'}
          />
          <StatBox 
            label="Profit Factor" 
            value={profitFactor.toFixed(2)} 
            valueClass={profitFactor >= 1 ? 'text-[#3dd9a4]' : 'text-[#f6465d]/80'}
          />
          <StatBox label="Wins" value={String(stats?.winningTrades || 0)} valueClass="text-[#3dd9a4]" />
          <StatBox label="Losses" value={String(stats?.losingTrades || 0)} valueClass="text-[#f6465d]/80" />
          <StatBox label="Max DD" value={formatPercent(stats?.maxDrawdown || 0)} valueClass="text-[#f6465d]/80" />
        </div>

        {/* Best/Worst Row */}
        <div className="grid grid-cols-2 gap-3">
          <div className="bg-[#13161a] rounded-xl border border-[#1e2126] p-3">
            <p className="text-gray-500 text-xs mb-1">Best Trade</p>
            <p className="text-[#3dd9a4] font-mono font-medium">{formatUSD(stats?.bestTrade || 0)}</p>
          </div>
          <div className="bg-[#13161a] rounded-xl border border-[#1e2126] p-3">
            <p className="text-gray-500 text-xs mb-1">Worst Trade</p>
            <p className="text-[#f6465d]/80 font-mono font-medium">{formatUSD(stats?.worstTrade || 0)}</p>
          </div>
        </div>

        {/* Spacer */}
        <div className="flex-1" />

        {/* Reset Button */}
        <button
          onClick={() => setShowResetModal(true)}
          className="w-full py-3.5 bg-[#f6465d]/10 border border-[#f6465d]/20 text-[#f6465d]/90 rounded-xl font-medium touch-manipulation active:bg-[#f6465d]/20 transition-colors"
        >
          Reset Account
        </button>
      </div>

      {/* Desktop Layout */}
      <div className="hidden md:block h-full overflow-auto p-6">
        <div className="max-w-4xl mx-auto">
          <div className="mb-6">
            <h1 className="text-2xl font-semibold text-white mb-1">Profile</h1>
            <p className="text-gray-500 text-sm">View your stats and manage your account</p>
          </div>

          <div className="grid md:grid-cols-2 gap-4">
            {/* Account Info */}
            <div className="bg-[#13161a] rounded-lg border border-[#1e2126] p-5">
              <h2 className="text-lg font-medium text-white mb-4">Account Info</h2>
              <div className="flex items-center gap-4 mb-4">
                <div className="w-14 h-14 rounded-full bg-[#00d4ff]/20 flex items-center justify-center text-xl font-semibold text-[#00d4ff]">
                  {user?.username?.[0]?.toUpperCase() || 'U'}
                </div>
                <div>
                  <p className="text-white font-medium text-lg">{user?.username || 'Trader'}</p>
                  <p className="text-gray-500 text-sm">Member since {account?.createdAt ? formatDate(account.createdAt) : 'N/A'}</p>
                </div>
              </div>
              <div className="flex justify-between py-2 border-t border-[#1e2126] text-sm">
                <span className="text-gray-400">Account Resets</span>
                <span className="text-white font-mono">{account?.resetCount || 0}</span>
              </div>
            </div>

            {/* Balance */}
            <div className="bg-[#13161a] rounded-lg border border-[#1e2126] p-5">
              <h2 className="text-lg font-medium text-white mb-4">Balance</h2>
              <div className="bg-[#1a1d21] rounded-lg p-4 mb-4">
                <p className="text-gray-500 text-xs mb-1">Current Balance</p>
                <p className={cn('text-3xl font-mono font-semibold', isProfitable ? 'text-[#3dd9a4]' : 'text-[#f6465d]/85')}>
                  {formatUSD(account?.balance || 0)}
                </p>
              </div>
              <div className="grid grid-cols-2 gap-3 mb-4">
                <div className="bg-[#1a1d21] rounded-lg p-3">
                  <p className="text-gray-500 text-xs mb-1">Initial Balance</p>
                  <p className="text-white font-mono font-medium">{formatUSD(account?.initialBalance || 100000)}</p>
                </div>
                <div className="bg-[#1a1d21] rounded-lg p-3">
                  <p className="text-gray-500 text-xs mb-1">Total P&L</p>
                  <p className={cn('font-mono font-medium', isProfitable ? 'text-[#3dd9a4]' : 'text-[#f6465d]/85')}>{formatUSD(totalPnl)}</p>
                </div>
              </div>
              <Button variant="danger" className="w-full" onClick={() => setShowResetModal(true)}>Reset Account</Button>
            </div>

            {/* Trading Statistics */}
            <div className="bg-[#13161a] rounded-lg border border-[#1e2126] p-5 md:col-span-2">
              <h2 className="text-lg font-medium text-white mb-4">Trading Statistics</h2>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <StatBoxDesktop label="Total Trades" value={String(stats?.tradeCount || 0)} />
                <StatBoxDesktop label="Win Rate" value={formatPercent(winRate)} valueClass={isGoodWinRate ? 'text-[#3dd9a4]' : 'text-[#f6465d]/80'} />
                <StatBoxDesktop label="Max Drawdown" value={formatPercent(stats?.maxDrawdown || 0)} valueClass="text-[#f6465d]/80" />
                <StatBoxDesktop label="Profit Factor" value={profitFactor.toFixed(2)} valueClass={profitFactor >= 1 ? 'text-[#3dd9a4]' : 'text-[#f6465d]/80'} />
                <StatBoxDesktop label="Winning Trades" value={String(stats?.winningTrades || 0)} valueClass="text-[#3dd9a4]" />
                <StatBoxDesktop label="Losing Trades" value={String(stats?.losingTrades || 0)} valueClass="text-[#f6465d]/80" />
                <StatBoxDesktop label="Best Trade" value={formatUSD(stats?.bestTrade || 0)} valueClass="text-[#3dd9a4]" />
                <StatBoxDesktop label="Worst Trade" value={formatUSD(stats?.worstTrade || 0)} valueClass="text-[#f6465d]/80" />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Reset Confirmation Modal */}
      <Modal isOpen={showResetModal} onClose={() => setShowResetModal(false)} title="Reset Account">
        <p className="text-gray-400 mb-6">Are you sure you want to reset your account? This will:</p>
        <ul className="text-gray-400 mb-6 space-y-2 text-sm">
          <li className="flex items-center gap-2"><span className="w-1 h-1 rounded-full bg-[#f6465d]/80" />Reset balance to $100,000</li>
          <li className="flex items-center gap-2"><span className="w-1 h-1 rounded-full bg-[#f6465d]/80" />Close all open positions</li>
          <li className="flex items-center gap-2"><span className="w-1 h-1 rounded-full bg-[#f6465d]/80" />Clear your trading history</li>
        </ul>
        <div className="flex gap-3">
          <Button variant="secondary" className="flex-1" onClick={() => setShowResetModal(false)}>Cancel</Button>
          <Button variant="danger" className="flex-1" onClick={handleReset} isLoading={isResetting}>Reset Account</Button>
        </div>
      </Modal>

      <MobileNav activeTab="account" />
    </div>
  );
}

function StatBox({ label, value, valueClass = 'text-white' }: { label: string; value: string; valueClass?: string }) {
  return (
    <div className="bg-[#13161a] rounded-xl border border-[#1e2126] p-3">
      <p className="text-gray-500 text-xs mb-1">{label}</p>
      <p className={cn('font-mono font-medium', valueClass)}>{value}</p>
    </div>
  );
}

function StatBoxDesktop({ label, value, valueClass = 'text-white' }: { label: string; value: string; valueClass?: string }) {
  return (
    <div className="bg-[#1a1d21] rounded-lg p-3">
      <p className="text-gray-500 text-xs mb-1">{label}</p>
      <p className={cn('text-lg font-mono font-medium', valueClass)}>{value}</p>
    </div>
  );
}
