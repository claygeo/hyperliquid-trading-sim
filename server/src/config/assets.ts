export interface AssetConfig {
  symbol: string;
  name: string;
  decimals: number;
  priceDecimals: number;
  hyperliquidIndex: number;
}

export const ASSETS: Record<string, AssetConfig> = {
  BTC: {
    symbol: 'BTC',
    name: 'Bitcoin',
    decimals: 8,
    priceDecimals: 2,
    hyperliquidIndex: 0,
  },
  ETH: {
    symbol: 'ETH',
    name: 'Ethereum',
    decimals: 8,
    priceDecimals: 2,
    hyperliquidIndex: 1,
  },
  SOL: {
    symbol: 'SOL',
    name: 'Solana',
    decimals: 8,
    priceDecimals: 4,
    hyperliquidIndex: 5,
  },
} as const;

export const SUPPORTED_ASSETS = Object.keys(ASSETS);

export function getAssetConfig(symbol: string): AssetConfig | undefined {
  return ASSETS[symbol.toUpperCase()];
}

export function isValidAsset(symbol: string): boolean {
  return symbol.toUpperCase() in ASSETS;
}
