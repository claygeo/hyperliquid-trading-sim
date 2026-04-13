import { TRADING_CONSTANTS, SLIPPAGE_BPS_PER_10K } from '../../config/constants.js';
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

  calculateMaxDrawdown(pnlHistory: number[]): number {
    if (pnlHistory.length === 0) return 0;

    let peak = pnlHistory[0];
    let maxDrawdown = 0;

    for (const pnl of pnlHistory) {
      if (pnl > peak) {
        peak = pnl;
      }
      const drawdown = peak - pnl;
      if (drawdown > maxDrawdown) {
        maxDrawdown = drawdown;
      }
    }

    return peak > 0 ? (maxDrawdown / peak) * 100 : 0;
  }

  calculateWinRate(trades: Array<{ pnl: number }>): number {
    if (trades.length === 0) return 0;
    const wins = trades.filter((t) => t.pnl > 0).length;
    return (wins / trades.length) * 100;
  }

  calculateProfitFactor(trades: Array<{ pnl: number }>): number {
    const grossProfit = trades
      .filter((t) => t.pnl > 0)
      .reduce((sum, t) => sum + t.pnl, 0);
    const grossLoss = Math.abs(
      trades.filter((t) => t.pnl < 0).reduce((sum, t) => sum + t.pnl, 0)
    );
    return grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0;
  }

  calculateFee(notional: number, feeRate: number): number {
    return notional * feeRate;
  }

  // Simplified linear slippage: 0.05% per $10k notional.
  // Direction: buys slip up, sells slip down.
  applySlippage(price: number, notional: number, side: OrderSide): number {
    const slippageBps = (notional / 10_000) * SLIPPAGE_BPS_PER_10K;
    const slippageFraction = slippageBps / 10_000;
    if (side === 'long') {
      return price * (1 + slippageFraction);
    }
    return price * (1 - slippageFraction);
  }
}
