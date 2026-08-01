import { getSupabase } from '../../lib/supabase.js';
import { logger } from '../../lib/logger.js';

export type EventType =
  | 'trade_executed'
  | 'position_closed'
  | 'position_liquidated'
  | 'signal_received'
  | 'price_tick'
  | 'pnl_update';

export interface TradingEvent {
  id?: string;
  type: EventType;
  payload: Record<string, unknown>;
  userId?: string;
  sessionId?: string;
  createdAt?: string;
}

export class EventService {
  // Activity events are deliberately best-effort because trading state commits
  // first. Throwing afterward would tell the caller an order failed even though
  // its accounting transaction succeeded. This is not a transactional outbox.
  async emit(type: EventType, payload: Record<string, unknown>, userId?: string, sessionId?: string): Promise<void> {
    try {
      const supabase = getSupabase();
      const { error } = await supabase
        .from('events')
        .insert({
          type,
          payload,
          user_id: userId || null,
          session_id: sessionId || null,
        });

      if (error) {
        logger.error(`[EventService] Failed to emit ${type}:`, error.message);
      }
    } catch (error) {
      logger.error(`[EventService] Exception emitting ${type}:`, error);
    }
  }

  async getEvents(
    userId: string,
    options?: { from?: string; to?: string; type?: EventType; limit?: number }
  ): Promise<TradingEvent[]> {
    const supabase = getSupabase();

    let query = supabase
      .from('events')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: true });

    if (options?.from) {
      query = query.gte('created_at', options.from);
    }
    if (options?.to) {
      query = query.lte('created_at', options.to);
    }
    if (options?.type) {
      query = query.eq('type', options.type);
    }
    if (options?.limit) {
      query = query.limit(options.limit);
    }

    const { data, error } = await query;

    if (error) {
      throw new Error(`Failed to fetch activity events: ${error.message}`);
    }

    return (data || []).map((row: Record<string, unknown>) => ({
      id: row.id as string,
      type: row.type as EventType,
      payload: row.payload as Record<string, unknown>,
      userId: row.user_id as string,
      sessionId: row.session_id as string | undefined,
      createdAt: row.created_at as string,
    }));
  }
}

export const eventService = new EventService();
