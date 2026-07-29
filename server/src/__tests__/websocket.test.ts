import { createServer, type Server } from 'http';
import type { AddressInfo } from 'net';
import { WebSocket } from 'ws';
import { WS_CONSTANTS } from '../config/constants';
import { WebSocketServer as ApplicationWebSocketServer } from '../websocket';
import { HyperliquidService } from '../services/hyperliquid';

jest.mock('../lib/logger', () => ({
  logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() },
}));

const wait = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function waitUntil(predicate: () => boolean, timeoutMs = 1000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error('Timed out waiting for condition');
    await wait(10);
  }
}

describe('application WebSocket server', () => {
  let httpServer: Server;
  let applicationServer: ApplicationWebSocketServer;
  let port: number;
  const clients = new Set<WebSocket>();

  beforeEach(async () => {
    httpServer = createServer();
    applicationServer = new ApplicationWebSocketServer(httpServer);
    await new Promise<void>((resolve) => httpServer.listen(0, '127.0.0.1', resolve));
    port = (httpServer.address() as AddressInfo).port;
  });

  afterEach(async () => {
    for (const client of clients) {
      client.terminate();
    }
    clients.clear();
    applicationServer.close();
    if (httpServer.listening) {
      await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    }
  });

  async function connectClient(): Promise<WebSocket> {
    const client = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    clients.add(client);

    await new Promise<void>((resolve, reject) => {
      const onMessage = (raw: WebSocket.RawData) => {
        const message = JSON.parse(raw.toString());
        if (message.type === 'connected') {
          client.off('message', onMessage);
          resolve();
        }
      };
      client.on('message', onMessage);
      client.once('error', reject);
    });

    return client;
  }

  function nextMessage(client: WebSocket): Promise<Record<string, any>> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Timed out waiting for WebSocket message')), 1000);
      client.once('message', (raw) => {
        clearTimeout(timeout);
        resolve(JSON.parse(raw.toString()));
      });
    });
  }

  it('broadcasts only to a client with a valid matching subscription', async () => {
    const subscribed = await connectClient();
    const other = await connectClient();
    const leaseAcquired = jest.fn();
    applicationServer.setAssetLeaseHandlers(leaseAcquired, jest.fn());
    let otherReceivedBroadcast = false;
    other.on('message', () => { otherReceivedBroadcast = true; });

    subscribed.send(JSON.stringify({ type: 'subscribe', channel: 'price:BTC' }));
    await waitUntil(() => [...(applicationServer as any).clients.values()].some(
      (client: any) => client.connection.subscriptions.has('price:BTC')
    ));
    expect(leaseAcquired).not.toHaveBeenCalled();

    const received = nextMessage(subscribed);
    applicationServer.broadcast({ type: 'price', channel: 'price:BTC', data: { price: 42000 } });

    await expect(received).resolves.toMatchObject({
      type: 'price',
      channel: 'price:BTC',
      data: { price: 42000 },
    });
    await wait(20);
    expect(otherReceivedBroadcast).toBe(false);
  });

  it('activates the upstream asset feeds from a validated client subscription', async () => {
    const upstreamSend = jest.fn();
    const hyperliquid = new HyperliquidService(applicationServer);
    (hyperliquid as any).ws = { readyState: WebSocket.OPEN, send: upstreamSend };
    applicationServer.setAssetLeaseHandlers(
      (asset) => hyperliquid.acquireAssetLease(asset),
      (asset) => hyperliquid.releaseAssetLease(asset),
    );
    const client = await connectClient();

    client.send(JSON.stringify({ type: 'subscribe', channel: 'orderbook:BTC' }));

    await waitUntil(() => upstreamSend.mock.calls.length === 2);
    expect(upstreamSend).toHaveBeenCalledTimes(2);
    expect(upstreamSend.mock.calls.map(([message]) => JSON.parse(message))).toEqual([
      { method: 'subscribe', subscription: { type: 'l2Book', coin: 'BTC' } },
      { method: 'subscribe', subscription: { type: 'trades', coin: 'BTC' } },
    ]);
  });

  it('keeps a shared feed when one client leaves and unsubscribes it after the last lease', async () => {
    const upstreamSend = jest.fn();
    const hyperliquid = new HyperliquidService(applicationServer);
    (hyperliquid as any).ws = { readyState: WebSocket.OPEN, send: upstreamSend };
    applicationServer.setAssetLeaseHandlers(
      (asset) => hyperliquid.acquireAssetLease(asset),
      (asset) => hyperliquid.releaseAssetLease(asset),
    );
    const first = await connectClient();
    const second = await connectClient();

    first.send(JSON.stringify({ type: 'subscribe', channel: 'orderbook:BTC' }));
    second.send(JSON.stringify({ type: 'subscribe', channel: 'orderbook:BTC' }));
    await waitUntil(() => (
      (hyperliquid as any).assetLeaseCounts.get('BTC') === 2
      && upstreamSend.mock.calls.length === 2
    ));
    expect(upstreamSend).toHaveBeenCalledTimes(2);

    first.send(JSON.stringify({ type: 'unsubscribe', channel: 'orderbook:BTC' }));
    await waitUntil(() => (hyperliquid as any).assetLeaseCounts.get('BTC') === 1);
    expect(upstreamSend).toHaveBeenCalledTimes(2);

    second.send(JSON.stringify({ type: 'unsubscribe', channel: 'orderbook:BTC' }));
    await waitUntil(() => upstreamSend.mock.calls.length === 4);
    expect(upstreamSend.mock.calls.slice(2).map(([message]) => JSON.parse(message))).toEqual([
      { method: 'unsubscribe', subscription: { type: 'l2Book', coin: 'BTC' } },
      { method: 'unsubscribe', subscription: { type: 'trades', coin: 'BTC' } },
    ]);
  });

  it('releases a client lease when its socket disconnects', async () => {
    const upstreamSend = jest.fn();
    const hyperliquid = new HyperliquidService(applicationServer);
    (hyperliquid as any).ws = { readyState: WebSocket.OPEN, send: upstreamSend };
    applicationServer.setAssetLeaseHandlers(
      (asset) => hyperliquid.acquireAssetLease(asset),
      (asset) => hyperliquid.releaseAssetLease(asset),
    );
    const client = await connectClient();
    client.send(JSON.stringify({ type: 'subscribe', channel: 'trades:BTC' }));
    await waitUntil(() => upstreamSend.mock.calls.length === 2);

    const closed = new Promise<void>((resolve) => client.once('close', () => resolve()));
    client.terminate();
    await closed;
    await waitUntil(() => upstreamSend.mock.calls.length === 4);

    expect(upstreamSend.mock.calls.slice(2).map(([message]) => JSON.parse(message))).toEqual([
      { method: 'unsubscribe', subscription: { type: 'l2Book', coin: 'BTC' } },
      { method: 'unsubscribe', subscription: { type: 'trades', coin: 'BTC' } },
    ]);
  });

  it('rejects malformed messages through the real handler', async () => {
    const client = await connectClient();
    const received = nextMessage(client);
    client.send(JSON.stringify({ type: 'subscribe', channel: 42 }));

    await expect(received).resolves.toMatchObject({
      type: 'error',
      data: { code: 'INVALID_MESSAGE' },
    });
  });

  it('rejects unsupported and oversized channel names', async () => {
    const client = await connectClient();

    let received = nextMessage(client);
    client.send(JSON.stringify({ type: 'subscribe', channel: 'positions:user-1' }));
    await expect(received).resolves.toMatchObject({ type: 'error', data: { code: 'INVALID_CHANNEL' } });

    received = nextMessage(client);
    client.send(JSON.stringify({ type: 'subscribe', channel: `price:${'A'.repeat(WS_CONSTANTS.MAX_CHANNEL_LENGTH)}` }));
    await expect(received).resolves.toMatchObject({ type: 'error', data: { code: 'INVALID_CHANNEL' } });

    received = nextMessage(client);
    client.send(JSON.stringify({ type: 'subscribe', channel: 'price:btc' }));
    await expect(received).resolves.toMatchObject({ type: 'error', data: { code: 'INVALID_CHANNEL' } });
  });

  it('rejects nondeterministic feed wildcards while allowing the global price wildcard', async () => {
    const client = await connectClient();
    const leaseAcquired = jest.fn();
    applicationServer.setAssetLeaseHandlers(leaseAcquired, jest.fn());

    let received = nextMessage(client);
    client.send(JSON.stringify({ type: 'subscribe', channel: 'orderbook:*' }));
    await expect(received).resolves.toMatchObject({ type: 'error', data: { code: 'INVALID_CHANNEL' } });

    received = nextMessage(client);
    client.send(JSON.stringify({ type: 'subscribe', channel: 'trades:*' }));
    await expect(received).resolves.toMatchObject({ type: 'error', data: { code: 'INVALID_CHANNEL' } });

    client.send(JSON.stringify({ type: 'subscribe', channel: 'price:*' }));
    await waitUntil(() => [...(applicationServer as any).clients.values()].some(
      (entry: any) => entry.connection.subscriptions.has('price:*')
    ));
    expect(leaseAcquired).not.toHaveBeenCalled();
  });

  it('caps subscriptions per connection', async () => {
    const client = await connectClient();
    const validAssets = [
      'BTC', 'ETH', 'SOL', 'XRP', 'DOGE', 'ADA', 'AVAX', 'LINK', 'DOT',
      'UNI', 'ATOM', 'LTC', 'ARB', 'OP', 'SUI', 'APT', 'NEAR',
    ];
    for (let index = 0; index < WS_CONSTANTS.MAX_SUBSCRIPTIONS_PER_CLIENT; index += 1) {
      client.send(JSON.stringify({ type: 'subscribe', channel: `price:${validAssets[index]}` }));
    }

    const received = nextMessage(client);
    client.send(JSON.stringify({
      type: 'subscribe',
      channel: `price:${validAssets[WS_CONSTANTS.MAX_SUBSCRIPTIONS_PER_CLIENT]}`,
    }));
    await expect(received).resolves.toMatchObject({ type: 'error', data: { code: 'SUBSCRIPTION_LIMIT' } });
  });

  it('closes connections that exceed the configured inbound payload limit', async () => {
    const client = await connectClient();
    const closed = new Promise<number>((resolve) => client.once('close', (code) => resolve(code)));
    client.send('x'.repeat(WS_CONSTANTS.MAX_PAYLOAD_BYTES + 1));
    await expect(closed).resolves.toBe(1009);
  });

  it('terminates slow clients before queuing more outbound data', () => {
    const slowSocket = {
      readyState: WebSocket.OPEN,
      bufferedAmount: WS_CONSTANTS.MAX_BUFFERED_AMOUNT_BYTES + 1,
      send: jest.fn(),
      terminate: jest.fn(),
    };

    (applicationServer as any).sendSerialized(slowSocket, '{}');

    expect(slowSocket.terminate).toHaveBeenCalledTimes(1);
    expect(slowSocket.send).not.toHaveBeenCalled();
  });
});
