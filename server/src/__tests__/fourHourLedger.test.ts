import {
  FOUR_HOUR_MS,
  HOUR_MS,
  type AcceptedSchedule,
  type DirectionalSignal,
  type FourHourCandle,
  type HourlyFunding,
  type MarketSymbol,
  type PerpAsset,
  type ScheduledPosition,
  type ValidatedFamilyData,
} from '../research/fourHour/contracts.js';
import {
  BASE_COSTS,
  H2_CONFIG,
  H3_CONFIG,
  STRESS_COSTS,
  type FrozenTrialConfig,
} from '../research/fourHour/frozenTrials.js';
import {
  entryCostsForPosition,
  replayAcceptedCostCases,
  replayAcceptedSchedule,
  replayAdverseBoundarySchedule,
} from '../research/fourHour/ledger.js';
import {
  buildAcceptedSchedule,
  decideStressAdmissions,
} from '../research/fourHour/schedule.js';

const START = Date.parse('2025-07-22T00:00:00.000Z');

function candles(
  symbol: MarketSymbol,
  opens: readonly number[],
  closes: readonly number[] = opens,
  highs?: readonly number[],
  lows?: readonly number[],
): FourHourCandle[] {
  if (opens.length !== closes.length) throw new Error('Fixture arrays are not aligned');
  return opens.map((open, index) => ({
    symbol,
    interval: '4h',
    openTime: START + index * FOUR_HOUR_MS,
    closeTime: START + (index + 1) * FOUR_HOUR_MS - 1,
    open,
    high: highs?.[index] ?? Math.max(open, closes[index]),
    low: lows?.[index] ?? Math.min(open, closes[index]),
    close: closes[index],
    volume: 100,
  }));
}

function funding(
  asset: PerpAsset,
  bars: number,
  rates: Readonly<Record<number, number>> = {},
): HourlyFunding[] {
  return Array.from({ length: bars * 4 }, (_, index) => ({
    coin: asset,
    time: START + index * HOUR_MS,
    rate: rates[index] ?? 0,
  }));
}

function fixtureData(
  bars: number,
  overrides: Partial<Record<MarketSymbol, FourHourCandle[]>> = {},
  fundingRates: Partial<Record<PerpAsset, Readonly<Record<number, number>>>> = {},
): ValidatedFamilyData {
  const flat = Array.from({ length: bars }, () => 100);
  const withWarmup = (symbol: MarketSymbol, values: FourHourCandle[]): FourHourCandle[] => {
    const first = values[0];
    if (!first) throw new Error(`Missing ${symbol} fixture candles`);
    const warmup = [-2, -1].map((offset) => ({
      symbol,
      interval: '4h' as const,
      openTime: START + offset * FOUR_HOUR_MS,
      closeTime: START + (offset + 1) * FOUR_HOUR_MS - 1,
      open: first.open,
      high: first.open,
      low: first.open,
      close: first.open,
      volume: 100,
    }));
    return [...warmup, ...values];
  };
  return {
    candles: {
      BTC: withWarmup('BTC', overrides.BTC ?? candles('BTC', flat)),
      ETH: withWarmup('ETH', overrides.ETH ?? candles('ETH', flat)),
      HYPE: withWarmup('HYPE', overrides.HYPE ?? candles('HYPE', flat)),
      '@142': withWarmup('@142', overrides['@142'] ?? candles('@142', flat)),
      '@151': withWarmup('@151', overrides['@151'] ?? candles('@151', flat)),
    },
    funding: {
      BTC: funding('BTC', bars, fundingRates.BTC),
      ETH: funding('ETH', bars, fundingRates.ETH),
      HYPE: funding('HYPE', bars, fundingRates.HYPE),
    },
    spotPairs: {},
  };
}

function positionId(
  trial: Readonly<FrozenTrialConfig>,
  asset: PerpAsset,
  entryBar: number,
): string {
  const decisionTime = START + (entryBar - 1) * FOUR_HOUR_MS;
  return `${trial.trialId}:${asset}:${decisionTime}`;
}

