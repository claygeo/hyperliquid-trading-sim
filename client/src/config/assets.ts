export interface Asset {
  symbol: string;
  name: string;
  szDecimals: number;
  maxLeverage: number;
}

// Assets supported by CryptoCompare API (have reliable price charts)
export const DEFAULT_ASSETS: Asset[] = [
  { symbol: 'BTC', name: 'Bitcoin', szDecimals: 5, maxLeverage: 50 },
  { symbol: 'ETH', name: 'Ethereum', szDecimals: 4, maxLeverage: 50 },
  { symbol: 'SOL', name: 'Solana', szDecimals: 2, maxLeverage: 50 },
  { symbol: 'XRP', name: 'Ripple', szDecimals: 2, maxLeverage: 50 },
  { symbol: 'DOGE', name: 'Dogecoin', szDecimals: 0, maxLeverage: 50 },
  { symbol: 'ADA', name: 'Cardano', szDecimals: 2, maxLeverage: 50 },
  { symbol: 'AVAX', name: 'Avalanche', szDecimals: 2, maxLeverage: 50 },
  { symbol: 'LINK', name: 'Chainlink', szDecimals: 2, maxLeverage: 50 },
  { symbol: 'DOT', name: 'Polkadot', szDecimals: 2, maxLeverage: 50 },
  { symbol: 'MATIC', name: 'Polygon', szDecimals: 1, maxLeverage: 50 },
  { symbol: 'UNI', name: 'Uniswap', szDecimals: 2, maxLeverage: 50 },
  { symbol: 'ATOM', name: 'Cosmos', szDecimals: 2, maxLeverage: 50 },
  { symbol: 'LTC', name: 'Litecoin', szDecimals: 2, maxLeverage: 50 },
  { symbol: 'ARB', name: 'Arbitrum', szDecimals: 1, maxLeverage: 50 },
  { symbol: 'OP', name: 'Optimism', szDecimals: 1, maxLeverage: 50 },
  { symbol: 'SUI', name: 'Sui', szDecimals: 1, maxLeverage: 50 },
  { symbol: 'APT', name: 'Aptos', szDecimals: 2, maxLeverage: 50 },
  { symbol: 'NEAR', name: 'NEAR', szDecimals: 1, maxLeverage: 50 },
  { symbol: 'INJ', name: 'Injective', szDecimals: 2, maxLeverage: 50 },
  { symbol: 'FTM', name: 'Fantom', szDecimals: 0, maxLeverage: 50 },
  { symbol: 'AAVE', name: 'Aave', szDecimals: 2, maxLeverage: 50 },
  { symbol: 'MKR', name: 'Maker', szDecimals: 2, maxLeverage: 50 },
  { symbol: 'SNX', name: 'Synthetix', szDecimals: 2, maxLeverage: 50 },
  { symbol: 'CRV', name: 'Curve', szDecimals: 2, maxLeverage: 50 },
  { symbol: 'FIL', name: 'Filecoin', szDecimals: 2, maxLeverage: 50 },
  { symbol: 'SAND', name: 'Sandbox', szDecimals: 2, maxLeverage: 50 },
  { symbol: 'MANA', name: 'Decentraland', szDecimals: 2, maxLeverage: 50 },
  { symbol: 'AXS', name: 'Axie Infinity', szDecimals: 2, maxLeverage: 50 },
  { symbol: 'RUNE', name: 'THORChain', szDecimals: 1, maxLeverage: 50 },
  { symbol: 'ENS', name: 'ENS', szDecimals: 2, maxLeverage: 50 },
  { symbol: 'LDO', name: 'Lido DAO', szDecimals: 2, maxLeverage: 50 },
  { symbol: 'GRT', name: 'The Graph', szDecimals: 2, maxLeverage: 50 },
  { symbol: 'IMX', name: 'Immutable X', szDecimals: 2, maxLeverage: 50 },
  { symbol: 'STX', name: 'Stacks', szDecimals: 2, maxLeverage: 50 },
  { symbol: 'RENDER', name: 'Render', szDecimals: 2, maxLeverage: 50 },
  { symbol: 'FET', name: 'Fetch.ai', szDecimals: 2, maxLeverage: 50 },
  { symbol: 'AR', name: 'Arweave', szDecimals: 2, maxLeverage: 50 },
  { symbol: 'SHIB', name: 'Shiba Inu', szDecimals: 0, maxLeverage: 50 },
  { symbol: 'PEPE', name: 'Pepe', szDecimals: 0, maxLeverage: 50 },
  { symbol: 'BNB', name: 'BNB', szDecimals: 2, maxLeverage: 50 },
];

// For backward compatibility
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
