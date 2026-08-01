import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { UI_CONSTANTS } from '../config/constants';
import { WebSocketClient } from './websocket';

class FakeWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  static instances: FakeWebSocket[] = [];

  readyState = FakeWebSocket.CONNECTING;
  sent: string[] = [];
  onopen: ((event: Event) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;

  constructor(readonly url: string) {
    FakeWebSocket.instances.push(this);
  }

  open(): void {
    this.readyState = FakeWebSocket.OPEN;
    this.onopen?.(new Event('open'));
  }

  fail(): void {
    this.onerror?.(new Event('error'));
  }

  close(code = 1000, reason = ''): void {
    if (this.readyState === FakeWebSocket.CLOSED) return;
    this.readyState = FakeWebSocket.CLOSED;
    this.onclose?.({ code, reason } as CloseEvent);
  }

  send(data: string): void {
    this.sent.push(data);
  }
}

describe('WebSocketClient connection lifecycle', () => {
  beforeEach(() => {
    FakeWebSocket.instances = [];
    vi.stubGlobal('WebSocket', FakeWebSocket);
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('rejects every concurrent caller when the shared connection attempt fails', async () => {
    const client = new WebSocketClient('ws://example.test/ws');

    const first = client.connect();
    const second = client.connect();

    expect(second).toBe(first);
    expect(FakeWebSocket.instances).toHaveLength(1);

    FakeWebSocket.instances[0].fail();
    const results = await Promise.allSettled([first, second]);

    expect(results.map((result) => result.status)).toEqual(['rejected', 'rejected']);
    client.disconnect();
  });

  it('reconnects after an unexpected close and restores retained subscriptions', async () => {
    vi.useFakeTimers();
    const client = new WebSocketClient('ws://example.test/ws');
    client.subscribe('price:BTC');

    const initialConnection = client.connect();
    FakeWebSocket.instances[0].open();
    await initialConnection;
    expect(FakeWebSocket.instances[0].sent.map((message) => JSON.parse(message))).toContainEqual({
      type: 'subscribe',
      channel: 'price:BTC',
    });

    FakeWebSocket.instances[0].close(1006, 'network lost');
    await vi.advanceTimersByTimeAsync(UI_CONSTANTS.WS_RECONNECT_DELAY);
    expect(FakeWebSocket.instances).toHaveLength(2);

    FakeWebSocket.instances[1].open();
    expect(FakeWebSocket.instances[1].sent.map((message) => JSON.parse(message))).toContainEqual({
      type: 'subscribe',
      channel: 'price:BTC',
    });

    client.disconnect();
  });
});
