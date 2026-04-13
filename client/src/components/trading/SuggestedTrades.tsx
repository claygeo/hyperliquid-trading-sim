import { useEffect, useState, useCallback } from 'react';
import { cn, formatPrice } from '../../lib/utils';
import { Modal } from '../ui/Modal';
import { usePositionsStore } from '../../hooks/usePositions';
import { useAuthStore } from '../../hooks/useAuth';
import { useAccountStore } from '../../hooks/useAccount';
import { useAssetsStore } from '../../hooks/useAssets';
import { useToast } from '../../context/ToastContext';

interface SuggestedTrade {
  id: string;
  type: 'signal' | 'position';
  coin: string;
  direction: 'long' | 'short';
  confidence: number;
  entryPrice: number;
  currentPrice: number;
  stopLoss: number | null;
  takeProfit1: number | null;
  traderCount: number;
  signalTier: string | null;
  traderTier: string | null;
  kellyFraction: number | null;
  openedAt: string;
  source: string;
}

interface TrackerStats {
  totalSignals: number;
  activeSignals: number;
  trackedTraders: number;
  signalWinRate: number | null;
}

interface SuggestionsResponse {
  enabled: boolean;
  suggestions: SuggestedTrade[];
  stats: TrackerStats | null;
  updatedAt: string;
}

interface SuggestedTradesProps {
  onTradeSelect?: (trade: SuggestedTrade) => void;
  selectedAsset?: string;
  compact?: boolean;
}

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

