import WebSocket from 'ws';
import { config } from '../../config/index.js';
import { getSupportedAssets, getAssetConfig, initializeAssets } from '../../config/assets.js';
import { logger } from '../../lib/logger.js';
import type { WebSocketServer } from '../../websocket/index.js';
import type { Candle, Orderbook, OrderbookLevel, Trade } from '../../types/market.js';
import type { HLCandle, HLOrderbook, HLTrade, HLAllMids } from '../../types/hyperliquid.js';
import { v4 as uuidv4 } from 'uuid';

// Top assets to keep always subscribed
const TOP_ASSETS = ['BTC', 'ETH', 'SOL', 'DOGE', 'AVAX', 'LINK', 'ARB', 'OP', 'SUI', 'PEPE', 
                   'WIF', 'MATIC', 'INJ', 'APT', 'NEAR', 'FTM', 'ATOM', 'TIA', 'SEI', 'RUNE'];

// Timeframe to milliseconds
const TIMEFRAME_MS: Record<string, number> = {
  '1m': 60 * 1000,
  '5m': 5 * 60 * 1000,
  '15m': 15 * 60 * 1000,
  '1h': 60 * 60 * 1000,
  '4h': 4 * 60 * 60 * 1000,
  '1d': 24 * 60 * 60 * 1000,
};

// Cache TTL for historical candles (when to refresh from REST)
const CANDLE_CACHE_TTL: Record<string, number> = {
  '1m': 30 * 1000,
  '5m': 60 * 1000,
  '15m': 2 * 60 * 1000,
  '1h': 5 * 60 * 1000,
  '4h': 10 * 60 * 1000,
  '1d': 30 * 60 * 1000,
};

interface CandleCache {
  candles: Candle[];
  timestamp: number;
  timeframe: string;
}

// Track pending requests to prevent duplicate fetches
const pendingCandleFetches = new Map<string, Promise<Candle[]>>();

export class HyperliquidService {
  private ws: WebSocket | null = null;
  private wss: WebSocketServer;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 10;
  private reconnectTimeout: NodeJS.Timeout | null = null;
  
  // Caches
  private prices: Map<string, number> = new Map();
  private orderbooks: Map<string, Orderbook> = new Map();
  private candleCache: Map<string, CandleCache> = new Map();
  private subscribedAssets: Set<string> = new Set();
  private wsSubscribedCandles: Set<string> = new Set();

  constructor(wss: WebSocketServer) {
    this.wss = wss;
  }

  async connect(): Promise<void> {
    // Initialize assets first
    await initializeAssets();
    
    return new Promise((resolve, reject) => {
      try {
        this.ws = new WebSocket(config.hyperliquid.wsUrl);

        this.ws.on('open', () => {
          logger.info('Hyperliquid WebSocket connected');
          this.reconnectAttempts = 0;
          this.subscribeToMarkets();
          resolve();
        });

        this.ws.on('message', (data) => {
          this.handleMessage(data.toString());
        });

        this.ws.on('close', () => {
          logger.warn('Hyperliquid WebSocket closed');
          this.scheduleReconnect();
        });

        this.ws.on('error', (error) => {
          logger.error('Hyperliquid WebSocket error:', error);
          if (this.reconnectAttempts === 0) {
            reject(error);
          }
        });
      } catch (error) {
        reject(error);
      }
    });
  }

