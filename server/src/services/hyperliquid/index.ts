import WebSocket from 'ws';
import { config } from '../../config/index.js';
import { initializeAssets } from '../../config/assets.js';
import { logger } from '../../lib/logger.js';
import type { WebSocketServer } from '../../websocket/index.js';
import type { Candle, Orderbook, OrderbookLevel, Trade } from '../../types/market.js';
import type { HLOrderbook, HLTrade, HLAllMids } from '../../types/hyperliquid.js';
import { randomUUID } from 'node:crypto';

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

// Cache TTL for historical candle snapshots.
const CANDLE_CACHE_TTL: Record<string, number> = {
  '1m': 30 * 1000,      // 30 seconds
  '5m': 60 * 1000,      // 1 minute
  '15m': 3 * 60 * 1000, // 3 minutes
  '1h': 10 * 60 * 1000, // 10 minutes
  '4h': 20 * 60 * 1000, // 20 minutes
  '1d': 60 * 60 * 1000, // 1 hour
};

interface CandleCache {
  candles: Candle[];
  timestamp: number;
  timeframe: string;
}

// Track pending requests to prevent duplicate fetches
const pendingCandleFetches = new Map<string, Promise<Candle[]>>();

const DEFAULT_WARM_LEASE_MS = 15_000;

// Hyperliquid permits 2,000 client messages per minute per IP across every
// upstream WebSocket connection. Pace this process at 1,200/minute so control
// traffic retains 40% headroom for reconnects and any future heartbeat traffic.
export const UPSTREAM_CONTROL_MESSAGE_INTERVAL_MS = 50;

type AssetFeedType = 'l2Book' | 'trades';
type UpstreamSubscription =
  | { type: 'allMids' }
  | { type: AssetFeedType; coin: string };

// Track if assets have been initialized (only do once per server lifetime)
let assetsInitialized = false;

export class HyperliquidService {
  private ws: WebSocket | null = null;
  private wss: WebSocketServer;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 10;
  private reconnectTimeout: NodeJS.Timeout | null = null;
  private shouldReconnect = true;
  
  // Caches
  private prices: Map<string, number> = new Map();
  private priceObservedAt: Map<string, number> = new Map();
  private orderbooks: Map<string, Orderbook> = new Map();
  private candleCache: Map<string, CandleCache> = new Map();
  private assetLeaseCounts: Map<string, number> = new Map();
  private desiredAssets: Set<string> = new Set();
  private warmLeaseTimeouts: Map<string, NodeJS.Timeout> = new Map();
  private activeControlSubscriptions: Set<string> = new Set();
  private queuedControlSubscriptions: Set<string> = new Set();
  private controlQueue: UpstreamSubscription[] = [];
  private controlTimer: NodeJS.Timeout | null = null;
  private lastControlMessageAt = 0;
  
  constructor(wss: WebSocketServer) {
    this.wss = wss;
  }

