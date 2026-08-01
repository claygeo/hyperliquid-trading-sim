import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { wsClient } from '../lib/websocket';
import { useMarketDataStore } from './useMarketData';

class FakeWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSED = 3;
  static instances: FakeWebSocket[] = [];

  readyState = FakeWebSocket.CONNECTING;
  sent: string[] = [];
  onopen: ((event: Event) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;

  constructor() {
    FakeWebSocket.instances.push(this);
  }

  open(): void {
    this.readyState = FakeWebSocket.OPEN;
    this.onopen?.(new Event('open'));
  }

  close(code = 1000, reason = ''): void {
    if (this.readyState === FakeWebSocket.CLOSED) return;
    this.readyState = FakeWebSocket.CLOSED;
    this.onclose?.({ code, reason } as CloseEvent);
  }

  send(data: string): void {
    this.sent.push(data);
  }

  message(data: unknown): void {
    this.onmessage?.({ data: JSON.stringify(data) } as MessageEvent);
  }
}

describe('market-data WebSocket subscriptions', () => {
  beforeEach(() => {
    FakeWebSocket.instances = [];
    vi.stubGlobal('WebSocket', FakeWebSocket);
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    useMarketDataStore.setState({
      selectedAsset: 'BTC',
      currentSubscribedAsset: null,
      currentPrice: 0,
      orderbook: null,
      trades: [],
    });
  });

  afterEach(() => {
    const subscribedAsset = useMarketDataStore.getState().currentSubscribedAsset;
    if (subscribedAsset) useMarketDataStore.getState().unsubscribeFromAsset(subscribedAsset);
    wsClient.disconnect();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('consumes the price channel and reacquires all channels for the same asset after disconnect', async () => {
    const initialConnection = wsClient.connect();
    FakeWebSocket.instances[0].open();
    await initialConnection;

    useMarketDataStore.getState().subscribeToAsset('BTC');
    expect(FakeWebSocket.instances[0].sent.map((message) => JSON.parse(message))).toEqual(expect.arrayContaining([
      { type: 'subscribe', channel: 'price:BTC' },
      { type: 'subscribe', channel: 'orderbook:BTC' },
      { type: 'subscribe', channel: 'trades:BTC' },
    ]));

    FakeWebSocket.instances[0].message({
      type: 'price',
      channel: 'price:BTC',
      data: { asset: 'BTC', price: 50_123.45 },
    });
    expect(useMarketDataStore.getState().currentPrice).toBe(50_123.45);

    wsClient.disconnect();
    expect(useMarketDataStore.getState().currentSubscribedAsset).toBe('BTC');
    expect(wsClient.hasSubscription('price:BTC')).toBe(false);

    useMarketDataStore.getState().subscribeToAsset('BTC');
    expect(wsClient.hasSubscription('price:BTC')).toBe(true);
    expect(wsClient.hasSubscription('orderbook:BTC')).toBe(true);
    expect(wsClient.hasSubscription('trades:BTC')).toBe(true);

    const reconnected = wsClient.connect();
    FakeWebSocket.instances[1].open();
    await reconnected;
    expect(FakeWebSocket.instances[1].sent.map((message) => JSON.parse(message))).toEqual(expect.arrayContaining([
      { type: 'subscribe', channel: 'price:BTC' },
      { type: 'subscribe', channel: 'orderbook:BTC' },
      { type: 'subscribe', channel: 'trades:BTC' },
    ]));
  });
});