export function SuggestedTrades({ onTradeSelect, selectedAsset, compact }: SuggestedTradesProps) {
  const [data, setData] = useState<SuggestionsResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [confirmTrade, setConfirmTrade] = useState<SuggestedTrade | null>(null);
  const [isExecuting, setIsExecuting] = useState(false);

  const { placeOrder } = usePositionsStore();
  const { isAuthenticated } = useAuthStore();
  const { account, fetchAccount } = useAccountStore();
  const { addToast } = useToast();

  const fetchSuggestions = useCallback(async () => {
    try {
      const res = await fetch(`${API_URL}/api/suggestions`);
      if (!res.ok) throw new Error('Failed to fetch');
      const json = await res.json();
      setData(json);
      setError(null);
    } catch (err) {
      setError('Tracker offline');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSuggestions();
    const interval = setInterval(fetchSuggestions, 30_000);
    return () => clearInterval(interval);
  }, [fetchSuggestions]);

  const handleTakeTrade = useCallback((trade: SuggestedTrade) => {
    if (!isAuthenticated) {
      addToast({ type: 'error', title: 'Login Required', message: 'Please login to take trades' });
      return;
    }
    setConfirmTrade(trade);
  }, [isAuthenticated, addToast]);

  const handleConfirmExecution = useCallback(async () => {
    if (!confirmTrade) return;

    setIsExecuting(true);
    try {
      // Notional-based sizing: $500 default exposure regardless of coin price
      const DEFAULT_NOTIONAL = 500;
      const price = confirmTrade.currentPrice || confirmTrade.entryPrice || 1;
      const baseSize = DEFAULT_NOTIONAL / price;
      const size = confirmTrade.kellyFraction
        ? Math.max(baseSize * 0.1, confirmTrade.kellyFraction * baseSize)
        : baseSize;

      await placeOrder({
        asset: confirmTrade.coin,
        side: confirmTrade.direction,
        size,
        leverage: 10,
        source: 'signal',
        signalId: confirmTrade.id,
      });

      addToast({
        type: 'success',
        title: 'Trade Executed',
        message: `${confirmTrade.direction.toUpperCase()} ${confirmTrade.coin} from signal`,
      });

      fetchAccount();
      setConfirmTrade(null);
    } catch (err) {
      addToast({
        type: 'error',
        title: 'Trade Failed',
        message: err instanceof Error ? err.message : 'Failed to execute trade',
      });
    } finally {
      setIsExecuting(false);
    }
  }, [confirmTrade, placeOrder, addToast, fetchAccount]);

  if (isLoading) {
    return (
      <div className="bg-[#0d0f11] rounded-lg border border-[#1e2126] p-3">
        <div className="text-xs text-gray-500 animate-pulse">Loading signals...</div>
      </div>
    );
  }

  if (error || !data?.enabled) {
    return (
      <div className="bg-[#0d0f11] rounded-lg border border-[#1e2126] p-3">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-gray-600" />
          <span className="text-xs text-gray-500">Position Tracker</span>
        </div>
        <p className="text-[10px] text-gray-600 mt-1">
          {error || 'Bridge not configured'}
        </p>
      </div>
    );
  }

  const suggestions = data.suggestions;
  const stats = data.stats;

  const filtered = selectedAsset
    ? suggestions.filter(s => s.coin === selectedAsset)
    : suggestions;

  const displayed = compact ? filtered.slice(0, 3) : filtered.slice(0, 10);

  return (
    <>
      <div className="bg-[#0d0f11] rounded-lg border border-[#1e2126]">
        {/* Header */}
        <div className="flex items-center justify-between px-3 py-2 border-b border-[#1e2126]">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-[#3dd9a4] animate-pulse" />
            <span className="text-xs font-medium text-white">Tracker Signals</span>
            {stats && (
              <span className="text-[10px] text-gray-500">
                {stats.trackedTraders} traders
              </span>
            )}
          </div>
          {stats?.signalWinRate !== null && stats?.signalWinRate !== undefined && (
            <span className="text-[10px] text-[#3dd9a4] font-mono">
              {(stats.signalWinRate * 100).toFixed(0)}% WR
            </span>
          )}
        </div>

        {/* Suggestions list */}
        {displayed.length === 0 ? (
          <div className="px-3 py-4 text-center">
            <p className="text-[10px] text-gray-500">
              {selectedAsset
                ? `No active signals for ${selectedAsset}`
                : 'No active signals right now'}
            </p>
            {suggestions.length > 0 && selectedAsset && (
              <p className="text-[10px] text-gray-600 mt-1">
                {suggestions.length} signal{suggestions.length !== 1 ? 's' : ''} on other coins
              </p>
            )}
          </div>
        ) : (
          <div className="divide-y divide-[#1e2126]/50">
            {displayed.map(trade => (
              <SuggestionRow
                key={trade.id}
                trade={trade}
                onSelect={onTradeSelect}
                onTakeTrade={handleTakeTrade}
                isAuthenticated={isAuthenticated}
              />
            ))}
          </div>
        )}

        {/* Show more indicator */}
        {filtered.length > displayed.length && (
          <div className="px-3 py-1.5 text-center border-t border-[#1e2126]/50">
            <span className="text-[10px] text-gray-500">
              +{filtered.length - displayed.length} more
            </span>
          </div>
        )}
      </div>

      {/* Trade Confirmation Modal */}
      {confirmTrade && (
        <TradeConfirmModal
          trade={confirmTrade}
          isOpen={!!confirmTrade}
          isExecuting={isExecuting}
          onConfirm={handleConfirmExecution}
          onClose={() => setConfirmTrade(null)}
          availableBalance={account?.availableMargin || 0}
        />
      )}
    </>
  );
}

function SuggestionRow({
  trade,
  onSelect,
  onTakeTrade,
  isAuthenticated,
}: {
  trade: SuggestedTrade;
  onSelect?: (t: SuggestedTrade) => void;
  onTakeTrade: (t: SuggestedTrade) => void;
  isAuthenticated: boolean;
}) {
  const isLong = trade.direction === 'long';
  const pnlPct = trade.entryPrice > 0
    ? ((trade.currentPrice - trade.entryPrice) / trade.entryPrice * 100) * (isLong ? 1 : -1)
    : 0;
  const isProfitable = pnlPct >= 0;

  const confColor = trade.confidence >= 70
    ? 'text-[#3dd9a4] bg-[#3dd9a4]/10'
    : trade.confidence >= 50
    ? 'text-[#fbbf24] bg-[#fbbf24]/10'
    : 'text-gray-400 bg-gray-400/10';

  const typeLabel = trade.type === 'signal'
    ? `${trade.traderCount} trader${trade.traderCount !== 1 ? 's' : ''}`
    : trade.traderTier || 'tracker';

  const { getAsset } = useAssetsStore();
  const assetAvailable = !!getAsset(trade.coin);

  return (
    <div className="flex items-center px-3 py-2 hover:bg-[#1a1d21] transition-colors">
      <button
        onClick={() => onSelect?.(trade)}
        className="flex-1 text-left touch-manipulation"
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className={cn(
              'text-[11px] font-medium',
              isLong ? 'text-[#3dd9a4]' : 'text-[#f6465d]'
            )}>
              {trade.coin}
            </span>
            <span className={cn(
              'text-[9px] px-1 py-0.5 rounded font-medium',
              isLong ? 'text-[#3dd9a4] bg-[#3dd9a4]/10' : 'text-[#f6465d] bg-[#f6465d]/10'
            )}>
              {trade.direction.toUpperCase()}
            </span>
          </div>

          <span className={cn('text-[10px] px-1.5 py-0.5 rounded font-mono', confColor)}>
            {trade.confidence}
          </span>
        </div>

        <div className="flex items-center justify-between mt-1">
          <span className="text-[9px] text-gray-500">{typeLabel}</span>
          <div className="flex items-center gap-2">
            <span className="text-[9px] text-gray-500 font-mono">
              {formatPrice(trade.entryPrice)}
            </span>
            {trade.entryPrice > 0 && (
              <span className={cn(
                'text-[9px] font-mono',
                isProfitable ? 'text-[#3dd9a4]' : 'text-[#f6465d]'
              )}>
                {isProfitable ? '+' : ''}{pnlPct.toFixed(1)}%
              </span>
            )}
          </div>
        </div>
      </button>

      {/* Take Trade button */}
      <button
        onClick={(e) => {
          e.stopPropagation();
          onTakeTrade(trade);
        }}
        disabled={!isAuthenticated || !assetAvailable}
        title={
          !isAuthenticated
            ? 'Login to trade'
            : !assetAvailable
            ? 'Asset not available in sim'
            : `Take ${trade.direction} ${trade.coin}`
        }
        className={cn(
          'ml-2 px-2 py-1 rounded text-[9px] font-medium transition-colors touch-manipulation shrink-0',
          isAuthenticated && assetAvailable
            ? 'text-[#00d4ff] bg-[#00d4ff]/10 hover:bg-[#00d4ff]/20'
            : 'text-gray-600 bg-gray-600/10 cursor-not-allowed'
        )}
      >
        Take
      </button>
    </div>
  );
}

function TradeConfirmModal({
  trade,
  isOpen,
  isExecuting,
  onConfirm,
  onClose,
  availableBalance,
}: {
  trade: SuggestedTrade;
  isOpen: boolean;
  isExecuting: boolean;
  onConfirm: () => void;
  onClose: () => void;
  availableBalance: number;
}) {
  const isLong = trade.direction === 'long';
  const DEFAULT_NOTIONAL = 500;
  const price = trade.currentPrice || trade.entryPrice || 1;
  const baseSize = DEFAULT_NOTIONAL / price;
  const size = trade.kellyFraction
    ? Math.max(baseSize * 0.1, trade.kellyFraction * baseSize)
    : baseSize;
  const leverage = 10;
  const notional = size * price;
  const marginRequired = notional / leverage;
  const hasEnoughMargin = availableBalance >= marginRequired;

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Confirm Signal Trade">
      <div className="space-y-3">
        {/* Signal source badge */}
        <div className="flex items-center gap-2">
          <span className="text-[9px] px-1.5 py-0.5 rounded font-medium text-[#00d4ff] bg-[#00d4ff]/10">
            SIG
          </span>
          <span className="text-xs text-gray-400">Signal-sourced trade</span>
        </div>

        {/* Trade details grid */}
        <div className="bg-[#0d0f11] rounded-lg border border-[#1e2126] p-3 space-y-2">
          <div className="flex justify-between">
            <span className="text-[11px] text-gray-400">Asset</span>
            <span className="text-[11px] text-white font-medium">{trade.coin}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-[11px] text-gray-400">Direction</span>
            <span className={cn(
              'text-[11px] font-medium',
              isLong ? 'text-[#3dd9a4]' : 'text-[#f6465d]'
            )}>
              {trade.direction.toUpperCase()}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-[11px] text-gray-400">Size</span>
            <span className="text-[11px] text-white font-mono">{size.toFixed(4)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-[11px] text-gray-400">Entry Price</span>
            <span className="text-[11px] text-white font-mono">{formatPrice(trade.currentPrice)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-[11px] text-gray-400">Leverage</span>
            <span className="text-[11px] text-white font-mono">{leverage}x</span>
          </div>
          <div className="flex justify-between">
            <span className="text-[11px] text-gray-400">Margin Required</span>
            <span className={cn(
              'text-[11px] font-mono',
              hasEnoughMargin ? 'text-white' : 'text-[#f6465d]'
            )}>
              ${marginRequired.toFixed(2)}
            </span>
          </div>
          {trade.stopLoss && (
            <div className="flex justify-between">
              <span className="text-[11px] text-gray-400">Stop Loss</span>
              <span className="text-[11px] text-[#f6465d] font-mono">{formatPrice(trade.stopLoss)}</span>
            </div>
          )}
          {trade.takeProfit1 && (
            <div className="flex justify-between">
              <span className="text-[11px] text-gray-400">Take Profit</span>
              <span className="text-[11px] text-[#3dd9a4] font-mono">{formatPrice(trade.takeProfit1)}</span>
            </div>
          )}
          <div className="flex justify-between">
            <span className="text-[11px] text-gray-400">Confidence</span>
            <span className="text-[11px] text-white font-mono">{trade.confidence}%</span>
          </div>
        </div>

        {!hasEnoughMargin && (
          <p className="text-[10px] text-[#f6465d]">
            Insufficient margin. Available: ${availableBalance.toFixed(2)}
          </p>
        )}

        {/* Action buttons */}
        <div className="flex gap-2 pt-1">
          <button
            onClick={onClose}
            className="flex-1 px-3 py-2 rounded-lg text-xs text-gray-400 hover:text-white hover:bg-[#1a1d21] transition-colors touch-manipulation"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={isExecuting || !hasEnoughMargin}
            className={cn(
              'flex-1 px-3 py-2 rounded-lg text-xs font-medium transition-colors touch-manipulation',
              isExecuting || !hasEnoughMargin
                ? 'bg-gray-600/20 text-gray-500 cursor-not-allowed'
                : isLong
                ? 'bg-[#3dd9a4]/20 text-[#3dd9a4] hover:bg-[#3dd9a4]/30'
                : 'bg-[#f6465d]/20 text-[#f6465d] hover:bg-[#f6465d]/30'
            )}
          >
            {isExecuting ? 'Executing...' : `${trade.direction.toUpperCase()} ${trade.coin}`}
          </button>
        </div>
      </div>
    </Modal>
  );
}
