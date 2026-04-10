// ============================================
// Tracker Bridge Service
//
// Reads active signals and position trades from
// the Hyperliquid Position Tracker's Supabase.
// Exposes them as "suggested trades" for the sim UI.
//
// Read-only. Never writes to the tracker DB.
// ============================================

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { config } from '../../config/index.js';
import { logger } from '../../lib/logger.js';

export interface SuggestedTrade {
  id: string;
  type: 'signal' | 'position';
  coin: string;
  direction: 'long' | 'short';
  confidence: number;
  entryPrice: number;
  currentPrice: number;
  stopLoss: number | null;
  takeProfit1: number | null;
  takeProfit2: number | null;
  takeProfit3: number | null;
  traderCount: number;
  signalTier: string | null;
  kellyFraction: number | null;
  positionSizeUsd: number | null;
  traderAddress: string | null;
  traderTier: string | null;
  openedAt: string;
  source: string;
}

export class TrackerBridge {
  private client: SupabaseClient | null = null;
  private cache: { data: SuggestedTrade[]; expiresAt: number } | null = null;
  private readonly CACHE_TTL_MS = 30_000; // 30 seconds

  constructor() {
    if (config.tracker.enabled) {
      this.client = createClient(
        config.tracker.supabaseUrl,
        config.tracker.supabaseKey,
        { auth: { autoRefreshToken: false, persistSession: false } }
      );
      logger.info('[TrackerBridge] Connected to position tracker DB');
    } else {
      logger.info('[TrackerBridge] Disabled (no TRACKER_SUPABASE_URL configured)');
    }
  }

  isEnabled(): boolean {
    return this.client !== null;
  }

  async getSuggestedTrades(): Promise<SuggestedTrade[]> {
    if (!this.client) return [];

    // Check cache
    if (this.cache && this.cache.expiresAt > Date.now()) {
      return this.cache.data;
    }

    try {
      const [signals, positionTrades] = await Promise.all([
        this.getActiveSignals(),
        this.getActivePositionTrades(),
      ]);

      const suggestions = [...signals, ...positionTrades];

      // Sort by confidence descending
      suggestions.sort((a, b) => b.confidence - a.confidence);

      this.cache = { data: suggestions, expiresAt: Date.now() + this.CACHE_TTL_MS };
      return suggestions;
    } catch (error) {
      logger.error('[TrackerBridge] Error fetching suggestions:', error);
      return this.cache?.data || [];
    }
  }

  private async getActiveSignals(): Promise<SuggestedTrade[]> {
    if (!this.client) return [];

    const { data, error } = await this.client
      .from('quality_signals')
      .select('id, coin, direction, signal_tier, confidence, avg_entry_price, current_price, stop_loss, take_profit_1, take_profit_2, take_profit_3, trader_count, created_at')
      .eq('is_active', true)
      .order('confidence', { ascending: false });

    if (error) {
      logger.error('[TrackerBridge] Error fetching signals:', error.message);
      return [];
    }

    return (data || []).map(s => ({
      id: `signal-${s.id}`,
      type: 'signal' as const,
      coin: s.coin,
      direction: s.direction,
      confidence: s.confidence || 0,
      entryPrice: s.avg_entry_price || 0,
      currentPrice: s.current_price || s.avg_entry_price || 0,
      stopLoss: s.stop_loss,
      takeProfit1: s.take_profit_1,
      takeProfit2: s.take_profit_2,
      takeProfit3: s.take_profit_3,
      traderCount: s.trader_count || 1,
      signalTier: s.signal_tier,
      kellyFraction: null,
      positionSizeUsd: null,
      traderAddress: null,
      traderTier: null,
      openedAt: s.created_at,
      source: 'convergence',
    }));
  }

  private async getActivePositionTrades(): Promise<SuggestedTrade[]> {
    if (!this.client) return [];

    const { data, error } = await this.client
      .from('user_trades')
      .select('id, coin, direction, confidence_at_entry, user_entry_price, current_price, stop_loss, take_profit_1, take_profit_2, take_profit_3, kelly_fraction, position_size_usd, trader_address, trader_tier, opened_at, source')
      .eq('is_open', true)
      .eq('is_paper', true)
      .in('source', ['system', 'system_position'])
      .order('confidence_at_entry', { ascending: false })
      .limit(50);

    if (error) {
      logger.error('[TrackerBridge] Error fetching position trades:', error.message);
      return [];
    }

    return (data || []).map(t => ({
      id: `trade-${t.id}`,
      type: 'position' as const,
      coin: t.coin,
      direction: t.direction,
      confidence: t.confidence_at_entry || 0,
      entryPrice: t.user_entry_price || 0,
      currentPrice: t.current_price || t.user_entry_price || 0,
      stopLoss: t.stop_loss,
      takeProfit1: t.take_profit_1,
      takeProfit2: t.take_profit_2,
      takeProfit3: t.take_profit_3,
      traderCount: 1,
      signalTier: null,
      kellyFraction: t.kelly_fraction,
      positionSizeUsd: t.position_size_usd,
      traderAddress: t.trader_address,
      traderTier: t.trader_tier,
      openedAt: t.opened_at,
      source: t.source === 'system' ? 'signal_trade' : 'position_trade',
    }));
  }

  async getTrackerStats(): Promise<{
    totalSignals: number;
    activeSignals: number;
    trackedTraders: number;
    signalWinRate: number | null;
    positionWinRate: number | null;
  } | null> {
    if (!this.client) return null;

    try {
      const [signals, traders, closedSignals] = await Promise.all([
        this.client.from('quality_signals').select('id', { count: 'exact', head: true }),
        this.client.from('trader_quality').select('id', { count: 'exact', head: true }).eq('is_tracked', true),
        this.client.from('quality_signals').select('outcome').eq('is_active', false).not('outcome', 'is', null),
      ]);

      const activeCount = await this.client.from('quality_signals').select('id', { count: 'exact', head: true }).eq('is_active', true);

      let signalWinRate: number | null = null;
      if (closedSignals.data && closedSignals.data.length > 0) {
        const wins = closedSignals.data.filter(s => s.outcome === 'profit').length;
        signalWinRate = wins / closedSignals.data.length;
      }

      return {
        totalSignals: signals.count || 0,
        activeSignals: activeCount.count || 0,
        trackedTraders: traders.count || 0,
        signalWinRate,
        positionWinRate: null, // TODO: compute from user_trades
      };
    } catch (error) {
      logger.error('[TrackerBridge] Error fetching stats:', error);
      return null;
    }
  }
}

export const trackerBridge = new TrackerBridge();