function directionalPosition(
  asset: PerpAsset,
  entryBar: number,
  signedUnits: number,
  entryPrice = 100,
  trial: Readonly<FrozenTrialConfig> = H3_CONFIG,
): ScheduledPosition {
  const decisionTime = START + (entryBar - 1) * FOUR_HOUR_MS;
  return {
    id: positionId(trial, asset, entryBar),
    trialId: trial.trialId,
    strategy: trial.id,
    asset,
    signalIndex: entryBar,
    decisionTime,
    entryTime: START + entryBar * FOUR_HOUR_MS,
    exitTime: START + (entryBar + trial.holdBars) * FOUR_HOUR_MS,
    entryGross: Math.abs(signedUnits) * entryPrice,
    legs: [{
      instrument: asset === 'BTC' ? 'BTC-PERP' : asset === 'ETH' ? 'ETH-PERP' : 'HYPE-PERP',
      market: 'perp',
      asset,
      signedUnits,
      entryReferencePrice: entryPrice,
    }],
  };
}

function schedule(
  positions: ScheduledPosition[],
  trial: Readonly<FrozenTrialConfig> = H3_CONFIG,
): AcceptedSchedule {
  return { trialId: trial.trialId, positions, skipped: [] };
}

function signal(asset: PerpAsset, decisionBar: number): DirectionalSignal {
  const signalIndex = decisionBar + 1;
  return {
    strategy: 'H3',
    asset,
    signalIndex,
    decisionTime: START + decisionBar * FOUR_HOUR_MS,
    entryIndex: signalIndex + H3_CONFIG.executionDelayBars,
    exitIndex: signalIndex + H3_CONFIG.executionDelayBars + H3_CONFIG.holdBars,
    direction: 1,
    score: 4,
  };
}

