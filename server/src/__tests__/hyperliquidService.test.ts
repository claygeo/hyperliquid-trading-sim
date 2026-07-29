import WebSocket from 'ws';
import {
  HyperliquidService,
  UPSTREAM_CONTROL_MESSAGE_INTERVAL_MS,
} from '../services/hyperliquid/index';
import type { WebSocketServer as AppWebSocketServer } from '../websocket/index';

jest.mock('../lib/logger', () => ({
  logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() },
}));

interface TestableHyperliquidService {
  ws: { readyState: number; send: jest.Mock; close?: jest.Mock };
  desiredAssets: Set<string>;
  assetLeaseCounts: Map<string, number>;
  activeControlSubscriptions: Set<string>;
  queuedControlSubscriptions: Set<string>;
  controlQueue: unknown[];
  controlTimer: NodeJS.Timeout | null;
  subscribeToAllMids(): void;
  restoreDesiredAssetSubscriptions(): void;
  resetControlSocketState(): void;
  handleMessage(data: string): void;
}

describe('HyperliquidService live feeds', () => {
  const broadcast = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('upstream control pacing', () => {
    beforeEach(() => {
      jest.useFakeTimers();
      jest.setSystemTime(new Date('2026-07-29T12:00:00.000Z'));
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    function sentMessages(send: jest.Mock): Array<Record<string, any>> {
      return send.mock.calls.map(([message]) => JSON.parse(message));
    }

    it('keeps a shared asset feed until the final lease releases it', () => {
      const service = new HyperliquidService({ broadcast } as unknown as AppWebSocketServer);
      const send = jest.fn();
      const testable = service as unknown as TestableHyperliquidService;
      testable.ws = { readyState: WebSocket.OPEN, send };

      service.acquireAssetLease('BTC');
      service.acquireAssetLease('BTC');
      jest.advanceTimersByTime(0);
      expect(send).toHaveBeenCalledTimes(1);
      jest.advanceTimersByTime(UPSTREAM_CONTROL_MESSAGE_INTERVAL_MS);
      expect(send).toHaveBeenCalledTimes(2);

      service.releaseAssetLease('BTC');
      jest.runOnlyPendingTimers();
      expect(send).toHaveBeenCalledTimes(2);

      service.releaseAssetLease('BTC');
      jest.runAllTimers();
      expect(sentMessages(send)).toEqual([
        { method: 'subscribe', subscription: { type: 'l2Book', coin: 'BTC' } },
        { method: 'subscribe', subscription: { type: 'trades', coin: 'BTC' } },
        { method: 'unsubscribe', subscription: { type: 'l2Book', coin: 'BTC' } },
        { method: 'unsubscribe', subscription: { type: 'trades', coin: 'BTC' } },
      ]);
      expect(testable.activeControlSubscriptions).toEqual(new Set());
    });

    it('paces every upstream control message, including allMids, one message at a time', () => {
      const service = new HyperliquidService({ broadcast } as unknown as AppWebSocketServer);
      const sentAt: number[] = [];
      const send = jest.fn(() => sentAt.push(Date.now()));
      const testable = service as unknown as TestableHyperliquidService;
      testable.ws = { readyState: WebSocket.OPEN, send };

      testable.subscribeToAllMids();
      service.acquireAssetLease('BTC');
      service.acquireAssetLease('ETH');
      jest.runAllTimers();
      service.releaseAssetLease('BTC');
      service.releaseAssetLease('ETH');
      jest.runAllTimers();

      expect(sentMessages(send)).toEqual([
        { method: 'subscribe', subscription: { type: 'allMids' } },
        { method: 'subscribe', subscription: { type: 'l2Book', coin: 'BTC' } },
        { method: 'subscribe', subscription: { type: 'trades', coin: 'BTC' } },
        { method: 'subscribe', subscription: { type: 'l2Book', coin: 'ETH' } },
        { method: 'subscribe', subscription: { type: 'trades', coin: 'ETH' } },
        { method: 'unsubscribe', subscription: { type: 'l2Book', coin: 'BTC' } },
        { method: 'unsubscribe', subscription: { type: 'trades', coin: 'BTC' } },
        { method: 'unsubscribe', subscription: { type: 'l2Book', coin: 'ETH' } },
        { method: 'unsubscribe', subscription: { type: 'trades', coin: 'ETH' } },
      ]);
      expect(sentAt.slice(1).every(
        (timestamp, index) => timestamp - sentAt[index] >= UPSTREAM_CONTROL_MESSAGE_INTERVAL_MS
      )).toBe(true);
    });

    it('coalesces rapid acquire/release churn before it can reach upstream', () => {
      const service = new HyperliquidService({ broadcast } as unknown as AppWebSocketServer);
      const send = jest.fn();
      const testable = service as unknown as TestableHyperliquidService;
      testable.ws = { readyState: WebSocket.OPEN, send };

      for (let index = 0; index < 10; index += 1) {
        service.acquireAssetLease('BTC');
        service.releaseAssetLease('BTC');
      }
      jest.runAllTimers();

      expect(send).not.toHaveBeenCalled();
      expect(testable.assetLeaseCounts.has('BTC')).toBe(false);
      expect(testable.desiredAssets.has('BTC')).toBe(false);
      expect(testable.activeControlSubscriptions).toEqual(new Set());
      expect(testable.controlQueue).toEqual([]);
    });

    it('cancels unsent feeds and rolls back a partially active asset after release', () => {
      const service = new HyperliquidService({ broadcast } as unknown as AppWebSocketServer);
      const send = jest.fn();
      const testable = service as unknown as TestableHyperliquidService;
      testable.ws = { readyState: WebSocket.OPEN, send };

      service.acquireAssetLease('BTC');
      jest.advanceTimersByTime(0);
      expect(sentMessages(send)).toEqual([
        { method: 'subscribe', subscription: { type: 'l2Book', coin: 'BTC' } },
      ]);

      service.releaseAssetLease('BTC');
      jest.runAllTimers();

      expect(sentMessages(send)).toEqual([
        { method: 'subscribe', subscription: { type: 'l2Book', coin: 'BTC' } },
        { method: 'unsubscribe', subscription: { type: 'l2Book', coin: 'BTC' } },
      ]);
      expect(testable.activeControlSubscriptions).toEqual(new Set());
      expect(testable.queuedControlSubscriptions).toEqual(new Set());
      expect(testable.controlQueue).toEqual([]);
    });

    it('retries a failed control send without breaking the pacing boundary', () => {
      const service = new HyperliquidService({ broadcast } as unknown as AppWebSocketServer);
      const attemptedAt: number[] = [];
      const send = jest.fn(() => {
        attemptedAt.push(Date.now());
        if (attemptedAt.length === 1) throw new Error('temporary send failure');
      });
      const testable = service as unknown as TestableHyperliquidService;
      testable.ws = { readyState: WebSocket.OPEN, send };

      service.acquireAssetLease('BTC');
      jest.runAllTimers();

      expect(send).toHaveBeenCalledTimes(3);
      expect(attemptedAt.slice(1).every(
        (timestamp, index) => timestamp - attemptedAt[index] >= UPSTREAM_CONTROL_MESSAGE_INTERVAL_MS
      )).toBe(true);
      expect(testable.activeControlSubscriptions).toEqual(
        new Set(['l2Book:BTC', 'trades:BTC'])
      );
      expect(testable.controlQueue).toEqual([]);
    });

    it('cancels a queued unsubscribe when the asset is reacquired', () => {
      const service = new HyperliquidService({ broadcast } as unknown as AppWebSocketServer);
      const send = jest.fn();
      const testable = service as unknown as TestableHyperliquidService;
      testable.ws = { readyState: WebSocket.OPEN, send };

      service.acquireAssetLease('BTC');
      jest.runAllTimers();
      service.releaseAssetLease('BTC');
      service.acquireAssetLease('BTC');
      jest.runAllTimers();

      expect(sentMessages(send)).toEqual([
        { method: 'subscribe', subscription: { type: 'l2Book', coin: 'BTC' } },
        { method: 'subscribe', subscription: { type: 'trades', coin: 'BTC' } },
      ]);
      expect(testable.activeControlSubscriptions).toEqual(
        new Set(['l2Book:BTC', 'trades:BTC'])
      );
    });

    it('restores only live leases after an upstream reconnect', () => {
      const service = new HyperliquidService({ broadcast } as unknown as AppWebSocketServer);
      const firstSend = jest.fn();
      const testable = service as unknown as TestableHyperliquidService;
      testable.ws = { readyState: WebSocket.OPEN, send: firstSend };

      service.acquireAssetLease('BTC');
      service.acquireAssetLease('ETH');
      jest.runAllTimers();
      service.releaseAssetLease('ETH');
      jest.runAllTimers();

      testable.resetControlSocketState();
      const reconnectedSend = jest.fn();
      testable.ws = { readyState: WebSocket.OPEN, send: reconnectedSend };
      testable.subscribeToAllMids();
      testable.restoreDesiredAssetSubscriptions();
      jest.runAllTimers();

      expect(sentMessages(reconnectedSend)).toEqual([
        { method: 'subscribe', subscription: { type: 'allMids' } },
        { method: 'subscribe', subscription: { type: 'l2Book', coin: 'BTC' } },
        { method: 'subscribe', subscription: { type: 'trades', coin: 'BTC' } },
      ]);
      expect(testable.activeControlSubscriptions).toEqual(
        new Set(['allMids', 'l2Book:BTC', 'trades:BTC'])
      );
    });

    it('bounds an HTTP warm-up lease and coalesces repeated warming', () => {
      const service = new HyperliquidService({ broadcast } as unknown as AppWebSocketServer);
      const send = jest.fn();
      const testable = service as unknown as TestableHyperliquidService;
      testable.ws = { readyState: WebSocket.OPEN, send };

      service.warmAsset('BTC', 1000);
      service.warmAsset('BTC', 1000);
      jest.advanceTimersByTime(UPSTREAM_CONTROL_MESSAGE_INTERVAL_MS);
      expect(send).toHaveBeenCalledTimes(2);

      jest.advanceTimersByTime(1000 - UPSTREAM_CONTROL_MESSAGE_INTERVAL_MS - 1);
      expect(send).toHaveBeenCalledTimes(2);
      jest.advanceTimersByTime(1);
      jest.runOnlyPendingTimers();
      expect(send).toHaveBeenCalledTimes(3);
      jest.advanceTimersByTime(UPSTREAM_CONTROL_MESSAGE_INTERVAL_MS);
      expect(sentMessages(send).slice(2)).toEqual([
        { method: 'unsubscribe', subscription: { type: 'l2Book', coin: 'BTC' } },
        { method: 'unsubscribe', subscription: { type: 'trades', coin: 'BTC' } },
      ]);
    });

    it('clears queued controls and warm timers when the upstream socket disconnects', () => {
      const service = new HyperliquidService({ broadcast } as unknown as AppWebSocketServer);
      const send = jest.fn();
      const close = jest.fn();
      const testable = service as unknown as TestableHyperliquidService;
      testable.ws = { readyState: WebSocket.OPEN, send, close };

      service.warmAsset('BTC', 1000);
      service.disconnect();
      jest.runAllTimers();

      expect(send).not.toHaveBeenCalled();
      expect(close).toHaveBeenCalledTimes(1);
      expect(testable.controlTimer).toBeNull();
      expect(testable.controlQueue).toEqual([]);
      expect(testable.queuedControlSubscriptions).toEqual(new Set());
      expect(testable.activeControlSubscriptions).toEqual(new Set());
      expect(testable.assetLeaseCounts).toEqual(new Map());
      expect(testable.desiredAssets).toEqual(new Set());
    });
  });

  it('maps upstream public trades onto the documented client channel', () => {
    const service = new HyperliquidService({ broadcast } as unknown as AppWebSocketServer);
    const testable = service as unknown as TestableHyperliquidService;

    testable.handleMessage(JSON.stringify({
      channel: 'trades',
      data: [{
        coin: 'BTC', side: 'B', px: '50000', sz: '0.25',
        time: 1234, hash: 'trade-hash',
      }],
    }));

    expect(broadcast).toHaveBeenCalledWith({
      type: 'trade',
      channel: 'trades:BTC',
      data: {
        id: 'trade-hash',
        price: 50000,
        size: 0.25,
        side: 'buy',
        timestamp: 1234,
      },
    });
  });

  it('serves candle snapshots without creating upstream WebSocket subscriptions', async () => {
    const service = new HyperliquidService({ broadcast } as unknown as AppWebSocketServer);
    const send = jest.fn();
    const testable = service as unknown as TestableHyperliquidService;
    testable.ws = { readyState: WebSocket.OPEN, send };
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        Response: 'Success',
        Data: {
          Data: [
            { time: 1000, open: 100, high: 110, low: 95, close: 105, volumefrom: 12 },
            { time: 2000, open: 105, high: 115, low: 100, close: 110, volumefrom: 14 },
          ],
        },
      }),
    } as Response);

    try {
      const [first, concurrent] = await Promise.all([
        service.getCandles('BTC', '1h', 2),
        service.getCandles('BTC', '1h', 2),
      ]);
      const cached = await service.getCandles('BTC', '1h', 1);

      expect(first).toHaveLength(2);
      expect(concurrent).toEqual(first);
      expect(cached).toEqual([first[1]]);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(send).not.toHaveBeenCalled();
    } finally {
      fetchMock.mockRestore();
    }
  });
});
