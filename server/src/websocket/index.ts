import { WebSocketServer as WSServer, WebSocket } from 'ws';
import { Server } from 'http';
import { v4 as uuidv4 } from 'uuid';
import { logger } from '../lib/logger.js';
import { WS_CONSTANTS } from '../config/constants.js';
import { getSupabase } from '../lib/supabase.js';
import type { WSMessage, ClientConnection } from '../types/websocket.js';

interface RateLimitState {
  messageCount: number;
  windowStart: number;
}

export class WebSocketServer {
  private wss: WSServer;
  private clients: Map<string, { ws: WebSocket; connection: ClientConnection; rateLimit: RateLimitState }> = new Map();
  private heartbeatInterval: NodeJS.Timeout | null = null;

  constructor(server: Server) {
    this.wss = new WSServer({ server, path: '/ws' });
    this.setupServer();
    this.startHeartbeat();
  }

  private setupServer(): void {
    this.wss.on('connection', async (ws, req) => {
      const clientId = uuidv4();
      const connection: ClientConnection = {
        id: clientId,
        subscriptions: new Set(),
        isAlive: true,
        lastPing: Date.now(),
      };

      // Validate token from query string if present
      const url = new URL(req.url || '', `http://${req.headers.host}`);
      const token = url.searchParams.get('token');
      if (token) {
        try {
          const supabase = getSupabase();
          const { data: { user }, error } = await supabase.auth.getUser(token);
          if (!error && user) {
            connection.userId = user.id;
            logger.debug(`WebSocket authenticated for user ${user.id}`);
          }
        } catch (error) {
          logger.debug('WebSocket token validation failed, continuing as anonymous');
        }
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
          const message: WSMessage = JSON.parse(data.toString());
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

      ws.on('close', () => {
        this.clients.delete(clientId);
        logger.info(`Client disconnected: ${clientId}`);
      });

      ws.on('error', (error) => {
        logger.error(`WebSocket error for ${clientId}:`, error);
        this.clients.delete(clientId);
      });
    });

    logger.info('WebSocket server initialized');
  }

  private handleMessage(clientId: string, message: WSMessage): void {
    const client = this.clients.get(clientId);
    if (!client) return;

    switch (message.type) {
      case 'subscribe':
        if (message.channel) {
          client.connection.subscriptions.add(message.channel);
          logger.debug(`Client ${clientId} subscribed to ${message.channel}`);
        }
        break;

      case 'unsubscribe':
        if (message.channel) {
          client.connection.subscriptions.delete(message.channel);
          logger.debug(`Client ${clientId} unsubscribed from ${message.channel}`);
        }
        break;

      default:
        // Handle other message types
        break;
    }
  }

  private startHeartbeat(): void {
    this.heartbeatInterval = setInterval(() => {
      for (const [clientId, { ws, connection }] of this.clients.entries()) {
        if (!connection.isAlive) {
          logger.info(`Terminating inactive client: ${clientId}`);
          ws.terminate();
          this.clients.delete(clientId);
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

      ws.send(data);
    }
  }

  broadcastToUser(userId: string, message: WSMessage): void {
    const data = JSON.stringify({
      ...message,
      timestamp: message.timestamp || Date.now(),
    });

    for (const [, { ws, connection }] of this.clients.entries()) {
      if (ws.readyState !== WebSocket.OPEN) continue;
      if (connection.userId !== userId) continue;

      ws.send(data);
    }
  }

  private send(ws: WebSocket, message: WSMessage): void {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        ...message,
        timestamp: message.timestamp || Date.now(),
      }));
    }
  }

  getClientCount(): number {
    return this.clients.size;
  }

  close(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
    }

    for (const [, { ws }] of this.clients.entries()) {
      ws.close();
    }

    this.wss.close();
    logger.info('WebSocket server closed');
  }
}
