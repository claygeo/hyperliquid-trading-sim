import { Router } from 'express';
import { z } from 'zod';
import { validateQuery } from '../middleware/validation.middleware.js';
import { getAssetConfig, fetchAssetsFromHyperliquid } from '../config/assets.js';
import { logger } from '../lib/logger.js';
import type { HyperliquidService } from '../services/hyperliquid/index.js';
import { MAX_EXECUTION_PRICE_AGE_MS, priceService } from '../services/price/index.js';

export const marketRoutes = Router();

// Service will be injected
let hyperliquidService: HyperliquidService | null = null;

export function setMarketHyperliquidService(service: HyperliquidService) {
  hyperliquidService = service;
  priceService.setHyperliquidService(service);
  logger.info('HyperliquidService injected into market routes');
}

async function resolveAssetSymbol(input: string): Promise<string | null> {
  let asset = getAssetConfig(input);
  if (!asset) {
    await fetchAssetsFromHyperliquid();
    asset = getAssetConfig(input);
  }
  return asset?.symbol ?? null;
}

const candlesQuerySchema = z.object({
  asset: z.string().min(1).max(20),
  timeframe: z.enum(['1m', '5m', '15m', '1h', '4h', '1d']).optional().default('1h'),
  limit: z.coerce.number().int().min(1).max(1000).optional().default(500),
}).strict();

const priceQuerySchema = z.object({
  asset: z.string().min(1).max(20),
}).strict();

// Get available assets
marketRoutes.get('/assets', async (_req, res) => {
  try {
    const assets = await fetchAssetsFromHyperliquid();
    res.json(assets);
  } catch (error) {
    logger.error('Get assets error:', error);
    res.status(500).json({ error: 'Failed to fetch assets' });
  }
});

// Get bounded historical candle snapshots from cache/REST.
marketRoutes.get('/candles', validateQuery(candlesQuerySchema), async (req, res) => {
  try {
    const { asset: requestedAsset, timeframe, limit } = req.query as unknown as {
      asset: string;
      timeframe: string;
      limit: number;
    };

    const asset = await resolveAssetSymbol(requestedAsset);
    if (!asset) {
      return res.status(400).json({ error: `Invalid asset: ${requestedAsset}` });
    }

    if (!hyperliquidService) {
      logger.error('HyperliquidService not initialized');
      return res.status(503).json({ error: 'Service unavailable' });
    }

    // This path has no durable upstream WebSocket side effects.
    const candles = await hyperliquidService.getCandles(asset, timeframe, limit);
    res.json(candles);
  } catch (error) {
    logger.error('Get candles error:', error);
    res.status(500).json({ error: 'Failed to fetch candles' });
  }
});

// Get current price - served from cache
marketRoutes.get('/price', validateQuery(priceQuerySchema), async (req, res) => {
  try {
    const { asset: requestedAsset } = req.query as { asset: string };
    const asset = await resolveAssetSymbol(requestedAsset);
    if (!asset) {
      return res.status(400).json({ error: `Invalid asset: ${requestedAsset}` });
    }

    if (!hyperliquidService) {
      return res.status(503).json({ error: 'Service unavailable' });
    }

    const price = priceService.getCurrentPrice(asset);
    
    if (price === null) {
      return res.status(503).json({
        error: 'Price feed unavailable',
        asset,
      });
    } else {
      res.json({ price });
    }
  } catch (error) {
    logger.error('Get price error:', error);
    res.status(500).json({ error: 'Failed to fetch price' });
  }
});

// Get orderbook - served from cache
marketRoutes.get('/orderbook', validateQuery(priceQuerySchema), async (req, res) => {
  try {
    const { asset: requestedAsset } = req.query as { asset: string };
    const asset = await resolveAssetSymbol(requestedAsset);
    if (!asset) {
      return res.status(400).json({ error: `Invalid asset: ${requestedAsset}` });
    }

    if (!hyperliquidService) {
      return res.status(503).json({ error: 'Service unavailable' });
    }

    const orderbook = hyperliquidService.getOrderbook(asset);
    
    if (!orderbook || Date.now() - orderbook.timestamp > MAX_EXECUTION_PRICE_AGE_MS) {
      hyperliquidService.warmAsset(asset);
      return res.status(503).json({
        error: 'Order book feed unavailable',
        asset,
      });
    } else {
      res.json(orderbook);
    }
  } catch (error) {
    logger.error('Get orderbook error:', error);
    res.status(500).json({ error: 'Failed to fetch orderbook' });
  }
});
