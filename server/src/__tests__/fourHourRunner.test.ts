import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

import type { StoredMarketSnapshot } from '../research/hyperliquid.js';
import {
  FOUR_HOUR_MS,
  HOUR_MS,
  type FourHourCandle,
  type HourlyFunding,
  type MarketSymbol,
  type PerpAsset,
  type ValidatedFamilyData,
} from '../research/fourHour/contracts.js';
import { HOLDOUT_START_TIME } from '../research/fourHour/frozenTrials.js';
import {
  FROZEN_H1_FAMILY_INPUT,
  extractH1FamilyInput,
  familyDataFromSnapshot,
  evaluateFrozenTrial,
  evaluateFrozenTrials,
  generateFrozenSignals,
} from '../research/fourHour/runner.js';
import * as fourHourArtifacts from '../research/fourHour/artifacts.js';
import type { StoredFamilySnapshot } from '../research/fourHour/artifacts.js';

type MutableJson = Record<string, any>;

const H1_REPORT_FILE = `H1-TREND-DAILY-20260722-001.${FROZEN_H1_FAMILY_INPUT.reportSha256}.json`;
const H1_SNAPSHOT_FILE = `H1-TREND-DAILY-20260722-001.${FROZEN_H1_FAMILY_INPUT.snapshotDataSha256}.json`;

function repositoryRoot(): string {
  return path.basename(process.cwd()) === 'server' ? path.dirname(process.cwd()) : process.cwd();
}

function cloned<T>(value: T): T {
  return structuredClone(value);
}

describe('frozen H1 family input', () => {
  let report: MutableJson;
  let snapshot: StoredMarketSnapshot;

  beforeAll(async () => {
    const root = repositoryRoot();
    [report, snapshot] = await Promise.all([
      readFile(path.join(root, 'server', 'research-results', H1_REPORT_FILE), 'utf8')
        .then((value) => JSON.parse(value) as MutableJson),
      readFile(path.join(root, 'server', 'research-data', H1_SNAPSHOT_FILE), 'utf8')
        .then((value) => JSON.parse(value) as StoredMarketSnapshot),
    ]);
  });

  it('extracts exactly 359 unrounded adjacent returns from the pinned artifacts', () => {
    const extracted = extractH1FamilyInput(report, snapshot);
    const daily = report.canonical.result.holdout.base.daily as Array<{ nav: number }>;

    expect(extracted).toMatchObject({
      id: 'H1',
      reportSha256: FROZEN_H1_FAMILY_INPUT.reportSha256,
      snapshotArtifactSha256: FROZEN_H1_FAMILY_INPUT.snapshotArtifactSha256,
      snapshotDataSha256: FROZEN_H1_FAMILY_INPUT.snapshotDataSha256,
      codeCommit: FROZEN_H1_FAMILY_INPUT.codeCommit,
      specificationCommit: FROZEN_H1_FAMILY_INPUT.specificationCommit,
      dailyNavCount: 360,
      dailyReturnCount: 359,
      dailyReturnsSha256: FROZEN_H1_FAMILY_INPUT.dailyReturnsSha256,
      familyDsrInputAvailable: true,
      unavailabilityReason: null,
    });
    expect(extracted.returns).toHaveLength(359);
    expect(extracted.returns[0]).toBe(daily[1].nav / daily[0].nav - 1);
    expect(extracted.returns.at(-1)).toBe(daily.at(-1)!.nav / daily.at(-2)!.nav - 1);
    expect(createHash('sha256').update(fourHourArtifacts.canonicalJson(extracted.returns)).digest('hex'))
      .toBe(FROZEN_H1_FAMILY_INPUT.dailyReturnsSha256);
    expect(Object.isFrozen(extracted)).toBe(true);
    expect(Object.isFrozen(extracted.returns)).toBe(true);
  });

  it('rejects outer identities and canonical bytes that no longer match the frozen report', () => {
    const wrongHead = cloned(report);
    wrongHead.pinnedHead = '0'.repeat(40);
    expect(() => extractH1FamilyInput(wrongHead, snapshot)).toThrow('frozen outer identity');

    const changedCanonical = cloned(report);
    changedCanonical.canonical.result.limitations[0] = 'tampered limitation';
    expect(() => extractH1FamilyInput(changedCanonical, snapshot)).toThrow('canonical hash mismatch');
  });

  it('rejects snapshot hash tampering and broken report-to-snapshot linkage', () => {
    const wrongSnapshot = cloned(snapshot);
    wrongSnapshot.artifactSha256 = '0'.repeat(64);
    expect(() => extractH1FamilyInput(report, wrongSnapshot)).toThrow('frozen hashes mismatch');

    const changedSnapshotPayload = cloned(snapshot);
    changedSnapshotPayload.canonical.assets.BTC.candles[0].close += 1;
    expect(() => extractH1FamilyInput(report, changedSnapshotPayload))
      .toThrow('snapshot payload hashes mismatch');

    const wrongLink = cloned(report);
    wrongLink.canonical.artifactIdentity.snapshotDataSha256 = 'f'.repeat(64);
    expect(() => extractH1FamilyInput(wrongLink, snapshot)).toThrow('artifact linkage mismatch');
  });

  it('fails closed on non-positive NAV and daily chronology corruption before deriving returns', () => {
    const nonPositive = cloned(report);
    nonPositive.canonical.result.holdout.base.daily[17].nav = 0;
    expect(() => extractH1FamilyInput(nonPositive, snapshot)).toThrow('finite and positive');

    const wrongTime = cloned(report);
    wrongTime.canonical.result.holdout.base.daily[17].time += 1;
    expect(() => extractH1FamilyInput(wrongTime, snapshot)).toThrow('chronology mismatch');
  });
});