describe('frozen stress schedule', () => {
  test('admits atomic positions in BTC then ETH order using projected stressed costs', () => {
    const btc = directionalPosition('BTC', 1, 7.5);
    const eth = directionalPosition('ETH', 1, 7.5);
    const oneOnly = decideStressAdmissions([eth, btc], {
      stressNavBeforeBatch: 1_500,
      retainedMarkedGross: 0,
      entryGrossCap: 1_500,
    });
    expect(oneOnly.admitted.map((position) => position.asset)).toEqual(['BTC']);
    expect(oneOnly.rejected).toEqual([{ position: eth, reason: 'capacity' }]);
    expect(oneOnly.admittedEntryCosts).toBeCloseTo(750 * (0.00045 + 0.0005) * 2, 12);
    expect(oneOnly.projectedStressNav).toBeCloseTo(1_498.575, 12);

    const neither = decideStressAdmissions([btc], {
      stressNavBeforeBatch: 1,
      retainedMarkedGross: 0,
      entryGrossCap: 1_500,
    });
    expect(neither.admitted).toHaveLength(0);
    expect(neither.rejected[0].reason).toBe('non_positive_nav');
  });

  test('enforces pending/open overlap, exact holds, exit-before-decision ordering, and window end', () => {
    const bars = 16;
    const result = buildAcceptedSchedule({
      trial: H3_CONFIG,
      portfolio: 'primary',
      signals: [
        signal('BTC', 0),
        signal('BTC', 1), // ignored while first signal is pending
        signal('BTC', 4), // ignored before the position exits at this boundary
        signal('BTC', 5), // newly flat, accepted
        signal('ETH', 0), // simultaneous independent primary slot
        signal('ETH', 12), // exit would equal the exclusive end
      ],
      data: fixtureData(bars),
      window: { startTime: START, endTime: START + bars * FOUR_HOUR_MS },
    });
    expect(result.schedule.positions.map((position) => [
      position.asset,
      (position.entryTime - START) / FOUR_HOUR_MS,
      (position.exitTime - position.entryTime) / FOUR_HOUR_MS,
    ])).toEqual([
      ['BTC', 1, 3],
      ['ETH', 1, 3],
      ['BTC', 6, 3],
    ]);
    expect(result.schedule.skipped).toEqual(expect.arrayContaining([
      expect.objectContaining({ asset: 'BTC', decisionTime: START + FOUR_HOUR_MS, reason: 'pending_or_open' }),
      expect.objectContaining({ asset: 'BTC', decisionTime: START + 4 * FOUR_HOUR_MS, reason: 'pending_or_open' }),
      expect.objectContaining({ asset: 'ETH', reason: 'window_end' }),
    ]));
    expect(result.stressController.completedPositions).toHaveLength(3);
    expect(result.stressController.episodes).toHaveLength(2);
    expect(result.stressController.termination).toBeNull();
  });

  test('skips a terminal signal before reading an entry candle beyond the window', () => {
    const bars = 4;
    const result = buildAcceptedSchedule({
      trial: H3_CONFIG,
      portfolio: 'primary',
      signals: [signal('ETH', 3)],
      data: fixtureData(bars),
      window: { startTime: START, endTime: START + bars * FOUR_HOUR_MS },
    });
    expect(result.schedule.positions).toEqual([]);
    expect(result.schedule.skipped).toEqual([
      expect.objectContaining({ asset: 'ETH', reason: 'window_end' }),
    ]);
  });

  test('terminates rather than throwing when normal exit costs exhaust stress NAV', () => {
    const bars = 8;
    const gapOpen = 499.6766666666667;
    const data = fixtureData(bars, {
      BTC: candles(
        'BTC',
        [100, 100, 100, 100, gapOpen, gapOpen, gapOpen, gapOpen],
        [100, 100, 100, 100, gapOpen, gapOpen, gapOpen, gapOpen],
      ),
    });
    const shortSignal = { ...signal('BTC', 0), direction: -1 as const };
    expect(() => buildAcceptedSchedule({
      trial: H3_CONFIG,
      portfolio: 'primary',
      signals: [shortSignal, signal('ETH', 3)],
      data,
      window: { startTime: START, endTime: START + bars * FOUR_HOUR_MS },
    })).not.toThrow();
    const result = buildAcceptedSchedule({
      trial: H3_CONFIG,
      portfolio: 'primary',
      signals: [shortSignal, signal('ETH', 3)],
      data,
      window: { startTime: START, endTime: START + bars * FOUR_HOUR_MS },
    });
    expect(result.stressController.termination).toMatchObject({
      time: START + 4 * FOUR_HOUR_MS,
      phase: 'execution_batch',
      reason: 'non_positive_nav',
    });
    expect(result.schedule.skipped).toContainEqual(
      expect.objectContaining({ asset: 'ETH', reason: 'non_positive_nav' }),
    );
  });

  test('rejects non-finite admission economics before comparisons', () => {
    const tampered = { ...directionalPosition('BTC', 1, 7.5), entryGross: Number.NaN };
    expect(() => decideStressAdmissions([tampered], {
      stressNavBeforeBatch: 3_000,
      retainedMarkedGross: 0,
      entryGrossCap: 1_500,
    })).toThrow(/entry gross must be finite and positive/);
  });
});

