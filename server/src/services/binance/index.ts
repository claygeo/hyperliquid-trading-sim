import WebSocket from 'ws';
import { logger } from '../../lib/logger.js';
import type { WebSocketServer } from '../../websocket/index.js';
import type { Candle } from '../../types/market.js';

// Map our symbols to Binance US format (lowercase + usdt)
const BINANCE_SYMBOLS: Record<string, string> = {
  BTC: 'btcusdt', ETH: 'ethusdt', SOL: 'solusdt', DOGE: 'dogeusdt',
  XRP: 'xrpusdt', ADA: 'adausdt', AVAX: 'avaxusdt', LINK: 'linkusdt',
  DOT: 'dotusdt', MATIC: 'maticusdt', UNI: 'uniusdt', ATOM: 'atomusdt',
  LTC: 'ltcusdt', ARB: 'arbusdt', OP: 'opusdt', SUI: 'suiusdt',
  APT: 'aptusdt', NEAR: 'nearusdt', INJ: 'injusdt', FTM: 'ftmusdt',
  AAVE: 'aaveusdt', MKR: 'mkrusdt', SNX: 'snxusdt', CRV: 'crvusdt',
  PEPE: 'pepeusdt', TIA: 'tiausdt', SEI: 'seiusdt', JUP: 'jupusdt',
  RENDER: 'renderusdt', FET: 'fetusdt', STX: 'stxusdt', IMX: 'imxusdt',
  WLD: 'wldusdt', RUNE: 'runeusdt', ENS: 'ensusdt', FIL: 'filusdt',
  GALA: 'galausdt', SAND: 'sandusdt', MANA: 'manausdt', AXS: 'axsusdt',
  DYDX: 'dydxusdt', GMX: 'gmxusdt', LDO: 'ldousdt', ENA: 'enausdt',
  BONK: 'bonkusdt', SHIB: 'shibusdt', BNB: 'bnbusdt', TRX: 'trxusdt',
  TON: 'tonusdt', XLM: 'xlmusdt', ALGO: 'algousdt', ICP: 'icpusdt',
  HBAR: 'hbarusdt', ETC: 'etcusdt', BCH: 'bchusdt', TAO: 'taousdt',
  AR: 'arusdt', GRT: 'grtusdt', PYTH: 'pythusdt',
};

// Map timeframes to Binance intervals
const BINANCE_INTERVALS: Record<string, string> = {
  '1m': '1m',
  '5m': '5m',
  '15m': '15m',
  '1h': '1h',
  '4h': '4h',
  '1d': '1d',
};

interface KlineMessage {
  e: string;      // Event type "kline"
  E: number;      // Event time
  s: string;      // Symbol
  k: {
    t: number;    // Kline start time
    T: number;    // Kline close time
    s: string;    // Symbol
    i: string;    // Interval
    o: string;    // Open price
    c: string;    // Close price
    h: string;    // High price
    l: string;    // Low price
    v: string;    // Base asset volume
    n: number;    // Number of trades
    x: boolean;   // Is this kline closed?
  };
}

interface CandleCache {
  candles: Candle[];
  timestamp: number;
}

export class BinanceKlineService {
  private connections: Map<string, WebSocket> = new Map();
  private wss: WebSocketServer;
  private candleCache: Map<string, CandleCache> = new Map();
  private subscribedStreams: Set<string> = new Set();
  private reconnectTimeouts: Map<string, NodeJS.Timeout> = new Map();

  constructor(wss: WebSocketServer) {
    this.wss = wss;
    logger.info('BinanceKlineService initialized');
  }

  // Get Binance symbol from our asset
  private getBinanceSymbol(asset: string): string | null {
    return BINANCE_SYMBOLS[asset] || null;
  }

  // Get our asset from Binance symbol
  private getAssetFromBinanceSymbol(binanceSymbol: string): string | null {
    for (const [asset, symbol] of Object.entries(BINANCE_SYMBOLS)) {
      if (symbol === binanceSymbol.toLowerCase()) {
        return asset;
      }
    }
    return null;
  }

  // Get stream name for asset and timeframe
  private getStreamName(asset: string, timeframe: string): string {
    const binanceSymbol = this.getBinanceSymbol(asset);
    const interval = BINANCE_INTERVALS[timeframe] || '1m';
    return `${binanceSymbol}@kline_${interval}`;
  }

  // Subscribe to kline stream for an asset
  subscribeToKlines(asset: string, timeframe: string = '1m'): void {
    const binanceSymbol = this.getBinanceSymbol(asset);
    if (!binanceSymbol) {
      logger.debug(`No Binance US mapping for ${asset}, skipping kline subscription`);
      return;
    }

    const streamName = this.getStreamName(asset, timeframe);
    if (this.subscribedStreams.has(streamName)) {
      return;
    }

    this.subscribedStreams.add(streamName);
    this.connectToStream(asset, timeframe, streamName);
  }