const SIGNAL_INDEX = 181;
// Leave enough post-signal candles for t+2 entry plus the longest directional hold.
const SYNTHETIC_BARS = 188;
const SYNTHETIC_START = HOLDOUT_START_TIME - SIGNAL_INDEX * FOUR_HOUR_MS;

function logReturnAt(index: number, shock: boolean): number {
  if (shock && index === SIGNAL_INDEX) return 0.04;
  return ((index % 5) - 2) * 0.001;
}

function candleSeries(symbol: MarketSymbol, shock: boolean): FourHourCandle[] {
  const candles: FourHourCandle[] = [];
  let previousClose = symbol === 'HYPE' ? 20 : symbol.startsWith('@') ? 1_000 : 1_000;
  for (let index = 0; index < SYNTHETIC_BARS; index += 1) {
    const openTime = SYNTHETIC_START + index * FOUR_HOUR_MS;
    const open = previousClose;
    const close = index === 0 ? open : open * Math.exp(logReturnAt(index, shock));
    candles.push({
      symbol,
      interval: '4h',
      openTime,
      closeTime: openTime + FOUR_HOUR_MS - 1,
      open,
      high: Math.max(open, close) * 1.01,
      low: Math.min(open, close) * 0.99,
      close,
      volume: shock && index === SIGNAL_INDEX ? 250 : 100,
    });
    previousClose = close;
  }
  return candles;
}

function candleSeriesFromReturns(
  symbol: MarketSymbol,
  returns: readonly number[],
): FourHourCandle[] {
  const candles: FourHourCandle[] = [];
  let previousClose = symbol === 'HYPE' ? 20 : 1_000;
  for (let index = 0; index <= returns.length; index += 1) {
    const openTime = SYNTHETIC_START + index * FOUR_HOUR_MS;
    const open = previousClose;
    const close = index === 0 ? open : open * Math.exp(returns[index - 1]);
    candles.push({
      symbol,
      interval: '4h',
      openTime,
      closeTime: openTime + FOUR_HOUR_MS - 1,
      open,
      high: Math.max(open, close) * 1.01,
      low: Math.min(open, close) * 0.99,
      close,
      volume: 100,
    });
    previousClose = close;
  }
  return candles;
}

function fundingSeries(coin: PerpAsset): HourlyFunding[] {
  const firstDecision = SYNTHETIC_START + FOUR_HOUR_MS;
  const lastDecision = SYNTHETIC_START + SYNTHETIC_BARS * FOUR_HOUR_MS;
  const start = firstDecision - 168 * HOUR_MS;
  const funding: HourlyFunding[] = [];
  for (let time = start; time < lastDecision; time += HOUR_MS) {
    funding.push({ coin, time, rate: 0 });
  }
  return funding;
}

