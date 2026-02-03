import { PnlCalculator } from '../services/trading/pnlCalculator';

describe('PnlCalculator', () => {
  let calc: PnlCalculator;

  beforeEach(() => {
    calc = new PnlCalculator();
  });

  describe('calculatePnl', () => {
    it('calculates profit on a long position when price goes up', () => {
      const pnl = calc.calculatePnl(50000, 52000, 1, 'long');
      expect(pnl).toBe(2000);
    });

    it('calculates loss on a long position when price goes down', () => {
      const pnl = calc.calculatePnl(50000, 48000, 1, 'long');
      expect(pnl).toBe(-2000);
    });

    it('calculates profit on a short position when price goes down', () => {
      const pnl = calc.calculatePnl(50000, 48000, 1, 'short');
      expect(pnl).toBe(2000);
    });

    it('calculates loss on a short position when price goes up', () => {
      const pnl = calc.calculatePnl(50000, 52000, 1, 'short');
      expect(pnl).toBe(-2000);
    });

    it('scales PnL by position size', () => {
      const pnl = calc.calculatePnl(50000, 51000, 0.5, 'long');
      expect(pnl).toBe(500);
    });

    it('returns 0 PnL when price is unchanged', () => {
      const pnl = calc.calculatePnl(50000, 50000, 1, 'long');
      expect(pnl).toBe(0);
    });

    it('handles small fractional sizes correctly', () => {
      const pnl = calc.calculatePnl(100, 110, 0.001, 'long');
      expect(pnl).toBeCloseTo(0.01, 5);
    });

    it('handles very large position sizes', () => {
      const pnl = calc.calculatePnl(50000, 50100, 100, 'long');
      expect(pnl).toBe(10000);
    });
  });

  describe('calculatePnlPercent', () => {
    it('calculates percentage gain for long position', () => {
      const pct = calc.calculatePnlPercent(50000, 51000, 'long', 1);
      expect(pct).toBe(2); // 2% gain
    });

    it('calculates percentage loss for long position', () => {
      const pct = calc.calculatePnlPercent(50000, 49000, 'long', 1);
      expect(pct).toBe(-2); // 2% loss
    });

    it('multiplies percentage by leverage', () => {
      const pct = calc.calculatePnlPercent(50000, 51000, 'long', 10);
      expect(pct).toBe(20); // 2% * 10x = 20%
    });

    it('calculates leveraged short PnL percent', () => {
      const pct = calc.calculatePnlPercent(50000, 49000, 'short', 5);
      expect(pct).toBe(10); // 2% * 5x = 10%
    });

    it('returns 0 when price unchanged', () => {
      const pct = calc.calculatePnlPercent(50000, 50000, 'long', 10);
      expect(pct).toBe(0);
    });

    it('calculates correct PnL percent for high leverage short loss', () => {
      // Price goes up 1% on short at 50x = -50% ROE
      const pct = calc.calculatePnlPercent(50000, 50500, 'short', 50);
      expect(pct).toBe(-50);
    });
  });

  describe('calculateLiquidationPrice', () => {
    it('calculates liquidation price below entry for long', () => {
      const liqPrice = calc.calculateLiquidationPrice(50000, 10, 'long');
      expect(liqPrice).toBeLessThan(50000);
    });

    it('calculates liquidation price above entry for short', () => {
      const liqPrice = calc.calculateLiquidationPrice(50000, 10, 'short');
      expect(liqPrice).toBeGreaterThan(50000);
    });

    it('tightens liquidation price with higher leverage', () => {
      const liq10x = calc.calculateLiquidationPrice(50000, 10, 'long');
      const liq50x = calc.calculateLiquidationPrice(50000, 50, 'long');
      // Higher leverage = liquidation price is closer to entry
      expect(liq50x).toBeGreaterThan(liq10x);
    });

    it('at 1x long leverage, liquidation is far from entry', () => {
      const liqPrice = calc.calculateLiquidationPrice(50000, 1, 'long');
      // At 1x, (1 - 0.05) / 1 = 0.95 => entry * (1 - 0.95) = entry * 0.05
      expect(liqPrice).toBeCloseTo(50000 * 0.05, 5);
    });

    it('respects custom maintenance margin', () => {
      const defaultLiq = calc.calculateLiquidationPrice(50000, 10, 'long');
      const customLiq = calc.calculateLiquidationPrice(50000, 10, 'long', 0.1);
      // Higher maintenance margin = different liquidation price
      expect(customLiq).not.toBe(defaultLiq);
    });
  });

  describe('calculateMargin', () => {
    it('calculates margin as notional / leverage', () => {
      const margin = calc.calculateMargin(1, 50000, 10);
      expect(margin).toBe(5000);
    });

    it('calculates full margin at 1x leverage', () => {
      const margin = calc.calculateMargin(1, 50000, 1);
      expect(margin).toBe(50000);
    });

    it('calculates small margin at max leverage', () => {
      const margin = calc.calculateMargin(1, 50000, 50);
      expect(margin).toBe(1000);
    });
  });

  describe('calculateNotionalValue', () => {
    it('calculates notional as size * price', () => {
      expect(calc.calculateNotionalValue(1, 50000)).toBe(50000);
    });

    it('handles fractional sizes', () => {
      expect(calc.calculateNotionalValue(0.5, 50000)).toBe(25000);
    });
  });

  describe('shouldLiquidate', () => {
    it('returns true when long price hits liquidation', () => {
      expect(calc.shouldLiquidate(50000, 45000, 45500, 'long')).toBe(true);
    });

    it('returns false when long price is above liquidation', () => {
      expect(calc.shouldLiquidate(50000, 49000, 45500, 'long')).toBe(false);
    });

    it('returns true when short price hits liquidation', () => {
      expect(calc.shouldLiquidate(50000, 55500, 55000, 'short')).toBe(true);
    });

    it('returns false when short price is below liquidation', () => {
      expect(calc.shouldLiquidate(50000, 51000, 55000, 'short')).toBe(false);
    });

    it('returns true at exact liquidation price for long', () => {
      expect(calc.shouldLiquidate(50000, 45500, 45500, 'long')).toBe(true);
    });

    it('returns true at exact liquidation price for short', () => {
      expect(calc.shouldLiquidate(50000, 55000, 55000, 'short')).toBe(true);
    });
  });

  describe('calculateMaxDrawdown', () => {
    it('returns 0 for empty history', () => {
      expect(calc.calculateMaxDrawdown([])).toBe(0);
    });

    it('returns 0 for monotonically increasing PnL', () => {
      expect(calc.calculateMaxDrawdown([100, 200, 300, 400])).toBe(0);
    });

    it('calculates drawdown for simple peak-to-trough', () => {
      // Peak at 1000, drops to 600 = 40% drawdown
      const dd = calc.calculateMaxDrawdown([500, 1000, 600]);
      expect(dd).toBe(40);
    });

    it('finds the largest drawdown in multiple drops', () => {
      // First drop: 100 -> 80 = 20%, Second drop: 120 -> 60 = 50%
      const dd = calc.calculateMaxDrawdown([100, 80, 120, 60]);
      expect(dd).toBe(50);
    });

    it('returns 0 when PnL is flat', () => {
      expect(calc.calculateMaxDrawdown([100, 100, 100])).toBe(0);
    });
  });

  describe('calculateWinRate', () => {
    it('returns 0 for empty trades', () => {
      expect(calc.calculateWinRate([])).toBe(0);
    });

    it('returns 100 for all winning trades', () => {
      expect(calc.calculateWinRate([{ pnl: 100 }, { pnl: 50 }])).toBe(100);
    });

    it('returns 0 for all losing trades', () => {
      expect(calc.calculateWinRate([{ pnl: -100 }, { pnl: -50 }])).toBe(0);
    });

    it('calculates correct win rate for mixed trades', () => {
      const trades = [{ pnl: 100 }, { pnl: -50 }, { pnl: 200 }, { pnl: -30 }];
      expect(calc.calculateWinRate(trades)).toBe(50);
    });

    it('does not count breakeven trades as wins', () => {
      const trades = [{ pnl: 0 }, { pnl: 100 }];
      expect(calc.calculateWinRate(trades)).toBe(50);
    });
  });

  describe('calculateProfitFactor', () => {
    it('returns 0 for empty trades', () => {
      expect(calc.calculateProfitFactor([])).toBe(0);
    });

    it('returns Infinity when no losses exist', () => {
      expect(calc.calculateProfitFactor([{ pnl: 100 }, { pnl: 200 }])).toBe(Infinity);
    });

    it('returns 0 when only losses exist', () => {
      expect(calc.calculateProfitFactor([{ pnl: -100 }, { pnl: -200 }])).toBe(0);
    });

    it('calculates correct profit factor for mixed trades', () => {
      // Gross profit = 300, Gross loss = 100 => PF = 3.0
      const trades = [{ pnl: 200 }, { pnl: -100 }, { pnl: 100 }];
      expect(calc.calculateProfitFactor(trades)).toBe(3);
    });

    it('returns 1 when profit equals loss', () => {
      const trades = [{ pnl: 100 }, { pnl: -100 }];
      expect(calc.calculateProfitFactor(trades)).toBe(1);
    });
  });
});
