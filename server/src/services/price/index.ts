import type { HyperliquidService } from '../hyperliquid/index.js';
import { logger } from '../../lib/logger.js';

export const MAX_EXECUTION_PRICE_AGE_MS = 15_000;

interface PriceSnapshot {
  price: number;
  observedAt: number;
}

// Single source of truth for executable prices. A short last-known window can
// bridge a transient upstream frame gap; older prices fail closed.
export class PriceService {
  private hyperliquidService: HyperliquidService | null = null;
  private lastKnownPrices: Map<string, PriceSnapshot> = new Map();

  setHyperliquidService(service: HyperliquidService) {
    this.hyperliquidService = service;
  }

  getCurrentPrice(asset: string): number | null {
    const now = Date.now();

    if (this.hyperliquidService) {
      const snapshot = this.hyperliquidService.getPriceSnapshot(asset);
      if (snapshot && snapshot.price > 0 && Number.isFinite(snapshot.price)) {
        this.lastKnownPrices.set(asset, snapshot);
        if (now - snapshot.observedAt <= MAX_EXECUTION_PRICE_AGE_MS) {
          return snapshot.price;
        }
      }
    }

    // Permit only a bounded last-known fallback for transient feed gaps.
    const lastKnown = this.lastKnownPrices.get(asset);
    if (lastKnown && now - lastKnown.observedAt <= MAX_EXECUTION_PRICE_AGE_MS) {
      logger.warn(`Using recent last known price for ${asset}: ${lastKnown.price}`);
      return lastKnown.price;
    }

    logger.error(`No fresh price available for ${asset}`);
    return null;
  }

  getAllPrices(): Map<string, number> {
    if (this.hyperliquidService) {
      return this.hyperliquidService.getAllPrices();
    }
    return new Map(
      [...this.lastKnownPrices].map(([asset, snapshot]) => [asset, snapshot.price])
    );
  }
}

// Singleton
export const priceService = new PriceService();
