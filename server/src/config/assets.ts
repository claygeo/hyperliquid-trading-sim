import { logger } from '../lib/logger.js';

export interface AssetConfig {
  symbol: string;
  name: string;
  szDecimals: number;
  maxLeverage: number;
}

// Cache for assets fetched from Hyperliquid
let assetsCache: AssetConfig[] = [];
let assetsCacheTime = 0;
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

// Default assets to use if API fails
const DEFAULT_ASSETS: AssetConfig[] = [
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
  { symbol: 'NEAR', name: 'NEAR Protocol', szDecimals: 1, maxLeverage: 50 },
  { symbol: 'FTM', name: 'Fantom', szDecimals: 0, maxLeverage: 50 },
  { symbol: 'ATOM', name: 'Cosmos', szDecimals: 2, maxLeverage: 50 },
  { symbol: 'TIA', name: 'Celestia', szDecimals: 2, maxLeverage: 50 },
  { symbol: 'SEI', name: 'Sei', szDecimals: 0, maxLeverage: 50 },
  { symbol: 'RUNE', name: 'THORChain', szDecimals: 1, maxLeverage: 50 },
];

// Fetch assets from Hyperliquid API
export async function fetchAssetsFromHyperliquid(): Promise<AssetConfig[]> {
  // Return cache if fresh
  if (assetsCache.length > 0 && Date.now() - assetsCacheTime < CACHE_TTL) {
    return assetsCache;
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);

    const response = await fetch('https://api.hyperliquid.xyz/info', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'meta' }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`Hyperliquid API error: ${response.status}`);
    }

    const data: { universe?: Array<{ name: string; szDecimals?: number; maxLeverage?: number }> } = await response.json();
    
    if (!data.universe || !Array.isArray(data.universe)) {
      throw new Error('Invalid response from Hyperliquid meta API');
    }

    // Map the universe to our asset format
    const assets: AssetConfig[] = data.universe.map((asset) => ({
      symbol: asset.name,
      name: asset.name, // Hyperliquid doesn't provide full names
      szDecimals: asset.szDecimals || 2,
      maxLeverage: asset.maxLeverage || 50,
    }));

    // Sort by symbol for consistency
    assets.sort((a, b) => a.symbol.localeCompare(b.symbol));

    // Update cache
    assetsCache = assets;
    assetsCacheTime = Date.now();

    logger.info(`Fetched ${assets.length} assets from Hyperliquid`);
    return assets;
  } catch (error) {
    logger.warn('Failed to fetch assets from Hyperliquid, using defaults:', error);
    
    // Return cache even if stale, or defaults
    if (assetsCache.length > 0) {
      return assetsCache;
    }
    return DEFAULT_ASSETS;
  }
}

// Get supported asset symbols (for backward compatibility)
export function getSupportedAssets(): string[] {
  if (assetsCache.length > 0) {
    return assetsCache.map(a => a.symbol);
  }
  return DEFAULT_ASSETS.map(a => a.symbol);
}

// Backwards compatibility - will be dynamically updated
export let SUPPORTED_ASSETS: string[] = DEFAULT_ASSETS.map(a => a.symbol);

// Update SUPPORTED_ASSETS when assets are fetched
export async function initializeAssets(): Promise<void> {
  const assets = await fetchAssetsFromHyperliquid();
  SUPPORTED_ASSETS = assets.map(a => a.symbol);
}

export function getAssetConfig(symbol: string): AssetConfig | undefined {
  const upperSymbol = symbol.toUpperCase();
  const cached = assetsCache.find(a => a.symbol === upperSymbol);
  if (cached) return cached;
  return DEFAULT_ASSETS.find(a => a.symbol === upperSymbol);
}

export function isValidAsset(symbol: string): boolean {
  const upperSymbol = symbol.toUpperCase();
  if (assetsCache.length > 0) {
    return assetsCache.some(a => a.symbol === upperSymbol);
  }
  return DEFAULT_ASSETS.some(a => a.symbol === upperSymbol);
}