function syntheticFamilyData(shocks: readonly PerpAsset[]): ValidatedFamilyData {
  const btc = candleSeries('BTC', shocks.includes('BTC'));
  const eth = candleSeries('ETH', shocks.includes('ETH'));
  const hype = candleSeries('HYPE', shocks.includes('HYPE'));
  const ubtc = btc.map((candle) => ({ ...candle, symbol: '@142' as const }));
  const ueth = eth.map((candle) => ({ ...candle, symbol: '@151' as const }));
  return {
    candles: { BTC: btc, ETH: eth, HYPE: hype, '@142': ubtc, '@151': ueth },
    funding: {
      BTC: fundingSeries('BTC'),
      ETH: fundingSeries('ETH'),
      HYPE: fundingSeries('HYPE'),
    },
    spotPairs: {},
  };
}

describe('pure frozen signal generation', () => {
  it('returns H2,H3,H4 in frozen order and keeps a HYPE shock exploratory-only', () => {
    const batch = generateFrozenSignals(syntheticFamilyData(['HYPE']));

    expect(batch.map((trial) => trial.id)).toEqual(['H2', 'H3', 'H4']);
    expect([batch, ...batch, batch[1].exploratory, batch[1].exploratory[0]].every(Object.isFrozen))
      .toBe(true);
    expect(batch[0].primary).toEqual([]);
    expect(batch[0].exploratory).toEqual([]);
    expect(batch[1].primary).toEqual([]);
    expect(batch[1].exploratory).toHaveLength(1);
    expect(batch[1].exploratory[0]).toMatchObject({
      strategy: 'H3',
      asset: 'HYPE',
      signalIndex: SIGNAL_INDEX,
      decisionTime: HOLDOUT_START_TIME + FOUR_HOUR_MS,
      direction: -1,
    });
    expect(batch[2].primary).toEqual([]);
  });

  it('orders simultaneous primary signals BTC then ETH without leaking them into exploration', () => {
    const batch = generateFrozenSignals(syntheticFamilyData(['BTC', 'ETH']));
    const h3 = batch[1];

    expect(h3.primary.map((signal) => signal.asset)).toEqual(['BTC', 'ETH']);
    expect(h3.primary.every((signal) => signal.strategy === 'H3')).toBe(true);
    expect(h3.exploratory).toEqual([]);
  });

  it('keeps H4 primary output byte-identical when only exploratory HYPE changes', () => {
    const priorBtc = Array.from(
      { length: 180 },
      (_, index) => (index % 2 === 0 ? -0.001 : 0.001),
    );
    const priorLaggard = priorBtc.map((value, index) => (
      0.5 * value + [-0.0002, 0.0002, 0.0002, -0.0002][index % 4]
    ));
    const fixture = (hypeCurrentReturn: number): ValidatedFamilyData => {
      const data = syntheticFamilyData([]);
      const btc = candleSeriesFromReturns('BTC', [...priorBtc, 0.01, 0, 0]);
      const eth = candleSeriesFromReturns('ETH', [...priorLaggard, 0.004, 0, 0]);
      const hype = candleSeriesFromReturns('HYPE', [
        ...priorLaggard, hypeCurrentReturn, 0, 0,
      ]);
      data.candles = {
        BTC: btc,
        ETH: eth,
        HYPE: hype,
        '@142': btc.map((candle) => ({ ...candle, symbol: '@142' as const })),
        '@151': eth.map((candle) => ({ ...candle, symbol: '@151' as const })),
      };
      return data;
    };
    const withoutHypeLag = generateFrozenSignals(fixture(0.005))[2];
    const withHypeLag = generateFrozenSignals(fixture(0.004))[2];

    expect(withoutHypeLag.primary).toHaveLength(1);
    expect(fourHourArtifacts.canonicalJson(withHypeLag.primary))
      .toBe(fourHourArtifacts.canonicalJson(withoutHypeLag.primary));
    expect(withHypeLag.exploratory).not.toEqual(withoutHypeLag.exploratory);
  });

  it('retains pre-holdout signals and remaps aligned H2 indices to the global perp calendar', () => {
    const data = syntheticFamilyData([]);
    const btc = data.candles.BTC!;
    data.candles['@142'] = btc.slice(10).map((candle) => ({
      ...candle,
      symbol: '@142' as const,
      open: candle.open * 0.99,
      high: candle.high * 0.99,
      low: candle.low * 0.99,
      close: candle.close * 0.99,
    }));
    data.funding.BTC = data.funding.BTC!.map((record) => ({ ...record, rate: 0.0001 }));

    const h2Btc = generateFrozenSignals(data)[0].primary
      .filter((candidate) => candidate.asset === 'BTC');
    expect(h2Btc.length).toBeGreaterThan(0);
    expect(h2Btc[0]).toMatchObject({
      strategy: 'H2',
      signalIndex: 10,
      entryIndex: 12,
      exitIndex: 54,
    });
    expect(h2Btc[0].decisionTime).toBeLessThan(HOLDOUT_START_TIME);
  });

  it('rejects a gap instead of silently index-aligning different calendars', () => {
    const data = syntheticFamilyData([]);
    data.candles['@142']!.splice(20, 1);
    expect(() => generateFrozenSignals(data)).toThrow('invalid or non-causal');
  });
});

