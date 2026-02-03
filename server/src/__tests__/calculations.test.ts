import {
  calculatePnl,
  calculatePnlPercent,
  calculateLiquidationPrice,
  calculateMargin,
  calculateNotionalValue,
  roundToDecimals,
} from '../utils/calculations';

describe('Calculation Utilities', () => {
  describe('calculatePnl', () => {
    it('matches PnlCalculator output for long positions', () => {
      expect(calculatePnl(50000, 52000, 1, 'long')).toBe(2000);
      expect(calculatePnl(50000, 48000, 1, 'long')).toBe(-2000);
    });

    it('matches PnlCalculator output for short positions', () => {
      expect(calculatePnl(50000, 48000, 1, 'short')).toBe(2000);
      expect(calculatePnl(50000, 52000, 1, 'short')).toBe(-2000);
    });
  });

  describe('calculatePnlPercent', () => {
    it('calculates leveraged percentage correctly', () => {
      expect(calculatePnlPercent(50000, 51000, 'long', 10)).toBe(20);
      expect(calculatePnlPercent(50000, 49000, 'short', 5)).toBe(10);
    });
  });

  describe('calculateLiquidationPrice', () => {
    it('long liquidation is below entry', () => {
      const liqPrice = calculateLiquidationPrice(50000, 10, 'long');
      expect(liqPrice).toBeLessThan(50000);
      expect(liqPrice).toBeGreaterThan(0);
    });

    it('short liquidation is above entry', () => {
      const liqPrice = calculateLiquidationPrice(50000, 10, 'short');
      expect(liqPrice).toBeGreaterThan(50000);
    });

    it('higher leverage = tighter liquidation', () => {
      const liq5x = calculateLiquidationPrice(50000, 5, 'long');
      const liq50x = calculateLiquidationPrice(50000, 50, 'long');
      expect(liq50x).toBeGreaterThan(liq5x);
    });
  });

  describe('calculateMargin', () => {
    it('returns size * price / leverage', () => {
      expect(calculateMargin(1, 50000, 10)).toBe(5000);
      expect(calculateMargin(2, 3000, 5)).toBe(1200);
    });
  });

  describe('calculateNotionalValue', () => {
    it('returns size * price', () => {
      expect(calculateNotionalValue(1, 50000)).toBe(50000);
      expect(calculateNotionalValue(0.5, 3000)).toBe(1500);
    });
  });

  describe('roundToDecimals', () => {
    it('rounds to specified decimal places', () => {
      expect(roundToDecimals(1.23456789, 2)).toBe(1.23);
      expect(roundToDecimals(1.23456789, 4)).toBe(1.2346);
      expect(roundToDecimals(1.5, 0)).toBe(2);
    });

    it('handles zero decimals', () => {
      expect(roundToDecimals(99.9, 0)).toBe(100);
    });

    it('preserves exact values when no rounding needed', () => {
      expect(roundToDecimals(1.5, 2)).toBe(1.5);
    });
  });
});
