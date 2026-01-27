export interface HLCandle {
  t: number; // timestamp
  T: number; // close timestamp
  s: string; // symbol
  i: string; // interval
  o: string; // open
  c: string; // close
  h: string; // high
  l: string; // low
  v: string; // volume
  n: number; // number of trades
}

export interface HLTrade {
  coin: string;
  side: string;
  px: string;
  sz: string;
  time: number;
  hash: string;
}

export interface HLOrderbookLevel {
  px: string;
  sz: string;
  n: number;
}

export interface HLOrderbook {
  coin: string;
  levels: [HLOrderbookLevel[], HLOrderbookLevel[]]; // [bids, asks]
  time: number;
}

export interface HLPosition {
  coin: string;
  szi: string;
  entryPx: string;
  positionValue: string;
  unrealizedPnl: string;
  returnOnEquity: string;
  liquidationPx: string | null;
  marginUsed: string;
  leverage: {
    type: string;
    value: number;
  };
}

export interface HLUserState {
  assetPositions: Array<{
    position: HLPosition;
    type: string;
  }>;
  marginSummary: {
    accountValue: string;
    totalMarginUsed: string;
    totalNtlPos: string;
    totalRawUsd: string;
  };
}

export interface HLMeta {
  universe: Array<{
    name: string;
    szDecimals: number;
  }>;
}

export interface HLAllMids {
  [coin: string]: string;
}

export interface HLWebSocketMessage {
  channel: string;
  data: unknown;
}

export interface HLSubscription {
  type: 'l2Book' | 'trades' | 'candle' | 'allMids' | 'userEvents';
  coin?: string;
  interval?: string;
  user?: string;
}
