import { Router } from 'express';
import { z } from 'zod';
import { authMiddleware, AuthenticatedRequest } from '../middleware/auth.middleware.js';
import { validateBody, validateParams } from '../middleware/validation.middleware.js';
import { OrderExecutor, PositionManager } from '../services/trading/index.js';
import { LeaderboardService } from '../services/leaderboard/index.js';
import { getSupabase } from '../lib/supabase.js';
import { logger } from '../lib/logger.js';
import type { HyperliquidService } from '../services/hyperliquid/index.js';

export const tradingRoutes = Router();

let hyperliquidService: HyperliquidService | null = null;

export function setHyperliquidService(service: HyperliquidService) {
  hyperliquidService = service;
}

const orderExecutor = new OrderExecutor();
const positionManager = new PositionManager();
const leaderboardService = new LeaderboardService();

const placeOrderSchema = z.object({
  asset: z.string(),
  side: z.enum(['long', 'short']),
  size: z.number().positive(),
  leverage: z.number().min(1).max(50),
});

const positionIdSchema = z.object({
  id: z.string().uuid(),
});

// Helper to get current price from Hyperliquid or fallback
function getCurrentPrice(asset: string): number {
  if (hyperliquidService) {
    const price = hyperliquidService.getPrice(asset);
    if (price > 0) return price;
  }
  // Fallback prices if service unavailable
  const fallbackPrices: Record<string, number> = {
    BTC: 87500,
    ETH: 2900,
    SOL: 120,
  };
  return fallbackPrices[asset] || 100;
}

// Place market order
tradingRoutes.post(
  '/order',
  authMiddleware,
  validateBody(placeOrderSchema),
  async (req: AuthenticatedRequest, res) => {
    try {
      const { asset, side, size, leverage } = req.body;
      const userId = req.userId!;

      logger.info(`Order request: ${side} ${size} ${asset} @ ${leverage}x for user ${userId}`);

      const currentPrice = getCurrentPrice(asset);
      logger.info(`Current price for ${asset}: ${currentPrice}`);

      const position = await orderExecutor.executeMarketOrder(
        userId,
        { asset, side, size, leverage },
        currentPrice
      );

      logger.info(`Order executed: position ${position.id}`);
      res.status(201).json(position);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to place order';
      logger.error(`Order error for user ${req.userId}: ${message}`);
      
      // Return proper error with message
      res.status(400).json({ 
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
      const currentPrice = getCurrentPrice(position.asset);
      const priceDiff = currentPrice - position.entryPrice;
      const direction = position.side === 'long' ? 1 : -1;
      const unrealizedPnl = priceDiff * position.size * direction;
      const unrealizedPnlPercent = (priceDiff / position.entryPrice) * 100 * direction * position.leverage;
      
      return {
        ...position,
        currentPrice,
        unrealizedPnl,
        unrealizedPnlPercent,
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

      const closedPosition = await orderExecutor.closePosition(userId, id, currentPrice);

      // Update leaderboard stats
      await leaderboardService.updateUserStats(userId);

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
tradingRoutes.get('/history', authMiddleware, async (req: AuthenticatedRequest, res) => {
  try {
    const limit = parseInt(req.query.limit as string) || 50;
    const offset = parseInt(req.query.offset as string) || 0;
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

// Get account info (useful for debugging)
tradingRoutes.get('/account', authMiddleware, async (req: AuthenticatedRequest, res) => {
  try {
    const supabase = getSupabase();
    const { data: account, error } = await supabase
      .from('accounts')
      .select('*')
      .eq('user_id', req.userId!)
      .single();

    if (error || !account) {
      return res.status(404).json({ error: 'Account not found' });
    }

    // Get open positions for margin calculation
    const { data: positions } = await supabase
      .from('positions')
      .select('margin')
      .eq('user_id', req.userId!)
      .eq('status', 'open');

    const usedMargin = (positions || []).reduce((sum, p) => sum + p.margin, 0);
    const availableBalance = account.balance - usedMargin;

    res.json({
      balance: account.balance,
      usedMargin,
      availableBalance,
      initialBalance: account.initial_balance,
    });
  } catch (error) {
    logger.error('Get account error:', error);
    res.status(500).json({ error: 'Failed to fetch account' });
  }
});

// Get limit orders (placeholder - returns empty for now as we only support market orders)
tradingRoutes.get('/limit-orders', authMiddleware, async (req: AuthenticatedRequest, res) => {
  try {
    // Return empty array - limit orders not implemented yet
    res.json([]);
  } catch (error) {
    logger.error('Get limit orders error:', error);
    res.status(500).json({ error: 'Failed to fetch limit orders' });
  }
});
