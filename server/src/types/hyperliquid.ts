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

export interface HLAllMids {
  [coin: string]: string;
}
