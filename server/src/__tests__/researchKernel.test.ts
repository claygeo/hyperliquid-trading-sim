import { mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  calculateIndicators,
  canonicalJson,
  costAwareEntryBudget,
  DAY_MS,
  FROZEN_CONFIG,
  runFrozenResearch,
  screenVerdict,
  type FrozenResearchConfig,
  type PortfolioMetrics,
  type ResearchAsset,
  type ResearchCandle,
} from '../research/kernel.js';
import {
  buildFrozenSnapshot,
  calculateSnapshotHashes,
  fetchFrozenDailyCandles,
  parseCandleRow,
  readFrozenSnapshot,
  snapshotSeries,
  writeSnapshot,
  type ResearchFetch,
} from '../research/hyperliquid.js';

const TEST_START = Date.parse('2024-01-01T00:00:00.000Z');

function testConfig(
  days = 12,
  holdoutIndex = 6,
  overrides: Partial<FrozenResearchConfig> = {},
): FrozenResearchConfig {
  return {
    ...FROZEN_CONFIG,
    trialId: 'TEST-TRIAL',
    startTime: TEST_START,
    asOfTime: TEST_START + days * DAY_MS,
    holdoutStartTime: TEST_START + holdoutIndex * DAY_MS,
    initialNav: 3_000,
    returnLookbackDays: 1,
    emaDays: 2,
    volatilityLookbackDays: 2,
    executionDelayDays: 2,
    ...overrides,
  };
}

function candle(
  asset: ResearchAsset,
  index: number,
  close: number,
  open = close,
): ResearchCandle {
  const openTime = TEST_START + index * DAY_MS;
  return {
    symbol: asset,
    interval: '1d',
    openTime,
    closeTime: openTime + DAY_MS - 1,
    open,
    high: Math.max(open, close) + 1,
    low: Math.min(open, close) - 1,
    close,
    volume: 100 + index,
  };
}

function alignedSeries(prices: number[]): Record<ResearchAsset, ResearchCandle[]> {
  return {
    BTC: prices.map((price, index) => candle('BTC', index, price)),
    ETH: prices.map((price, index) => candle('ETH', index, price * 0.5)),
  };
}

function rawRow(asset: ResearchAsset, index: number, price = 100) {
  const openTime = TEST_START + index * DAY_MS;
  return {
    T: openTime + DAY_MS - 1,
    c: String(price),
    h: String(price + 2),
    i: '1d',
    l: String(price - 2),
    n: 5,
    o: String(price),
    s: asset,
    t: openTime,
    v: '12.5',
  };
}

function completeRangeFetch(
  reverseRows = false,
  priceOffset = 0,
): { fetchImpl: ResearchFetch; requests: any[] } {
  const requests: any[] = [];
  const fetchImpl: ResearchFetch = async (_input, init) => {
    const request = JSON.parse(init.body);
    requests.push(request);
    const asset = request.req.coin as ResearchAsset;
    const firstIndex = (request.req.startTime - TEST_START) / DAY_MS;
    const finalIndex = (request.req.endTime - TEST_START + 1) / DAY_MS;
    const rows = Array.from(
      { length: finalIndex - firstIndex },
      (_, offset) => rawRow(
        asset,
        firstIndex + offset,
        100 + priceOffset + firstIndex + offset,
      ),
    );
    if (reverseRows) rows.reverse();
    return {
      ok: true,
      status: 200,
      statusText: 'OK',
      text: async () => JSON.stringify(rows),
    };
  };
  return { fetchImpl, requests };
}

function metrics(overrides: Partial<PortfolioMetrics> = {}): PortfolioMetrics {
  return {
    startingNav: 3_000,
    endingNav: 3_100,
    adjustedPricePnl: 100,
    cagr: 0.1,
    annualizedVolatility: 0.2,
    sharpe: 1,
    maxDrawdown: 0.05,
    completedTrades: 40,
    winningTrades: 24,
    winRate: 0.6,
    effectiveEpisodes: 30,
    effectiveEpisodeExpectancy: 5,
    profitFactor: 1.5,
    averageAdjustedTradePnl: 2.5,
    exposureFraction: 0.5,
    turnover: 4,
    largestPositiveTradeConcentration: 0.15,
    topFivePositiveTradeConcentration: 0.45,
    largestPositiveAssetConcentration: 0.7,
    positivePnlByAsset: { BTC: 70, ETH: 30 },
    maxMarkedGross: 1_500,
    maxMarkedGrossToNav: 0.5,
    nonPositiveNav: false,
    ...overrides,
  };
}

