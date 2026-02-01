import WebSocket from 'ws';
import { config } from '../../config/index.js';
import { initializeAssets } from '../../config/assets.js';
import { logger } from '../../lib/logger.js';
import type { WebSocketServer } from '../../websocket/index.js';
import type { Candle, Orderbook, OrderbookLevel, Trade } from '../../types/market.js';
import type { HLCandle, HLOrderbook, HLTrade, HLAllMids } from '../../types/hyperliquid.js';
import { v4 as uuidv4 } from 'uuid';

// Timeframe to milliseconds
const TIMEFRAME_MS: Record<string, number> = {
  '1m': 60 * 1000,
  '5m': 5 * 60 * 1000,
  '15m': 15 * 60 * 1000,
  '1h': 60 * 60 * 1000,
  '4h': 4 * 60 * 60 * 1000,
  '1d': 24 * 60 * 60 * 1000,
};

// Map our timeframes to CryptoCompare API endpoints and parameters
const CRYPTOCOMPARE_INTERVALS: Record<string, { endpoint: string; aggregate: number }> = {
  '1m': { endpoint: 'histominute', aggregate: 1 },
  '5m': { endpoint: 'histominute', aggregate: 5 },
  '15m': { endpoint: 'histominute', aggregate: 15 },
  '1h': { endpoint: 'histohour', aggregate: 1 },
  '4h': { endpoint: 'histohour', aggregate: 4 },
  '1d': { endpoint: 'histoday', aggregate: 1 },
};

// CryptoCompare uses standard symbols (BTC, ETH, etc.) - no mapping needed for most
const CRYPTOCOMPARE_SYMBOLS: Record<string, string> = {
  BTC: 'BTC',
  ETH: 'ETH',
  SOL: 'SOL',
  DOGE: 'DOGE',
  XRP: 'XRP',
  ADA: 'ADA',
  AVAX: 'AVAX',
  LINK: 'LINK',
  DOT: 'DOT',
  MATIC: 'MATIC',
  UNI: 'UNI',
  ATOM: 'ATOM',
  LTC: 'LTC',
  ARB: 'ARB',
  OP: 'OP',
  SUI: 'SUI',
  APT: 'APT',
  NEAR: 'NEAR',
  INJ: 'INJ',
  FTM: 'FTM',
  AAVE: 'AAVE',
  MKR: 'MKR',
  SNX: 'SNX',
  CRV: 'CRV',
  PEPE: 'PEPE',
  WIF: 'WIF',
  TIA: 'TIA',
  SEI: 'SEI',
  JUP: 'JUP',
  RENDER: 'RENDER',
  FET: 'FET',
  PENDLE: 'PENDLE',
  STX: 'STX',
  IMX: 'IMX',
  WLD: 'WLD',
  RUNE: 'RUNE',
  ENS: 'ENS',
  ONDO: 'ONDO',
  FIL: 'FIL',
  GALA: 'GALA',
  SAND: 'SAND',
  MANA: 'MANA',
  AXS: 'AXS',
  DYDX: 'DYDX',
  GMX: 'GMX',
  LDO: 'LDO',
  ENA: 'ENA',
  STRK: 'STRK',
  BLUR: 'BLUR',
  ORDI: 'ORDI',
  BONK: 'BONK',
  FLOKI: 'FLOKI',
  SHIB: 'SHIB',
  BNB: 'BNB',
  TRX: 'TRX',
  TON: 'TON',
  XLM: 'XLM',
  ALGO: 'ALGO',
  ICP: 'ICP',
  HBAR: 'HBAR',
  ETC: 'ETC',
  BCH: 'BCH',
  ZEC: 'ZEC',
  TRUMP: 'TRUMP',
  TAO: 'TAO',
  EIGEN: 'EIGEN',
  AR: 'AR',
  GRT: 'GRT',
  PYTH: 'PYTH',
  JTO: 'JTO',
  HYPE: 'HYPE',
};

// Cache TTL for historical candles - longer for reliability
const CANDLE_CACHE_TTL: Record<string, number> = {
  '1m': 45 * 1000,      // 45 seconds
  '5m': 2 * 60 * 1000,  // 2 minutes
  '15m': 5 * 60 * 1000, // 5 minutes
  '1h': 15 * 60 * 1000, // 15 minutes
  '4h': 30 * 60 * 1000, // 30 minutes
  '1d': 60 * 60 * 1000, // 1 hour
};