  // Connect to Binance US WebSocket stream
  private connectToStream(asset: string, timeframe: string, streamName: string): void {
    const wsUrl = `wss://stream.binance.us:9443/ws/${streamName}`;
    
    try {
      const ws = new WebSocket(wsUrl);

      ws.on('open', () => {
        logger.info(`Binance US kline stream connected: ${asset} ${timeframe}`);
        this.connections.set(streamName, ws);
      });

      ws.on('message', (data) => {
        try {
          const message: KlineMessage = JSON.parse(data.toString());
          this.handleKline(asset, timeframe, message);
        } catch (error) {
          // Ignore parse errors
        }
      });

      ws.on('close', () => {
        logger.warn(`Binance US kline stream closed: ${streamName}`);
        this.connections.delete(streamName);
        this.scheduleReconnect(asset, timeframe, streamName);
      });

      ws.on('error', (error) => {
        logger.error(`Binance US kline stream error: ${streamName}`, error);
      });

    } catch (error) {
      logger.error(`Failed to connect to Binance US stream: ${streamName}`, error);
      this.scheduleReconnect(asset, timeframe, streamName);
    }
  }

  // Handle incoming kline data
  private handleKline(asset: string, timeframe: string, message: KlineMessage): void {
    if (message.e !== 'kline') return;

    const k = message.k;
    const candle: Candle = {
      time: k.t,
      open: parseFloat(k.o),
      high: parseFloat(k.h),
      low: parseFloat(k.l),
      close: parseFloat(k.c),
      volume: parseFloat(k.v),
    };

    // Update local candle cache
    const cacheKey = `${asset}-${timeframe}`;
    this.updateCandleCache(cacheKey, candle);

    // Broadcast candle update to all clients subscribed to this asset
    this.wss.broadcast({
      type: 'candle',
      channel: `candles:${asset}`,
      data: candle,
    });
  }

  // Update the local candle cache
  private updateCandleCache(cacheKey: string, candle: Candle): void {
    let cached = this.candleCache.get(cacheKey);
    
    if (!cached) {
      cached = { candles: [], timestamp: Date.now() };
      this.candleCache.set(cacheKey, cached);
    }

    const candles = cached.candles;
    const lastCandle = candles[candles.length - 1];

    if (lastCandle && lastCandle.time === candle.time) {
      // Update existing candle (same time period)
      candles[candles.length - 1] = candle;
    } else if (!lastCandle || candle.time > lastCandle.time) {
      // New candle period
      candles.push(candle);
      // Keep max 500 candles in cache
      if (candles.length > 500) {
        candles.shift();
      }
    }

    cached.timestamp = Date.now();
  }

  // Get cached candles for an asset/timeframe
  getCachedCandles(asset: string, timeframe: string): Candle[] | null {
    const cacheKey = `${asset}-${timeframe}`;
    const cached = this.candleCache.get(cacheKey);
    return cached?.candles || null;
  }

  // Merge REST candles with live updates
  mergeWithLiveCandles(restCandles: Candle[], asset: string, timeframe: string): Candle[] {
    const liveCandles = this.getCachedCandles(asset, timeframe);
    if (!liveCandles || liveCandles.length === 0) {
      return restCandles;
    }

    // Find the last REST candle time
    const lastRestTime = restCandles[restCandles.length - 1]?.time || 0;
    
    // Get live candles that are newer than or equal to last REST candle
    const newerLiveCandles = liveCandles.filter(c => c.time >= lastRestTime);
    
    if (newerLiveCandles.length === 0) {
      return restCandles;
    }

    // Replace/update the last REST candle with live data
    const merged = [...restCandles];
    for (const liveCandle of newerLiveCandles) {
      const existingIndex = merged.findIndex(c => c.time === liveCandle.time);
      if (existingIndex >= 0) {
        merged[existingIndex] = liveCandle;
      } else {
        merged.push(liveCandle);
      }
    }

    // Sort by time and limit
    merged.sort((a, b) => a.time - b.time);
    return merged.slice(-500);
  }

  // Schedule reconnection with backoff
  private scheduleReconnect(asset: string, timeframe: string, streamName: string): void {
    const existingTimeout = this.reconnectTimeouts.get(streamName);
    if (existingTimeout) {
      clearTimeout(existingTimeout);
    }

    // Reconnect after 5 seconds
    const timeout = setTimeout(() => {
      if (this.subscribedStreams.has(streamName)) {
        logger.info(`Reconnecting to Binance US stream: ${streamName}`);
        this.connectToStream(asset, timeframe, streamName);
      }
    }, 5000);

    this.reconnectTimeouts.set(streamName, timeout);
  }

  // Unsubscribe from a stream
  unsubscribeFromKlines(asset: string, timeframe: string = '1m'): void {
    const streamName = this.getStreamName(asset, timeframe);
    this.subscribedStreams.delete(streamName);

    const ws = this.connections.get(streamName);
    if (ws) {
      ws.close();
      this.connections.delete(streamName);
    }

    const timeout = this.reconnectTimeouts.get(streamName);
    if (timeout) {
      clearTimeout(timeout);
      this.reconnectTimeouts.delete(streamName);
    }
  }

  // Check if asset is supported by Binance US
  isSupported(asset: string): boolean {
    return !!BINANCE_SYMBOLS[asset];
  }

  // Get connection count
  getConnectionCount(): number {
    return this.connections.size;
  }

  // Close all connections
  disconnect(): void {
    for (const [, ws] of this.connections) {
      ws.close();
    }
    this.connections.clear();
    this.subscribedStreams.clear();

    for (const timeout of this.reconnectTimeouts.values()) {
      clearTimeout(timeout);
    }
    this.reconnectTimeouts.clear();

    logger.info('BinanceKlineService disconnected');
  }
}
