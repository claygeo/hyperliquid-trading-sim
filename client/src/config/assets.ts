export interface Asset {
  symbol: string;
  name: string;
  decimals: number;
  priceDecimals: number;
  icon: string;
  hyperliquidSymbol: string;
  defaultTimeframe: string;
}

export const ASSETS: Record<string, Asset> = {
  BTC: {
    symbol: 'BTC',
    name: 'Bitcoin',
    decimals: 8,
    priceDecimals: 2,
    icon: '₿',
    hyperliquidSymbol: 'BTC',
    defaultTimeframe: '1h',
  },
  ETH: {
    symbol: 'ETH',
    name: 'Ethereum',
    decimals: 8,
    priceDecimals: 2,
    icon: 'Ξ',
    hyperliquidSymbol: 'ETH',
    defaultTimeframe: '1h',
  },
  SOL: {
    symbol: 'SOL',
    name: 'Solana',
    decimals: 8,
    priceDecimals: 4,
    icon: '◎',
    hyperliquidSymbol: 'SOL',
    defaultTimeframe: '15m',
  },
} as const;

export const ASSET_LIST = Object.values(ASSETS);
export const ASSET_SYMBOLS = Object.keys(ASSETS) as Array<keyof typeof ASSETS>;

export const TIMEFRAMES = [
  { value: '1m', label: '1m', seconds: 60 },
  { value: '5m', label: '5m', seconds: 300 },
  { value: '15m', label: '15m', seconds: 900 },
  { value: '1h', label: '1H', seconds: 3600 },
  { value: '4h', label: '4H', seconds: 14400 },
  { value: '1d', label: '1D', seconds: 86400 },
] as const;

export type TimeframeValue = typeof TIMEFRAMES[number]['value'];
