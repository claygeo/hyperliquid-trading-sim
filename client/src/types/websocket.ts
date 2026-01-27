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

export interface WSCandle {
  type: 'candle';
  channel: string;
  data: {
    time: number;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
  };
}

export interface WSOrderbook {
  type: 'orderbook';
  channel: string;
  data: {
    bids: Array<[number, number]>;
    asks: Array<[number, number]>;
    timestamp: number;
  };
}

export interface WSTrade {
  type: 'trade';
  channel: string;
  data: {
    id: string;
    price: number;
    size: number;
    side: 'buy' | 'sell';
    timestamp: number;
    user?: string;
    isSimulated?: boolean;
  };
}

export interface WSPosition {
  type: 'position';
  data: {
    id: string;
    asset: string;
    side: 'long' | 'short';
    entryPrice: number;
    currentPrice: number;
    size: number;
    unrealizedPnl: number;
    liquidationPrice: number;
  };
}

export interface WSParticipant {
  type: 'participant';
  data: {
    id: string;
    address: string;
    asset: string;
    side: 'long' | 'short';
    entryPrice: number;
    size: number;
    unrealizedPnl: number;
    leverage: number;
  };
}

export interface WSTPS {
  type: 'tps';
  data: {
    current: number;
    average: number;
    peak: number;
    messageCount: number;
    latency: number;
  };
}

export type StressTestSpeed = 'off' | 'slow' | 'medium' | 'fast';

export interface WSStressTest {
  type: 'stress_test';
  data: {
    speed: StressTestSpeed;
    enabled: boolean;
  };
}
