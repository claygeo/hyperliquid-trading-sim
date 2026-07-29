import { config } from '../config';
import { UI_CONSTANTS } from '../config/constants';
import type { WSMessage, WSMessageType } from '../types/websocket';

type MessageHandler = (message: WSMessage) => void;
type ConnectionStateHandler = (connected: boolean) => void;

export class WebSocketClient {
  private ws: WebSocket | null = null;
  private url: string;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 10;
  private handlers: Map<string, Set<MessageHandler>> = new Map();
  private connectionStateHandlers: Set<ConnectionStateHandler> = new Set();
  private subscriptions: Set<string> = new Set();
  private reconnectTimeout: NodeJS.Timeout | null = null;
  private isConnecting = false;
  private shouldReconnect = true;
  private connectPromise: Promise<void> | null = null;

  constructor(url?: string) {
    this.url = url || config.wsUrl;
  }

  connect(): Promise<void> {
    this.shouldReconnect = true;
    if (this.ws?.readyState === WebSocket.OPEN) return Promise.resolve();
    if (this.connectPromise) return this.connectPromise;

    this.isConnecting = true;
    const socket = new WebSocket(this.url);
    this.ws = socket;
    let settled = false;
    const attemptPromise = new Promise<void>((resolve, reject) => {
      const settle = (error?: unknown) => {
        if (settled) return;
        settled = true;
        if (this.connectPromise === attemptPromise) this.connectPromise = null;
        if (error) {
          reject(error);
        } else {
          resolve();
        }
      };

      socket.onopen = () => {
        if (this.ws !== socket) {
          socket.close(1000, 'Superseded connection');
          settle(new Error('WebSocket connection was superseded'));
          return;
        }
        console.log('[WS] Connected');
        this.isConnecting = false;
        this.reconnectAttempts = 0;
        this.notifyConnectionState(true);
        this.resubscribe();
        settle();
      };

      socket.onclose = (event) => {
        console.log('[WS] Disconnected:', event.code, event.reason);
        const isCurrentSocket = this.ws === socket;
        if (isCurrentSocket) {
          this.ws = null;
          this.isConnecting = false;
          this.notifyConnectionState(false);
        }
        settle(new Error(`WebSocket closed before connecting (${event.code})`));
        if (isCurrentSocket && this.shouldReconnect) this.scheduleReconnect();
      };

      socket.onerror = (error) => {
        console.error('[WS] Error: WebSocket connection failed');
        if (this.ws === socket) {
          this.isConnecting = false;
          this.notifyConnectionState(false);
        }
        settle(error);
      };

      socket.onmessage = (event) => {
        try {
          const message: WSMessage = JSON.parse(event.data);
          this.handleMessage(message);
        } catch (error) {
          console.error('[WS] Failed to parse message:', error);
        }
      };
    });

    this.connectPromise = attemptPromise;
    return attemptPromise;
  }

  disconnect() {
    this.shouldReconnect = false;
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
    if (this.ws) {
      const socket = this.ws;
      socket.close(1000, 'Client disconnect');
    }
    this.isConnecting = false;
    this.notifyConnectionState(false);
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

  hasSubscription(channel: string): boolean {
    return this.subscriptions.has(channel);
  }

  onConnectionState(handler: ConnectionStateHandler) {
    this.connectionStateHandlers.add(handler);
    return () => this.connectionStateHandlers.delete(handler);
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

  private notifyConnectionState(connected: boolean) {
    this.connectionStateHandlers.forEach((handler) => handler(connected));
  }

  private resubscribe() {
    this.subscriptions.forEach((channel) => {
      this.send({ type: 'subscribe', channel });
    });
  }

  private scheduleReconnect() {
    if (!this.shouldReconnect || this.reconnectTimeout) return;
    if (this.isConnecting || this.ws?.readyState === WebSocket.OPEN) return;
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error('[WS] Max reconnect attempts reached');
      return;
    }

    const delay = Math.min(
      UI_CONSTANTS.WS_RECONNECT_DELAY * Math.pow(2, this.reconnectAttempts),
      30000
    );

    this.reconnectTimeout = setTimeout(() => {
      this.reconnectTimeout = null;
      if (!this.shouldReconnect) return;
      this.reconnectAttempts++;
      console.log(`[WS] Reconnecting (attempt ${this.reconnectAttempts})...`);
      this.connect().catch(() => {});
    }, delay);
  }
}

export const wsClient = new WebSocketClient();
