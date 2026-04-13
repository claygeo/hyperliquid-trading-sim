import type { HyperliquidService } from '../hyperliquid/index.js';
import { logger } from '../../lib/logger.js';

// Single source of truth for current asset prices.
// Fallback chain: live WebSocket price → last known price → null (reject trade).
// No hardcoded prices. If we don't have data, we say so.
export class PriceService {
  private hyperliquidService: HyperliquidService | null = null;
  private lastKnownPrices: Map<string, number> = new Map();

  setHyperliquidService(service: HyperliquidService) {
    this.hyperliquidService = service;
  }

  getCurrentPrice(asset: string): number | null {
    // Try live WebSocket price first
    if (this.hyperliquidService) {
      const livePrice = this.hyperliquidService.getPrice(asset);
      if (livePrice > 0) {
        this.lastKnownPrices.set(asset, livePrice);
        return livePrice;
      }
    }

    // Fall back to last known price
    const lastKnown = this.lastKnownPrices.get(asset);
    if (lastKnown && lastKnown > 0) {
      logger.warn(`Using last known price for ${asset}: ${lastKnown}`);
      return lastKnown;
    }

    // No price available
    logger.error(`No price available for ${asset}`);
    return null;
  }

  getAllPrices(): Map<string, number> {
    if (this.hyperliquidService) {
      return this.hyperliquidService.getAllPrices();
    }
    return this.lastKnownPrices;
  }
}

// Singleton
export const priceService = new PriceService();