describe('family snapshot conversion', () => {
  it('delegates malformed envelopes to the immutable artifact validator', () => {
    expect(() => familyDataFromSnapshot({} as StoredFamilySnapshot)).toThrow();
  });

  it('deeply detaches mutable evaluator data from the retained snapshot', () => {
    const source = syntheticFamilyData([]);
    const token = (index: number, name: string) => ({
      index,
      name,
      szDecimals: 5,
      weiDecimals: 8,
      tokenId: `token-${index}`,
    });
    const snapshot = {
      dataSha256: 'a'.repeat(64),
      artifactSha256: 'b'.repeat(64),
      canonical: {
        candles: Object.fromEntries(Object.entries(source.candles).map(([symbol, candles]) => (
          [symbol, { candles }]
        ))),
        funding: Object.fromEntries(Object.entries(source.funding).map(([coin, funding]) => (
          [coin, { funding }]
        ))),
        spotMetadata: {
          pairs: {
            '@142': {
              symbol: '@142', index: 142, displayName: 'UBTC/USDC',
              baseTokenIndex: 197, quoteTokenIndex: 0, isCanonical: false,
              wrapperMultiplier: 1, tokens: [token(197, 'UBTC'), token(0, 'USDC')],
            },
            '@151': {
              symbol: '@151', index: 151, displayName: 'UETH/USDC',
              baseTokenIndex: 221, quoteTokenIndex: 0, isCanonical: false,
              wrapperMultiplier: 1, tokens: [token(221, 'UETH'), token(0, 'USDC')],
            },
          },
        },
      },
    } as unknown as StoredFamilySnapshot;
    const validator = jest.spyOn(fourHourArtifacts, 'validateStoredFamilySnapshot')
      .mockImplementationOnce(() => undefined);
    try {
      const detached = familyDataFromSnapshot(snapshot);
      const retainedBtcClose = snapshot.canonical.candles.BTC.candles[0].close;
      const detachedEthClose = detached.candles.ETH![0].close;

      detached.candles.BTC![0].close = -1;
      detached.candles.BTC!.pop();
      detached.funding.BTC![0].rate = 99;
      detached.spotPairs['@142']!.tokens[0].name = 'MUTATED';
      expect(snapshot.canonical.candles.BTC.candles[0].close).toBe(retainedBtcClose);
      expect(snapshot.canonical.candles.BTC.candles).toHaveLength(SYNTHETIC_BARS);
      expect(snapshot.canonical.funding.BTC.funding[0].rate).toBe(0);
      expect(snapshot.canonical.spotMetadata.pairs['@142'].tokens[0].name).toBe('UBTC');

      snapshot.canonical.candles.ETH.candles[0].close = -2;
      expect(detached.candles.ETH![0].close).toBe(detachedEthClose);
    } finally {
      validator.mockRestore();
    }
  });
});