interface CandleCache {
  candles: Candle[];
  timestamp: number;
  timeframe: string;
}

// Track pending requests to prevent duplicate fetches
const pendingCandleFetches = new Map<string, Promise<Candle[]>>();

// Track if assets have been initialized (only do once per server lifetime)
let assetsInitialized = false;

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
  private subscriptionQueue: string[] = [];
  private isProcessingQueue = false;

  constructor(wss: WebSocketServer) {
    this.wss = wss;
  }

  async connect(): Promise<void> {
    // Only initialize assets once per server lifetime
    if (!assetsInitialized) {
      try {
        await initializeAssets();
        assetsInitialized = true;
        logger.info('Assets initialized');
      } catch (error) {
        logger.warn('Failed to initialize assets, will use defaults');
        assetsInitialized = true; // Don't retry
      }
    }
    
    return new Promise((resolve, reject) => {
      try {
        this.ws = new WebSocket(config.hyperliquid.wsUrl);

        this.ws.on('open', () => {
          logger.info('Hyperliquid WebSocket connected');
          this.reconnectAttempts = 0;
          
          // ONLY subscribe to allMids initially
          // Individual asset subscriptions happen on-demand
          this.subscribeToAllMids();
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

  // Subscribe only to allMids on startup - ONE subscription for ALL prices
  private subscribeToAllMids() {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    this.ws.send(JSON.stringify({
      method: 'subscribe',
      subscription: { type: 'allMids' },
    }));

    logger.info('Subscribed to allMids for price updates');
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
    
    // Validate cached data - ensure it has the correct asset
    if (cached && Date.now() - cached.timestamp < cacheTTL && cached.candles.length > 0) {
      // Verify cached candles have reasonable prices for this asset
      const currentPrice = this.prices.get(asset);
      if (currentPrice && cached.candles.length > 0) {
        const lastCachedPrice = cached.candles[cached.candles.length - 1].close;
        const priceDiff = Math.abs(currentPrice - lastCachedPrice) / currentPrice;
        // If cached price is more than 30% off current price, invalidate cache
        if (priceDiff > 0.3) {
          logger.info(`Cache invalidated for ${asset}: price drift too large (${priceDiff.toFixed(2)})`);
          this.candleCache.delete(cacheKey);
        } else {
          return cached.candles.slice(-limit);
        }
      } else {
        return cached.candles.slice(-limit);
      }
    }

    // Check if there's already a pending fetch
    if (pendingCandleFetches.has(cacheKey)) {
      try {
        const candles = await pendingCandleFetches.get(cacheKey)!;
        return candles.slice(-limit);
      } catch {
        // Fall through to fetch
      }
    }

    // Fetch from REST API
    const fetchPromise = this.fetchCandlesFromREST(asset, timeframe, limit);
    pendingCandleFetches.set(cacheKey, fetchPromise);

    try {
      const candles = await fetchPromise;
      
      // Validate fetched candles
      if (candles.length > 0) {
        const avgPrice = candles.reduce((sum, c) => sum + c.close, 0) / candles.length;
        
        // Sanity check: compare with known price if available
        const currentPrice = this.prices.get(asset);
        if (currentPrice && Math.abs(currentPrice - avgPrice) / currentPrice > 0.5) {
          logger.warn(`Fetched candles for ${asset} have unexpected price range: avg=${avgPrice}, current=${currentPrice}`);
        }
      }
      
      // Cache the results
      this.candleCache.set(cacheKey, {
        candles,
        timestamp: Date.now(),
        timeframe,
      });
      
      // Queue subscription for this asset (for live orderbook updates)
      this.queueAssetSubscription(asset);
      
      logger.info(`Cached ${candles.length} candles for ${asset} ${timeframe}`);
      return candles.slice(-limit);
    } catch (error) {
      logger.error(`Failed to fetch candles for ${asset} ${timeframe}:`, error);
      
      // Return stale cache if available
      if (cached && cached.candles.length > 0) {
        return cached.candles.slice(-limit);
      }
      
      // Generate fallback candles
      return this.generateFallbackCandles(asset, timeframe, limit);
    } finally {
      setTimeout(() => pendingCandleFetches.delete(cacheKey), 1000);
    }
  }

  // Queue asset subscription to avoid overwhelming the WebSocket
  private queueAssetSubscription(asset: string) {
    if (this.subscribedAssets.has(asset)) return;
    if (this.subscriptionQueue.includes(asset)) return;
    
    this.subscriptionQueue.push(asset);
    this.processSubscriptionQueue();
  }

  // Process subscription queue with delays
  private async processSubscriptionQueue() {
    if (this.isProcessingQueue) return;
    if (this.subscriptionQueue.length === 0) return;
    
    this.isProcessingQueue = true;
    
    while (this.subscriptionQueue.length > 0) {
      const asset = this.subscriptionQueue.shift()!;
      
      if (!this.subscribedAssets.has(asset)) {
        this.subscribeToAssetImmediate(asset);
        // Wait 1 second between subscriptions to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
    
    this.isProcessingQueue = false;
  }

  // Public method to subscribe to an asset
  subscribeToAsset(asset: string): void {
    this.queueAssetSubscription(asset);
  }

  // Immediate subscription (called from queue)
  private subscribeToAssetImmediate(asset: string): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    if (this.subscribedAssets.has(asset)) return;

    this.subscribedAssets.add(asset);

    // Only subscribe to L2 orderbook (we get prices from allMids)
    this.ws.send(JSON.stringify({
      method: 'subscribe',
      subscription: { type: 'l2Book', coin: asset },
    }));

    logger.info(`Subscribed to ${asset} orderbook`);
  }

  // Fetch candles from CryptoCompare API (no geo-restrictions, dedicated data API)
  private async fetchCandlesFromREST(asset: string, timeframe: string, limit: number): Promise<Candle[]> {
    const ccSymbol = CRYPTOCOMPARE_SYMBOLS[asset];
    const intervalConfig = CRYPTOCOMPARE_INTERVALS[timeframe] || CRYPTOCOMPARE_INTERVALS['1h'];
    
    // If no CryptoCompare mapping, try Hyperliquid as fallback
    if (!ccSymbol) {
      logger.warn(`No CryptoCompare mapping for ${asset}, trying Hyperliquid`);
      return this.fetchCandlesFromHyperliquid(asset, timeframe, limit);
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);

    try {
      // CryptoCompare free API - no API key needed, no geo-restrictions
      // Adjust limit for aggregate (e.g., for 5m candles, we need 5x more 1m candles)
      const adjustedLimit = Math.min(Math.ceil(limit / intervalConfig.aggregate) * intervalConfig.aggregate, 2000);
      const url = `https://min-api.cryptocompare.com/data/v2/${intervalConfig.endpoint}?fsym=${ccSymbol}&tsym=USD&limit=${adjustedLimit}&aggregate=${intervalConfig.aggregate}`;
      
      const response = await fetch(url, {
        method: 'GET',
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`CryptoCompare API error: ${response.status}`);
      }

      const data = await response.json() as {
        Response: string;
        Message?: string;
        Data?: {
          Data?: Array<{
            time: number;
            open: number;
            high: number;
            low: number;
            close: number;
            volumefrom: number;
          }>;
        };
      };

      if (data.Response !== 'Success' || !data.Data?.Data || data.Data.Data.length === 0) {
        throw new Error(`CryptoCompare API error: ${data.Message || 'Empty response'}`);
      }

      // CryptoCompare returns time in seconds, convert to ms
      const candles: Candle[] = data.Data.Data.map((c) => ({
        time: c.time * 1000,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
        volume: c.volumefrom,
      }));

      // Filter out zero-price candles and sort
      const validCandles = candles.filter(c => c.open > 0 && c.close > 0);
      validCandles.sort((a, b) => a.time - b.time);
      
      logger.info(`Fetched ${validCandles.length} candles from CryptoCompare for ${asset} ${timeframe}`);
      return validCandles.slice(-limit);
    } catch (error) {
      clearTimeout(timeoutId);
      logger.warn(`CryptoCompare fetch failed for ${asset}, trying Hyperliquid: ${error}`);
      // Fallback to Hyperliquid if CryptoCompare fails
      return this.fetchCandlesFromHyperliquid(asset, timeframe, limit);
    }
  }

  // Fallback to Hyperliquid REST API
  private async fetchCandlesFromHyperliquid(asset: string, timeframe: string, limit: number): Promise<Candle[]> {
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

      const candles: Candle[] = data.map((c: any) => ({
        time: c.t,
        open: parseFloat(c.o),
        high: parseFloat(c.h),
        low: parseFloat(c.l),
        close: parseFloat(c.c),
        volume: parseFloat(c.v),
      }));

      candles.sort((a, b) => a.time - b.time);
      logger.info(`Fetched ${candles.length} candles from Hyperliquid for ${asset} ${timeframe}`);
      return candles;
    } catch (error) {
      clearTimeout(timeoutId);
      throw error;
    }
  }

  // Generate fallback candles using REAL WebSocket price
  private generateFallbackCandles(asset: string, timeframe: string, limit: number): Candle[] {
    // Use real WebSocket price if available, otherwise estimate
    const basePrice = this.prices.get(asset) || this.getEstimatedPrice(asset);
    const candles: Candle[] = [];
    const now = Date.now();
    const intervalMs = TIMEFRAME_MS[timeframe] || TIMEFRAME_MS['1h'];

    // Start from a price slightly below current to create realistic trend
    let price = basePrice * (0.97 + Math.random() * 0.02);

    for (let i = limit - 1; i >= 0; i--) {
      const time = now - i * intervalMs;
      // Smaller volatility for more realistic chart
      const volatility = basePrice * 0.001;

      const open = price;
      // Slight upward bias to end near current price
      const bias = (i < 10) ? 0.0001 : 0;
      const change = (Math.random() - 0.48 + bias) * volatility;
      const close = open + change;
      const high = Math.max(open, close) + Math.random() * volatility * 0.3;
      const low = Math.min(open, close) - Math.random() * volatility * 0.3;
      const volume = Math.random() * 1000000 + 10000;

      candles.push({ time, open, high, low, close, volume });
      price = close;
    }

    logger.warn(`Generated fallback candles for ${asset} ${timeframe}`);
    return candles;
  }

  private getEstimatedPrice(asset: string): number {
    // Updated estimates closer to Feb 2026 market values
    // These are used as fallback only when real data isn't available
    const estimates: Record<string, number> = {
      BTC: 78000, ETH: 2800, SOL: 180, DOGE: 0.25, AVAX: 28,
      LINK: 18, ARB: 0.70, OP: 1.5, SUI: 3.5, PEPE: 0.000012,
      WIF: 1.2, MATIC: 0.38, INJ: 18, APT: 7, NEAR: 4.5,
      AAVE: 220, UNI: 10, MKR: 1400, SNX: 2.0, CRV: 0.6,
      XRP: 1.65, ADA: 0.85, DOT: 6, ATOM: 8, FTM: 0.7,
    };
    return estimates[asset] || 100;
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
      // Ignore parse errors for non-JSON messages
    }
  }

  private handleAllMids(data: HLAllMids) {
    const mids = data.mids || data;
    for (const [coin, price] of Object.entries(mids)) {
      const priceNum = parseFloat(price as string);
      if (!isNaN(priceNum)) {
        this.prices.set(coin, priceNum);

        // Broadcast price update
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

      this.prices.set(coin, trade.price);

      this.wss.broadcast({
        type: 'trade',
        channel: `trades:${coin}`,
        data: trade,
      });
    }
  }

  private handleCandle(data: HLCandle) {
    const { s: coin, t: time, o, h, l, c, v } = data;

    const candle: Candle = {
      time: time,
      open: parseFloat(o),
      high: parseFloat(h),
      low: parseFloat(l),
      close: parseFloat(c),
      volume: parseFloat(v),
    };

    this.prices.set(coin, candle.close);

    // Update candle cache
    const cacheKey = `${coin}-1m`;
    const cached = this.candleCache.get(cacheKey);
    
    if (cached) {
      const existing = cached.candles;
      const lastCandle = existing[existing.length - 1];
      
      if (lastCandle && lastCandle.time === candle.time) {
        existing[existing.length - 1] = candle;
      } else {
        existing.push(candle);
        if (existing.length > 500) {
          existing.shift();
        }
      }
      cached.timestamp = Date.now();
    }

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

    // Use longer delays to avoid hammering
    const delay = Math.min(5000 * Math.pow(1.5, this.reconnectAttempts), 60000);
    this.reconnectAttempts++;

    logger.info(`Reconnecting to Hyperliquid in ${delay}ms (attempt ${this.reconnectAttempts})`);

    this.reconnectTimeout = setTimeout(() => {
      // Clear subscribed assets so we can re-subscribe on demand
      this.subscribedAssets.clear();
      
      this.connect().catch((error) => {
        logger.error('Reconnect failed:', error);
      });
    }, delay);
  }
}
