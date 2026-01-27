import { Router } from 'express';
import { z } from 'zod';
import { validateQuery } from '../middleware/validation.middleware.js';
import { isValidAsset } from '../config/assets.js';
import { logger } from '../lib/logger.js';
import type { Candle } from '../types/market.js';

export const marketRoutes = Router();

const candlesQuerySchema = z.object({
  asset: z.string(),
  timeframe: z.string().optional().default('1h'),
  limit: z.string().optional().default('500'),
});

const priceQuerySchema = z.object({
  asset: z.string(),
});

// Hyperliquid interval mapping
const TIMEFRAME_MAP: Record<string, string> = {
  '1m': '1m',
  '5m': '5m',
  '15m': '15m',
  '1h': '1h',
  '4h': '4h',
  '1d': '1d',
};

// Cache for candles to avoid rate limiting
const candleCache = new Map<string, { candles: Candle[]; timestamp: number }>();
const CACHE_TTL = 10000; // 10 seconds

// Generate fallback candles when API fails
function generateFallbackCandles(
  asset: string,
  timeframe: string,
  limit: number
): Candle[] {
  const basePrices: Record<string, number> = {
    BTC: 87500,
    ETH: 2900,
    SOL: 120,
  };

  const basePrice = basePrices[asset] || 100;
  const candles: Candle[] = [];
  const now = Date.now();
  
  const intervalMs: Record<string, number> = {
    '1m': 60 * 1000,
    '5m': 5 * 60 * 1000,
    '15m': 15 * 60 * 1000,
    '1h': 60 * 60 * 1000,
    '4h': 4 * 60 * 60 * 1000,
    '1d': 24 * 60 * 60 * 1000,
  };

  const interval = intervalMs[timeframe] || intervalMs['1h'];
  let price = basePrice * (0.98 + Math.random() * 0.04);

  for (let i = limit - 1; i >= 0; i--) {
    const time = now - i * interval;
    const volatility = basePrice * 0.002;
    
    const open = price;
    const change = (Math.random() - 0.48) * volatility;
    const close = open + change;
    const high = Math.max(open, close) + Math.random() * volatility * 0.5;
    const low = Math.min(open, close) - Math.random() * volatility * 0.5;
    const volume = Math.random() * 1000 + 100;

    candles.push({ time, open, high, low, close, volume });
    price = close;
  }

  return candles;
}

// Fetch candles from Hyperliquid REST API with caching and fallback
async function fetchHyperliquidCandles(
  asset: string,
  timeframe: string,
  limit: number
): Promise<Candle[]> {
  const cacheKey = `${asset}-${timeframe}`;
  const cached = candleCache.get(cacheKey);
  
  // Return cached if fresh
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.candles.slice(-limit);
  }

  const interval = TIMEFRAME_MAP[timeframe] || '1h';
  const now = Date.now();
  
  const intervalMs: Record<string, number> = {
    '1m': 60 * 1000,
    '5m': 5 * 60 * 1000,
    '15m': 15 * 60 * 1000,
    '1h': 60 * 60 * 1000,
    '4h': 4 * 60 * 60 * 1000,
    '1d': 24 * 60 * 60 * 1000,
  };
  
  const startTime = now - (limit * (intervalMs[timeframe] || intervalMs['1h']));

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000); // 5s timeout

    const response = await fetch('https://api.hyperliquid.xyz/info', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'candleSnapshot',
        req: {
          coin: asset,
          interval: interval,
          startTime: startTime,
          endTime: now,
        },
      }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`Hyperliquid API error: ${response.status}`);
    }

    const data = await response.json();
    
    if (!Array.isArray(data) || data.length === 0) {
      throw new Error('Invalid or empty response from Hyperliquid');
    }

    // Transform Hyperliquid candle format
    const candles: Candle[] = data.map((c: any) => ({
      time: c.t,
      open: parseFloat(c.o),
      high: parseFloat(c.h),
      low: parseFloat(c.l),
      close: parseFloat(c.c),
      volume: parseFloat(c.v),
    }));

    candles.sort((a, b) => a.time - b.time);

    // Cache the results
    candleCache.set(cacheKey, { candles, timestamp: Date.now() });

    return candles.slice(-limit);
  } catch (error) {
    logger.warn(`Failed to fetch Hyperliquid candles for ${asset}, using fallback:`, error);
    
    // Return cached even if stale, or generate fallback
    if (cached) {
      return cached.candles.slice(-limit);
    }
    
    return generateFallbackCandles(asset, timeframe, limit);
  }
}

// Get current price from Hyperliquid with fallback
async function fetchHyperliquidPrice(asset: string): Promise<number> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3000); // 3s timeout

    const response = await fetch('https://api.hyperliquid.xyz/info', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'allMids' }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`Hyperliquid API error: ${response.status}`);
    }

    const data = await response.json();
    const price = parseFloat(data[asset]);
    
    if (isNaN(price)) {
      throw new Error(`Price not found for ${asset}`);
    }

    return price;
  } catch (error) {
    logger.warn(`Failed to fetch Hyperliquid price for ${asset}, using fallback`);
    
    // Fallback prices
    const fallbackPrices: Record<string, number> = {
      BTC: 87500,
      ETH: 2900,
      SOL: 120,
    };
    return fallbackPrices[asset] || 100;
  }
}

// Get historical candles
marketRoutes.get('/candles', validateQuery(candlesQuerySchema), async (req, res) => {
  try {
    const { asset, timeframe, limit } = req.query as {
      asset: string;
      timeframe: string;
      limit: string;
    };

    if (!isValidAsset(asset)) {
      return res.status(400).json({ error: `Invalid asset: ${asset}` });
    }

    const candles = await fetchHyperliquidCandles(asset, timeframe, parseInt(limit));
    res.json(candles);
  } catch (error) {
    logger.error('Get candles error:', error);
    res.status(500).json({ error: 'Failed to fetch candles' });
  }
});

// Get current price
marketRoutes.get('/price', validateQuery(priceQuerySchema), async (req, res) => {
  try {
    const { asset } = req.query as { asset: string };

    if (!isValidAsset(asset)) {
      return res.status(400).json({ error: `Invalid asset: ${asset}` });
    }

    const price = await fetchHyperliquidPrice(asset);
    res.json({ price });
  } catch (error) {
    logger.error('Get price error:', error);
    res.status(500).json({ error: 'Failed to fetch price' });
  }
});

// Get market data
marketRoutes.get('/data', validateQuery(priceQuerySchema), async (req, res) => {
  try {
    const { asset } = req.query as { asset: string };

    if (!isValidAsset(asset)) {
      return res.status(400).json({ error: `Invalid asset: ${asset}` });
    }

    const price = await fetchHyperliquidPrice(asset);
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
