export type OrderSide = 'long' | 'short';
export type PositionStatus = 'open' | 'closed' | 'liquidated';

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

export interface Order {
  id: string;
  userId: string;
  asset: string;
  side: OrderSide;
  size: number;
  price: number;
  leverage: number;
  status: 'pending' | 'filled' | 'cancelled';
  createdAt: string;
  filledAt?: string;
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

export interface TradeHistory {
  id: string;
  userId: string;
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
}

export interface ClosePositionRequest {
  positionId: string;
}
