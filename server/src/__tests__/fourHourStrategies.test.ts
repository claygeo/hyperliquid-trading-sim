import {
  FOUR_HOUR_MS,
  HOUR_MS,
  type FourHourCandle,
  type HourlyFunding,
  type MarketSymbol,
  type PerpAsset,
} from '../research/fourHour/contracts.js';
import { H2_CONFIG, H3_CONFIG, H4_CONFIG } from '../research/fourHour/frozenTrials.js';
import {
  fitOlsWithIntercept,
  logReturn,
  median,
  robustScore,
} from '../research/fourHour/indicators.js';
import { h2CarrySignal } from '../research/fourHour/strategies/h2Carry.js';
import { h3ShockReversalSignal } from '../research/fourHour/strategies/h3ShockReversal.js';
import { h4BtcLagSignal } from '../research/fourHour/strategies/h4BtcLag.js';

const TEST_START = Date.parse('2025-01-01T00:00:00.000Z');

function candle(
  symbol: MarketSymbol,
  index: number,
  close: number,
  volume = 10,
): FourHourCandle {
  const openTime = TEST_START + index * FOUR_HOUR_MS;
  return {
    symbol,
    interval: '4h',
    openTime,
    closeTime: openTime + FOUR_HOUR_MS - 1,
    open: close,
    high: close,
    low: close,
    close,
    volume,
  };
}

function closesFromReturns(returns: readonly number[], initial = 100): number[] {
  const closes = [initial];
  for (const value of returns) closes.push(closes.at(-1)! * Math.exp(value));
  return closes;
}

function candleSeries(
  symbol: PerpAsset,
  returns: readonly number[],
  volumes?: readonly number[],
): FourHourCandle[] {
  return closesFromReturns(returns).map((close, index) => (
    candle(symbol, index, close, volumes?.[index] ?? 10)
  ));
}

function h2Candles(perpClose = 101, spotClose = 100): {
  perpCandles: FourHourCandle[];
  spotCandles: FourHourCandle[];
} {
  return {
    perpCandles: [candle('BTC', 0, perpClose)],
    spotCandles: [candle('@142', 0, spotClose)],
  };
}

function fundingWindow(total: number, coin: PerpAsset = 'BTC'): HourlyFunding[] {
  const decisionTime = TEST_START + FOUR_HOUR_MS;
  const startTime = decisionTime - H2_CONFIG.fundingLookbackHours * HOUR_MS;
  return Array.from({ length: H2_CONFIG.fundingLookbackHours }, (_, index) => ({
    coin,
    time: startTime + index * HOUR_MS,
    rate: index === 0 ? total : 0,
  }));
}

describe('four-hour pure indicators', () => {
  test('uses the frozen even-median and MAD conventions without mutating input', () => {
    const values = [4, 1, 3, 2];
    expect(median(values)).toBe(2.5);
    expect(values).toEqual([4, 1, 3, 2]);
    expect(median([3, 1, 2])).toBe(2);
    expect(median([])).toBeNull();
    expect(median([1, Number.NaN])).toBeNull();

    const score = robustScore(4, [-2, -1, 1, 2], H3_CONFIG.robustScaleFactor);
    expect(score).toMatchObject({ median: 0, mad: 1.5, scale: 2.2239 });
    expect(score?.z).toBeCloseTo(4 / 2.2239, 12);
    expect(robustScore(1, [1, 1, 1], H3_CONFIG.robustScaleFactor)).toBeNull();
    expect(robustScore(1, [0, 1], 0)).toBeNull();
  });

  test('calculates causal log returns and the n-2 OLS residual scale', () => {
    expect(logReturn(100, 110)).toBeCloseTo(Math.log(1.1), 15);
    expect(logReturn(0, 1)).toBeNull();
    expect(logReturn(1, Number.POSITIVE_INFINITY)).toBeNull();

    const fit = fitOlsWithIntercept(
      [-2, -1, 1, 2],
      [-4, 0, 4, 4], // 1 + 2*x plus residuals [-1, 1, 1, -1]
    );
    expect(fit?.alpha).toBeCloseTo(1, 12);
    expect(fit?.beta).toBeCloseTo(2, 12);
    expect(fit?.residualScale).toBeCloseTo(Math.sqrt(2), 12);
    expect(fitOlsWithIntercept([1, 1, 1], [1, 2, 3])).toBeNull();
    expect(fitOlsWithIntercept([1, 2], [1, 2])).toBeNull();
    expect(fitOlsWithIntercept([1, 2, 3], [1, 2])).toBeNull();
  });
});

