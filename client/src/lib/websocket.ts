import { config } from '../config';
import { UI_CONSTANTS } from '../config/constants';
import type { WSMessage, WSMessageType } from '../types/websocket';

type MessageHandler = (message: WSMessage) => void;

export class WebSocketClient {
  private ws: WebSocket | null = null;
  private url: string;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 10;
  private handlers: Map<string, Set<MessageHandler>> = new Map();
  private subscriptions: Set<string> = new Set();
  private heartbeatInterval: NodeJS.Timeout | null = null;
  private reconnectTimeout: NodeJS.Timeout | null = null;
  private isConnecting = false;
  private token: string | null = null;

  constructor(url?: string) {
    this.url = url || config.wsUrl;
  }

  setToken(token: string | null) {
    this.token = token;
  }

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        resolve();
        return;
      }

      if (this.isConnecting) {
        const checkConnection = setInterval(() => {
          if (this.ws?.readyState === WebSocket.OPEN) {
            clearInterval(checkConnection);
            resolve();
          }
        }, 100);
        return;
      }

      this.isConnecting = true;
      const wsUrl = this.token ? `${this.url}?token=${this.token}` : this.url;
      this.ws = new WebSocket(wsUrl);

      this.ws.onopen = () => {
        console.log('[WS] Connected');
        this.isConnecting = false;
        this.reconnectAttempts = 0;
        this.startHeartbeat();
        this.resubscribe();
        resolve();
      };

      this.ws.onclose = (event) => {
        console.log('[WS] Disconnected:', event.code, event.reason);
        this.isConnecting = false;
        this.stopHeartbeat();
        this.scheduleReconnect();
      };

      this.ws.onerror = (error) => {
        console.error('[WS] Error:', error);
        this.isConnecting = false;
        reject(error);
      };

      this.ws.onmessage = (event) => {
        try {
          const message: WSMessage = JSON.parse(event.data);
          this.handleMessage(message);
        } catch (error) {
          console.error('[WS] Failed to parse message:', error);
        }
      };
    });
  }

  disconnect() {
    this.stopHeartbeat();
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.subscriptions.clear();
  }

  subscribe(channel: string) {
    this.subscriptions.add(channel);
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.send({ type: 'subscribe', channel });
    }
  }

  unsubscribe(channel: string) {
    this.subscriptions.delete(channel);
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.send({ type: 'unsubscribe', channel });
    }
  }

  on(type: WSMessageType | string, handler: MessageHandler) {
    if (!this.handlers.has(type)) {
      this.handlers.set(type, new Set());
    }
    this.handlers.get(type)!.add(handler);

    return () => {
      this.handlers.get(type)?.delete(handler);
    };
  }

  off(type: WSMessageType | string, handler: MessageHandler) {
    this.handlers.get(type)?.delete(handler);
  }

  send(message: WSMessage) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    } else {
      console.warn('[WS] Cannot send message, not connected');
    }
  }

  get isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  private handleMessage(message: WSMessage) {
    // Handle specific message type
    const typeHandlers = this.handlers.get(message.type);
    if (typeHandlers) {
      typeHandlers.forEach((handler) => handler(message));
    }

    // Handle channel-specific handlers
    if (message.channel) {
      const channelHandlers = this.handlers.get(message.channel);
      if (channelHandlers) {
        channelHandlers.forEach((handler) => handler(message));
      }
    }

    // Handle wildcard handlers
    const wildcardHandlers = this.handlers.get('*');
    if (wildcardHandlers) {
      wildcardHandlers.forEach((handler) => handler(message));
    }
  }

  private startHeartbeat() {
    this.heartbeatInterval = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.send({ type: 'subscribe', channel: 'ping' });
      }
    }, UI_CONSTANTS.WS_HEARTBEAT_INTERVAL);
  }

  private stopHeartbeat() {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }

  private resubscribe() {
    this.subscriptions.forEach((channel) => {
      this.send({ type: 'subscribe', channel });
    });
  }

  private scheduleReconnect() {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error('[WS] Max reconnect attempts reached');
      return;
    }

    const delay = Math.min(
      UI_CONSTANTS.WS_RECONNECT_DELAY * Math.pow(2, this.reconnectAttempts),
      30000
    );

    this.reconnectTimeout = setTimeout(() => {
      this.reconnectAttempts++;
      console.log(`[WS] Reconnecting (attempt ${this.reconnectAttempts})...`);
      this.connect().catch(() => {});
    }, delay);
  }
}

export const wsClient = new WebSocketClient();
