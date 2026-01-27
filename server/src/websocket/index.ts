import { WebSocketServer as WSServer, WebSocket } from 'ws';
import { Server } from 'http';
import { v4 as uuidv4 } from 'uuid';
import { logger } from '../lib/logger.js';
import { WS_CONSTANTS } from '../config/constants.js';
import type { WSMessage, ClientConnection } from '../types/websocket.js';

export class WebSocketServer {
  private wss: WSServer;
  private clients: Map<string, { ws: WebSocket; connection: ClientConnection }> = new Map();
  private heartbeatInterval: NodeJS.Timeout | null = null;

  constructor(server: Server) {
    this.wss = new WSServer({ server, path: '/ws' });
    this.setupServer();
    this.startHeartbeat();
  }

  private setupServer(): void {
    this.wss.on('connection', (ws, req) => {
      const clientId = uuidv4();
      const connection: ClientConnection = {
        id: clientId,
        subscriptions: new Set(),
        isAlive: true,
        lastPing: Date.now(),
      };

      // Extract token from query string if present
      const url = new URL(req.url || '', `http://${req.headers.host}`);
      const token = url.searchParams.get('token');
      if (token) {
        // TODO: Validate token and set userId
        // connection.userId = validateToken(token);
      }

      this.clients.set(clientId, { ws, connection });
      logger.info(`Client connected: ${clientId}`);

      // Send connected message
      this.send(ws, { type: 'connected', data: { clientId } });

      ws.on('message', (data) => {
        try {
          const message: WSMessage = JSON.parse(data.toString());
          this.handleMessage(clientId, message);
        } catch (error) {
          logger.error('Invalid WebSocket message:', error);
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
          const [type, asset] = message.channel.split(':');
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