  disconnect() {
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  // Get current price from cache
  getPrice(asset: string): number {
    return this.prices.get(asset) || 0;
  }

  // Get all prices
  getAllPrices(): Map<string, number> {
    return this.prices;
  }

  // Get orderbook from cache
  getOrderbook(asset: string): Orderbook | undefined {
    return this.orderbooks.get(asset);
  }

  // Get candles - either from cache or fetch from REST API
  async getCandles(asset: string, timeframe: string, limit: number = 500): Promise<Candle[]> {
    const cacheKey = `${asset}-${timeframe}`;
    const cached = this.candleCache.get(cacheKey);
    const cacheTTL = CANDLE_CACHE_TTL[timeframe] || CANDLE_CACHE_TTL['1h'];
    
    // Return from cache if fresh
    if (cached && Date.now() - cached.timestamp < cacheTTL && cached.candles.length > 0) {
      logger.debug(`Serving ${asset} ${timeframe} candles from cache (${cached.candles.length} candles)`);
      return cached.candles.slice(-limit);
    }

    // Check if there's already a pending fetch for this
    if (pendingCandleFetches.has(cacheKey)) {
      logger.debug(`Waiting for pending fetch: ${cacheKey}`);
      try {
        const candles = await pendingCandleFetches.get(cacheKey)!;
        return candles.slice(-limit);
      } catch {
        // If pending fetch fails, try our own fetch below
      }
    }

    // Fetch from REST API
    const fetchPromise = this.fetchCandlesFromREST(asset, timeframe, limit);
    pendingCandleFetches.set(cacheKey, fetchPromise);

    try {
      const candles = await fetchPromise;
      
      // Cache the results
      this.candleCache.set(cacheKey, {
        candles,
        timestamp: Date.now(),
        timeframe,
      });
      
      // Subscribe to WebSocket updates for this asset if not already
      this.subscribeToAsset(asset);
      
      logger.info(`Fetched and cached ${candles.length} candles for ${asset} ${timeframe}`);
      return candles.slice(-limit);
    } catch (error) {
      logger.error(`Failed to fetch candles for ${asset} ${timeframe}:`, error);
      
      // Return stale cache if available
      if (cached && cached.candles.length > 0) {
        logger.info(`Returning stale cache for ${asset} ${timeframe}`);
        return cached.candles.slice(-limit);
      }
      
      // Generate fallback candles
      return this.generateFallbackCandles(asset, timeframe, limit);
    } finally {
      // Clean up pending fetch after a delay
      setTimeout(() => pendingCandleFetches.delete(cacheKey), 1000);
    }
  }

  // Fetch candles from Hyperliquid REST API
  private async fetchCandlesFromREST(asset: string, timeframe: string, limit: number): Promise<Candle[]> {
    const now = Date.now();
    const intervalMs = TIMEFRAME_MS[timeframe] || TIMEFRAME_MS['1h'];
    const startTime = now - (limit * intervalMs);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000);

    try {
      const response = await fetch('https://api.hyperliquid.xyz/info', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'candleSnapshot',
          req: {
            coin: asset,
            interval: timeframe,
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
      return candles;
    } catch (error) {
      clearTimeout(timeoutId);
      throw error;
    }
  }

  // Generate fallback candles when all else fails
  private generateFallbackCandles(asset: string, timeframe: string, limit: number): Candle[] {
    const basePrice = this.prices.get(asset) || this.getEstimatedPrice(asset);
    const candles: Candle[] = [];
    const now = Date.now();
    const intervalMs = TIMEFRAME_MS[timeframe] || TIMEFRAME_MS['1h'];

    let price = basePrice * (0.98 + Math.random() * 0.04);

    for (let i = limit - 1; i >= 0; i--) {
      const time = now - i * intervalMs;
      const volatility = basePrice * 0.002;

      const open = price;
      const change = (Math.random() - 0.48) * volatility;
      const close = open + change;
      const high = Math.max(open, close) + Math.random() * volatility * 0.5;
      const low = Math.min(open, close) - Math.random() * volatility * 0.5;
      const volume = Math.random() * 1000000 + 10000;

      candles.push({ time, open, high, low, close, volume });
      price = close;
    }

    logger.warn(`Generated fallback candles for ${asset} ${timeframe}`);
    return candles;
  }

  private getEstimatedPrice(asset: string): number {
    const estimates: Record<string, number> = {
      BTC: 95000, ETH: 3300, SOL: 180, DOGE: 0.35, AVAX: 35,
      LINK: 22, ARB: 1.2, OP: 2.5, SUI: 4.5, PEPE: 0.000015,
      WIF: 2.5, MATIC: 0.5, INJ: 25, APT: 10, NEAR: 5,
    };
    return estimates[asset] || 100;
  }

  // Subscribe to a specific asset on demand
  subscribeToAsset(asset: string): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    if (this.subscribedAssets.has(asset)) return;

    this.subscribedAssets.add(asset);

    // L2 orderbook
    this.ws.send(JSON.stringify({
      method: 'subscribe',
      subscription: { type: 'l2Book', coin: asset },
    }));

    // Trades
    this.ws.send(JSON.stringify({
      method: 'subscribe',
      subscription: { type: 'trades', coin: asset },
    }));

    // Candles (1m for live updates)
    if (!this.wsSubscribedCandles.has(asset)) {
      this.ws.send(JSON.stringify({
        method: 'subscribe',
        subscription: { type: 'candle', coin: asset, interval: '1m' },
      }));
      this.wsSubscribedCandles.add(asset);
    }

    logger.info(`Subscribed to ${asset} via WebSocket`);
  }

  private subscribeToMarkets() {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    // Subscribe to all mids (prices) - this gives us all prices in one subscription
    this.ws.send(JSON.stringify({
      method: 'subscribe',
      subscription: { type: 'allMids' },
    }));

    // Pre-subscribe to top assets
    for (const asset of TOP_ASSETS) {
      this.subscribeToAsset(asset);
    }

    logger.info(`Subscribed to allMids and ${TOP_ASSETS.length} top assets`);
  }

  private handleMessage(data: string) {
    try {
      const message = JSON.parse(data);

      if (message.channel === 'allMids') {
        this.handleAllMids(message.data);
      } else if (message.channel === 'l2Book') {
        this.handleOrderbook(message.data);
      } else if (message.channel === 'trades') {
        this.handleTrades(message.data);
      } else if (message.channel === 'candle') {
        this.handleCandle(message.data);
      }
    } catch (error) {
      logger.error('Failed to parse Hyperliquid message:', error);
    }
  }

  private handleAllMids(data: HLAllMids) {
    const mids = data.mids || data;
    for (const [coin, price] of Object.entries(mids)) {
      const priceNum = parseFloat(price as string);
      if (!isNaN(priceNum)) {
        this.prices.set(coin, priceNum);

        // Broadcast price update to subscribed clients
        this.wss.broadcast({
          type: 'price',
          channel: `price:${coin}`,
          data: { asset: coin, price: priceNum, timestamp: Date.now() },
        });
      }
    }
  }

  private handleOrderbook(data: HLOrderbook) {
    const { coin, levels, time } = data;

    const [hlBids, hlAsks] = levels;

    let bidTotal = 0;
    const bids: OrderbookLevel[] = hlBids.slice(0, 15).map((level) => {
      const size = parseFloat(level.sz);
      bidTotal += size;
      return {
        price: parseFloat(level.px),
        size,
        total: bidTotal,
      };
    });

    let askTotal = 0;
    const asks: OrderbookLevel[] = hlAsks.slice(0, 15).map((level) => {
      const size = parseFloat(level.sz);
      askTotal += size;
      return {
        price: parseFloat(level.px),
        size,
        total: askTotal,
      };
    });

    const bestBid = bids[0]?.price || 0;
    const bestAsk = asks[0]?.price || 0;
    const spread = bestAsk - bestBid;
    const midPrice = (bestBid + bestAsk) / 2;
    const spreadPercent = midPrice > 0 ? (spread / midPrice) * 100 : 0;

    const orderbook: Orderbook = {
      bids,
      asks,
      spread,
      spreadPercent,
      midPrice,
      timestamp: time,
    };

    this.orderbooks.set(coin, orderbook);
    
    // Update price from orderbook mid
    if (midPrice > 0) {
      this.prices.set(coin, midPrice);
    }

    // Broadcast orderbook update
    this.wss.broadcast({
      type: 'orderbook',
      channel: `orderbook:${coin}`,
      data: {
        bids: bids.map((b) => [b.price, b.size] as [number, number]),
        asks: asks.map((a) => [a.price, a.size] as [number, number]),
        timestamp: time,
      },
    });
  }

  private handleTrades(data: HLTrade[]) {
    if (!Array.isArray(data) || data.length === 0) return;

    for (const hlTrade of data) {
      const { coin, side, px, sz, time, hash } = hlTrade;

      const trade: Trade = {
        id: hash || uuidv4(),
        price: parseFloat(px),
        size: parseFloat(sz),
        side: side === 'B' ? 'buy' : 'sell',
        timestamp: time,
      };

      // Update price from trade
      this.prices.set(coin, trade.price);

      // Broadcast trade
      this.wss.broadcast({
        type: 'trade',
        channel: `trades:${coin}`,
        data: trade,
      });
    }
  }

  private handleCandle(data: HLCandle) {
    const { s: coin, t: time, o, h, l, c, v, i: interval } = data;

    const candle: Candle = {
      time: time,
      open: parseFloat(o),
      high: parseFloat(h),
      low: parseFloat(l),
      close: parseFloat(c),
      volume: parseFloat(v),
    };

    // Update price from candle close
    this.prices.set(coin, candle.close);

    // Update candle cache for 1m timeframe
    const cacheKey = `${coin}-1m`;
    const cached = this.candleCache.get(cacheKey);
    
    if (cached) {
      const existing = cached.candles;
      const lastCandle = existing[existing.length - 1];
      
      if (lastCandle && lastCandle.time === candle.time) {
        // Update existing candle
        existing[existing.length - 1] = candle;
      } else {
        // Add new candle
        existing.push(candle);
        if (existing.length > 500) {
          existing.shift();
        }
      }
      
      cached.timestamp = Date.now();
    }

    // Broadcast candle update
    this.wss.broadcast({
      type: 'candle',
      channel: `candles:${coin}`,
      data: candle,
    });
  }

  private scheduleReconnect() {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      logger.error('Max reconnect attempts reached for Hyperliquid');
      return;
    }

    const delay = Math.min(3000 * Math.pow(2, this.reconnectAttempts), 30000);
    this.reconnectAttempts++;

    logger.info(`Reconnecting to Hyperliquid in ${delay}ms (attempt ${this.reconnectAttempts})`);

    this.reconnectTimeout = setTimeout(() => {
      // Clear subscribed sets so we re-subscribe on reconnect
      this.subscribedAssets.clear();
      this.wsSubscribedCandles.clear();
      
      this.connect().catch((error) => {
        logger.error('Reconnect failed:', error);
      });
    }, delay);
  }
}
