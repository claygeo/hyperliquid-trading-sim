export interface Asset {
  symbol: string;
  name: string;
  szDecimals: number;
  maxLeverage: number;
}

// Default assets for initial render before API fetch
export const DEFAULT_ASSETS: Asset[] = [
  { symbol: 'BTC', name: 'Bitcoin', szDecimals: 5, maxLeverage: 50 },
  { symbol: 'ETH', name: 'Ethereum', szDecimals: 4, maxLeverage: 50 },
  { symbol: 'SOL', name: 'Solana', szDecimals: 2, maxLeverage: 50 },
  { symbol: 'DOGE', name: 'Dogecoin', szDecimals: 0, maxLeverage: 50 },
  { symbol: 'AVAX', name: 'Avalanche', szDecimals: 2, maxLeverage: 50 },
  { symbol: 'LINK', name: 'Chainlink', szDecimals: 2, maxLeverage: 50 },
  { symbol: 'ARB', name: 'Arbitrum', szDecimals: 1, maxLeverage: 50 },
  { symbol: 'OP', name: 'Optimism', szDecimals: 1, maxLeverage: 50 },
  { symbol: 'SUI', name: 'Sui', szDecimals: 1, maxLeverage: 50 },
  { symbol: 'PEPE', name: 'Pepe', szDecimals: 0, maxLeverage: 50 },
  { symbol: 'WIF', name: 'dogwifhat', szDecimals: 1, maxLeverage: 50 },
  { symbol: 'MATIC', name: 'Polygon', szDecimals: 1, maxLeverage: 50 },
  { symbol: 'INJ', name: 'Injective', szDecimals: 2, maxLeverage: 50 },
  { symbol: 'APT', name: 'Aptos', szDecimals: 2, maxLeverage: 50 },
  { symbol: 'NEAR', name: 'NEAR', szDecimals: 1, maxLeverage: 50 },
  { symbol: 'FTM', name: 'Fantom', szDecimals: 0, maxLeverage: 50 },
  { symbol: 'ATOM', name: 'Cosmos', szDecimals: 2, maxLeverage: 50 },
  { symbol: 'TIA', name: 'Celestia', szDecimals: 2, maxLeverage: 50 },
  { symbol: 'SEI', name: 'Sei', szDecimals: 0, maxLeverage: 50 },
  { symbol: 'RUNE', name: 'THORChain', szDecimals: 1, maxLeverage: 50 },
];

// For backward compatibility - will be replaced with dynamic list
export const ASSETS: Record<string, Asset> = Object.fromEntries(
  DEFAULT_ASSETS.map(a => [a.symbol, a])
);

export const ASSET_LIST = DEFAULT_ASSETS;
export const ASSET_SYMBOLS = DEFAULT_ASSETS.map(a => a.symbol);

export const TIMEFRAMES = [
  { value: '1m', label: '1m', seconds: 60 },
  { value: '5m', label: '5m', seconds: 300 },
  { value: '15m', label: '15m', seconds: 900 },
  { value: '1h', label: '1H', seconds: 3600 },
  { value: '4h', label: '4H', seconds: 14400 },
  { value: '1d', label: '1D', seconds: 86400 },
] as const;

export type TimeframeValue = typeof TIMEFRAMES[number]['value'];

// Helper to get price decimals based on price
export function getPriceDecimals(price: number): number {
  if (price >= 1000) return 2;
  if (price >= 1) return 2;
  if (price >= 0.01) return 4;
  if (price >= 0.0001) return 6;
  return 8;
}
