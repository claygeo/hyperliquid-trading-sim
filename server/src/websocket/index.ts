import { WebSocketServer as WSServer, WebSocket } from 'ws';
import { Server, type IncomingMessage } from 'http';
import { randomUUID } from 'node:crypto';
import { logger } from '../lib/logger.js';
import { WS_CONSTANTS } from '../config/constants.js';
import { config } from '../config/index.js';
import { getAssetConfig } from '../config/assets.js';
import type { WSMessage, ClientConnection } from '../types/websocket.js';

const ASSET_CHANNEL = /^(orderbook|trades|price):([A-Za-z0-9]{1,20}|\*)$/;

interface RateLimitState {
  messageCount: number;
  windowStart: number;
}

type AssetLeaseHandler = (asset: string) => void;

interface AssetLeaseHandlers {
  acquire: AssetLeaseHandler;
  release: AssetLeaseHandler;
}

export class WebSocketServer {
  private wss: WSServer;
  private clients: Map<string, { ws: WebSocket; connection: ClientConnection; rateLimit: RateLimitState }> = new Map();
  private heartbeatInterval: NodeJS.Timeout | null = null;
  private assetLeaseHandlers: AssetLeaseHandlers | null = null;

  constructor(server: Server) {
    this.wss = new WSServer({
      server,
      path: '/ws',
      maxPayload: WS_CONSTANTS.MAX_PAYLOAD_BYTES,
    });
    this.setupServer();
    this.startHeartbeat();
  }

  private setupServer(): void {
    this.wss.on('connection', (ws, req) => {
      const clientId = randomUUID();
      const ipAddress = this.getClientIp(req);
      const connection: ClientConnection = {
        id: clientId,
        ipAddress,
        subscriptions: new Set(),
        isAlive: true,
        lastPing: Date.now(),
      };

      ws.on('close', () => {
        this.cleanupClient(clientId);
        logger.info(`Client disconnected: ${clientId}`);
      });

      ws.on('error', (error) => {
        logger.error(`WebSocket error for ${clientId}:`, error);
        this.cleanupClient(clientId);
      });

      if (this.clients.size >= WS_CONSTANTS.MAX_CLIENTS) {
        logger.warn(`Rejecting WebSocket client: global connection cap reached`);
        ws.close(1013, 'Server capacity reached');
        return;
      }

      const clientsForIp = [...this.clients.values()].filter(
        (client) => client.connection.ipAddress === ipAddress
      ).length;
      if (clientsForIp >= WS_CONSTANTS.MAX_CLIENTS_PER_IP) {
        logger.warn(`Rejecting WebSocket client: per-IP cap reached for ${ipAddress}`);
        ws.close(1008, 'Connection limit reached');
        return;
      }

      const rateLimit: RateLimitState = { messageCount: 0, windowStart: Date.now() };
      this.clients.set(clientId, { ws, connection, rateLimit });
      logger.info(`Client connected: ${clientId}`);

      // Send connected message
      this.send(ws, { type: 'connected', data: { clientId } });

      ws.on('message', (data) => {
        const client = this.clients.get(clientId);
        if (!client) return;

        // Rate limiting: per-connection message throttle
        const now = Date.now();
        const rl = client.rateLimit;
        if (now - rl.windowStart >= WS_CONSTANTS.RATE_LIMIT.WINDOW_MS) {
          rl.messageCount = 0;
          rl.windowStart = now;
        }
        rl.messageCount++;

        if (rl.messageCount > WS_CONSTANTS.RATE_LIMIT.MAX_MESSAGES_PER_SECOND) {
          this.send(ws, { type: 'error', data: { code: 'RATE_LIMITED', message: 'Too many messages, disconnecting' } });
          logger.warn(`Rate limited client ${clientId}: ${rl.messageCount} msgs in window`);
          ws.close(1008, 'Rate limited');
          return;
        }

        try {
          const message: unknown = JSON.parse(data.toString());
          if (!this.isClientMessage(message)) {
            this.send(ws, { type: 'error', data: { code: 'INVALID_MESSAGE', message: 'Expected subscribe or unsubscribe with a channel' } });
            return;
          }
          this.handleMessage(clientId, message);
        } catch (error) {
          this.send(ws, { type: 'error', data: { code: 'INVALID_MESSAGE', message: 'Malformed JSON' } });
        }
      });

      ws.on('pong', () => {
        const client = this.clients.get(clientId);
        if (client) {
          client.connection.isAlive = true;
          client.connection.lastPing = Date.now();
        }
      });

    });

    logger.info('WebSocket server initialized');
  }

  private handleMessage(clientId: string, message: WSMessage): void {
    const client = this.clients.get(clientId);
    if (!client) return;

    switch (message.type) {
      case 'subscribe': {
        if (!this.isAllowedChannel(message.channel!)) {
          this.send(client.ws, { type: 'error', data: { code: 'INVALID_CHANNEL', message: 'Unsupported subscription channel' } });
          return;
        }
        if (
          !client.connection.subscriptions.has(message.channel!)
          && client.connection.subscriptions.size >= WS_CONSTANTS.MAX_SUBSCRIPTIONS_PER_CLIENT
        ) {
          this.send(client.ws, { type: 'error', data: { code: 'SUBSCRIPTION_LIMIT', message: 'Subscription limit reached' } });
          return;
        }
        const isNewSubscription = !client.connection.subscriptions.has(message.channel!);
        client.connection.subscriptions.add(message.channel!);
        if (isNewSubscription) {
          const asset = this.getLeasedAsset(message.channel!);
          if (asset) this.assetLeaseHandlers?.acquire(asset);
        }
        logger.debug(`Client ${clientId} subscribed to ${message.channel}`);
        break;
      }

      case 'unsubscribe':
        if (!this.isAllowedChannel(message.channel!)) {
          this.send(client.ws, { type: 'error', data: { code: 'INVALID_CHANNEL', message: 'Unsupported subscription channel' } });
          return;
        }
        if (client.connection.subscriptions.delete(message.channel!)) {
          const asset = this.getLeasedAsset(message.channel!);
          if (asset) this.assetLeaseHandlers?.release(asset);
        }
        logger.debug(`Client ${clientId} unsubscribed from ${message.channel}`);
        break;
    }
  }