describe('research indicators and ledger', () => {
  const prices = [100, 100.4, 101, 101.5, 102.2, 103, 103.4, 104.2, 105, 105.4, 106.2, 107];

  test('uses the frozen EMA seed and requires non-zero trailing volatility', () => {
    const config = testConfig();
    const points = calculateIndicators(alignedSeries(prices).BTC, config);
    expect(points[0].ema).toBeNull();
    expect(points[1].ema).toBeCloseTo(100.2, 12);
    expect(points[1].long).toBe(true);
    expect(points[2].annualizedVolatility20).toBeGreaterThan(0);
    expect(points[2].long).toBe(true);

    const flat = calculateIndicators(alignedSeries(prices.map(() => 100)).BTC, config);
    expect(flat[2].annualizedVolatility20).toBe(0);
    expect(flat[2].long).toBe(false);
  });

  test('fills at t+2, keeps quantity fixed, and charges each cost once', () => {
    const config = testConfig();
    const result = runFrozenResearch(alignedSeries(prices), config);
    const buys = result.fullHistory.base.executions.filter((execution) => execution.side === 'BUY');
    const sells = result.fullHistory.base.executions.filter((execution) => execution.side === 'SELL');

    expect(buys).toHaveLength(2);
    expect(buys[0].time).toBe(TEST_START + 4 * DAY_MS);
    expect(buys[0].referenceNotional).toBeCloseTo(750, 10);
    expect(buys[0].fee).toBeCloseTo(0.3375, 10);
    expect(buys[0].slippage).toBeCloseTo(0.375, 10);
    expect(sells[0].units).toBeCloseTo(buys[0].units, 12);
    expect(result.fullHistory.base.trades[0].executionCosts).toBeCloseTo(
      buys[0].totalCost + sells[0].totalCost,
      12,
    );
  });

  test('matches the frozen single-position futures ledger anchor', () => {
    const btcCloses = [98, 99, 100, 90, 100, 110];
    const series: Record<ResearchAsset, ResearchCandle[]> = {
      BTC: btcCloses.map((price, index) => candle('BTC', index, price)),
      ETH: btcCloses.map((_price, index) => candle('ETH', index, 50)),
    };
    const result = runFrozenResearch(series, testConfig(6, 3));
    expect(result.fullHistory.base.executions).toHaveLength(2);
    expect(result.fullHistory.base.metrics.endingNav).toBeCloseTo(3_073.50375, 10);
    expect(result.fullHistory.doubledCosts.metrics.endingNav).toBeCloseTo(3_072.0075, 10);
    const trade = result.fullHistory.base.trades[0];
    expect(trade).toMatchObject({
      entryNotional: 750,
      exitNotional: 825,
      pricePnl: 75,
    });
    expect(trade.executionCosts).toBeCloseTo(1.49625, 12);
    expect(trade.adjustedPricePnl).toBeCloseTo(73.50375, 12);
  });

  test('does not exit an existing trend solely because entry volatility becomes zero', () => {
    const btcPrices = [100, 101, 103, 106, 212, 424, 848, 1_696, 3_392];
    const series: Record<ResearchAsset, ResearchCandle[]> = {
      BTC: btcPrices.map((price, index) => candle('BTC', index, price)),
      ETH: btcPrices.map((_price, index) => candle('ETH', index, 50)),
    };
    const config = testConfig(9, 4);
    const points = calculateIndicators(series.BTC, config);
    expect(points[5].annualizedVolatility20).toBe(0);
    expect(points[5].long).toBe(true);

    const result = runFrozenResearch(series, config);
    expect(result.fullHistory.base.executions.filter((execution) => execution.side === 'SELL'))
      .toHaveLength(1);
    expect(result.fullHistory.base.trades[0].reason).toBe('dataset_end');
  });

  test('uses one schedule for base and doubled costs and one overlapping episode', () => {
    const result = runFrozenResearch(alignedSeries(prices), testConfig());
    const scheduleIdentity = (execution: typeof result.fullHistory.base.executions[number]) => ({
      asset: execution.asset,
      time: execution.time,
      side: execution.side,
      units: execution.units,
      referencePrice: execution.referencePrice,
      referenceNotional: execution.referenceNotional,
      reason: execution.reason,
    });
    const baseSchedule = result.fullHistory.base.executions.map(scheduleIdentity);
    const stressSchedule = result.fullHistory.doubledCosts.executions.map(scheduleIdentity);

    expect(stressSchedule).toEqual(baseSchedule);
    expect(result.fullHistory.doubledCosts.executions[0].totalCost).toBeCloseTo(
      result.fullHistory.base.executions[0].totalCost * 2,
      12,
    );
    expect(result.fullHistory.base.trades).toHaveLength(2);
    expect(result.fullHistory.base.episodes).toHaveLength(1);
    expect(result.fullHistory.base.metrics.effectiveEpisodes).toBe(1);
    expect(result.fullHistory.base.daily.every((point) => Number.isFinite(point.nav))).toBe(true);
  });

  test('keeps a same-open direct asset rotation inside one effective episode', () => {
    const btcPrices = [98, 99, 100, 101, 80, 79, 78, 77];
    const ethPrices = [50, 50, 50, 50, 51, 52, 53, 54];
    const series: Record<ResearchAsset, ResearchCandle[]> = {
      BTC: btcPrices.map((price, index) => candle('BTC', index, price)),
      ETH: ethPrices.map((price, index) => candle('ETH', index, price)),
    };
    const result = runFrozenResearch(series, testConfig(8, 4));
    const rotationTime = TEST_START + 6 * DAY_MS;
    expect(result.fullHistory.base.executions.filter((execution) => execution.time === rotationTime)
      .map((execution) => `${execution.asset}:${execution.side}`))
      .toEqual(['BTC:SELL', 'ETH:BUY']);
    expect(result.fullHistory.base.trades).toHaveLength(2);
    expect(result.fullHistory.base.episodes).toHaveLength(1);
    const tradePnl = result.fullHistory.base.trades
      .reduce((sum, trade) => sum + trade.adjustedPricePnl, 0);
    expect(result.fullHistory.base.episodes[0].adjustedPricePnl).toBeCloseTo(tradePnl, 10);
  });

  test('starts holdout flat and ignores pre-split decisions', () => {
    const config = testConfig(12, 6);
    const result = runFrozenResearch(alignedSeries(prices), config);
    const firstHoldoutBuy = result.holdout.base.executions.find((execution) => execution.side === 'BUY');

    expect(firstHoldoutBuy?.time).toBe(config.holdoutStartTime + 2 * DAY_MS);
    expect(result.holdout.base.daily).toHaveLength(6);
    expect(result.holdout.base.daily[0].nav).toBe(config.initialNav);
  });

  test('freezes the cost-aware controller budget', () => {
    const budget = costAwareEntryBudget(1_200, 600, 1_000, FROZEN_CONFIG);
    expect(budget).toBeCloseTo(598.8621618924, 10);
    const stressedCost = budget * FROZEN_CONFIG.stressMultiplier
      * (FROZEN_CONFIG.feeRate + FROZEN_CONFIG.slippageRate);
    expect(600 + budget + stressedCost).toBeCloseTo(1_200, 10);
    expect(costAwareEntryBudget(500, 600, 1_000, FROZEN_CONFIG)).toBe(0);
  });

  test('serializes deterministically without non-finite JSON values', () => {
    const result = runFrozenResearch(alignedSeries(prices), testConfig());
    const first = canonicalJson(result);
    const second = canonicalJson(runFrozenResearch(alignedSeries(prices), testConfig()));
    expect(second).toBe(first);
    expect(first).not.toMatch(/NaN|Infinity/);
    expect(() => canonicalJson({ missing: undefined })).toThrow('cannot contain undefined');
    expect(() => canonicalJson({ invalid: Number.NaN })).toThrow('non-finite');
  });

  test('applies reject before insufficiency and candidate gates', () => {
    expect(screenVerdict(metrics({ effectiveEpisodeExpectancy: 0 }), metrics()))
      .toBe('PRICE_EDGE_REJECT');
    expect(screenVerdict(metrics({ effectiveEpisodes: 29 }), metrics()))
      .toBe('PRICE_EDGE_INSUFFICIENT');
    expect(screenVerdict(metrics({ topFivePositiveTradeConcentration: 0.51 }), metrics()))
      .toBe('PRICE_EDGE_INSUFFICIENT');
    expect(screenVerdict(metrics({ largestPositiveAssetConcentration: 0.81 }), metrics()))
      .toBe('PRICE_EDGE_INSUFFICIENT');
    expect(screenVerdict(metrics(), metrics())).toBe('PRICE_EDGE_CANDIDATE');
    expect(screenVerdict(metrics({ nonPositiveNav: true }), metrics()))
      .toBe('PRICE_EDGE_REJECT');
    expect(screenVerdict(metrics({ sharpe: null }), metrics()))
      .toBe('PRICE_EDGE_INSUFFICIENT');
  });

  test('fails closed on calendar and frozen-boundary mismatches', () => {
    const series = alignedSeries(prices);
    series.ETH[3] = { ...series.ETH[3], openTime: series.ETH[3].openTime + 1 };
    expect(() => runFrozenResearch(series, testConfig())).toThrow('calendar mismatch');
    expect(() => runFrozenResearch(alignedSeries(prices.slice(0, -1)), testConfig()))
      .toThrow('Expected 12 candles');

    const wrongStart = alignedSeries(prices);
    wrongStart.BTC[0] = { ...wrongStart.BTC[0], openTime: TEST_START - DAY_MS };
    wrongStart.ETH[0] = { ...wrongStart.ETH[0], openTime: TEST_START - DAY_MS };
    expect(() => runFrozenResearch(wrongStart, testConfig())).toThrow('frozen boundary');

    const missingHoldout = testConfig(12, 20);
    expect(() => runFrozenResearch(alignedSeries(prices), missingHoldout))
      .toThrow('Holdout boundary');

    expect(() => runFrozenResearch({ BTC: [], ETH: [] }, testConfig()))
      .toThrow('non-empty');
  });

  test('force-closes a severe losing path and records NAV drawdown', () => {
    const collapsing = [100, 100.4, 101, 101.5, 102, 0.0001, 0.0001, 0.0001];
    const config = testConfig(8, 4, { initialNav: 1 });
    const result = runFrozenResearch(alignedSeries(collapsing), config);
    expect(result.screenVerdict).toBe('PRICE_EDGE_REJECT');
    expect(result.fullHistory.doubledCosts.metrics.nonPositiveNav).toBe(false);
    expect(result.fullHistory.doubledCosts.metrics.maxDrawdown).toBeGreaterThan(0.99);

    const defensive = runFrozenResearch(
      alignedSeries(collapsing),
      testConfig(8, 4, { initialNav: -1 }),
    );
    expect(defensive.fullHistory.doubledCosts.metrics.nonPositiveNav).toBe(true);
  });

  test('returns a cash-only buy-and-hold reference when the window is too short', () => {
    const shortPrices = [100, 100.1, 100.2];
    const config = testConfig(3, 1, { emaDays: 5 });
    const result = runFrozenResearch(alignedSeries(shortPrices), config);
    expect(result.fullHistory.buyAndHold.base.endingNav).toBe(config.initialNav);
    expect(result.fullHistory.buyAndHold.base.sharpe).toBeNull();
  });

  test('reports terminal-day marked gross before the forced close', () => {
    const result = runFrozenResearch(
      alignedSeries([100, 100.4, 101, 101.5, 102.2]),
      testConfig(5, 2),
    );
    expect(result.fullHistory.base.executions.map((execution) => execution.side))
      .toEqual(['BUY', 'BUY', 'SELL', 'SELL']);
    expect(result.fullHistory.base.daily.at(-1)?.markedGross).toBeGreaterThan(0);
    expect(result.fullHistory.base.metrics.maxMarkedGross).toBeGreaterThan(0);
  });
});

