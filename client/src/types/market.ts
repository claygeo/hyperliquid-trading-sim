export interface Candle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface OrderbookLevel {
  price: number;
  size: number;
  total: number;
}

export interface Orderbook {
  bids: OrderbookLevel[];
  asks: OrderbookLevel[];
  spread: number;
  spreadPercent: number;
  midPrice: number;
  timestamp: number;
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

export interface MarketData {
  asset: string;
  price: number;
  change24h: number;
  changePercent24h: number;
  high24h: number;
  low24h: number;
  volume24h: number;
  timestamp: number;
}

export interface PriceUpdate {
  asset: string;
  price: number;
  timestamp: number;
}
