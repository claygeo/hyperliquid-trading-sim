import { v4 as uuidv4 } from 'uuid';
import { STRESS_TEST_CONFIG } from '../../config/constants.js';
import { SUPPORTED_ASSETS } from '../../config/assets.js';
import type { WebSocketServer } from '../../websocket/index.js';
import type { Trade } from '../../types/market.js';
import type { StressTestSpeed, TPSStats } from '../../types/websocket.js';
import { logger } from '../../lib/logger.js';

export class StressTestService {
  private wss: WebSocketServer;
  private speed: StressTestSpeed = 'off';
  private generatorInterval: NodeJS.Timeout | null = null;
  private statsInterval: NodeJS.Timeout | null = null;
  private messageCount = 0;
  private startTime = 0;
  private tpsHistory: number[] = [];
  private lastBroadcastLatency = 0;
  private basePrices: Map<string, number> = new Map([
    ['BTC', 87500],
    ['ETH', 2900],
    ['SOL', 120],
  ]);

  constructor(wss: WebSocketServer) {
    this.wss = wss;
  }

  setSpeed(speed: StressTestSpeed): void {
    this.speed = speed;
    this.stop();

    if (speed !== 'off') {
      this.start();
    }

    // Broadcast speed change
    this.wss.broadcast({
      type: 'stress_test',
      data: { speed, enabled: speed !== 'off' },
    });

    logger.info(`Stress test speed set to: ${speed}`);
  }

  getSpeed(): StressTestSpeed {
    return this.speed;
  }

  private start(): void {
    const tps = this.getTPS();
    if (tps === 0) return;

    const intervalMs = Math.max(1, Math.floor(1000 / tps));

    this.messageCount = 0;
    this.startTime = Date.now();
    this.tpsHistory = [];

    logger.info(`Starting stress test at ${tps} TPS (interval: ${intervalMs}ms)`);

    // Generator interval - produces trades
    this.generatorInterval = setInterval(() => {
      this.generateAndBroadcast();
    }, intervalMs);

    // Stats interval - broadcasts TPS stats every second
    this.statsInterval = setInterval(() => {
      this.broadcastTPSStats();
    }, 1000);

    // Broadcast initial stats
    this.broadcastTPSStats();
  }

  private stop(): void {
    if (this.generatorInterval) {
      clearInterval(this.generatorInterval);
      this.generatorInterval = null;
    }
    if (this.statsInterval) {
      clearInterval(this.statsInterval);
      this.statsInterval = null;
    }

    // Reset stats
    this.messageCount = 0;
    this.tpsHistory = [];

    // Broadcast zeroed stats
    this.wss.broadcast({
      type: 'tps',
      data: {
        current: 0,
        average: 0,
        peak: 0,
        messageCount: 0,
        latency: 0,
      },
    });

    logger.info('Stress test stopped');
  }

  private getTPS(): number {
    switch (this.speed) {
      case 'slow':
        return STRESS_TEST_CONFIG.SLOW_TPS;
      case 'medium':
        return STRESS_TEST_CONFIG.MEDIUM_TPS;
      case 'fast':
        return STRESS_TEST_CONFIG.FAST_TPS;
      default:
        return 0;
    }
  }

  private generateAndBroadcast(): void {
    const asset = this.randomAsset();
    const basePrice = this.basePrices.get(asset) || 100;

    // Simulate price movement
    const priceChange = (Math.random() - 0.5) * basePrice * 0.001;
    const newPrice = basePrice + priceChange;
    this.basePrices.set(asset, newPrice);

    // Generate synthetic trade
    const trade: Trade = {
      id: uuidv4(),
      price: newPrice,
      size: Math.random() * 10,
      side: Math.random() > 0.5 ? 'buy' : 'sell',
      timestamp: Date.now(),
      isSimulated: true,
    };

    // Measure actual broadcast latency
    const broadcastStart = performance.now();
    this.wss.broadcast({
      type: 'trade',
      channel: `trades:${asset}`,
      data: trade,
    });
    this.lastBroadcastLatency = performance.now() - broadcastStart;

    // Also update orderbook occasionally
    if (Math.random() > 0.7) {
      this.broadcastOrderbookUpdate(asset, newPrice);
    }

    this.messageCount++;
  }

  private broadcastOrderbookUpdate(asset: string, midPrice: number): void {
    const spread = midPrice * 0.0001; // 0.01% spread
    const bids: [number, number][] = [];
    const asks: [number, number][] = [];

    for (let i = 0; i < 10; i++) {
      bids.push([
        midPrice - spread * (i + 1),
        Math.random() * 100,
      ]);
      asks.push([
        midPrice + spread * (i + 1),
        Math.random() * 100,
      ]);
    }

    this.wss.broadcast({
      type: 'orderbook',
      channel: `orderbook:${asset}`,
      data: {
        bids,
        asks,
        timestamp: Date.now(),
      },
    });
  }

  private broadcastTPSStats(): void {
    const elapsed = (Date.now() - this.startTime) / 1000;
    const currentTPS = elapsed > 0 ? this.messageCount / elapsed : 0;

    this.tpsHistory.push(currentTPS);
    if (this.tpsHistory.length > 60) {
      this.tpsHistory.shift();
    }

    const stats: TPSStats = {
      current: Math.round(currentTPS),
      average: Math.round(
        this.tpsHistory.reduce((a, b) => a + b, 0) / this.tpsHistory.length
      ),
      peak: Math.round(Math.max(...this.tpsHistory)),
      messageCount: this.messageCount,
      latency: this.lastBroadcastLatency,
    };

    this.wss.broadcast({
      type: 'tps',
      data: stats,
    });
  }

  private randomAsset(): string {
    return SUPPORTED_ASSETS[Math.floor(Math.random() * SUPPORTED_ASSETS.length)];
  }
}
