export type OrderSide = 'long' | 'short';
export type PositionStatus = 'open' | 'closed' | 'liquidated';

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

export interface Account {
  id: string;
  userId: string;
  balance: number;
  initialBalance: number;
  equity: number;
  unrealizedPnl: number;
  usedMargin: number;
  availableMargin: number;
  priceStale: boolean;
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
  expectedAccountResetCount: number;
  source?: PositionSource;
  signalId?: string;
}

export interface ClosePositionRequest {
  positionId: string;
}
