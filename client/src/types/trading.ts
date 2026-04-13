export type OrderSide = 'long' | 'short';
export type OrderType = 'market' | 'limit';
export type PositionStatus = 'open' | 'closed' | 'liquidated';
export type LimitOrderStatus = 'pending' | 'filled' | 'cancelled' | 'expired';

export type PositionSource = 'manual' | 'signal';

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
  source: PositionSource;
  signalId?: string;
  openedAt: string;
  closedAt?: string;
}

export interface LimitOrder {
  id: string;
  oderId: string;
  asset: string;
  side: OrderSide;
  size: number;
  price: number;
  leverage: number;
  status: LimitOrderStatus;
  createdAt: string;
  filledAt?: string;
  cancelledAt?: string;
}

export interface Order {
  id: string;
  oderId: string;
  asset: string;
  side: OrderSide;
  type: OrderType;
  size: number;
  price: number;
  leverage: number;
  status: 'pending' | 'filled' | 'cancelled';
  createdAt: string;
  filledAt?: string;
}

export interface Account {
  id: string;
  oderId: string;
  balance: number;
  initialBalance: number;
  equity: number;
  unrealizedPnl: number;
  usedMargin: number;
  availableMargin: number;
  resetCount: number;
  createdAt: string;
}

export interface TradeHistory {
  id: string;
  oderId: string;
  asset: string;
  side: OrderSide;
  entryPrice: number;
  exitPrice: number;
  size: number;
  pnl: number;
  pnlPercent: number;
  openedAt: string;
  closedAt: string;
}

export interface Participant {
  id: string;
  address: string;
  username?: string;
  asset: string;
  side: OrderSide;
  entryPrice: number;
  currentPrice: number;
  size: number;
  notionalValue: number;
  leverage: number;
  liquidationPrice: number;
  unrealizedPnl: number;
  unrealizedPnlPercent: number;
  margin: number;
  isWhale: boolean;
  updatedAt: string;
}

export interface PlaceOrderRequest {
  asset: string;
  side: OrderSide;
  size: number;
  leverage: number;
  type?: OrderType;
  price?: number; // Required for limit orders
  source?: PositionSource;
  signalId?: string;
}

export interface ClosePositionRequest {
  positionId: string;
}
