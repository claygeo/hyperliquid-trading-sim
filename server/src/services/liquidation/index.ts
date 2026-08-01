import { randomUUID } from 'crypto';
import { getSupabase } from '../../lib/supabase.js';
import { logger } from '../../lib/logger.js';
import { priceService } from '../price/index.js';
import { eventService } from '../events/index.js';
import { OrderExecutor } from '../trading/index.js';

// The engine is a trigger, not an authority. It detects liquidation-price
// crossings from the same fail-closed price source used for order execution
// and routes every liquidation through the exact same close path as a manual
// close: OrderExecutor.closePosition -> close_position_atomic. The RPC keeps
// sole authority over accounting (isolated-margin loss clamp, account-first
// locking, single balance write), so a duplicate or racing trigger degrades to
// a benign "already closed" error rather than a second debit.

export interface OpenPositionRow {
  id: string;
  userId: string;
  asset: string;
  side: 'long' | 'short';
  liquidationPrice: number;
}

export interface LiquidationEngineDeps {
  fetchOpenPositions(limit: number): Promise<OpenPositionRow[]>;
  getPrice(asset: string): number | null;
  closePosition(userId: string, positionId: string, currentPrice: number): Promise<unknown>;
  emitLiquidationEvent(row: OpenPositionRow, price: number): Promise<void>;
}

export const DEFAULT_SWEEP_INTERVAL_MS = 3_000;
// Bounded sweep; anything above the cap is picked up next sweep and the cap is
// logged so coverage gaps are visible instead of silent.
export const MAX_POSITIONS_PER_SWEEP = 500;

const BENIGN_CLOSE_ERRORS = [
  'Position not found',
  'already closed',
];

export function isLiquidatable(
  side: 'long' | 'short',
  currentPrice: number,
  liquidationPrice: number
): boolean {
  if (!Number.isFinite(currentPrice) || currentPrice <= 0) return false;
  if (!Number.isFinite(liquidationPrice) || liquidationPrice <= 0) return false;
  return side === 'long'
    ? currentPrice <= liquidationPrice
    : currentPrice >= liquidationPrice;
}

export class LiquidationEngine {
  private deps: LiquidationEngineDeps;
  private timer: NodeJS.Timeout | null = null;
  private sweeping = false;
  private inFlight = new Set<string>();

  constructor(deps: LiquidationEngineDeps) {
    this.deps = deps;
  }

  start(intervalMs: number = DEFAULT_SWEEP_INTERVAL_MS): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.sweep();
    }, intervalMs);
    // Do not hold the process open for the sweep loop alone.
    this.timer.unref?.();
    logger.info(`Liquidation engine started (sweep every ${intervalMs}ms)`);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async sweep(): Promise<number> {
    // A slow sweep must not stack behind itself.
    if (this.sweeping) return 0;
    this.sweeping = true;
    let liquidated = 0;
    try {
      const rows = await this.deps.fetchOpenPositions(MAX_POSITIONS_PER_SWEEP);
      if (rows.length === MAX_POSITIONS_PER_SWEEP) {
        logger.warn(
          `Liquidation sweep hit the ${MAX_POSITIONS_PER_SWEEP}-position cap; remaining positions are covered next sweep`
        );
      }

      for (const row of rows) {
        if (this.inFlight.has(row.id)) continue;

        // Fail closed: a stale or missing price never triggers a liquidation.
        const price = this.deps.getPrice(row.asset);
        if (price === null) continue;
        if (!isLiquidatable(row.side, price, row.liquidationPrice)) continue;

        this.inFlight.add(row.id);
        try {
          await this.deps.closePosition(row.userId, row.id, price);
          liquidated += 1;
          logger.info(
            `Liquidation executed: position ${row.id} (${row.asset} ${row.side}) at ${price}`
          );
          try {
            await this.deps.emitLiquidationEvent(row, price);
          } catch (eventError) {
            // Events are best-effort; accounting already committed.
            logger.warn(`Liquidation event emit failed for ${row.id}:`, eventError);
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          if (BENIGN_CLOSE_ERRORS.some((fragment) => message.includes(fragment))) {
            // Lost the race to a manual close, reset, or a concurrent trigger.
            logger.info(`Liquidation skipped for ${row.id}: ${message}`);
          } else {
            logger.error(`Liquidation failed for position ${row.id}:`, error);
          }
        } finally {
          this.inFlight.delete(row.id);
        }
      }
    } catch (error) {
      logger.error('Liquidation sweep failed:', error);
    } finally {
      this.sweeping = false;
    }
    return liquidated;
  }
}

export function createLiquidationEngine(): LiquidationEngine {
  const orderExecutor = new OrderExecutor();

  return new LiquidationEngine({
    async fetchOpenPositions(limit: number): Promise<OpenPositionRow[]> {
      const supabase = getSupabase();
      const { data, error } = await supabase
        .from('positions')
        .select('id, user_id, asset, side, liquidation_price')
        .eq('status', 'open')
        .order('opened_at', { ascending: true })
        .limit(limit);
      if (error) {
        throw new Error(`Failed to fetch open positions: ${error.message}`);
      }
      return (data ?? []).map((row) => ({
        id: row.id as string,
        userId: row.user_id as string,
        asset: row.asset as string,
        side: row.side as 'long' | 'short',
        liquidationPrice: Number(row.liquidation_price),
      }));
    },
    getPrice(asset: string): number | null {
      return priceService.getCurrentPrice(asset);
    },
    async closePosition(userId: string, positionId: string, currentPrice: number) {
      return orderExecutor.closePosition(userId, positionId, currentPrice);
    },
    async emitLiquidationEvent(row: OpenPositionRow, price: number) {
      await eventService.emit(
        'position_liquidated',
        {
          positionId: row.id,
          asset: row.asset,
          side: row.side,
          liquidationPrice: row.liquidationPrice,
          triggerPrice: price,
          eventId: randomUUID(),
        },
        row.userId
      );
    },
  });
}