describe('four-hour ledger accounting', () => {
  test('replays byte-identical units with signed perpetual PnL and exactly doubled costs', () => {
    const data = fixtureData(8, {
      BTC: candles('BTC', [100, 100, 110, 110, 110, 110, 110, 110]),
      ETH: candles('ETH', [100, 100, 90, 90, 90, 90, 90, 90]),
    });
    const positions = [
      directionalPosition('BTC', 0, 7.5),
      directionalPosition('ETH', 0, -7.5),
    ];
    const result = replayAcceptedCostCases({
      schedule: schedule(positions),
      data,
      window: { startTime: START, endTime: START + 8 * FOUR_HOUR_MS },
    });
    expect(result.base.completedPositions.map((position) => position.id))
      .toEqual(result.stress.completedPositions.map((position) => position.id));
    expect(result.base.pricePnl).toBeCloseTo(150, 12);
    expect(result.base.fees).toBeCloseTo(7.5 * (100 + 110 + 100 + 90) * 0.00045, 12);
    expect(result.base.slippage).toBeCloseTo(7.5 * (100 + 110 + 100 + 90) * 0.0005, 12);
    expect(result.stress.fees).toBeCloseTo(result.base.fees * 2, 12);
    expect(result.stress.slippage).toBeCloseTo(result.base.slippage * 2, 12);
    expect(result.base.adjustedPnl).toBeCloseTo(
      150 - result.base.fees - result.base.slippage,
      12,
    );
  });

  test('accounts for spot principal once and keeps pair price PnL separate from costs', () => {
    const bars = 48;
    const data = fixtureData(bars, {
      BTC: candles('BTC', Array.from({ length: bars }, (_, index) => (index < 42 ? 101 : 111))),
      '@142': candles('@142', Array.from({ length: bars }, (_, index) => (index < 42 ? 100 : 110))),
    });
    const units = H2_CONFIG.perLegNotionalCap / 101;
    const position: ScheduledPosition = {
      id: positionId(H2_CONFIG, 'BTC', 0),
      trialId: H2_CONFIG.trialId,
      strategy: 'H2',
      asset: 'BTC',
      signalIndex: 0,
      decisionTime: START - FOUR_HOUR_MS,
      entryTime: START,
      exitTime: START + H2_CONFIG.holdBars * FOUR_HOUR_MS,
      entryGross: units * 201,
      legs: [
        { instrument: 'UBTC-SPOT', market: 'spot', asset: 'BTC', signedUnits: units, entryReferencePrice: 100 },
        { instrument: 'BTC-PERP', market: 'perp', asset: 'BTC', signedUnits: -units, entryReferencePrice: 101 },
      ],
    };
    const result = replayAcceptedSchedule({
      schedule: schedule([position], H2_CONFIG),
      data,
      window: { startTime: START, endTime: START + bars * FOUR_HOUR_MS },
      costs: BASE_COSTS,
    });
    const expectedFee = units * ((100 + 110) * 0.00070 + (101 + 111) * 0.00045);
    const expectedSlippage = units * (100 + 110 + 101 + 111) * 0.00050;
    expect(result.pricePnl).toBeCloseTo(0, 12);
    expect(result.fees).toBeCloseTo(expectedFee, 12);
    expect(result.slippage).toBeCloseTo(expectedSlippage, 12);
    expect(result.cash).toBeCloseTo(3_000 - expectedFee - expectedSlippage, 12);
    expect(result.endingNav).toBeCloseTo(result.cash, 12);
    expect(result.pnlByAsset.BTC.adjustedPnl).toBeCloseTo(-expectedFee - expectedSlippage, 12);
  });

  test('uses low for a funding credit, high for a debit, and books all events before the close mark', () => {
    const high = Array.from({ length: 8 }, () => 120);
    const low = Array.from({ length: 8 }, () => 90);
    const flat = Array.from({ length: 8 }, () => 100);
    const data = fixtureData(8, {
      BTC: candles('BTC', flat, flat, high, low),
      ETH: candles('ETH', flat, flat, high, low),
    }, {
      BTC: { 1: 0.01 }, // short receives +0.90
      ETH: { 1: 0.01 }, // long pays -1.20
    });
    const positions = [
      directionalPosition('BTC', 0, -7.5),
      directionalPosition('ETH', 0, 7.5),
    ];
    const result = replayAcceptedSchedule({
      schedule: schedule(positions),
      data,
      window: { startTime: START, endTime: START + 8 * FOUR_HOUR_MS },
      costs: BASE_COSTS,
    });
    expect(result.funding).toBeCloseTo(-2.25, 12);
    expect(result.completedPositions.find((item) => item.id === positionId(H3_CONFIG, 'BTC', 0))?.funding)
      .toBeCloseTo(6.75, 12);
    expect(result.completedPositions.find((item) => item.id === positionId(H3_CONFIG, 'ETH', 0))?.funding)
      .toBeCloseTo(-9, 12);
    const atFirstClose = result.events.filter((event) => event.time === START + FOUR_HOUR_MS);
    const firstMark = atFirstClose.findIndex((event) => event.kind === 'mark');
    expect(firstMark).toBeGreaterThan(0);
    expect(atFirstClose.slice(0, firstMark).every((event) => event.kind === 'funding')).toBe(true);
    expect(atFirstClose.filter((event) => event.kind === 'funding')).toEqual(expect.arrayContaining([
      expect.objectContaining({
        positionId: positionId(H3_CONFIG, 'BTC', 0),
        fundingTime: START + HOUR_MS,
        fundingRate: 0.01,
        oracleProxy: 90,
      }),
      expect.objectContaining({
        positionId: positionId(H3_CONFIG, 'ETH', 0),
        fundingTime: START + HOUR_MS,
        fundingRate: 0.01,
        oracleProxy: 120,
      }),
    ]));
  });

  test('replays adverse entry/exit boundary debits without changing the accepted schedule', () => {
    const flat = Array.from({ length: 8 }, () => 100);
    const highs = [120, 130, 140, 140, 150, 150, 150, 150];
    const data = fixtureData(8, {
      BTC: candles('BTC', flat, flat, highs, Array.from({ length: 8 }, () => 90)),
    }, {
      BTC: { 0: 0.01, 12: 0.02 },
    });
    const accepted = schedule([directionalPosition('BTC', 0, 7.5)]);
    const ordinaryStress = replayAcceptedSchedule({
      schedule: accepted,
      data,
      window: { startTime: START, endTime: START + 8 * FOUR_HOUR_MS },
      costs: STRESS_COSTS,
    });
    const adverse = replayAdverseBoundarySchedule({
      schedule: accepted,
      data,
      window: { startTime: START, endTime: START + 8 * FOUR_HOUR_MS },
    });
    expect(ordinaryStress.funding).toBe(0);
    expect(adverse.funding).toBeCloseTo(-9 - 21, 12);
    expect(adverse.adjustedPnl - ordinaryStress.adjustedPnl).toBeCloseTo(-30, 12);
    expect(adverse.completedPositions.map((position) => position.id))
      .toEqual([positionId(H3_CONFIG, 'BTC', 0)]);
    expect(adverse.completedPositions[0].funding).toBeCloseTo(-30, 12);
    expect(adverse.episodes[0].pnl - ordinaryStress.episodes[0].pnl).toBeCloseTo(-30, 12);
    expect(adverse.events.filter((event) => event.kind === 'boundary_funding_debit')).toHaveLength(2);
  });

  test('orders exits before entries while preserving a same-batch rotation as one episode', () => {
    const data = fixtureData(10);
    const positions = [
      directionalPosition('BTC', 0, 7.5),
      directionalPosition('ETH', 3, 7.5),
    ];
    const result = replayAcceptedSchedule({
      schedule: schedule(positions),
      data,
      window: { startTime: START, endTime: START + 10 * FOUR_HOUR_MS },
      costs: BASE_COSTS,
    });
    const rotationTime = START + 3 * FOUR_HOUR_MS;
    const executionKinds = result.events
      .filter((event) => event.time === rotationTime && ['exit', 'entry'].includes(event.kind))
      .map((event) => event.kind);
    expect(executionKinds).toEqual(['exit', 'entry']);
    expect(result.episodes).toHaveLength(1);
    expect(result.episodes[0].startTime).toBe(START);
    expect(result.episodes[0].endTime).toBe(START + 6 * FOUR_HOUR_MS);
    expect(result.episodes[0].pnl).toBeCloseTo(result.adjustedPnl, 12);
  });

  test('force-closes on the first non-positive close mark and truncates future positions', () => {
    const btcOpens = [100, 100, 600, 600, 600, 600, 600, 600];
    const data = fixtureData(8, {
      BTC: candles('BTC', btcOpens, [100, 600, 600, 600, 600, 600, 600, 600]),
      ETH: candles('ETH', Array.from({ length: 8 }, () => 100)),
    });
    const first = directionalPosition('BTC', 1, -7.5);
    const future = directionalPosition('ETH', 4, 7.5);
    const result = replayAcceptedSchedule({
      schedule: schedule([first, future]),
      data,
      window: { startTime: START, endTime: START + 8 * FOUR_HOUR_MS },
      costs: STRESS_COSTS,
    });
    expect(result.termination).toMatchObject({
      time: START + 2 * FOUR_HOUR_MS,
      phase: 'completed_close',
      reason: 'non_positive_nav',
      reference: 'close',
    });
    expect(result.completedPositions).toEqual([
      expect.objectContaining({
        id: positionId(H3_CONFIG, 'BTC', 1),
        forced: true,
        exitTime: START + 2 * FOUR_HOUR_MS,
      }),
    ]);
    expect(result.truncatedPositionIds).toEqual([positionId(H3_CONFIG, 'ETH', 4)]);
    expect(result.episodes).toHaveLength(1);
    expect(result.endingNav).toBeLessThanOrEqual(0);
  });

  test('records an unexecuted same-boundary entry as truncated at a pre-execution stop', () => {
    const data = fixtureData(8);
    const pending = directionalPosition('ETH', 1, 7.5);
    const stopTime = START + FOUR_HOUR_MS;
    const result = replayAcceptedSchedule({
      schedule: schedule([pending]),
      data,
      window: { startTime: START, endTime: START + 8 * FOUR_HOUR_MS },
      costs: BASE_COSTS,
      sharedStop: { time: stopTime, phase: 'current_open', reference: 'open' },
    });
    expect(result.completedPositions).toEqual([]);
    expect(result.truncatedPositionIds).toEqual([pending.id]);
    expect(result.termination).toMatchObject({ time: stopTime, phase: 'shared_stop' });
  });

  test('rejects tampered schedule identity, chronology, quantity, and non-finite gross', () => {
    const data = fixtureData(8);
    const valid = directionalPosition('BTC', 1, 7.5);
    const input = (position: ScheduledPosition) => ({
      schedule: schedule([position]),
      data,
      window: { startTime: START, endTime: START + 8 * FOUR_HOUR_MS },
      costs: BASE_COSTS,
    });
    expect(() => replayAcceptedSchedule(input({ ...valid, strategy: 'H4' })))
      .toThrow(/does not belong/);
    expect(() => replayAcceptedSchedule(input({ ...valid, exitTime: valid.exitTime + FOUR_HOUR_MS })))
      .toThrow(/holding chronology/);
    expect(() => replayAcceptedSchedule(input({
      ...valid,
      entryGross: 700,
      legs: [{ ...valid.legs[0], signedUnits: 7 }],
    }))).toThrow(/frozen H3 quantity economics/);
    expect(() => replayAcceptedSchedule(input({ ...valid, entryGross: Number.NaN })))
      .toThrow(/entry gross must be finite/);
    expect(() => replayAcceptedSchedule(input({ ...valid, signalIndex: valid.signalIndex + 1 })))
      .toThrow(/Missing or invalid BTC candle/);
  });

  test('computes entry cost exactly once from immutable reference notionals', () => {
    const position = directionalPosition('BTC', 1, -7.5);
    const base = entryCostsForPosition(position, BASE_COSTS);
    const stress = entryCostsForPosition(position, STRESS_COSTS);
    expect(base.notional).toBe(750);
    expect(base.fee).toBeCloseTo(0.3375, 15);
    expect(base.slippage).toBeCloseTo(0.375, 15);
    expect(stress.total).toBeCloseTo(base.total * 2, 15);
  });
});