describe('H2 carry signal', () => {
  test('requires a strict 86-bps funding sum and positive perp/spot basis', () => {
    const markets = h2Candles();
    expect(h2CarrySignal({
      asset: 'BTC',
      signalIndex: 0,
      ...markets,
      funding: fundingWindow(H2_CONFIG.fundingThreshold),
    })).toBeNull();
    expect(h2CarrySignal({
      asset: 'BTC',
      signalIndex: 0,
      ...h2Candles(100, 100),
      funding: fundingWindow(H2_CONFIG.fundingThreshold + 1e-7),
    })).toBeNull();

    const signal = h2CarrySignal({
      asset: 'BTC',
      signalIndex: 0,
      ...markets,
      funding: fundingWindow(H2_CONFIG.fundingThreshold + 1e-7),
    });
    expect(signal).toMatchObject({
      strategy: 'H2',
      asset: 'BTC',
      signalIndex: 0,
      decisionTime: TEST_START + FOUR_HOUR_MS,
      entryIndex: 2,
      exitIndex: 44,
      perpClose: 101,
      spotClose: 100,
    });
    expect(signal?.fundingSum).toBeCloseTo(H2_CONFIG.fundingThreshold + 1e-7, 15);
  });

  test('cannot override the preregistered economics through an extra input property', () => {
    const forgedInput = {
      asset: 'BTC' as const,
      signalIndex: 0,
      ...h2Candles(),
      funding: fundingWindow(H2_CONFIG.fundingThreshold),
      config: { ...H2_CONFIG, fundingThreshold: 0, executionDelayBars: 0 },
    };
    expect(h2CarrySignal(forgedInput)).toBeNull();
  });

  test('fails closed on an incomplete, gapped, or wrong-identity funding window', () => {
    const input = {
      asset: 'BTC' as const,
      signalIndex: 0,
      ...h2Candles(),
    };
    expect(() => h2CarrySignal({ ...input, funding: fundingWindow(0.01).slice(1) }))
      .toThrow('exactly 168');
    const gapped = fundingWindow(0.01);
    gapped[3] = { ...gapped[3], time: gapped[3].time + 1 };
    expect(() => h2CarrySignal({ ...input, funding: gapped })).toThrow('exact and hourly');
    expect(() => h2CarrySignal({ ...input, funding: fundingWindow(0.01, 'ETH') }))
      .toThrow('exact and hourly');
    expect(() => h2CarrySignal({
      ...input,
      perpCandles: [candle('ETH', 0, 101)],
      funding: fundingWindow(0.01),
    })).toThrow('identity/calendar mismatch');

    const malformed = h2Candles();
    malformed.spotCandles[0] = {
      ...malformed.spotCandles[0], closeTime: malformed.spotCandles[0].closeTime - 1,
    };
    expect(() => h2CarrySignal({ ...input, ...malformed, funding: fundingWindow(0.01) }))
      .toThrow('identity/calendar mismatch');
  });

  test('does not inspect future entry or exit candles', () => {
    const signal = h2CarrySignal({
      asset: 'BTC',
      signalIndex: 0,
      ...h2Candles(),
      funding: fundingWindow(0.01),
    });
    expect(signal?.entryIndex).toBeGreaterThan(0);
    expect(signal?.exitIndex).toBeGreaterThan(0);
  });
});