  private isClientMessage(message: unknown): message is WSMessage {
    if (!message || typeof message !== 'object') return false;
    const candidate = message as { type?: unknown; channel?: unknown };
    return (
      (candidate.type === 'subscribe' || candidate.type === 'unsubscribe')
      && typeof candidate.channel === 'string'
    );
  }

  private isAllowedChannel(channel: string): boolean {
    if (channel.length > WS_CONSTANTS.MAX_CHANNEL_LENGTH) return false;
    if (channel === 'tps' || channel === 'ping') return true;

    const match = ASSET_CHANNEL.exec(channel);
    if (!match) return false;
    const asset = match[2];
    if (asset === '*') return match[1] === 'price';

    // The upstream feed preserves symbols such as kPEPE. Accept only the
    // canonical spelling so a valid-looking lowercase subscription cannot sit
    // idle while broadcasts use a differently cased channel.
    return getAssetConfig(asset)?.symbol === asset;
  }

  private getLeasedAsset(channel: string): string | null {
    const match = ASSET_CHANNEL.exec(channel);
    if (!match || match[2] === '*' || match[1] === 'price') return null;
    return match[2];
  }

  setAssetLeaseHandlers(acquire: AssetLeaseHandler, release: AssetLeaseHandler): void {
    this.assetLeaseHandlers = { acquire, release };
  }

  private cleanupClient(clientId: string): void {
    const client = this.clients.get(clientId);
    if (!client) return;

    for (const channel of client.connection.subscriptions) {
      const asset = this.getLeasedAsset(channel);
      if (asset) this.assetLeaseHandlers?.release(asset);
    }
    client.connection.subscriptions.clear();
    this.clients.delete(clientId);
  }

  private getClientIp(req: IncomingMessage): string {
    const remoteAddress = req.socket.remoteAddress || 'unknown';
    if (config.trustProxyHops === 0) return remoteAddress;

    const forwardedHeader = req.headers['x-forwarded-for'];
    const forwarded = (Array.isArray(forwardedHeader) ? forwardedHeader[0] : forwardedHeader)
      ?.split(',')
      .map((address) => address.trim())
      .filter(Boolean) ?? [];
    if (forwarded.length === 0) return remoteAddress;

    const index = Math.max(0, forwarded.length - config.trustProxyHops);
    return forwarded[index] || remoteAddress;
  }

  private startHeartbeat(): void {
    this.heartbeatInterval = setInterval(() => {
      for (const [clientId, { ws, connection }] of this.clients.entries()) {
        if (!connection.isAlive) {
          logger.info(`Terminating inactive client: ${clientId}`);
          this.cleanupClient(clientId);
          ws.terminate();
          continue;
        }

        connection.isAlive = false;
        ws.ping();
      }
    }, WS_CONSTANTS.HEARTBEAT_INTERVAL);
  }

  broadcast(message: WSMessage): void {
    const data = JSON.stringify({
      ...message,
      timestamp: message.timestamp || Date.now(),
    });

    for (const [, { ws, connection }] of this.clients.entries()) {
      if (ws.readyState !== WebSocket.OPEN) continue;

      // If message has a channel, only send to subscribed clients
      if (message.channel) {
        if (!connection.subscriptions.has(message.channel)) {
          // Check for wildcard subscriptions
          const [type] = message.channel.split(':');
          if (!connection.subscriptions.has(`${type}:*`)) {
            continue;
          }
        }
      }

      this.sendSerialized(ws, data);
    }
  }

  private send(ws: WebSocket, message: WSMessage): void {
    if (ws.readyState === WebSocket.OPEN) {
      this.sendSerialized(ws, JSON.stringify({
        ...message,
        timestamp: message.timestamp || Date.now(),
      }));
    }
  }

  private sendSerialized(ws: WebSocket, data: string): void {
    if (ws.readyState !== WebSocket.OPEN) return;
    if (ws.bufferedAmount > WS_CONSTANTS.MAX_BUFFERED_AMOUNT_BYTES) {
      logger.warn(`Terminating slow WebSocket client with ${ws.bufferedAmount} buffered bytes`);
      for (const [clientId, client] of this.clients) {
        if (client.ws === ws) {
          this.cleanupClient(clientId);
          break;
        }
      }
      ws.terminate();
      return;
    }
    ws.send(data);
  }

  getClientCount(): number {
    return this.clients.size;
  }

  close(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
    }

    for (const [clientId, { ws }] of [...this.clients.entries()]) {
      this.cleanupClient(clientId);
      ws.close();
    }

    this.wss.close();
    logger.info('WebSocket server closed');
  }
}
