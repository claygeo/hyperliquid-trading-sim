import { useEffect, useState, useCallback } from 'react';
import { cn, formatPrice } from '../../lib/utils';

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
    const interval = setInterval(fetchSuggestions, 30_000); // Refresh every 30s
    return () => clearInterval(interval);
  }, [fetchSuggestions]);

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

  // Filter to selected asset if provided, but always show all if empty
  const filtered = selectedAsset
    ? suggestions.filter(s => s.coin === selectedAsset)
    : suggestions;

  const displayed = compact ? filtered.slice(0, 3) : filtered.slice(0, 10);

  return (
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
  );
}

function SuggestionRow({ trade, onSelect }: { trade: SuggestedTrade; onSelect?: (t: SuggestedTrade) => void }) {
  const isLong = trade.direction === 'long';
  const pnlPct = trade.entryPrice > 0
    ? ((trade.currentPrice - trade.entryPrice) / trade.entryPrice * 100) * (isLong ? 1 : -1)
    : 0;
  const isProfitable = pnlPct >= 0;

  // Confidence badge color
  const confColor = trade.confidence >= 70
    ? 'text-[#3dd9a4] bg-[#3dd9a4]/10'
    : trade.confidence >= 50
    ? 'text-[#fbbf24] bg-[#fbbf24]/10'
    : 'text-gray-400 bg-gray-400/10';

  const typeLabel = trade.type === 'signal'
    ? `${trade.traderCount} trader${trade.traderCount !== 1 ? 's' : ''}`
    : trade.traderTier || 'tracker';

  return (
    <button
      onClick={() => onSelect?.(trade)}
      className="w-full px-3 py-2 hover:bg-[#1a1d21] transition-colors text-left"
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {/* Coin + direction */}
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

        {/* Confidence badge */}
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
  );
}
