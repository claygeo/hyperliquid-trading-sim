export type WSMessageType =
  | 'subscribe'
  | 'unsubscribe'
  | 'candle'
  | 'orderbook'
  | 'trade'
  | 'position'
  | 'participant'
  | 'price'
  | 'stress_test'
  | 'tps'
  | 'error'
  | 'connected'
  | 'pong';

export interface WSMessage<T = unknown> {
  type: WSMessageType;
  channel?: string;
  data?: T;
  timestamp?: number;
}

export interface WSSubscription {
  channel: string;
  asset?: string;
}

export type StressTestSpeed = 'off' | 'slow' | 'medium' | 'fast';

export interface TPSStats {
  current: number;
  average: number;
  peak: number;
  messageCount: number;
  latency: number;
}

export interface ClientConnection {
  id: string;
  userId?: string;
  subscriptions: Set<string>;
  isAlive: boolean;
  lastPing: number;
}