describe('strict Hyperliquid research adapter', () => {
  test('parses a valid official row and rejects malformed market data', () => {
    expect(parseCandleRow(rawRow('BTC', 0), 'BTC')).toMatchObject({
      symbol: 'BTC',
      interval: '1d',
      openTime: TEST_START,
      closeTime: TEST_START + DAY_MS - 1,
    });
    expect(() => parseCandleRow({ ...rawRow('BTC', 0), s: 'ETH' }, 'BTC'))
      .toThrow('wrong symbol');
    expect(() => parseCandleRow({ ...rawRow('BTC', 0), i: '1h' }, 'BTC'))
      .toThrow('wrong interval');
    expect(() => parseCandleRow({ ...rawRow('BTC', 0), t: TEST_START + 1 }, 'BTC'))
      .toThrow('aligned');
    expect(() => parseCandleRow({ ...rawRow('BTC', 0), o: '0' }, 'BTC'))
      .toThrow('positive');
    expect(() => parseCandleRow({ ...rawRow('BTC', 0), h: '90' }, 'BTC'))
      .toThrow('OHLC');
    expect(() => parseCandleRow({ ...rawRow('BTC', 0), v: '-1' }, 'BTC'))
      .toThrow('volume');
    expect(() => parseCandleRow(null, 'BTC')).toThrow('object');
    expect(() => parseCandleRow({ ...rawRow('BTC', 0), T: 1.5 }, 'BTC'))
      .toThrow('integer');
  });

  test('requests the complete frozen range once and validates exact coverage', async () => {
    const config = testConfig(4, 2);
    const { fetchImpl, requests } = completeRangeFetch();
    const result = await fetchFrozenDailyCandles('BTC', { config, fetchImpl });

    expect(result.candles).toHaveLength(4);
    expect(result.pages).toHaveLength(1);
    expect(requests).toHaveLength(1);
    expect(requests[0].type).toBe('candleSnapshot');
    expect(requests[0].req.startTime).toBe(config.startTime);
    expect(requests[0].req.endTime).toBe(config.asOfTime - 1);
  });

  test('rejects HTTP errors, empty responses, gaps, and oversized ranges', async () => {
    const config = testConfig(4, 2);
    const failed: ResearchFetch = async () => ({
      ok: false,
      status: 429,
      statusText: 'rate limited',
      text: async () => '{}',
    });
    await expect(fetchFrozenDailyCandles('BTC', { config, fetchImpl: failed }))
      .rejects.toThrow('429');

    const empty: ResearchFetch = async () => ({
      ok: true,
      status: 200,
      statusText: 'OK',
      text: async () => '[]',
    });
    await expect(fetchFrozenDailyCandles('BTC', { config, fetchImpl: empty }))
      .rejects.toThrow('empty');

    const gap: ResearchFetch = async () => ({
      ok: true,
      status: 200,
      statusText: 'OK',
      text: async () => JSON.stringify([rawRow('BTC', 1)]),
    });
    await expect(fetchFrozenDailyCandles('BTC', { config, fetchImpl: gap }))
      .rejects.toThrow('did not begin');

    const tooLarge = testConfig(5_001, 4_000);
    await expect(fetchFrozenDailyCandles('BTC', { config: tooLarge, fetchImpl: empty }))
      .rejects.toThrow('exceeds');

    const invalidJson: ResearchFetch = async () => ({
      ok: true,
      status: 200,
      statusText: 'OK',
      text: async () => 'not-json',
    });
    await expect(fetchFrozenDailyCandles('BTC', { config, fetchImpl: invalidJson }))
      .rejects.toThrow('valid JSON');

    const duplicate: ResearchFetch = async () => ({
      ok: true,
      status: 200,
      statusText: 'OK',
      text: async () => JSON.stringify([rawRow('BTC', 0), rawRow('BTC', 0)]),
    });
    await expect(fetchFrozenDailyCandles('BTC', { config, fetchImpl: duplicate }))
      .rejects.toThrow('duplicate candle');
  });

  test('accepts the frozen 1,199-candle response in one official request', async () => {
    const requests: Array<{ startTime: number; endTime: number }> = [];
    const fetchImpl: ResearchFetch = async (_input, init) => {
      const request = JSON.parse(init.body);
      const startTime = request.req.startTime as number;
      const endTime = request.req.endTime as number;
      requests.push({ startTime, endTime });
      const remaining = Math.floor((endTime - startTime + 1) / DAY_MS);
      const rows = Array.from({ length: remaining }, (_, index) => {
        const openTime = startTime + index * DAY_MS;
        return {
          T: openTime + DAY_MS - 1,
          c: '100',
          h: '101',
          i: '1d',
          l: '99',
          o: '100',
          s: 'BTC',
          t: openTime,
          v: '1',
        };
      });
      return {
        ok: true,
        status: 200,
        statusText: 'OK',
        text: async () => JSON.stringify(rows),
      };
    };
    const result = await fetchFrozenDailyCandles('BTC', { fetchImpl });
    expect(result.pages.map((page) => page.acceptedRows)).toEqual([1_199]);
    expect(requests).toEqual([{
      startTime: 1681084800000,
      endTime: 1784678399999,
    }]);
  });

  test('discards a still-open as-of candle returned by the transport', async () => {
    const config = testConfig(4, 2);
    const fetchImpl: ResearchFetch = async () => ({
      ok: true,
      status: 200,
      statusText: 'OK',
      text: async () => JSON.stringify([
        rawRow('BTC', 0),
        rawRow('BTC', 1),
        rawRow('BTC', 2),
        rawRow('BTC', 3),
        rawRow('BTC', 4),
      ]),
    });
    const result = await fetchFrozenDailyCandles('BTC', { config, fetchImpl });
    expect(result.candles).toHaveLength(4);
    expect(result.pages[0]).toMatchObject({ responseRows: 5, acceptedRows: 4 });
  });

  test('builds a stable BTC/ETH snapshot and refuses to overwrite a trial', async () => {
    const config = testConfig(4, 2);
    const firstFetch = completeRangeFetch(false).fetchImpl;
    const secondFetch = completeRangeFetch(true).fetchImpl;
    const first = await buildFrozenSnapshot({ config, fetchImpl: firstFetch });
    const second = await buildFrozenSnapshot({ config, fetchImpl: secondFetch });
    expect(second.dataSha256).toBe(first.dataSha256);
    expect(second.artifactSha256).not.toBe(first.artifactSha256);
    expect(canonicalJson(second.canonical)).not.toBe(canonicalJson(first.canonical));

    const directory = await mkdtemp(path.join(os.tmpdir(), 'hl-research-'));
    const output = await writeSnapshot(first, directory);
    const originalBytes = await readFile(output, 'utf8');
    expect(JSON.parse(originalBytes).dataSha256).toBe(first.dataSha256);
    const loaded = await readFrozenSnapshot(directory, config.trialId, config);
    expect(snapshotSeries(loaded).BTC).toHaveLength(4);
    await expect(writeSnapshot(first, directory)).rejects.toThrow('already exists');
    expect(await readFile(output, 'utf8')).toBe(originalBytes);

    const corruptDirectory = await mkdtemp(path.join(os.tmpdir(), 'hl-research-corrupt-'));
    const corruptPath = await writeSnapshot(first, corruptDirectory);
    const corrupt = JSON.parse(await readFile(corruptPath, 'utf8'));
    corrupt.canonical.assets.BTC.candles[0].close = 999;
    await writeFile(corruptPath, JSON.stringify(corrupt), 'utf8');
    await expect(readFrozenSnapshot(corruptDirectory, config.trialId, config))
      .rejects.toThrow('hash verification');

    const missingDirectory = await mkdtemp(path.join(os.tmpdir(), 'hl-research-empty-'));
    await expect(readFrozenSnapshot(missingDirectory, config.trialId, config))
      .rejects.toThrow('exactly one');

  });

  test('requires the official source contract and serializes concurrent trial writes', async () => {
    const config = testConfig(4, 2);
    await expect(buildFrozenSnapshot({
      config,
      endpoint: 'https://example.invalid/info',
      fetchImpl: completeRangeFetch().fetchImpl,
    })).rejects.toThrow('official Hyperliquid');

    const first = await buildFrozenSnapshot({ config, fetchImpl: completeRangeFetch().fetchImpl });
    const different = await buildFrozenSnapshot({
      config,
      fetchImpl: completeRangeFetch(false, 10).fetchImpl,
    });
    const concurrentDirectory = await mkdtemp(path.join(os.tmpdir(), 'hl-research-race-'));
    const outcomes = await Promise.allSettled([
      writeSnapshot(first, concurrentDirectory),
      writeSnapshot(different, concurrentDirectory),
    ]);
    expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1);
    expect(outcomes.filter((outcome) => outcome.status === 'rejected')).toHaveLength(1);
    expect((await readdir(concurrentDirectory)).filter((name) => name.endsWith('.json')))
      .toHaveLength(1);

    const wrongSourceCanonical = structuredClone(first.canonical);
    (wrongSourceCanonical.source as { endpoint: string }).endpoint = 'https://example.invalid/info';
    const wrongSource = {
      ...calculateSnapshotHashes(wrongSourceCanonical),
      canonical: wrongSourceCanonical,
    };
    const wrongSourceDirectory = await mkdtemp(path.join(os.tmpdir(), 'hl-research-source-'));
    await writeSnapshot(wrongSource, wrongSourceDirectory);
    await expect(readFrozenSnapshot(wrongSourceDirectory, config.trialId, config))
      .rejects.toThrow('source contract');

    const wrongIdentityCanonical = structuredClone(first.canonical);
    (wrongIdentityCanonical.assets.BTC.candles[0] as { symbol: string }).symbol = 'ETH';
    const wrongIdentity = {
      ...calculateSnapshotHashes(wrongIdentityCanonical),
      canonical: wrongIdentityCanonical,
    };
    const wrongIdentityDirectory = await mkdtemp(path.join(os.tmpdir(), 'hl-research-row-id-'));
    await writeSnapshot(wrongIdentity, wrongIdentityDirectory);
    await expect(readFrozenSnapshot(wrongIdentityDirectory, config.trialId, config))
      .rejects.toThrow('normalized candle identity');

    const nonPositiveCanonical = structuredClone(first.canonical);
    nonPositiveCanonical.assets.BTC.candles[0].open = 0;
    const nonPositive = {
      ...calculateSnapshotHashes(nonPositiveCanonical),
      canonical: nonPositiveCanonical,
    };
    const nonPositiveDirectory = await mkdtemp(path.join(os.tmpdir(), 'hl-research-row-price-'));
    await writeSnapshot(nonPositive, nonPositiveDirectory);
    await expect(readFrozenSnapshot(nonPositiveDirectory, config.trialId, config))
      .rejects.toThrow('invalid OHLCV');

    const missingPagesCanonical = structuredClone(first.canonical);
    delete (missingPagesCanonical.assets.BTC as { pages?: unknown }).pages;
    const missingPages = {
      ...calculateSnapshotHashes(missingPagesCanonical),
      canonical: missingPagesCanonical,
    };
    const missingPagesDirectory = await mkdtemp(path.join(os.tmpdir(), 'hl-research-pages-'));
    await writeSnapshot(missingPages, missingPagesDirectory);
    await expect(readFrozenSnapshot(missingPagesDirectory, config.trialId, config))
      .rejects.toThrow('exactly one response evidence');

    const multiResponseCanonical = structuredClone(first.canonical);
    const sourcePage = multiResponseCanonical.assets.BTC.pages[0];
    const btcCandles = multiResponseCanonical.assets.BTC.candles;
    multiResponseCanonical.assets.BTC.pages = [
      {
        ...sourcePage,
        acceptedRows: 2,
        lastCloseTime: btcCandles[1].closeTime,
        responseRows: 2,
      },
      {
        ...sourcePage,
        page: 2,
        acceptedRows: 2,
        firstOpenTime: btcCandles[2].openTime,
        requestedStartTime: btcCandles[2].openTime,
        responseRows: 2,
      },
    ];
    const multiResponse = {
      ...calculateSnapshotHashes(multiResponseCanonical),
      canonical: multiResponseCanonical,
    };
    const multiResponseDirectory = await mkdtemp(path.join(os.tmpdir(), 'hl-research-multi-'));
    await writeSnapshot(multiResponse, multiResponseDirectory);
    await expect(readFrozenSnapshot(multiResponseDirectory, config.trialId, config))
      .rejects.toThrow('exactly one response evidence');
  });

  test('research source is isolated from mixed feeds, Supabase, and random fallbacks', async () => {
    const researchDirectory = path.resolve(process.cwd(), 'src/research');
    const kernelSource = await readFile(path.join(researchDirectory, 'kernel.ts'), 'utf8');
    const adapterSource = await readFile(path.join(researchDirectory, 'hyperliquid.ts'), 'utf8');
    const combined = `${kernelSource}\n${adapterSource}`;

    expect(combined).not.toMatch(/supabase|CryptoCompare|Binance|Math\.random|HyperliquidService/);
    expect(adapterSource).toContain("requestType: 'candleSnapshot'");
  });
});
