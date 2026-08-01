import { getSupabase } from '../../lib/supabase.js';
import { PnlCalculator } from './pnlCalculator.js';
import type { Position, OrderSide } from '../../types/trading.js';

export class PositionManager {
  private pnlCalculator: PnlCalculator;

  constructor() {
    this.pnlCalculator = new PnlCalculator();
  }

  async getOpenPositions(userId: string): Promise<Position[]> {
    const supabase = getSupabase();

    const { data: positions, error } = await supabase
      .from('positions')
      .select('*')
      .eq('user_id', userId)
      .eq('status', 'open')
      .order('opened_at', { ascending: false });

    if (error) {
      throw new Error(`Failed to fetch positions: ${error.message}`);
    }

    return (positions || []).map(this.mapDbPosition);
  }

  async getPosition(userId: string, positionId: string): Promise<Position | null> {
    const supabase = getSupabase();

    const { data: position, error } = await supabase
      .from('positions')
      .select('*')
      .eq('id', positionId)
      .eq('user_id', userId)
      .single();

    if (error || !position) {
      return null;
    }

    return this.mapDbPosition(position);
  }

  async updatePositionPrice(
    positionId: string,
    currentPrice: number
  ): Promise<Position | null> {
    const supabase = getSupabase();

    const { data: position, error: fetchError } = await supabase
      .from('positions')
      .select('*')
      .eq('id', positionId)
      .eq('status', 'open')
      .single();

    if (fetchError || !position) {
      return null;
    }

    const unrealizedPnl = this.pnlCalculator.calculatePnl(
      position.entry_price,
      currentPrice,
      position.size,
      position.side as OrderSide
    );

    const unrealizedPnlPercent = this.pnlCalculator.calculatePnlPercent(
      position.entry_price,
      currentPrice,
      position.side as OrderSide,
      position.leverage
    );

    const { data: updated, error: updateError } = await supabase
      .from('positions')
      .update({
        current_price: currentPrice,
        unrealized_pnl: unrealizedPnl,
        unrealized_pnl_percent: unrealizedPnlPercent,
      })
      .eq('id', positionId)
      .select()
      .single();

    if (updateError || !updated) {
      return null;
    }

    return this.mapDbPosition(updated);
  }

  private mapDbPosition(db: Record<string, unknown>): Position {
    return {
      id: db.id as string,
      userId: db.user_id as string,
      asset: db.asset as string,
      side: db.side as OrderSide,
      entryPrice: db.entry_price as number,
      currentPrice: db.current_price as number,
      size: db.size as number,
      leverage: db.leverage as number,
      margin: db.margin as number,
      liquidationPrice: db.liquidation_price as number,
      unrealizedPnl: db.unrealized_pnl as number,
      unrealizedPnlPercent: db.unrealized_pnl_percent as number,
      realizedPnl: db.realized_pnl as number,
      status: db.status as Position['status'],
      source: (db.source as Position['source']) || 'manual',
      signalId: db.signal_id as string | undefined,
      openedAt: db.opened_at as string,
      closedAt: db.closed_at as string | undefined,
    };
  }
}