describe('deterministic frozen trial evaluation', () => {
  it('builds complete primary/exploratory evidence with byte-identical stress replay', () => {
    const data = syntheticFamilyData(['BTC', 'ETH', 'HYPE']);
    const first = evaluateFrozenTrials(data);
    const second = evaluateFrozenTrials(cloned(data));

    expect(first.map((payload) => [payload.strategyId, payload.status])).toEqual([
      ['H2', 'COMPLETE'],
      ['H3', 'COMPLETE'],
      ['H4', 'COMPLETE'],
    ]);
    expect(fourHourArtifacts.canonicalJson(second)).toBe(fourHourArtifacts.canonicalJson(first));
    expect(Object.isFrozen(first)).toBe(true);

    const h3 = first[1];
    expect(h3).toMatchObject({
      familyDecision: 'PENDING',
      historicalPromotionEligible: false,
      error: null,
      exploratory: {
        asset: 'HYPE',
        classification: 'EXPLORATORY_ONLY',
        selectionEligible: false,
        historicalPromotionEligible: false,
        status: 'COMPLETE',
        error: null,
      },
    });
    expect(h3.gateMetrics).not.toHaveProperty('dsr');
    expect(h3).not.toHaveProperty('verdict');
    expect(h3.primary!.holdout.cases.base.metrics.dailyReturns).toHaveLength(365);
    expect(h3.primary!.holdout.cases.base.metrics.rawLegs).toBe(2);
    expect(h3.primary!.holdout.cases.base.metrics.completedAssetTrades).toBe(2);
    expect(h3.primary!.holdout.cases.base.metrics.effectiveEpisodes).toBe(1);
    expect(h3.primary!.holdout.cases.base.metrics.dailyReturnsSha256).toBe(
      createHash('sha256')
        .update(fourHourArtifacts.canonicalJson(
          h3.primary!.holdout.cases.base.metrics.dailyReturns,
        ))
        .digest('hex'),
    );

    for (const payload of first) {
      expect(payload.primary).not.toBeNull();
      for (const run of [
        payload.primary!.fullHistory,
        payload.primary!.holdout,
        ...payload.primary!.halves,
      ]) {
        expect(run.stressControllerByteIdentical).toBe(true);
        expect(run.stressControllerSha256).toBe(run.stressReplaySha256);
        expect(run.scheduleSha256).toBe(
          createHash('sha256')
            .update(fourHourArtifacts.canonicalJson(run.schedule))
            .digest('hex'),
        );
        expect(run.cases.base.costCase).toBe('base');
        expect(run.cases.stress.costCase).toBe('stress');
        expect(run.cases.adverseBoundaryStress.boundaryFunding).toBe('adverse_debits');
      }
    }
  });

  it('isolates an H2 signal-generation failure and still evaluates every later trial', () => {
    const data = syntheticFamilyData([]);
    data.funding.BTC!.splice(20, 1);

    const results = evaluateFrozenTrials(data);
    expect(results[0]).toMatchObject({
      strategyId: 'H2',
      status: 'ERROR',
      primary: null,
      exploratory: null,
      gateMetrics: null,
      error: { code: 'INVALID_INPUT', stage: 'signals' },
    });
    expect(results[1]).toMatchObject({ strategyId: 'H3', status: 'COMPLETE' });
    expect(results[2]).toMatchObject({ strategyId: 'H4', status: 'COMPLETE' });
    expect(results[0].error!.message).not.toMatch(/[\r\n]|[A-Za-z]:[\\/]/u);
  });

  it('has no caller-supplied signal path that can alter frozen economics', () => {
    const data = syntheticFamilyData(['BTC', 'ETH']);
    const generated = generateFrozenSignals(data);
    const injected = cloned(generated) as unknown as Array<{
      primary: Array<Record<string, unknown>>;
    }>;
    injected[1].primary[0].direction = 1;
    injected[1].primary.splice(1);

    const baseline = evaluateFrozenTrials(data);
    const legacyCall = evaluateFrozenTrials as unknown as (
      value: Readonly<ValidatedFamilyData>,
      ignoredSignals: unknown,
    ) => ReturnType<typeof evaluateFrozenTrials>;
    expect(fourHourArtifacts.canonicalJson(legacyCall(data, injected)))
      .toBe(fourHourArtifacts.canonicalJson(baseline));

    const legacySingle = evaluateFrozenTrial as unknown as (
      value: Readonly<ValidatedFamilyData>,
      invalidId: unknown,
    ) => ReturnType<typeof evaluateFrozenTrial>;
    expect(() => legacySingle(data, injected[1])).toThrow(
      'Frozen trial evaluator requires H2, H3, or H4',
    );
  });

  it('quarantines a HYPE-only failure without changing primary bytes, gates, or status', () => {
    const data = syntheticFamilyData(['BTC', 'ETH', 'HYPE']);
    const h3 = generateFrozenSignals(data)[1];
    expect(h3.primary).toHaveLength(2);
    expect(h3.exploratory).toHaveLength(1);
    const baseline = evaluateFrozenTrial(data, 'H3');
    const corruptHype = cloned(data);
    const heldFundingTime = corruptHype.candles.HYPE![h3.exploratory[0].entryIndex].openTime
      + HOUR_MS;
    const fundingIndex = corruptHype.funding.HYPE!
      .findIndex((record) => record.time === heldFundingTime);
    expect(fundingIndex).toBeGreaterThanOrEqual(0);
    corruptHype.funding.HYPE!.splice(fundingIndex, 1);
    const quarantined = evaluateFrozenTrial(corruptHype, 'H3');

    expect(baseline).toMatchObject({
      strategyId: 'H3',
      status: 'COMPLETE',
      familyDecision: 'PENDING',
      exploratory: { status: 'COMPLETE', error: null },
    });
    expect(quarantined).toMatchObject({
      strategyId: 'H3',
      status: 'COMPLETE',
      familyDecision: 'PENDING',
      error: null,
      exploratory: {
        status: 'ERROR',
        fullHistory: null,
        holdout: null,
        error: { stage: 'schedule' },
      },
    });
    expect(fourHourArtifacts.canonicalJson(quarantined.primary))
      .toBe(fourHourArtifacts.canonicalJson(baseline.primary));
    expect(fourHourArtifacts.canonicalJson(quarantined.gateMetrics))
      .toBe(fourHourArtifacts.canonicalJson(baseline.gateMetrics));
  });

  it('quarantines HYPE signal-generation errors before primary evaluation', () => {
    const data = syntheticFamilyData(['BTC', 'ETH', 'HYPE']);
    const baseline = evaluateFrozenTrial(data, 'H3');
    const corruptHype = cloned(data);
    corruptHype.candles.HYPE![17].close = Number.NaN;

    const quarantined = evaluateFrozenTrial(corruptHype, 'H3');
    expect(quarantined).toMatchObject({
      strategyId: 'H3',
      status: 'COMPLETE',
      error: null,
      exploratory: {
        status: 'ERROR',
        fullHistory: null,
        holdout: null,
        error: { code: 'INVALID_INPUT', stage: 'signals' },
      },
    });
    expect(fourHourArtifacts.canonicalJson(quarantined.primary))
      .toBe(fourHourArtifacts.canonicalJson(baseline.primary));
    expect(fourHourArtifacts.canonicalJson(quarantined.gateMetrics))
      .toBe(fourHourArtifacts.canonicalJson(baseline.gateMetrics));
  });

  it('keeps a valid early finite termination COMPLETE with a nullable bootstrap', () => {
    const data = syntheticFamilyData(['BTC']);
    const lossCandle = data.candles.BTC![SIGNAL_INDEX + 2];
    lossCandle.close = lossCandle.open * 10;
    lossCandle.high = lossCandle.close * 1.01;
    lossCandle.low = lossCandle.open * 0.99;

    const result = evaluateFrozenTrial(data, 'H3');
    expect(result).toMatchObject({
      strategyId: 'H3',
      status: 'COMPLETE',
      error: null,
      gateMetrics: { bootstrapLowerBound: null },
    });
    const base = result.primary!.holdout.cases.base.metrics;
    const stress = result.primary!.holdout.cases.stress.metrics;
    expect(base.dailyReturns.length).toBeLessThan(7);
    expect(base.termination).not.toBeNull();
    expect(stress.termination).not.toBeNull();
    expect(Math.max(base.fourHourMaxDrawdown, stress.fourHourMaxDrawdown)).toBeGreaterThan(0.08);
  });
});

