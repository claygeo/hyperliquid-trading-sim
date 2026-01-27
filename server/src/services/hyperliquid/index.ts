import WebSocket from 'ws';
import { config } from '../../config/index.js';
import { SUPPORTED_ASSETS, getAssetConfig } from '../../config/assets.js';
import { logger } from '../../lib/logger.js';
import type { WebSocketServer } from '../../websocket/index.js';
import type { Candle, Orderbook, OrderbookLevel, Trade } from '../../types/market.js';
import type { HLCandle, HLOrderbook, HLTrade, HLAllMids } from '../../types/hyperliquid.js';
import { v4 as uuidv4 } from 'uuid';

export class HyperliquidService {
  private ws: WebSocket | null = null;
  private wss: WebSocketServer;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 10;
  private reconnectTimeout: NodeJS.Timeout | null = null;
  private prices: Map<string, number> = new Map();
  private candles: Map<string, Candle[]> = new Map();
  private orderbooks: Map<string, Orderbook> = new Map();

  constructor(wss: WebSocketServer) {
    this.wss = wss;
  }

  async connect(): Promise<void> {
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

  getPrice(asset: string): number {
    return this.prices.get(asset) || 0;
  }

  getOrderbook(asset: string): Orderbook | undefined {
    return this.orderbooks.get(asset);
  }

  getCandles(asset: string, timeframe: string): Candle[] {
    return this.candles.get(`${asset}-${timeframe}`) || [];
  }

  private subscribeToMarkets() {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    // Subscribe to all mids (prices)
    this.ws.send(JSON.stringify({
      method: 'subscribe',
      subscription: { type: 'allMids' },
    }));

    // Subscribe to orderbook and trades for each asset
    for (const asset of SUPPORTED_ASSETS) {
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

      // Candles (1m default)
      this.ws.send(JSON.stringify({
        method: 'subscribe',
        subscription: { type: 'candle', coin: asset, interval: '1m' },
      }));
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
      } else if (message.channel === 'candle') {
        this.handleCandle(message.data);
      }
    } catch (error) {
      logger.error('Failed to parse Hyperliquid message:', error);
    }
  }

  private handleAllMids(data: HLAllMids) {
    for (const [coin, price] of Object.entries(data.mids || data)) {
      if (SUPPORTED_ASSETS.includes(coin)) {
        const priceNum = parseFloat(price);
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
    if (!SUPPORTED_ASSETS.includes(coin)) return;

    const [hlBids, hlAsks] = levels;
    const config = getAssetConfig(coin);
    
    let bidTotal = 0;
    const bids: OrderbookLevel[] = hlBids.slice(0, 10).map((level) => {
      const size = parseFloat(level.sz);
      bidTotal += size;
      return {
        price: parseFloat(level.px),
        size,
        total: bidTotal,
      };
    });

    let askTotal = 0;
    const asks: OrderbookLevel[] = hlAsks.slice(0, 10).map((level) => {
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
    this.prices.set(coin, midPrice);

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
      if (!SUPPORTED_ASSETS.includes(coin)) continue;

      const trade: Trade = {
        id: hash || uuidv4(),
        price: parseFloat(px),
        size: parseFloat(sz),
        side: side === 'B' ? 'buy' : 'sell',
        timestamp: time,
      };

      // Broadcast trade
      this.wss.broadcast({
        type: 'trade',
        channel: `trades:${coin}`,
        data: trade,
      });
    }
  }

  private handleCandle(data: HLCandle) {
    const { s: coin, t: time, o, h, l, c, v } = data;
    if (!SUPPORTED_ASSETS.includes(coin)) return;

    const candle: Candle = {
      time: time,
      open: parseFloat(o),
      high: parseFloat(h),
      low: parseFloat(l),
      close: parseFloat(c),
      volume: parseFloat(v),
    };

    const key = `${coin}-1m`;
    const existing = this.candles.get(key) || [];
    
    // Update or add candle
    const lastCandle = existing[existing.length - 1];
    if (lastCandle && lastCandle.time === candle.time) {
      existing[existing.length - 1] = candle;
    } else {
      existing.push(candle);
      if (existing.length > 500) {
        existing.shift();
      }
    }
    
    this.candles.set(key, existing);

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
      this.connect().catch((error) => {
        logger.error('Reconnect failed:', error);
      });
    }, delay);
  }
}