describe('H3 shock-reversal signal', () => {
  const priorReturns = Array.from(
    { length: H3_CONFIG.lookbackBars },
    (_, index) => (index % 2 === 0 ? -0.001 : 0.001),
  );

  test('uses only 180 prior returns/volumes and accepts inclusive z/volume comparisons', () => {
    const returns = [...priorReturns, 0.0045];
    const volumes = Array.from({ length: returns.length + 1 }, () => 10);
    volumes[volumes.length - 1] = 20;
    const candles = candleSeries('BTC', returns, volumes);
    const signal = h3ShockReversalSignal({
      asset: 'BTC',
      signalIndex: H3_CONFIG.lookbackBars + 1,
      candles,
    });
    expect(signal).toMatchObject({
      strategy: 'H3',
      asset: 'BTC',
      direction: -1,
      signalIndex: 181,
      entryIndex: 183,
      exitIndex: 186,
    });
    expect(signal?.score).toBeGreaterThan(3);
  });

  test('accepts an exactly equal z threshold and ignores forged config overrides', () => {
    const boundaryPrior = Array.from(
      { length: H3_CONFIG.lookbackBars },
      (_, index) => (index % 2 === 0 ? -1 : 1),
    );
    const boundaryReturn = H3_CONFIG.zThreshold * H3_CONFIG.robustScaleFactor;
    const volumes = Array.from({ length: boundaryPrior.length + 2 }, () => 10);
    volumes[volumes.length - 1] = 20;
    const candles = candleSeries('BTC', [...boundaryPrior, boundaryReturn], volumes);
    const boundary = h3ShockReversalSignal({
      asset: 'BTC', signalIndex: H3_CONFIG.lookbackBars + 1, candles,
    });
    expect(boundary?.score).toBe(H3_CONFIG.zThreshold);

    const weak = candleSeries('BTC', [...priorReturns, 0.0015]);
    weak[weak.length - 1] = { ...weak[weak.length - 1], volume: 20 };
    const forgedInput = {
      asset: 'BTC' as const,
      signalIndex: H3_CONFIG.lookbackBars + 1,
      candles: weak,
      config: { ...H3_CONFIG, zThreshold: 0, volumeMultiple: 0, executionDelayBars: 0 },
    };
    expect(h3ShockReversalSignal(forgedInput)).toBeNull();
  });

  test('reverses a negative shock and rejects weak, low-volume, or degenerate samples', () => {
    const index = H3_CONFIG.lookbackBars + 1;
    const negative = candleSeries('ETH', [...priorReturns, -0.0045]);
    negative[index] = { ...negative[index], volume: 20 };
    expect(h3ShockReversalSignal({ asset: 'ETH', signalIndex: index, candles: negative })?.direction)
      .toBe(1);

    const weak = candleSeries('BTC', [...priorReturns, 0.0015]);
    weak[index] = { ...weak[index], volume: 20 };
    expect(h3ShockReversalSignal({ asset: 'BTC', signalIndex: index, candles: weak })).toBeNull();

    const lowVolume = candleSeries('BTC', [...priorReturns, 0.0045]);
    lowVolume[index] = { ...lowVolume[index], volume: 19.999 };
    expect(h3ShockReversalSignal({ asset: 'BTC', signalIndex: index, candles: lowVolume }))
      .toBeNull();

    const flat = candleSeries('BTC', Array.from({ length: 181 }, () => 0.001));
    expect(h3ShockReversalSignal({ asset: 'BTC', signalIndex: index, candles: flat })).toBeNull();
    expect(h3ShockReversalSignal({ asset: 'BTC', signalIndex: 180, candles: weak })).toBeNull();
  });

  test('fails on identity mismatch but produces timing beyond the available causal array', () => {
    const index = H3_CONFIG.lookbackBars + 1;
    const candles = candleSeries('BTC', [...priorReturns, 0.0045]);
    candles[index] = { ...candles[index], volume: 20 };
    const signal = h3ShockReversalSignal({ asset: 'BTC', signalIndex: index, candles });
    expect(signal?.exitIndex).toBeGreaterThanOrEqual(candles.length);
    const wrong = [...candles];
    wrong[0] = { ...wrong[0], symbol: 'ETH' };
    expect(() => h3ShockReversalSignal({ asset: 'BTC', signalIndex: index, candles: wrong }))
      .toThrow('identity/calendar mismatch');

    const gapped = [...candles];
    gapped[100] = { ...gapped[100], openTime: gapped[100].openTime + 1 };
    expect(() => h3ShockReversalSignal({ asset: 'BTC', signalIndex: index, candles: gapped }))
      .toThrow('identity/calendar mismatch');
  });
});

