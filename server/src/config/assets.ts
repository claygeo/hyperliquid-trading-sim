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

// Default assets to use if API fails - matches CryptoCompare supported symbols
const DEFAULT_ASSETS: AssetConfig[] = [
  { symbol: 'BTC', name: 'Bitcoin', szDecimals: 5, maxLeverage: 50 },
  { symbol: 'ETH', name: 'Ethereum', szDecimals: 4, maxLeverage: 50 },
  { symbol: 'SOL', name: 'Solana', szDecimals: 2, maxLeverage: 50 },
  { symbol: 'XRP', name: 'Ripple', szDecimals: 2, maxLeverage: 50 },
  { symbol: 'DOGE', name: 'Dogecoin', szDecimals: 0, maxLeverage: 50 },
  { symbol: 'ADA', name: 'Cardano', szDecimals: 2, maxLeverage: 50 },
  { symbol: 'AVAX', name: 'Avalanche', szDecimals: 2, maxLeverage: 50 },
  { symbol: 'LINK', name: 'Chainlink', szDecimals: 2, maxLeverage: 50 },
  { symbol: 'DOT', name: 'Polkadot', szDecimals: 2, maxLeverage: 50 },
  { symbol: 'UNI', name: 'Uniswap', szDecimals: 2, maxLeverage: 50 },
  { symbol: 'ATOM', name: 'Cosmos', szDecimals: 2, maxLeverage: 50 },
  { symbol: 'LTC', name: 'Litecoin', szDecimals: 2, maxLeverage: 50 },
  { symbol: 'ARB', name: 'Arbitrum', szDecimals: 1, maxLeverage: 50 },
  { symbol: 'OP', name: 'Optimism', szDecimals: 1, maxLeverage: 50 },
  { symbol: 'SUI', name: 'Sui', szDecimals: 1, maxLeverage: 50 },
  { symbol: 'APT', name: 'Aptos', szDecimals: 2, maxLeverage: 50 },
  { symbol: 'NEAR', name: 'NEAR', szDecimals: 1, maxLeverage: 50 },
  { symbol: 'INJ', name: 'Injective', szDecimals: 2, maxLeverage: 50 },
  { symbol: 'AAVE', name: 'Aave', szDecimals: 2, maxLeverage: 50 },
  { symbol: 'SNX', name: 'Synthetix', szDecimals: 2, maxLeverage: 50 },
  { symbol: 'CRV', name: 'Curve', szDecimals: 2, maxLeverage: 50 },
  { symbol: 'FIL', name: 'Filecoin', szDecimals: 2, maxLeverage: 50 },
  { symbol: 'SAND', name: 'Sandbox', szDecimals: 2, maxLeverage: 50 },
  { symbol: 'AXS', name: 'Axie Infinity', szDecimals: 2, maxLeverage: 50 },
  { symbol: 'RUNE', name: 'THORChain', szDecimals: 1, maxLeverage: 50 },
  { symbol: 'ENS', name: 'ENS', szDecimals: 2, maxLeverage: 50 },
  { symbol: 'LDO', name: 'Lido DAO', szDecimals: 2, maxLeverage: 50 },
  { symbol: 'IMX', name: 'Immutable X', szDecimals: 2, maxLeverage: 50 },
  { symbol: 'STX', name: 'Stacks', szDecimals: 2, maxLeverage: 50 },
  { symbol: 'RENDER', name: 'Render', szDecimals: 2, maxLeverage: 50 },
  { symbol: 'FET', name: 'Fetch.ai', szDecimals: 2, maxLeverage: 50 },
  { symbol: 'AR', name: 'Arweave', szDecimals: 2, maxLeverage: 50 },
  { symbol: 'BNB', name: 'BNB', szDecimals: 2, maxLeverage: 50 },
];

// Fetch assets from Hyperliquid API
export async function fetchAssetsFromHyperliquid(): Promise<AssetConfig[]> {
  // Return cache if fresh
  if (assetsCache.length > 0 && Date.now() - assetsCacheTime < CACHE_TTL) {
    return assetsCache;
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 5000);

  try {

    const response = await fetch('https://api.hyperliquid.xyz/info', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'meta' }),
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`Hyperliquid API error: ${response.status}`);
    }

    const data: {
      universe?: Array<{
        name: string;
        szDecimals?: number;
        maxLeverage?: number;
        isDelisted?: boolean;
      }>;
    } = await response.json();
    
    if (!data.universe || !Array.isArray(data.universe)) {
      throw new Error('Invalid response from Hyperliquid meta API');
    }

    // Map the universe to our asset format
    const assets: AssetConfig[] = data.universe
      .filter((asset) => asset.isDelisted !== true)
      .map((asset) => ({
        // Hyperliquid symbols are canonical and case-sensitive (for example,
        // kPEPE). Preserve them exactly for downstream REST/WS requests.
        symbol: asset.name,
        name: asset.name,
        szDecimals: asset.szDecimals ?? 2,
        maxLeverage: asset.maxLeverage ?? 50,
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
  } finally {
    clearTimeout(timeoutId);
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
  const normalizedSymbol = symbol.toLocaleLowerCase('en-US');
  if (assetsCache.length > 0) {
    return assetsCache.find(a => a.symbol.toLocaleLowerCase('en-US') === normalizedSymbol);
  }
  return DEFAULT_ASSETS.find(a => a.symbol.toLocaleLowerCase('en-US') === normalizedSymbol);
}

export function isValidAsset(symbol: string): boolean {
  return getAssetConfig(symbol) !== undefined;
}