async function fourHourSourceFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry): Promise<string[]> => {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) return fourHourSourceFiles(absolute);
    return entry.isFile() && entry.name.endsWith('.ts') ? [absolute] : [];
  }));
  return nested.flat().sort();
}

describe('four-hour source isolation', () => {
  it('keeps every runtime dependency inside the frozen subsystem or Node', async () => {
    const root = path.join(repositoryRoot(), 'server', 'src', 'research', 'fourHour');
    const files = await fourHourSourceFiles(root);
    const sources = await Promise.all(files.map(async (filename) => ({
      filename,
      source: await readFile(filename, 'utf8'),
    })));
    const runtimeImport = /(?:^|\n)\s*import\s+(?!type\b)(?:[\s\S]*?\s+from\s+)?['"]([^'"]+)['"]\s*;/gu;

    for (const { filename, source } of sources) {
      expect(source).not.toMatch(/\b(?:import|require)\s*\(/u);
      for (const match of source.matchAll(runtimeImport)) {
        const specifier = match[1];
        if (specifier.startsWith('node:')) continue;
        expect(specifier).toMatch(/^\.{1,2}\//u);
        const resolved = path.resolve(path.dirname(filename), specifier.replace(/\.js$/u, '.ts'));
        expect(path.relative(root, resolved)).not.toMatch(/^\.\.(?:[\\/]|$)/u);
      }
      expect(source).not.toMatch(/@supabase|CryptoCompare|Binance|Math\.random|HyperliquidService/u);
    }
  });
});
