import {
  aggregateFamily,
  deflatedSharpeFamily,
  evaluateTrial,
  normalCdf,
  normalInverseCdf,
  type TrialGateInput,
} from '../research/fourHour/familyEvaluation.js';
import {
  circularBlockBootstrapLowerBound,
  episodeMetrics,
  maxDrawdown,
  nextXorshift32,
  positiveAssetConcentration,
  returnMoments,
  trialSeed,
} from '../research/fourHour/metrics.js';

function passing(id: 'H2' | 'H3' | 'H4'): TrialGateInput {
  return {
    id,
    baseExpectancy: 1,
    stressExpectancy: 0.5,
    adverseBoundaryStressExpectancy: 0.25,
    baseMaxDrawdown: 0.04,
    stressMaxDrawdown: 0.06,
    requiredSleevePnl: [1, 1],
    halfAdjustedPnl: [1, 1],
    effectiveEpisodes: 40,
    baseAnnualizedSharpe: 1,
    baseProfitFactor: 1.25,
    stressAdjustedPnl: 1,
    bootstrapLowerBound: 0.000001,
    dsr: 0.95,
    topFiveConcentration: 0.5,
    assetConcentration: id === 'H4' ? null : 0.8,
    assetConcentrationApplicable: id !== 'H4',
    requiredSleevesWithExposure: true,
  };
}

describe('four-hour family statistics', () => {
  test('implements deterministic moments, drawdown, and episode formulas', () => {
    expect(returnMoments([-0.01, 0, 0.02])).toMatchObject({ mean: 0.0033333333333333335 });
    expect(maxDrawdown([
      { time: 0, nav: 3_000 },
      { time: 1, nav: 3_300 },
      { time: 1, nav: 2_970 },
    ])).toBeCloseTo(0.1, 12);
    expect(episodeMetrics([{ startTime: 0, endTime: 1, pnl: 2 }, {
      startTime: 2, endTime: 3, pnl: -1,
    }])).toMatchObject({ expectancy: 0.5, profitFactor: 2, winRate: 0.5 });
    expect(episodeMetrics([{ startTime: 0, endTime: 1, pnl: 1 }]).profitFactor).toBeNull();
    expect(positiveAssetConcentration({ BTC: 3, ETH: 1 })).toBe(0.75);
  });

  test('freezes xorshift transition and block bootstrap bytes', () => {
    expect(nextXorshift32(1)).toBe(270369);
    expect(trialSeed('H2-CARRY-4H-20260722-001')).toBe(trialSeed('H2-CARRY-4H-20260722-001'));
    const returns = Array.from({ length: 21 }, (_, index) => (index % 3 - 1) / 10_000);
    expect(circularBlockBootstrapLowerBound(returns, 'H2-CARRY-4H-20260722-001'))
      .toBe(circularBlockBootstrapLowerBound(returns, 'H2-CARRY-4H-20260722-001'));
  });

  test('matches normal reference anchors', () => {
    expect(normalInverseCdf(0.5)).toBeCloseTo(0, 14);
    expect(normalInverseCdf(0.975)).toBeCloseTo(1.959963984540054, 12);
    expect(normalCdf(0)).toBeCloseTo(0.5, 14);
    expect(normalCdf(1.959963984540054)).toBeCloseTo(0.975, 14);
  });

  test('computes DSR only for the frozen family and keeps all-zero attempts null', () => {
    const positive = Array.from({ length: 60 }, (_, index) => (
      index % 5 === 0 ? -0.001 : 0.001
    ));
    const result = deflatedSharpeFamily([
      { id: 'H1', returns: positive },
      { id: 'H2', returns: positive.map((value) => value * 1.1) },
      { id: 'H3', returns: Array(60).fill(0) },
      { id: 'H4', returns: positive.map((value) => value * 0.9) },
    ]);
    expect(result.available).toBe(true);
    expect(result.trials.find((trial) => trial.id === 'H3')?.dsr).toBeNull();
    expect(result.trials.find((trial) => trial.id === 'H2')?.dsr).not.toBeNull();
  });
});

describe('four-hour family verdicts', () => {
  test('applies strict precedence and threshold equalities', () => {
    expect(evaluateTrial(passing('H2')).verdict).toBe('ADVANCE_TO_FORWARD_PAPER');
    expect(evaluateTrial({ ...passing('H2'), baseExpectancy: 0 }).verdict).toBe('REJECT');
    expect(evaluateTrial({ ...passing('H2'), effectiveEpisodes: 39 }).verdict)
      .toBe('INSUFFICIENT');
    expect(evaluateTrial({ ...passing('H4'), assetConcentration: 1 }).verdict)
      .toBe('ADVANCE_TO_FORWARD_PAPER');
  });

  test('aggregates by error precedence and frozen rank rather than return', () => {
    const h2 = evaluateTrial(passing('H2'));
    const h3 = evaluateTrial(passing('H3'));
    const h4 = evaluateTrial(passing('H4'));
    expect(aggregateFamily([h2, h3, h4])).toEqual({
      verdict: 'ADVANCE_TO_FORWARD_PAPER', selectedTrial: 'H2',
    });
    expect(aggregateFamily([
      evaluateTrial({ ...passing('H2'), baseExpectancy: 0 }),
      h3,
      h4,
    ])).toEqual({ verdict: 'ADVANCE_TO_FORWARD_PAPER', selectedTrial: 'H3' });
    expect(aggregateFamily([
      h2,
      evaluateTrial({ ...passing('H3'), error: 'bad data' }),
      h4,
    ])).toEqual({ verdict: 'ERROR', selectedTrial: null });
  });
});