  async connect(): Promise<void> {
    this.shouldReconnect = true;
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
        const socket = new WebSocket(config.hyperliquid.wsUrl);
        this.ws = socket;
        let settled = false;

        socket.on('open', () => {
          if (this.ws !== socket || !this.shouldReconnect) {
            if (!settled) {
              settled = true;
              reject(new Error('Hyperliquid connection was superseded'));
            }
            socket.close();
            return;
          }

          logger.info('Hyperliquid WebSocket connected');
          this.reconnectAttempts = 0;

          // A new socket has no upstream subscriptions. Rebuild the desired
          // state through the same paced control path used during steady state.
          this.resetControlSocketState();
          this.subscribeToAllMids();
          this.restoreDesiredAssetSubscriptions();
          if (!settled) {
            settled = true;
            resolve();
          }
        });

        socket.on('message', (data) => {
          if (this.ws !== socket) return;
          this.handleMessage(data.toString());
        });

        socket.on('close', () => {
          if (!settled) {
            settled = true;
            reject(new Error('Hyperliquid WebSocket closed before opening'));
          }
          if (this.ws !== socket) return;

          logger.warn('Hyperliquid WebSocket closed');
          this.ws = null;
          this.resetControlSocketState();
          if (this.shouldReconnect) {
            this.scheduleReconnect();
          }
        });

        socket.on('error', (error) => {
          if (this.ws !== socket) return;
          logger.error('Hyperliquid WebSocket error:', error);
          if (!settled) {
            settled = true;
            reject(error);
          }
        });
      } catch (error) {
        reject(error);
      }
    });
  }

  disconnect() {
    this.shouldReconnect = false;
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
    for (const timeout of this.warmLeaseTimeouts.values()) {
      clearTimeout(timeout);
    }
    this.warmLeaseTimeouts.clear();
    this.assetLeaseCounts.clear();
    this.desiredAssets.clear();
    this.resetControlSocketState();

    const socket = this.ws;
    this.ws = null;
    if (socket) {
      // Closing the socket atomically drops every upstream subscription. Do not
      // bypass the paced control path by trying to flush unsubs during shutdown.
      socket.close();
    }
  }

  // Subscribe only to allMids on startup - ONE subscription for ALL prices
  private subscribeToAllMids() {
    this.enqueueControlReconciliation({ type: 'allMids' });
  }

  // Get current price from cache
  getPrice(asset: string): number {
    return this.prices.get(asset) || 0;
  }

  getPriceSnapshot(asset: string): { price: number; observedAt: number } | null {
    const price = this.prices.get(asset);
    const observedAt = this.priceObservedAt.get(asset);
    if (!price || !observedAt) return null;
    return { price, observedAt };
  }

  // Get all prices
  getAllPrices(): Map<string, number> {
    return this.prices;
  }

  // Get orderbook from cache
  getOrderbook(asset: string): Orderbook | undefined {
    return this.orderbooks.get(asset);
  }

  // Get bounded historical candle snapshots from cache or REST. A public HTTP
  // request must never create a durable upstream WebSocket subscription.
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
      
      logger.info(`Cached ${candles.length} candles for ${asset} ${timeframe}`);
      return candles.slice(-limit);
    } catch (error) {
      logger.error(`Failed to fetch candles for ${asset} ${timeframe}:`, error);
      
      // Return stale cache if available
      if (cached && cached.candles.length > 0) {
        return cached.candles.slice(-limit);
      }
      
      throw new Error(`Candle data unavailable for ${asset} ${timeframe}`, { cause: error });
    } finally {
      pendingCandleFetches.delete(cacheKey);
    }
  }

  acquireAssetLease(asset: string): void {
    const leaseCount = this.assetLeaseCounts.get(asset) ?? 0;
    this.assetLeaseCounts.set(asset, leaseCount + 1);
    if (leaseCount > 0) return;

    this.desiredAssets.add(asset);
    this.enqueueAssetReconciliation(asset);
  }

  releaseAssetLease(asset: string): void {
    const leaseCount = this.assetLeaseCounts.get(asset) ?? 0;
    if (leaseCount === 0) return;
    if (leaseCount > 1) {
      this.assetLeaseCounts.set(asset, leaseCount - 1);
      return;
    }

    this.assetLeaseCounts.delete(asset);
    this.desiredAssets.delete(asset);
    this.enqueueAssetReconciliation(asset);
  }

  warmAsset(asset: string, durationMs: number = DEFAULT_WARM_LEASE_MS): void {
    if (this.warmLeaseTimeouts.has(asset)) return;
    this.acquireAssetLease(asset);

    const timeout = setTimeout(() => {
      this.warmLeaseTimeouts.delete(asset);
      this.releaseAssetLease(asset);
    }, Math.max(1, durationMs));
    timeout.unref?.();
    this.warmLeaseTimeouts.set(asset, timeout);
  }

  private restoreDesiredAssetSubscriptions(): void {
    for (const asset of this.desiredAssets) {
      this.enqueueAssetReconciliation(asset);
    }
  }

  private enqueueAssetReconciliation(asset: string): void {
    this.enqueueControlReconciliation({ type: 'l2Book', coin: asset });
    this.enqueueControlReconciliation({ type: 'trades', coin: asset });
  }

  private enqueueControlReconciliation(subscription: UpstreamSubscription): void {
    const key = this.getControlSubscriptionKey(subscription);
    if (this.queuedControlSubscriptions.has(key)) return;

    this.controlQueue.push(subscription);
    this.queuedControlSubscriptions.add(key);
    this.scheduleControlPump();
  }

  private scheduleControlPump(): void {
    if (this.controlTimer || this.controlQueue.length === 0) return;
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    const elapsed = this.lastControlMessageAt === 0
      ? UPSTREAM_CONTROL_MESSAGE_INTERVAL_MS
      : Date.now() - this.lastControlMessageAt;
    const delay = Math.max(0, UPSTREAM_CONTROL_MESSAGE_INTERVAL_MS - elapsed);

    this.controlTimer = setTimeout(() => {
      this.controlTimer = null;
      this.processNextControlMessage();
    }, delay);
    this.controlTimer.unref?.();
  }

  private processNextControlMessage(): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    while (this.controlQueue.length > 0) {
      const subscription = this.controlQueue.shift()!;
      const key = this.getControlSubscriptionKey(subscription);
      this.queuedControlSubscriptions.delete(key);

      const desired = this.isControlSubscriptionDesired(subscription);
      const active = this.activeControlSubscriptions.has(key);
      if (desired === active) continue;

      const method = desired ? 'subscribe' : 'unsubscribe';
      try {
        this.sendControlMessage(method, subscription);
        if (desired) {
          this.activeControlSubscriptions.add(key);
        } else {
          this.activeControlSubscriptions.delete(key);
        }
        logger.debug(`Sent Hyperliquid ${method} for ${key}`);
      } catch (error) {
        // A failed attempt still consumes this process's pacing budget. Queue
        // the target again only if the socket remains usable; a close rebuilds
        // all desired state on the next connection.
        logger.error(`Failed to send Hyperliquid ${method} for ${key}:`, error);
        if (this.ws?.readyState === WebSocket.OPEN) {
          this.controlQueue.push(subscription);
          this.queuedControlSubscriptions.add(key);
        }
      }

      this.lastControlMessageAt = Date.now();
      break;
    }

    this.scheduleControlPump();
  }

  private sendControlMessage(
    method: 'subscribe' | 'unsubscribe',
    subscription: UpstreamSubscription,
  ): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('Hyperliquid WebSocket is not open');
    }
    this.ws.send(JSON.stringify({ method, subscription }));
  }

  private isControlSubscriptionDesired(subscription: UpstreamSubscription): boolean {
    if (subscription.type === 'allMids') return this.shouldReconnect;
    return this.desiredAssets.has(subscription.coin);
  }

  private getControlSubscriptionKey(subscription: UpstreamSubscription): string {
    return subscription.type === 'allMids'
      ? 'allMids'
      : `${subscription.type}:${subscription.coin}`;
  }

  private resetControlSocketState(): void {
    if (this.controlTimer) {
      clearTimeout(this.controlTimer);
      this.controlTimer = null;
    }
    this.controlQueue = [];
    this.queuedControlSubscriptions.clear();
    this.activeControlSubscriptions.clear();
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

  private handleMessage(data: string) {
    try {
      const message = JSON.parse(data);

      if (message.channel === 'allMids') {
        this.handleAllMids(message.data);
      } else if (message.channel === 'l2Book') {
        this.handleOrderbook(message.data);
      } else if (message.channel === 'trades') {
        this.handleTrades(message.data);
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
        this.priceObservedAt.set(coin, Date.now());

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
      this.priceObservedAt.set(coin, Date.now());
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
        id: hash || randomUUID(),
        price: parseFloat(px),
        size: parseFloat(sz),
        side: side === 'B' ? 'buy' : 'sell',
        timestamp: time,
      };

      this.prices.set(coin, trade.price);
      this.priceObservedAt.set(coin, Date.now());

      this.wss.broadcast({
        type: 'trade',
        channel: `trades:${coin}`,
        data: trade,
      });
    }
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
      this.connect().catch((error) => {
        logger.error('Reconnect failed:', error);
      });
    }, delay);
  }
}
