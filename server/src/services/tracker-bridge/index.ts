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
import { z } from 'zod';
import { config } from '../../config/index.js';
import { logger } from '../../lib/logger.js';
import { ExternalServiceError } from '../../lib/errors.js';
import { eventService } from '../events/index.js';

// Zod schemas for external data validation
const signalRowSchema = z.object({
  id: z.union([z.string(), z.number()]),
  coin: z.string(),
  direction: z.enum(['long', 'short']),
  signal_tier: z.string().nullable().optional(),
  confidence: z.number().nullable().optional(),
  avg_entry_price: z.number().nullable().optional(),
  current_price: z.number().nullable().optional(),
  stop_loss: z.number().nullable().optional(),
  take_profit_1: z.number().nullable().optional(),
  take_profit_2: z.number().nullable().optional(),
  take_profit_3: z.number().nullable().optional(),
  trader_count: z.number().nullable().optional(),
  created_at: z.string(),
});

const tradeRowSchema = z.object({
  id: z.union([z.string(), z.number()]),
  coin: z.string(),
  direction: z.enum(['long', 'short']),
  confidence_at_entry: z.number().nullable().optional(),
  user_entry_price: z.number().nullable().optional(),
  current_price: z.number().nullable().optional(),
  stop_loss: z.number().nullable().optional(),
  take_profit_1: z.number().nullable().optional(),
  take_profit_2: z.number().nullable().optional(),
  take_profit_3: z.number().nullable().optional(),
  kelly_fraction: z.number().nullable().optional(),
  position_size_usd: z.number().nullable().optional(),
  trader_address: z.string().nullable().optional(),
  trader_tier: z.string().nullable().optional(),
  opened_at: z.string(),
  source: z.string(),
});

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

const STALENESS_THRESHOLD_MS = 24 * 60 * 60 * 1000; // 24 hours

export class TrackerBridge {
  private client: SupabaseClient | null = null;
  private cache: { data: SuggestedTrade[]; expiresAt: number } | null = null;
  private lastSeenSignalIds: Set<string> = new Set();
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

      // Emit signal_received only for newly-appeared signals (deduplicate across refreshes)
      const currentSignalIds = new Set(signals.map(s => s.id));
      for (const s of signals) {
        if (!this.lastSeenSignalIds.has(s.id)) {
          eventService.emit('signal_received', {
            signalId: s.id,
            coin: s.coin,
            direction: s.direction,
            confidence: s.confidence,
            entryPrice: s.entryPrice,
            source: s.source,
          }).catch(() => {}); // Non-blocking for bridge reads
        }
      }
      this.lastSeenSignalIds = currentSignalIds;

      this.cache = { data: suggestions, expiresAt: Date.now() + this.CACHE_TTL_MS };
      return suggestions;
    } catch (error) {
      if (error instanceof ExternalServiceError) throw error;
      logger.error('[TrackerBridge] Error fetching suggestions:', error);
      // Return stale cache on error
      return this.cache?.data || [];
    }
  }

  private isStale(dateStr: string): boolean {
    const created = new Date(dateStr).getTime();
    return Date.now() - created > STALENESS_THRESHOLD_MS;
  }

  private async getActiveSignals(): Promise<SuggestedTrade[]> {
    if (!this.client) return [];

    const { data, error } = await this.client
      .from('quality_signals')
      .select('id, coin, direction, signal_tier, confidence, avg_entry_price, current_price, stop_loss, take_profit_1, take_profit_2, take_profit_3, trader_count, created_at')
      .eq('is_active', true)
      .order('confidence', { ascending: false });

    if (error) {
      throw new ExternalServiceError('TrackerBridge', `Failed to fetch signals: ${error.message}`);
    }

    const validated: SuggestedTrade[] = [];
    for (const row of data || []) {
      const parsed = signalRowSchema.safeParse(row);
      if (!parsed.success) {
        logger.warn('[TrackerBridge] Invalid signal row, skipping:', parsed.error.message);
        continue;
      }
      const s = parsed.data;

      // Filter stale signals (older than 24h)
      if (this.isStale(s.created_at)) continue;

      validated.push({
        id: `signal-${s.id}`,
        type: 'signal',
        coin: s.coin,
        direction: s.direction,
        confidence: s.confidence || 0,
        entryPrice: s.avg_entry_price || 0,
        currentPrice: s.current_price || s.avg_entry_price || 0,
        stopLoss: s.stop_loss ?? null,
        takeProfit1: s.take_profit_1 ?? null,
        takeProfit2: s.take_profit_2 ?? null,
        takeProfit3: s.take_profit_3 ?? null,
        traderCount: s.trader_count || 1,
        signalTier: s.signal_tier ?? null,
        kellyFraction: null,
        positionSizeUsd: null,
        traderAddress: null,
        traderTier: null,
        openedAt: s.created_at,
        source: 'convergence',
      });
    }

    return validated;
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
      throw new ExternalServiceError('TrackerBridge', `Failed to fetch trades: ${error.message}`);
    }

    const validated: SuggestedTrade[] = [];
    for (const row of data || []) {
      const parsed = tradeRowSchema.safeParse(row);
      if (!parsed.success) {
        logger.warn('[TrackerBridge] Invalid trade row, skipping:', parsed.error.message);
        continue;
      }
      const t = parsed.data;

      // Filter stale trades (older than 24h)
      if (this.isStale(t.opened_at)) continue;

      validated.push({
        id: `trade-${t.id}`,
        type: 'position',
        coin: t.coin,
        direction: t.direction,
        confidence: t.confidence_at_entry || 0,
        entryPrice: t.user_entry_price || 0,
        currentPrice: t.current_price || t.user_entry_price || 0,
        stopLoss: t.stop_loss ?? null,
        takeProfit1: t.take_profit_1 ?? null,
        takeProfit2: t.take_profit_2 ?? null,
        takeProfit3: t.take_profit_3 ?? null,
        traderCount: 1,
        signalTier: null,
        kellyFraction: t.kelly_fraction ?? null,
        positionSizeUsd: t.position_size_usd ?? null,
        traderAddress: t.trader_address ?? null,
        traderTier: t.trader_tier ?? null,
        openedAt: t.opened_at,
        source: t.source === 'system' ? 'signal_trade' : 'position_trade',
      });
    }

    return validated;
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
      const [signals, traders, closedSignals, activeCount] = await Promise.all([
        this.client.from('quality_signals').select('id', { count: 'exact', head: true }),
        this.client.from('trader_quality').select('id', { count: 'exact', head: true }).eq('is_tracked', true),
        this.client.from('quality_signals').select('outcome').eq('is_active', false).not('outcome', 'is', null),
        this.client.from('quality_signals').select('id', { count: 'exact', head: true }).eq('is_active', true),
      ]);

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
        positionWinRate: null,
      };
    } catch (error) {
      throw new ExternalServiceError('TrackerBridge', `Failed to fetch stats: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }
}

export const trackerBridge = new TrackerBridge();
