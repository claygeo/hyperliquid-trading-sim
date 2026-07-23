import {
  aggregateFamily,
  deflatedSharpeFamily,
  evaluateTrial,
  normalCdf,
  normalInverseCdf,
  type DsrTrialInput,
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
import {
  BOOTSTRAP_CONFIG,
  FAMILY_DSR_CONFIG,
  TRIAL_GATE_CONFIG,
} from '../research/fourHour/frozenTrials.js';

function passing(id: 'H2' | 'H3' | 'H4'): TrialGateInput {
  return {
    id,
    baseExpectancy: 1,
    stressExpectancy: 0.5,
    adverseBoundaryStressExpectancy: 0.25,
    baseMaxDrawdown: 0.04,
    stressMaxDrawdown: 0.06,
    requiredSleevePnl: id === 'H4' ? [1] : [1, 1],
    halfAdjustedPnl: [1, 1],
    effectiveEpisodes: TRIAL_GATE_CONFIG.minimumEffectiveEpisodes,
    baseAnnualizedSharpe: TRIAL_GATE_CONFIG.minimumAnnualizedDailySharpe,
    baseProfitFactor: TRIAL_GATE_CONFIG.minimumProfitFactor,
    stressAdjustedPnl: 1,
    bootstrapLowerBound: 0.000001,
    dsr: TRIAL_GATE_CONFIG.minimumDsr,
    topFiveConcentration: TRIAL_GATE_CONFIG.maximumTopFiveConcentration,
    assetConcentration: id === 'H4' ? null : TRIAL_GATE_CONFIG.maximumAssetConcentration,
    assetConcentrationApplicable: id !== 'H4',
    requiredSleevesWithExposure: true,
  };
}

function dsrSeries(drift: number): number[] {
  return Array.from({ length: 60 }, (_, index) => (
    drift + (index % 7 - 3) * 0.0004 + (index % 11 === 0 ? -0.0003 : 0)
  ));
}

function validDsrFamily(): DsrTrialInput[] {
  return [
    { id: 'H1', returns: dsrSeries(0.00005) },
    { id: 'H2', returns: dsrSeries(0.00010) },
    { id: 'H3', returns: dsrSeries(0.00015) },
    { id: 'H4', returns: dsrSeries(0.00020) },
  ];
}

describe('four-hour family statistics', () => {
  test('implements deterministic moments, drawdown, episode, and primary concentration formulas', () => {
    expect(returnMoments([-0.01, 0, 0.02])).toMatchObject({
      mean: 0.0033333333333333335,
    });
    expect(maxDrawdown([
      { time: 0, nav: 3_000 },
      { time: 1, nav: 3_300 },
      { time: 1, nav: 2_970 },
    ])).toBeCloseTo(0.1, 12);
    expect(episodeMetrics([
      { startTime: 0, endTime: 1, pnl: 2 },
      { startTime: 2, endTime: 3, pnl: -1 },
    ])).toMatchObject({ expectancy: 0.5, profitFactor: 2, winRate: 0.5 });
    expect(episodeMetrics([{ startTime: 0, endTime: 1, pnl: 1 }]).profitFactor).toBeNull();
    expect(positiveAssetConcentration({ BTC: 3, ETH: 1, HYPE: 1_000 })).toBe(0.75);
  });

  test('reports finite terminal insolvency in drawdown while rejecting malformed anchors', () => {
    expect(maxDrawdown([{ time: 0, nav: 3_000 }, { time: 1, nav: 0 }])).toBe(1);
    expect(maxDrawdown([{ time: 0, nav: 3_000 }, { time: 1, nav: -300 }])).toBe(1.1);
    expect(() => maxDrawdown([{ time: 0, nav: 0 }])).toThrow('anchor NAV must be positive');
    expect(() => maxDrawdown([{ time: 0, nav: 3_000 }, { time: 1, nav: Number.NaN }]))
      .toThrow('must be finite');
    expect(() => episodeMetrics([{ startTime: 1, endTime: 1, pnl: 0 }]))
      .toThrow('timestamps are invalid');
  });

  test('matches frozen xorshift, seed, circular-block, and quantile fixtures', () => {
    expect(trialSeed('H2-CARRY-4H-20260722-001')).toBe(1_760_742_226);
    let state = 1;
    const sequence: number[] = [];
    for (let index = 0; index < 5; index += 1) {
      state = nextXorshift32(state);
      sequence.push(state);
    }
    expect(sequence).toEqual([270_369, 67_634_689, 2_647_435_461, 307_599_695, 2_398_689_233]);

    const returns = Array.from({ length: 21 }, (_, index) => (index % 3 - 1) / 10_000);
    expect(circularBlockBootstrapLowerBound(returns, 'H2-CARRY-4H-20260722-001'))
      .toBe(-0.000014285714285714287);
    expect(Math.floor(
      BOOTSTRAP_CONFIG.familyAlpha * (BOOTSTRAP_CONFIG.replicates - 1),
    )).toBe(BOOTSTRAP_CONFIG.lowerQuantileIndex);
    expect(() => circularBlockBootstrapLowerBound(
      returns,
      'H2-CARRY-4H-20260722-001',
      BOOTSTRAP_CONFIG.replicates - 1,
    )).toThrow('Frozen bootstrap');
  });

  test('matches central and tail normal reference fixtures within absolute 1e-12', () => {
    const inverseFixtures: Array<[number, number]> = [
      [0.025, -1.959963984540054],
      [0.5, 0],
      [0.975, 1.959963984540054],
      [0.000001, -4.753424308822899],
    ];
    const cdfFixtures: Array<[number, number]> = [
      [-5, 2.866515718791933e-7],
      [0, 0.5],
      [1.959963984540054, 0.975],
      [5, 0.9999997133484281],
    ];
    for (const [probability, expected] of inverseFixtures) {
      expect(Math.abs(normalInverseCdf(probability) - expected)).toBeLessThanOrEqual(1e-12);
    }
    for (const [value, expected] of cdfFixtures) {
      expect(Math.abs(normalCdf(value) - expected)).toBeLessThanOrEqual(1e-12);
    }
  });

  test('matches the frozen N=4 DSR numeric fixture', () => {
    const result = deflatedSharpeFamily(validDsrFamily());
    expect(result.available).toBe(true);
    expect(Math.abs(result.sigmaSharpe! - 0.08008914131208039)).toBeLessThanOrEqual(1e-12);
    expect(Math.abs(result.expectedMaxSharpe! - 0.084263613544162)).toBeLessThanOrEqual(1e-12);
    const expectedDsr = [
      0.2012228204610822,
      0.35881530516926907,
      0.5459195630526675,
      0.723267431602473,
    ];
    expect(result.trials).toHaveLength(FAMILY_DSR_CONFIG.trialCount);
    result.trials.forEach((trial, index) => {
      expect(Math.abs(trial.dsr! - expectedDsr[index])).toBeLessThanOrEqual(1e-12);
    });
  });

  test('keeps a completed all-zero attempt in selection while leaving its own DSR null', () => {
    const inputs = validDsrFamily();
    inputs[2] = { id: 'H3', returns: Array(60).fill(0) };
    const result = deflatedSharpeFamily(inputs);
    expect(result.available).toBe(true);
    expect(result.trials[2]).toMatchObject({ id: 'H3', selectionSharpe: 0, dsr: null });
  });

  test('makes DSR unavailable family-wide for every frozen invalid state', () => {
    const short = validDsrFamily();
    short[1] = { id: 'H2', returns: [-0.001, 0.002] };
    const nonFinite = validDsrFamily();
    nonFinite[1] = { id: 'H2', returns: [0.001, Number.NaN, 0.002] };
    const malformed = validDsrFamily();
    malformed[1] = { id: 'H2', returns: null as unknown as number[] };
    const constantNonZero = validDsrFamily();
    constantNonZero[1] = { id: 'H2', returns: Array(60).fill(0.001) };
    const nonPositiveDenominator = validDsrFamily();
    const shift = Math.sqrt(6);
    nonPositiveDenominator[1] = {
      id: 'H2',
      returns: [shift - 0.5, shift - 0.5, shift + 1],
    };

    for (const inputs of [
      short,
      nonFinite,
      malformed,
      constantNonZero,
      nonPositiveDenominator,
    ]) {
      const result = deflatedSharpeFamily(inputs);
      expect(result.available).toBe(false);
      expect(result.sigmaSharpe).toBeNull();
      expect(result.expectedMaxSharpe).toBeNull();
      expect(result.trials.every((trial) => trial.dsr === null)).toBe(true);
    }
  });
});

describe('four-hour family verdicts', () => {
  test('applies every reject gate with strict precedence and threshold equality', () => {
    const exact = {
      ...passing('H2'),
      baseMaxDrawdown: TRIAL_GATE_CONFIG.maximumDrawdown,
      stressMaxDrawdown: TRIAL_GATE_CONFIG.maximumDrawdown,
    };
    expect(evaluateTrial(exact).verdict).toBe('ADVANCE_TO_FORWARD_PAPER');

    const cases: Array<[Partial<TrialGateInput>, string]> = [
      [{ baseExpectancy: 0 }, 'base_expectancy'],
      [{ stressExpectancy: 0 }, 'stress_expectancy'],
      [{ adverseBoundaryStressExpectancy: 0 }, 'boundary_funding_expectancy'],
      [{ baseMaxDrawdown: 0.0800000001 }, 'base_drawdown'],
      [{ stressMaxDrawdown: 0.0800000001 }, 'stress_drawdown'],
      [{ requiredSleevePnl: [-0.000001, 1] }, 'required_sleeve'],
    ];
    for (const [override, reason] of cases) {
      const result = evaluateTrial({ ...passing('H2'), ...override });
      expect(result.verdict).toBe('REJECT');
      expect(result.reasons).toContain(reason);
    }
  });

  test('applies every insufficiency gate and lets exact thresholds pass', () => {
    const cases: Array<[Partial<TrialGateInput>, string]> = [
      [{ effectiveEpisodes: 39 }, 'episodes'],
      [{ baseAnnualizedSharpe: 0.999999 }, 'sharpe'],
      [{ baseProfitFactor: 1.249999 }, 'profit_factor'],
      [{ stressAdjustedPnl: 0 }, 'stress_pnl'],
      [{ bootstrapLowerBound: 0 }, 'bootstrap'],
      [{ dsr: 0.949999 }, 'dsr'],
      [{ halfAdjustedPnl: [-0.000001, 1] }, 'halves'],
      [{ topFiveConcentration: 0.500001 }, 'top_five_concentration'],
      [{ assetConcentration: 0.800001 }, 'asset_concentration'],
      [{ requiredSleevesWithExposure: false }, 'required_sleeve_exposure'],
    ];
    for (const [override, reason] of cases) {
      const result = evaluateTrial({ ...passing('H2'), ...override });
      expect(result.verdict).toBe('INSUFFICIENT');
      expect(result.reasons).toContain(reason);
    }
    expect(evaluateTrial({ ...passing('H4'), assetConcentration: 1 }).verdict)
      .toBe('ADVANCE_TO_FORWARD_PAPER');
  });

  test('classifies non-finite and malformed gate inputs as ERROR before comparisons', () => {
    const numericFields: Array<keyof TrialGateInput> = [
      'baseExpectancy',
      'stressExpectancy',
      'adverseBoundaryStressExpectancy',
      'baseMaxDrawdown',
      'stressMaxDrawdown',
      'effectiveEpisodes',
      'baseAnnualizedSharpe',
      'baseProfitFactor',
      'stressAdjustedPnl',
      'bootstrapLowerBound',
      'dsr',
      'topFiveConcentration',
      'assetConcentration',
    ];
    for (const field of numericFields) {
      const malformed = { ...passing('H2'), [field]: Number.NaN } as TrialGateInput;
      expect(evaluateTrial(malformed).verdict).toBe('ERROR');
    }
    expect(evaluateTrial({ ...passing('H2'), baseExpectancy: Number.POSITIVE_INFINITY }).verdict)
      .toBe('ERROR');
    expect(evaluateTrial({ ...passing('H2'), baseMaxDrawdown: -0.01 }).verdict).toBe('ERROR');
    expect(evaluateTrial({ ...passing('H2'), dsr: 1.01 }).verdict).toBe('ERROR');
    expect(evaluateTrial({ ...passing('H2'), topFiveConcentration: -0.01 }).verdict)
      .toBe('ERROR');
    expect(evaluateTrial({ ...passing('H2'), requiredSleevePnl: [1] }).verdict).toBe('ERROR');
    expect(evaluateTrial({ ...passing('H4'), requiredSleevePnl: [1, 1] }).verdict).toBe('ERROR');
    expect(evaluateTrial({
      ...passing('H2'),
      halfAdjustedPnl: [1] as unknown as [number, number],
    }).verdict).toBe('ERROR');
    expect(evaluateTrial({ ...passing('H2'), assetConcentrationApplicable: false }).verdict)
      .toBe('ERROR');
    expect(evaluateTrial({ ...passing('H2'), effectiveEpisodes: 1.5 }).verdict).toBe('ERROR');
  });

  test('allows null expectancy only for a zero-episode insufficient run', () => {
    const result = evaluateTrial({
      ...passing('H2'),
      effectiveEpisodes: 0,
      baseExpectancy: null,
      stressExpectancy: null,
      adverseBoundaryStressExpectancy: null,
    });
    expect(result.verdict).toBe('INSUFFICIENT');
    expect(result.reasons).toContain('episodes');
    expect(evaluateTrial({ ...passing('H2'), baseExpectancy: null }).verdict).toBe('ERROR');
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
    expect(aggregateFamily([
      { ...h2, verdict: 'UNKNOWN' as never }, h3, h4,
    ])).toEqual({ verdict: 'ERROR', selectedTrial: null });
  });
});
