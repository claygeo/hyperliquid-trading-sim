import {
  TRADING_CONSTANTS,
  SLIPPAGE_BPS_PER_10K,
  MAX_SLIPPAGE_BPS,
} from '../../config/constants.js';
import type { OrderSide } from '../../types/trading.js';

export class PnlCalculator {
  calculatePnl(
    entryPrice: number,
    currentPrice: number,
    size: number,
    side: OrderSide
  ): number {
    const priceDiff =
      side === 'long' ? currentPrice - entryPrice : entryPrice - currentPrice;
    return priceDiff * size;
  }

  calculatePnlPercent(
    entryPrice: number,
    currentPrice: number,
    side: OrderSide,
    leverage: number
  ): number {
    const priceDiff =
      side === 'long' ? currentPrice - entryPrice : entryPrice - currentPrice;
    const basePercent = (priceDiff / entryPrice) * 100;
    return basePercent * leverage;
  }

  calculateLiquidationPrice(
    entryPrice: number,
    leverage: number,
    side: OrderSide,
    maintenanceMargin: number = TRADING_CONSTANTS.MAINTENANCE_MARGIN
  ): number {
    // Account for fees and maintenance margin
    const liquidationPercent = (1 - maintenanceMargin) / leverage;

    if (side === 'long') {
      return entryPrice * (1 - liquidationPercent);
    }
    return entryPrice * (1 + liquidationPercent);
  }

  calculateMargin(size: number, price: number, leverage: number): number {
    return (size * price) / leverage;
  }

  calculateNotionalValue(size: number, price: number): number {
    return size * price;
  }

  shouldLiquidate(
    entryPrice: number,
    currentPrice: number,
    liquidationPrice: number,
    side: OrderSide
  ): boolean {
    if (side === 'long') {
      return currentPrice <= liquidationPrice;
    }
    return currentPrice >= liquidationPrice;
  }

  calculateMaxDrawdown(
    cumulativePnlHistory: number[],
    initialBalance: number = TRADING_CONSTANTS.INITIAL_BALANCE
  ): number {
    if (cumulativePnlHistory.length === 0) return 0;
    if (!Number.isFinite(initialBalance) || initialBalance <= 0) {
      throw new Error('Initial balance must be a positive finite number');
    }

    let peakEquity = initialBalance;
    let maxDrawdown = 0;

    for (const cumulativePnl of cumulativePnlHistory) {
      if (!Number.isFinite(cumulativePnl)) {
        throw new Error('PnL history must contain only finite numbers');
      }

      const equity = Math.max(0, initialBalance + cumulativePnl);
      if (equity > peakEquity) {
        peakEquity = equity;
      }
      const drawdown = ((peakEquity - equity) / peakEquity) * 100;
      if (drawdown > maxDrawdown) {
        maxDrawdown = drawdown;
      }
    }

    return maxDrawdown;
  }

  calculateWinRate(trades: Array<{ pnl: number }>): number {
    if (trades.length === 0) return 0;
    const wins = trades.filter((t) => t.pnl > 0).length;
    return (wins / trades.length) * 100;
  }

  calculateProfitFactor(trades: Array<{ pnl: number }>): number | 'infinite' {
    const grossProfit = trades
      .filter((t) => t.pnl > 0)
      .reduce((sum, t) => sum + t.pnl, 0);
    const grossLoss = Math.abs(
      trades.filter((t) => t.pnl < 0).reduce((sum, t) => sum + t.pnl, 0)
    );
    return grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? 'infinite' : 0;
  }

  calculateFee(notional: number, feeRate: number): number {
    return notional * feeRate;
  }

  // Simplified linear slippage: 0.05% per $10k notional.
  // Direction: buys slip up, sells slip down.
  applySlippage(price: number, notional: number, side: OrderSide): number {
    const slippageBps = Math.min(
      (notional / 10_000) * SLIPPAGE_BPS_PER_10K,
      MAX_SLIPPAGE_BPS
    );
    const slippageFraction = slippageBps / 10_000;
    if (side === 'long') {
      return price * (1 + slippageFraction);
    }
    return price * (1 - slippageFraction);
  }
}