describe('H4 BTC-laggard signal', () => {
  const priorBtc = Array.from(
    { length: H4_CONFIG.lookbackBars },
    (_, index) => (index % 2 === 0 ? -0.001 : 0.001),
  );
  const priorLaggard = priorBtc.map((value, index) => {
    const noise = [-0.0002, 0.0002, 0.0002, -0.0002][index % 4];
    return 0.5 * value + noise;
  });

  test('fits only the prior 180 pairs and enters in the BTC direction after a lag residual', () => {
    const btc = candleSeries('BTC', [...priorBtc, 0.01]);
    const eth = candleSeries('ETH', [...priorLaggard, 0.004]);
    const signal = h4BtcLagSignal({
      asset: 'ETH',
      signalIndex: H4_CONFIG.lookbackBars + 1,
      btcCandles: btc,
      laggardCandles: eth,
    });
    expect(signal).toMatchObject({
      strategy: 'H4',
      asset: 'ETH',
      direction: 1,
      signalIndex: 181,
      entryIndex: 183,
      exitIndex: 186,
    });
    expect(signal?.score).toBeGreaterThan(2);
    expect(signal?.residual).toBeLessThanOrEqual(-(signal?.residualScale ?? 0));
  });

  test('rejects a non-lag residual, zero residual scale, and insufficient history', () => {
    const index = H4_CONFIG.lookbackBars + 1;
    const btc = candleSeries('BTC', [...priorBtc, 0.01]);
    const onRelationship = candleSeries('ETH', [...priorLaggard, 0.005]);
    expect(h4BtcLagSignal({
      asset: 'ETH', signalIndex: index, btcCandles: btc, laggardCandles: onRelationship,
    })).toBeNull();

    const zeroResidualLaggard = Array.from(
      { length: btc.length },
      (_, candleIndex) => candle('ETH', candleIndex, 100),
    );
    expect(h4BtcLagSignal({
      asset: 'ETH',
      signalIndex: index,
      btcCandles: btc,
      laggardCandles: zeroResidualLaggard,
    })).toBeNull();
    expect(h4BtcLagSignal({
      asset: 'ETH', signalIndex: 180, btcCandles: btc, laggardCandles: onRelationship,
    })).toBeNull();

    const forgedInput = {
      asset: 'ETH' as const,
      signalIndex: index,
      btcCandles: btc,
      laggardCandles: onRelationship,
      config: { ...H4_CONFIG, residualSigmaMultiple: 0, executionDelayBars: 0 },
    };
    expect(h4BtcLagSignal(forgedInput)).toBeNull();
  });

  test('supports the exploratory HYPE sleeve and fails closed on calendar mismatch', () => {
    const index = H4_CONFIG.lookbackBars + 1;
    const btc = candleSeries('BTC', [...priorBtc, -0.01]);
    const hype = candleSeries('HYPE', [...priorLaggard, -0.004]);
    expect(h4BtcLagSignal({
      asset: 'HYPE', signalIndex: index, btcCandles: btc, laggardCandles: hype,
    })?.direction).toBe(-1);

    const mismatched = [...hype];
    mismatched[index] = { ...mismatched[index], openTime: mismatched[index].openTime + 1 };
    expect(() => h4BtcLagSignal({
      asset: 'HYPE', signalIndex: index, btcCandles: btc, laggardCandles: mismatched,
    })).toThrow('identity/calendar mismatch');

    expect(() => h4BtcLagSignal({
      asset: 'BTC' as never, signalIndex: index, btcCandles: btc, laggardCandles: btc,
    })).toThrow('laggard asset must be ETH or HYPE');
  });
});
