// Shared types between client and server
// These can be imported in both environments

export type OrderSide = 'long' | 'short';
export type PositionStatus = 'open' | 'closed' | 'liquidated';
export type StressTestSpeed = 'off' | 'slow' | 'medium' | 'fast';

export interface Position {
  id: string;
  userId: string;
  asset: string;
  side: OrderSide;
  entryPrice: number;
  currentPrice: number;
  size: number;
  leverage: number;
  margin: number;
  liquidationPrice: number;
  unrealizedPnl: number;
  unrealizedPnlPercent: number;
  realizedPnl: number;
  status: PositionStatus;
  openedAt: string;
  closedAt?: string;
}

export interface Account {
  id: string;
  userId: string;
  balance: number;
  initialBalance: number;
  equity: number;
  unrealizedPnl: number;
  usedMargin: number;
  availableMargin: number;
  resetCount: number;
  createdAt: string;
}

export interface LeaderboardEntry {
  rank: number;
  userId: string;
  username: string;
  totalPnl: number;
  totalPnlPercent: number;
  winRate: number;
  maxDrawdown: number;
  tradeCount: number;
  updatedAt: string;
}

export interface Candle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface Trade {
  id: string;
  price: number;
  size: number;
  side: 'buy' | 'sell';
  timestamp: number;
  user?: string;
  isSimulated?: boolean;
}

export interface PlaceOrderRequest {
  asset: string;
  side: OrderSide;
  size: number;
  leverage: number;
}

export interface TPSStats {
  current: number;
  average: number;
  peak: number;
  messageCount: number;
  latency: number;
}

export const SUPPORTED_ASSETS = ['BTC', 'ETH', 'SOL'] as const;
export type SupportedAsset = typeof SUPPORTED_ASSETS[number];

export const TIMEFRAMES = ['1m', '5m', '15m', '1h', '4h', '1d'] as const;
export type Timeframe = typeof TIMEFRAMES[number];
