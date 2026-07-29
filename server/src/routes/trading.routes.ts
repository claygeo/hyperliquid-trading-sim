import { Router } from 'express';
import { z } from 'zod';
import { authMiddleware, AuthenticatedRequest } from '../middleware/auth.middleware.js';
import { validateBody, validateParams, validateQuery } from '../middleware/validation.middleware.js';
import { OrderExecutor, PositionManager } from '../services/trading/index.js';
import { getSupabase } from '../lib/supabase.js';
import { logger } from '../lib/logger.js';
import { priceService } from '../services/price/index.js';
import type { HyperliquidService } from '../services/hyperliquid/index.js';
import { eventService } from '../services/events/index.js';
import { fetchAssetsFromHyperliquid, getAssetConfig } from '../config/assets.js';
import { getHttpStatus } from '../lib/errors.js';

export const tradingRoutes = Router();

export function setHyperliquidService(service: HyperliquidService) {
  priceService.setHyperliquidService(service);
}

const orderExecutor = new OrderExecutor();
const positionManager = new PositionManager();

const placeOrderSchema = z.object({
  asset: z.string(),
  side: z.enum(['long', 'short']),
  size: z.number().finite().positive(),
  leverage: z.number().finite().int().min(1).max(50),
  expectedAccountResetCount: z.number().int().nonnegative().safe(),
  source: z.enum(['manual', 'signal']).optional(),
  signalId: z.string().min(1).max(100).regex(/^[A-Za-z0-9:_-]+$/).optional(),
}).superRefine((order, context) => {
  const isSignal = order.source === 'signal';
  if (isSignal !== Boolean(order.signalId)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['signalId'],
      message: 'signalId is required exactly when source is signal',
    });
  }
});
const positionIdSchema = z.object({
  id: z.string().uuid(),
});
const idempotencyKeySchema = z.string().uuid();
const tradeHistoryQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional().default(50),
  offset: z.coerce.number().int().min(0).max(10000).optional().default(0),
}).strict();

// Get current price via PriceService (live WS → last known → null)
function getCurrentPrice(asset: string): number | null {
  return priceService.getCurrentPrice(asset);
}

// Place market order
tradingRoutes.post(
  '/order',
  authMiddleware,
  validateBody(placeOrderSchema),
  async (req: AuthenticatedRequest, res) => {
    try {
      const {
        asset: requestedAsset,
        side,
        size,
        leverage,
        expectedAccountResetCount,
        source,
        signalId,
      } = req.body;
      const userId = req.userId!;
      const idempotencyKeyResult = idempotencyKeySchema.safeParse(
        req.get('Idempotency-Key')
      );
      if (!idempotencyKeyResult.success) {
        return res.status(400).json({
          error: 'A valid UUID Idempotency-Key header is required',
        });
      }
      const idempotencyKey = idempotencyKeyResult.data;

      let assetConfig = getAssetConfig(requestedAsset);
      if (!assetConfig) {
        await fetchAssetsFromHyperliquid();
        assetConfig = getAssetConfig(requestedAsset);
      }
      if (!assetConfig) {
        return res.status(400).json({ error: `Invalid asset: ${requestedAsset}` });
      }
      const asset = assetConfig.symbol;

      logger.info(`Order request: ${side} ${size} ${asset} @ ${leverage}x for user ${userId} (source: ${source || 'manual'})`);

      const currentPrice = getCurrentPrice(asset);
      if (currentPrice === null) {
        return res.status(503).json({ error: 'Price feed unavailable', details: `No price data for ${asset}` });
      }
      logger.info(`Current price for ${asset}: ${currentPrice}`);

      const position = await orderExecutor.executeMarketOrder(
        userId,
        { asset, side, size, leverage, expectedAccountResetCount, source, signalId },
        currentPrice,
        idempotencyKey
      );

      logger.info(`Order executed: position ${position.id}`);
      res.setHeader('Idempotency-Key', idempotencyKey);
      res.status(201).json(position);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to place order';
      logger.error(`Order error for user ${req.userId}: ${message}`);
      
      // Operational validation/conflict errors carry their own 4xx status.
      // Unknown failures stay 5xx because an RPC response can be lost after
      // commit; reporting those as a terminal 400 can cause a client to rotate
      // its idempotency key and execute the order twice.
      res.status(getHttpStatus(error)).json({
        error: message,
        details: error instanceof Error ? error.name : 'UnknownError'
      });
    }
  }
);

// Get open positions
tradingRoutes.get('/positions', authMiddleware, async (req: AuthenticatedRequest, res) => {
  try {
    const positions = await positionManager.getOpenPositions(req.userId!);
    
    // Update positions with current prices
    const updatedPositions = positions.map((position) => {
      const livePrice = getCurrentPrice(position.asset);
      const currentPrice = livePrice ?? position.entryPrice;
      const priceDiff = currentPrice - position.entryPrice;
      const direction = position.side === 'long' ? 1 : -1;
      const rawUnrealizedPnl = priceDiff * position.size * direction;
      const unrealizedPnl = Math.max(rawUnrealizedPnl, -position.margin);
      const unrealizedPnlPercent = (unrealizedPnl / position.margin) * 100;

      return {
        ...position,
        currentPrice,
        unrealizedPnl,
        unrealizedPnlPercent,
        priceStale: livePrice === null, // true when price feed is unavailable
      };
    });
    
    res.json(updatedPositions);
  } catch (error) {
    logger.error('Get positions error:', error);
    res.status(500).json({ error: 'Failed to fetch positions' });
  }
});

// Close position
tradingRoutes.post(
  '/close/:id',
  authMiddleware,
  validateParams(positionIdSchema),
  async (req: AuthenticatedRequest, res) => {
    try {
      const { id } = req.params;
      const userId = req.userId!;

      // Get position to determine asset
      const position = await positionManager.getPosition(userId, id);
      if (!position) {
        return res.status(404).json({ error: 'Position not found' });
      }

      const currentPrice = getCurrentPrice(position.asset);
      if (currentPrice === null) {
        return res.status(503).json({ error: 'Price feed unavailable', details: `No price data for ${position.asset}` });
      }

      const closedPosition = await orderExecutor.closePosition(userId, id, currentPrice);

      // Emit position_closed event (post-fee PnL)
      await eventService.emit('position_closed', {
        positionId: id,
        asset: closedPosition.asset,
        side: closedPosition.side,
        entryPrice: closedPosition.entryPrice,
        exitPrice: closedPosition.currentPrice,
        size: closedPosition.size,
        realizedPnl: closedPosition.realizedPnl,
        source: closedPosition.source,
      }, userId);

      res.json(closedPosition);
    } catch (error) {
      logger.error('Close position error:', error);
      res.status(400).json({
        error: error instanceof Error ? error.message : 'Failed to close position',
      });
    }
  }
);

// Get trade history
tradingRoutes.get('/history', authMiddleware, validateQuery(tradeHistoryQuerySchema), async (req: AuthenticatedRequest, res) => {
  try {
    const { limit, offset } = req.query as unknown as z.infer<typeof tradeHistoryQuerySchema>;
    const supabase = getSupabase();

    const { data: trades, error, count } = await supabase
      .from('trades')
      .select('*', { count: 'exact' })
      .eq('user_id', req.userId!)
      .order('closed_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) {
      throw error;
    }

    res.json({
      trades: trades || [],
      total: count || 0,
    });
  } catch (error) {
    logger.error('Get trade history error:', error);
    res.status(500).json({ error: 'Failed to fetch trade history' });
  }
});
