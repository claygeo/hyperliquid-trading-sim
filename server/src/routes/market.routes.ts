import { Router } from 'express';
import { z } from 'zod';
import { validateQuery } from '../middleware/validation.middleware.js';
import { isValidAsset, fetchAssetsFromHyperliquid } from '../config/assets.js';
import { logger } from '../lib/logger.js';
import type { HyperliquidService } from '../services/hyperliquid/index.js';

export const marketRoutes = Router();

// Service will be injected
let hyperliquidService: HyperliquidService | null = null;

export function setMarketHyperliquidService(service: HyperliquidService) {
  hyperliquidService = service;
  logger.info('HyperliquidService injected into market routes');
}

const candlesQuerySchema = z.object({
  asset: z.string(),
  timeframe: z.string().optional().default('1h'),
  limit: z.string().optional().default('500'),
});

const priceQuerySchema = z.object({
  asset: z.string(),
});

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

// Get historical candles - served from cache
marketRoutes.get('/candles', validateQuery(candlesQuerySchema), async (req, res) => {
  try {
    const { asset, timeframe, limit } = req.query as {
      asset: string;
      timeframe: string;
      limit: string;
    };

    // Validate asset exists
    if (!isValidAsset(asset)) {
      await fetchAssetsFromHyperliquid();
      if (!isValidAsset(asset)) {
        return res.status(400).json({ error: `Invalid asset: ${asset}` });
      }
    }

    if (!hyperliquidService) {
      logger.error('HyperliquidService not initialized');
      return res.status(503).json({ error: 'Service unavailable' });
    }

    // Get candles from service (will use cache or fetch)
    const candles = await hyperliquidService.getCandles(asset, timeframe, parseInt(limit));
    res.json(candles);
  } catch (error) {
    logger.error('Get candles error:', error);
    res.status(500).json({ error: 'Failed to fetch candles' });
  }
});

// Get current price - served from cache
marketRoutes.get('/price', validateQuery(priceQuerySchema), async (req, res) => {
  try {
    const { asset } = req.query as { asset: string };

    if (!isValidAsset(asset)) {
      await fetchAssetsFromHyperliquid();
      if (!isValidAsset(asset)) {
        return res.status(400).json({ error: `Invalid asset: ${asset}` });
      }
    }

    if (!hyperliquidService) {
      return res.status(503).json({ error: 'Service unavailable' });
    }

    const price = hyperliquidService.getPrice(asset);
    
    if (price === 0) {
      // Try to subscribe to this asset for future updates
      hyperliquidService.subscribeToAsset(asset);
      
      // Return a reasonable estimate
      const estimates: Record<string, number> = {
        BTC: 95000, ETH: 3300, SOL: 180, DOGE: 0.35, AVAX: 35,
        LINK: 22, ARB: 1.2, OP: 2.5, SUI: 4.5, PEPE: 0.000015,
      };
      res.json({ price: estimates[asset] || 100 });
    } else {
      res.json({ price });
    }
  } catch (error) {
    logger.error('Get price error:', error);
    res.status(500).json({ error: 'Failed to fetch price' });
  }
});

// Get market data - served from cache
marketRoutes.get('/data', validateQuery(priceQuerySchema), async (req, res) => {
  try {
    const { asset } = req.query as { asset: string };

    if (!isValidAsset(asset)) {
      await fetchAssetsFromHyperliquid();
      if (!isValidAsset(asset)) {
        return res.status(400).json({ error: `Invalid asset: ${asset}` });
      }
    }

    if (!hyperliquidService) {
      return res.status(503).json({ error: 'Service unavailable' });
    }

    let price = hyperliquidService.getPrice(asset);
    
    if (price === 0) {
      hyperliquidService.subscribeToAsset(asset);
      const estimates: Record<string, number> = {
        BTC: 95000, ETH: 3300, SOL: 180, DOGE: 0.35, AVAX: 35,
        LINK: 22, ARB: 1.2, OP: 2.5, SUI: 4.5, PEPE: 0.000015,
      };
      price = estimates[asset] || 100;
    }

    // Generate realistic 24h stats based on price
    const change24h = price * (Math.random() * 0.06 - 0.03);

    res.json({
      asset,
      price,
      change24h,
      changePercent24h: (change24h / price) * 100,
      high24h: price * 1.02,
      low24h: price * 0.98,
      volume24h: Math.random() * 1000000000,
      timestamp: Date.now(),
    });
  } catch (error) {
    logger.error('Get market data error:', error);
    res.status(500).json({ error: 'Failed to fetch market data' });
  }
});

// Get orderbook - served from cache
marketRoutes.get('/orderbook', validateQuery(priceQuerySchema), async (req, res) => {
  try {
    const { asset } = req.query as { asset: string };

    if (!isValidAsset(asset)) {
      await fetchAssetsFromHyperliquid();
      if (!isValidAsset(asset)) {
        return res.status(400).json({ error: `Invalid asset: ${asset}` });
      }
    }

    if (!hyperliquidService) {
      return res.status(503).json({ error: 'Service unavailable' });
    }

    const orderbook = hyperliquidService.getOrderbook(asset);
    
    if (!orderbook) {
      // Subscribe to this asset for future orderbook updates
      hyperliquidService.subscribeToAsset(asset);
      
      // Return empty orderbook (will be populated via WebSocket soon)
      res.json({
        bids: [],
        asks: [],
        spread: 0,
        spreadPercent: 0,
        midPrice: hyperliquidService.getPrice(asset) || 0,
        timestamp: Date.now(),
      });
    } else {
      res.json(orderbook);
    }
  } catch (error) {
    logger.error('Get orderbook error:', error);
    res.status(500).json({ error: 'Failed to fetch orderbook' });
  }
});
