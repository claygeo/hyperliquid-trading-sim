import { createHash } from 'node:crypto';

import type { StoredMarketSnapshot } from '../hyperliquid.js';
import {
  canonicalJson,
  validateStoredFamilySnapshot,
  type ExploratoryTrialPayload,
  type GateMetricsPayload,
  type LedgerCasePayload,
  type LedgerMetricsPayload,
  type PortfolioRunPayload,
  type PrimaryTrialPayload,
  type StoredFamilySnapshot,
  type TrialReportError,
  type TrialReportPayload,
} from './artifacts.js';
import {
  FOUR_HOUR_MS,
  HOUR_MS,
  MARKET_SYMBOLS,
  PERP_ASSETS,
  UTC_DAY_MS,
  type FourHourCandle,
  type HourlyFunding,
  type MarketSymbol,
  type PerpAsset,
  type StrategyId,
  type StrategySignal,
  type TrialWindow,
  type ValidatedFamilyData,
} from './contracts.js';
import type { DsrTrialInput } from './familyEvaluation.js';
import {
  AS_OF_TIME,
  BOOTSTRAP_CONFIG,
  CANDLE_WINDOWS,
  FAMILY_ID,
  FROZEN_TRIALS,
  HOLDOUT_HALVES,
  HOLDOUT_WINDOW,
  TRIAL_GATE_CONFIG,
  TRIAL_BY_ID,
  type FrozenTrialConfig,
} from './frozenTrials.js';
import {
  replayAcceptedCostCases,
  replayAdverseBoundarySchedule,
  type LedgerResult,
} from './ledger.js';
import {
  annualizedDailySharpe,
  circularBlockBootstrapLowerBound,
  episodeMetrics,
  maxDrawdown,
  navReturns,
  positiveAssetConcentration,
  sampleStandardDeviation,
} from './metrics.js';
import { buildAcceptedSchedule, type PortfolioKind } from './schedule.js';
import { h2CarrySignal } from './strategies/h2Carry.js';
import { h3ShockReversalSignal } from './strategies/h3ShockReversal.js';
import { h4BtcLagSignal, type LaggardAsset } from './strategies/h4BtcLag.js';

export const FROZEN_H1_FAMILY_INPUT = Object.freeze({
  trialId: 'H1-TREND-DAILY-20260722-001',
  reportSha256: '7dda9c692b4ffc0c2c14857570cff83513cfc49aed11088c934633b189064541',
  snapshotArtifactSha256: '7b5d1e864a9ac838dd13e6b8039179f1dc8e3917a7309cb518cde91dd2f404a4',
  snapshotDataSha256: '66cb46b27b36fbd28329f11d39ae25a57956bbe9563326d0f7551b67a7b0f0c4',
  codeCommit: '411f2d9a120da19a0fd65cb98879e6b9a5122695',
  specificationCommit: '87293cd8a4717c6ff766d22fc4cc0414c5838869',
  dailyNavPoints: 360,
  adjacentReturns: 359,
  dailyReturnsSha256: 'dd948c743c3a24f2b8c9eaddeb5be540343db908f3877db3f525bb09049daaaa',
} as const);

export interface H1FamilyInput extends DsrTrialInput {
  id: 'H1';
  trialId: typeof FROZEN_H1_FAMILY_INPUT.trialId;
  reportSha256: typeof FROZEN_H1_FAMILY_INPUT.reportSha256;
  snapshotArtifactSha256: typeof FROZEN_H1_FAMILY_INPUT.snapshotArtifactSha256;
  snapshotDataSha256: typeof FROZEN_H1_FAMILY_INPUT.snapshotDataSha256;
  codeCommit: typeof FROZEN_H1_FAMILY_INPUT.codeCommit;
  specificationCommit: typeof FROZEN_H1_FAMILY_INPUT.specificationCommit;
  dailyNavCount: typeof FROZEN_H1_FAMILY_INPUT.dailyNavPoints;
  dailyReturnCount: typeof FROZEN_H1_FAMILY_INPUT.adjacentReturns;
  dailyReturnsSha256: typeof FROZEN_H1_FAMILY_INPUT.dailyReturnsSha256;
  familyDsrInputAvailable: true;
  unavailabilityReason: null;
  returns: readonly number[];
}

export interface FrozenTrialSignals {
  id: StrategyId;
  trialId: string;
  primary: readonly StrategySignal[];
  exploratory: readonly StrategySignal[];
}

export type FrozenSignalBatch = readonly [
  FrozenTrialSignals,
  FrozenTrialSignals,
  FrozenTrialSignals,
];

type JsonRecord = Record<string, unknown>;

const ASSET_ORDER: Readonly<Record<PerpAsset, number>> = Object.freeze({
  BTC: 0,
  ETH: 1,
  HYPE: 2,
});

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function compareOrdinal(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function assertRecord(value: unknown, label: string): asserts value is JsonRecord {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
}

function assertExactKeys(value: unknown, keys: readonly string[], label: string): asserts value is JsonRecord {
  assertRecord(value, label);
  const actual = Object.keys(value).sort(compareOrdinal);
  const expected = [...keys].sort(compareOrdinal);
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new Error(`${label} keys mismatch`);
  }
}

function recordField(record: JsonRecord, key: string, label: string): JsonRecord {
  const value = record[key];
  assertRecord(value, `${label}.${key}`);
  return value;
}

function arrayField(record: JsonRecord, key: string, label: string): unknown[] {
  const value = record[key];
  if (!Array.isArray(value)) throw new Error(`${label}.${key} must be an array`);
  return value;
}

function normalizedLegacySnapshotData(snapshot: StoredMarketSnapshot['canonical']): unknown {
  return {
    schemaVersion: snapshot.schemaVersion,
    trialId: snapshot.trialId,
    source: snapshot.source,
    requestedWindow: snapshot.requestedWindow,
    assets: {
      BTC: snapshot.assets.BTC.candles,
      ETH: snapshot.assets.ETH.candles,
    },
  };
}

function validateLegacySnapshot(snapshot: StoredMarketSnapshot): void {
  assertExactKeys(snapshot, ['dataSha256', 'artifactSha256', 'canonical'], 'H1 snapshot');
  if (
    snapshot.dataSha256 !== FROZEN_H1_FAMILY_INPUT.snapshotDataSha256
    || snapshot.artifactSha256 !== FROZEN_H1_FAMILY_INPUT.snapshotArtifactSha256
  ) throw new Error('H1 snapshot frozen hashes mismatch');
  if (snapshot.canonical.trialId !== FROZEN_H1_FAMILY_INPUT.trialId) {
    throw new Error('H1 snapshot trial identity mismatch');
  }
  const artifactSha256 = sha256(canonicalJson(snapshot.canonical));
  const dataSha256 = sha256(canonicalJson(normalizedLegacySnapshotData(snapshot.canonical)));
  if (
    artifactSha256 !== snapshot.artifactSha256
    || dataSha256 !== snapshot.dataSha256
  ) throw new Error('H1 snapshot payload hashes mismatch');
}

function validateReportIdentity(report: unknown, snapshot: StoredMarketSnapshot): {
  report: JsonRecord;
  canonical: JsonRecord;
  result: JsonRecord;
  holdout: JsonRecord;
} {
  assertExactKeys(report, ['canonical', 'pinnedHead', 'reportSha256'], 'H1 report');
  if (
    report.reportSha256 !== FROZEN_H1_FAMILY_INPUT.reportSha256
    || report.pinnedHead !== FROZEN_H1_FAMILY_INPUT.codeCommit
  ) throw new Error('H1 report frozen outer identity mismatch');

  const canonical = recordField(report, 'canonical', 'H1 report');
  assertExactKeys(
    canonical,
    ['schemaVersion', 'trialId', 'artifactIdentity', 'data', 'result'],
    'H1 report canonical payload',
  );
  if (canonical.schemaVersion !== 1 || canonical.trialId !== FROZEN_H1_FAMILY_INPUT.trialId) {
    throw new Error('H1 report canonical identity mismatch');
  }

  const artifactIdentity = recordField(canonical, 'artifactIdentity', 'H1 report canonical payload');
  assertExactKeys(
    artifactIdentity,
    ['codeCommit', 'specificationCommit', 'snapshotArtifactSha256', 'snapshotDataSha256'],
    'H1 report artifact identity',
  );
  if (
    artifactIdentity.codeCommit !== FROZEN_H1_FAMILY_INPUT.codeCommit
    || artifactIdentity.specificationCommit !== FROZEN_H1_FAMILY_INPUT.specificationCommit
    || artifactIdentity.snapshotArtifactSha256 !== snapshot.artifactSha256
    || artifactIdentity.snapshotDataSha256 !== snapshot.dataSha256
  ) throw new Error('H1 report artifact linkage mismatch');

  const data = recordField(canonical, 'data', 'H1 report canonical payload');
  if (
    canonicalJson(data.source) !== canonicalJson(snapshot.canonical.source)
    || canonicalJson(data.requestedWindow) !== canonicalJson(snapshot.canonical.requestedWindow)
  ) throw new Error('H1 report source linkage mismatch');

  const result = recordField(canonical, 'result', 'H1 report canonical payload');
  if (result.schemaVersion !== 1 || result.trialId !== FROZEN_H1_FAMILY_INPUT.trialId) {
    throw new Error('H1 report result identity mismatch');
  }
  const config = recordField(result, 'config', 'H1 report result');
  if (config.trialId !== FROZEN_H1_FAMILY_INPUT.trialId) {
    throw new Error('H1 report config identity mismatch');
  }
  const holdout = recordField(result, 'holdout', 'H1 report result');
  return { report, canonical, result, holdout };
}

function dailyHoldoutReturns(holdout: JsonRecord): readonly number[] {
  const base = recordField(holdout, 'base', 'H1 report holdout');
  const daily = arrayField(base, 'daily', 'H1 report holdout base');
  if (daily.length !== FROZEN_H1_FAMILY_INPUT.dailyNavPoints) {
    throw new Error(`H1 holdout must contain exactly ${FROZEN_H1_FAMILY_INPUT.dailyNavPoints} NAV points`);
  }
  const startTime = holdout.startTime;
  const endTime = holdout.endTime;
  if (!Number.isInteger(startTime) || !Number.isInteger(endTime)) {
    throw new Error('H1 holdout bounds must be integer milliseconds');
  }
  const navs: number[] = [];
  daily.forEach((point, index) => {
    assertExactKeys(point, ['time', 'nav', 'exposed', 'markedGross'], `H1 daily NAV ${index}`);
    const expectedTime = Number(startTime) + (index + 1) * UTC_DAY_MS - 1;
    if (point.time !== expectedTime || !Number.isInteger(point.time)) {
      throw new Error(`H1 daily NAV ${index} chronology mismatch`);
    }
    if (typeof point.nav !== 'number' || !Number.isFinite(point.nav) || !(point.nav > 0)) {
      throw new Error(`H1 daily NAV ${index} must be finite and positive`);
    }
    navs.push(point.nav);
  });
  if (Number(startTime) + daily.length * UTC_DAY_MS - 1 !== endTime) {
    throw new Error('H1 holdout terminal timestamp mismatch');
  }

  const returns = navs.slice(1).map((nav, index) => {
    const value = nav / navs[index] - 1;
    if (!Number.isFinite(value)) throw new Error(`H1 adjacent return ${index} is not finite`);
    return value;
  });
  if (returns.length !== FROZEN_H1_FAMILY_INPUT.adjacentReturns) {
    throw new Error(`H1 family input must contain exactly ${FROZEN_H1_FAMILY_INPUT.adjacentReturns} returns`);
  }
  return Object.freeze(returns);
}

/**
 * Extract the only admissible H1 series for family DSR. There is deliberately
 * no caller-supplied identity or fallback reconstruction path.
 */
export function extractH1FamilyInput(
  parsedReport: unknown,
  snapshot: StoredMarketSnapshot,
): H1FamilyInput {
  validateLegacySnapshot(snapshot);
  const validated = validateReportIdentity(parsedReport, snapshot);
  const returns = dailyHoldoutReturns(validated.holdout);
  if (sha256(canonicalJson(validated.canonical)) !== FROZEN_H1_FAMILY_INPUT.reportSha256) {
    throw new Error('H1 report canonical hash mismatch');
  }
  const dailyReturnsSha256 = sha256(canonicalJson(returns));
  if (dailyReturnsSha256 !== FROZEN_H1_FAMILY_INPUT.dailyReturnsSha256) {
    throw new Error('H1 daily return vector hash mismatch');
  }
  return Object.freeze({
    id: 'H1',
    trialId: FROZEN_H1_FAMILY_INPUT.trialId,
    reportSha256: FROZEN_H1_FAMILY_INPUT.reportSha256,
    snapshotArtifactSha256: FROZEN_H1_FAMILY_INPUT.snapshotArtifactSha256,
    snapshotDataSha256: FROZEN_H1_FAMILY_INPUT.snapshotDataSha256,
    codeCommit: FROZEN_H1_FAMILY_INPUT.codeCommit,
    specificationCommit: FROZEN_H1_FAMILY_INPUT.specificationCommit,
    dailyNavCount: FROZEN_H1_FAMILY_INPUT.dailyNavPoints,
    dailyReturnCount: FROZEN_H1_FAMILY_INPUT.adjacentReturns,
    dailyReturnsSha256: FROZEN_H1_FAMILY_INPUT.dailyReturnsSha256,
    familyDsrInputAvailable: true,
    unavailabilityReason: null,
    returns,
  });
}

function copyCandle(candle: FourHourCandle): FourHourCandle {
  return { ...candle };
}

function copyFunding(record: HourlyFunding): HourlyFunding {
  return { ...record };
}

/** Validate the immutable artifact, then detach the evaluator's mutable working data. */
export function familyDataFromSnapshot(snapshot: StoredFamilySnapshot): ValidatedFamilyData {
  validateStoredFamilySnapshot(snapshot);
  const candles = Object.fromEntries(MARKET_SYMBOLS.map((symbol) => [
    symbol,
    snapshot.canonical.candles[symbol].candles.map(copyCandle),
  ])) as ValidatedFamilyData['candles'];
  const funding = Object.fromEntries(PERP_ASSETS.map((coin) => [
    coin,
    snapshot.canonical.funding[coin].funding.map(copyFunding),
  ])) as ValidatedFamilyData['funding'];
  const ubtc = snapshot.canonical.spotMetadata.pairs['@142'];
  const ueth = snapshot.canonical.spotMetadata.pairs['@151'];
  return {
    candles,
    funding,
    spotPairs: {
      '@142': { ...ubtc, tokens: [{ ...ubtc.tokens[0] }, { ...ubtc.tokens[1] }] },
      '@151': { ...ueth, tokens: [{ ...ueth.tokens[0] }, { ...ueth.tokens[1] }] },
    },
  };
}

function requiredCandles(
  data: Readonly<ValidatedFamilyData>,
  symbol: MarketSymbol,
): readonly FourHourCandle[] {
  const candles = data.candles[symbol];
  if (!candles || candles.length === 0) throw new Error(`Missing ${symbol} candle series`);
  candles.forEach((candle, index) => {
    const expectedOpen = index === 0
      ? candle.openTime
      : candles[index - 1].openTime + FOUR_HOUR_MS;
    if (
      candle.symbol !== symbol
      || candle.interval !== '4h'
      || !Number.isInteger(candle.openTime)
      || candle.openTime % FOUR_HOUR_MS !== 0
      || candle.openTime !== expectedOpen
      || candle.closeTime !== candle.openTime + FOUR_HOUR_MS - 1
      || ![candle.open, candle.high, candle.low, candle.close, candle.volume].every(Number.isFinite)
      || candle.open <= 0
      || candle.low <= 0
      || candle.high < Math.max(candle.open, candle.close)
      || candle.low > Math.min(candle.open, candle.close)
      || candle.volume < 0
    ) throw new Error(`${symbol} candle ${index} is invalid or non-causal`);
  });
  return candles;
}

function requiredFunding(
  data: Readonly<ValidatedFamilyData>,
  coin: PerpAsset,
): readonly HourlyFunding[] {
  const funding = data.funding[coin];
  if (!funding || funding.length === 0) throw new Error(`Missing ${coin} funding series`);
  funding.forEach((record, index) => {
    const expectedTime = index === 0 ? record.time : funding[index - 1].time + HOUR_MS;
    if (
      record.coin !== coin
      || !Number.isInteger(record.time)
      || record.time % HOUR_MS !== 0
      || record.time !== expectedTime
      || !Number.isFinite(record.rate)
    ) throw new Error(`${coin} funding ${index} is invalid or non-causal`);
  });
  return funding;
}

function alignedTail(
  left: readonly FourHourCandle[],
  right: readonly FourHourCandle[],
  label: string,
): [readonly FourHourCandle[], readonly FourHourCandle[]] {
  const startTime = Math.max(left[0].openTime, right[0].openTime);
  const leftStart = left.findIndex((candle) => candle.openTime === startTime);
  const rightStart = right.findIndex((candle) => candle.openTime === startTime);
  if (leftStart < 0 || rightStart < 0) throw new Error(`${label} has no exact common start`);
  const leftTail = left.slice(leftStart);
  const rightTail = right.slice(rightStart);
  if (leftTail.length === 0 || leftTail.length !== rightTail.length) {
    throw new Error(`${label} aligned tail length mismatch`);
  }
  leftTail.forEach((candle, index) => {
    if (
      candle.openTime !== rightTail[index].openTime
      || candle.closeTime !== rightTail[index].closeTime
    ) throw new Error(`${label} calendar mismatch at ${index}`);
  });
  return [leftTail, rightTail];
}

function inFrozenHistory(signal: StrategySignal): boolean {
  return signal.decisionTime < AS_OF_TIME;
}

function remapSignalIndex(signal: StrategySignal, offset: number): StrategySignal {
  if (!Number.isSafeInteger(offset) || offset < 0) throw new Error('Signal index offset is invalid');
  if (offset === 0) return signal;
  return {
    ...signal,
    signalIndex: signal.signalIndex + offset,
    entryIndex: signal.entryIndex + offset,
    exitIndex: signal.exitIndex + offset,
  };
}

function sortSignals(signals: StrategySignal[]): readonly StrategySignal[] {
  signals.sort((left, right) => (
    left.decisionTime - right.decisionTime
    || ASSET_ORDER[left.asset] - ASSET_ORDER[right.asset]
    || left.signalIndex - right.signalIndex
  ));
  return Object.freeze(signals.map((signal) => Object.freeze(signal)));
}

function generateH2(data: Readonly<ValidatedFamilyData>): FrozenTrialSignals {
  const trial = FROZEN_TRIALS[0];
  if (trial.id !== 'H2') throw new Error('Frozen trial registry order mismatch');
  const primary: StrategySignal[] = [];
  for (const asset of trial.primaryAssets) {
    const perp = requiredCandles(data, trial.perpSymbols[asset]);
    const spot = requiredCandles(data, trial.spotSymbols[asset]);
    const funding = requiredFunding(data, asset);
    const [alignedPerp, alignedSpot] = alignedTail(perp, spot, `H2 ${asset}`);
    const perpIndexOffset = perp.length - alignedPerp.length;
    for (let signalIndex = 0; signalIndex < alignedPerp.length; signalIndex += 1) {
      const decisionTime = alignedPerp[signalIndex].openTime + FOUR_HOUR_MS;
      const fundingStart = decisionTime - trial.fundingLookbackHours * HOUR_MS;
      const fundingOffset = (fundingStart - funding[0].time) / HOUR_MS;
      if (!Number.isInteger(fundingOffset) || fundingOffset < 0) {
        throw new Error(`H2 ${asset} funding does not cover the causal lookback`);
      }
      const causalFunding = funding.slice(
        fundingOffset,
        fundingOffset + trial.fundingLookbackHours,
      );
      const localSignal = h2CarrySignal({
        asset,
        signalIndex,
        perpCandles: alignedPerp,
        spotCandles: alignedSpot,
        funding: causalFunding,
      });
      if (localSignal) {
        const signal = remapSignalIndex(localSignal, perpIndexOffset);
        if (inFrozenHistory(signal)) primary.push(signal);
      }
    }
  }
  return Object.freeze({
    id: trial.id,
    trialId: trial.trialId,
    primary: sortSignals(primary),
    exploratory: Object.freeze([]),
  });
}

function generateH3Assets(
  data: Readonly<ValidatedFamilyData>,
  assets: readonly PerpAsset[],
): readonly StrategySignal[] {
  const trial = FROZEN_TRIALS[1];
  if (trial.id !== 'H3') throw new Error('Frozen trial registry order mismatch');
  const signals: StrategySignal[] = [];
  for (const asset of assets) {
    const candles = requiredCandles(data, asset);
    for (let signalIndex = 0; signalIndex < candles.length; signalIndex += 1) {
      const signal = h3ShockReversalSignal({ asset, signalIndex, candles });
      if (signal && inFrozenHistory(signal)) signals.push(signal);
    }
  }
  return sortSignals(signals);
}

function generateH3(data: Readonly<ValidatedFamilyData>): FrozenTrialSignals {
  const trial = FROZEN_TRIALS[1];
  if (trial.id !== 'H3') throw new Error('Frozen trial registry order mismatch');
  return Object.freeze({
    id: trial.id,
    trialId: trial.trialId,
    primary: generateH3Assets(data, trial.primaryAssets),
    exploratory: generateH3Assets(data, trial.exploratoryAssets),
  });
}

function generateH4Assets(
  data: Readonly<ValidatedFamilyData>,
  assets: readonly PerpAsset[],
): readonly StrategySignal[] {
  const trial = FROZEN_TRIALS[2];
  if (trial.id !== 'H4') throw new Error('Frozen trial registry order mismatch');
  const btc = requiredCandles(data, 'BTC');
  const signals: StrategySignal[] = [];
  for (const asset of assets) {
    if (asset === 'BTC') throw new Error('H4 laggard cannot be BTC');
    const laggard = requiredCandles(data, asset);
    const [alignedBtc, alignedLaggard] = alignedTail(btc, laggard, `H4 BTC/${asset}`);
    const laggardIndexOffset = laggard.length - alignedLaggard.length;
    for (let signalIndex = 0; signalIndex < alignedBtc.length; signalIndex += 1) {
      const localSignal = h4BtcLagSignal({
        asset: asset as LaggardAsset,
        signalIndex,
        btcCandles: alignedBtc,
        laggardCandles: alignedLaggard,
      });
      if (localSignal) {
        const signal = remapSignalIndex(localSignal, laggardIndexOffset);
        if (inFrozenHistory(signal)) signals.push(signal);
      }
    }
  }
  return sortSignals(signals);
}

function generateH4(data: Readonly<ValidatedFamilyData>): FrozenTrialSignals {
  const trial = FROZEN_TRIALS[2];
  if (trial.id !== 'H4') throw new Error('Frozen trial registry order mismatch');
  return Object.freeze({
    id: trial.id,
    trialId: trial.trialId,
    primary: generateH4Assets(data, trial.primaryAssets),
    exploratory: generateH4Assets(data, trial.exploratoryAssets),
  });
}

function assertFrozenRegistry(trials: readonly Readonly<FrozenTrialConfig>[]): void {
  if (trials.length !== 3 || trials.map((trial) => trial.id).join(',') !== 'H2,H3,H4') {
    throw new Error('Frozen trial registry must remain H2,H3,H4');
  }
}

/** Generate all preregistered candidate signals; no trial or economic flags exist. */
export function generateFrozenSignals(data: Readonly<ValidatedFamilyData>): FrozenSignalBatch {
  assertFrozenRegistry(FROZEN_TRIALS);
  return Object.freeze([generateH2(data), generateH3(data), generateH4(data)]);
}

type EvaluationStage = TrialReportError['stage'];

class TrialEvaluationFailure extends Error {
  constructor(
    readonly code: TrialReportError['code'],
    readonly stage: EvaluationStage,
    message: string,
  ) {
    super(message);
    this.name = 'TrialEvaluationFailure';
  }
}

const COMMON_LIMITATIONS = Object.freeze([
  'Historical metrics are research evidence only and authorize neither paper nor live trading.',
  'Four-hour marks do not model intrabar liquidation paths.',
] as const);

function trialLimitations(id: StrategyId): string[] {
  const limitations: string[] = [...COMMON_LIMITATIONS];
  if (id === 'H2') {
    limitations.push('UBTC and UETH wrapper redemption parity and live execution eligibility are not established.');
  }
  if (id === 'H3' || id === 'H4') {
    limitations.push('HYPE results are exploratory-only and cannot affect selection or historical promotion.');
  }
  if (id === 'H4') {
    limitations.push('H4 primary is structurally single-asset ETH; cross-asset concentration is not applicable.');
  }
  return limitations;
}

function cleanErrorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  const firstLine = raw.split(/[\r\n]/u, 1)[0]
    .replace(/[A-Za-z]:[\\/][^\s]+/gu, '[path]')
    .replace(/\/(?:Users|home|var|tmp)\/[^\s]+/gu, '[path]')
    .trim();
  return (firstLine || 'Unclassified deterministic evaluator failure').slice(0, 500);
}

function failure(
  code: TrialReportError['code'],
  stage: EvaluationStage,
  message: string,
): never {
  throw new TrialEvaluationFailure(code, stage, message);
}

function primarySignalsForTrial(
  data: Readonly<ValidatedFamilyData>,
  trial: Readonly<FrozenTrialConfig>,
): readonly StrategySignal[] {
  try {
    if (trial.id === 'H2') return generateH2(data).primary;
    if (trial.id === 'H3') return generateH3Assets(data, trial.primaryAssets);
    return generateH4Assets(data, trial.primaryAssets);
  } catch (error) {
    failure('INVALID_INPUT', 'signals', cleanErrorMessage(error));
  }
}

function exploratorySignalsForTrial(
  data: Readonly<ValidatedFamilyData>,
  trial: Readonly<FrozenTrialConfig>,
): readonly StrategySignal[] {
  if (trial.id === 'H2') return Object.freeze([]);
  try {
    return trial.id === 'H3'
      ? generateH3Assets(data, trial.exploratoryAssets)
      : generateH4Assets(data, trial.exploratoryAssets);
  } catch (error) {
    failure('INVALID_INPUT', 'signals', cleanErrorMessage(error));
  }
}

function sha256Canonical(value: unknown): string {
  return sha256(canonicalJson(value));
}

function cloneSignal(signal: Readonly<StrategySignal>): StrategySignal {
  return { ...signal };
}

function signalsForWindow(
  signals: readonly StrategySignal[],
  window: Readonly<TrialWindow>,
): StrategySignal[] {
  return signals
    .filter((signal) => signal.decisionTime >= window.startTime && signal.decisionTime < window.endTime)
    .map(cloneSignal);
}

function fullHistoryWindow(trial: Readonly<FrozenTrialConfig>, portfolio: PortfolioKind): TrialWindow {
  if (portfolio === 'exploratory') {
    if (trial.id === 'H2') failure('INVALID_INPUT', 'signals', 'H2 has no exploratory portfolio');
    return { startTime: CANDLE_WINDOWS.HYPE.startTime, endTime: AS_OF_TIME };
  }
  return {
    startTime: trial.id === 'H2'
      ? Math.max(CANDLE_WINDOWS['@142'].startTime, CANDLE_WINDOWS['@151'].startTime)
      : Math.max(CANDLE_WINDOWS.BTC.startTime, CANDLE_WINDOWS.ETH.startTime),
    endTime: AS_OF_TIME,
  };
}

function assertFiniteLedger(result: Readonly<LedgerResult>, label: string): void {
  try {
    canonicalJson(result);
  } catch (error) {
    failure('NON_FINITE_LEDGER', 'ledger', `${label}: ${cleanErrorMessage(error)}`);
  }
}

function ledgerMetrics(
  ledger: Readonly<LedgerResult>,
  schedule: PortfolioRunPayload['schedule'],
): LedgerMetricsPayload {
  assertFiniteLedger(ledger, 'Ledger result is not canonical finite JSON');
  let dailyReturns: number[];
  let dailyVolatility: number | null;
  let annualizedSharpe: number | null;
  let episodes: ReturnType<typeof episodeMetrics>;
  try {
    dailyReturns = navReturns(ledger.dailyNav);
    dailyVolatility = sampleStandardDeviation(dailyReturns);
    annualizedSharpe = dailyReturns.length === 0 ? null : annualizedDailySharpe(dailyReturns);
    episodes = episodeMetrics(ledger.episodes);
  } catch (error) {
    failure('NON_FINITE_LEDGER', 'metrics', cleanErrorMessage(error));
  }

  const scheduledById = new Map(schedule.positions.map((position) => [position.id, position]));
  let rawLegs = 0;
  for (const completed of ledger.completedPositions) {
    const position = scheduledById.get(completed.id);
    if (!position) {
      failure('CHRONOLOGY', 'metrics', `Completed position ${completed.id} is absent from its schedule`);
    }
    rawLegs += position.legs.length;
  }
  const largestPositiveEpisodePnl = ledger.episodes.reduce<number | null>(
    (largest, episode) => episode.pnl > 0 && (largest === null || episode.pnl > largest)
      ? episode.pnl
      : largest,
    null,
  );
  const metrics: LedgerMetricsPayload = {
    endingNav: ledger.endingNav,
    adjustedPnl: ledger.adjustedPnl,
    funding: ledger.funding,
    fees: ledger.fees,
    slippage: ledger.slippage,
    turnover: ledger.turnover,
    fourHourMaxDrawdown: maxDrawdown(ledger.navPoints),
    dailyReturns,
    dailyReturnsSha256: sha256Canonical(dailyReturns),
    dailyVolatility,
    annualizedDailySharpe: annualizedSharpe,
    rawLegs,
    completedAssetTrades: ledger.completedPositions.length,
    effectiveEpisodes: episodes.count,
    episodeExpectancy: episodes.expectancy,
    winRate: episodes.winRate,
    profitFactor: episodes.profitFactor,
    largestPositiveEpisodePnl,
    topFivePositiveEpisodeConcentration: episodes.topFivePositiveConcentration,
    pnlByAsset: {
      BTC: { ...ledger.pnlByAsset.BTC },
      ETH: { ...ledger.pnlByAsset.ETH },
      HYPE: { ...ledger.pnlByAsset.HYPE },
    },
    maximumMarkedGross: ledger.maximumMarkedGross,
    maximumGrossToNav: ledger.maximumGrossToNav,
    maximumLongGross: ledger.maximumLongGross,
    maximumShortGross: ledger.maximumShortGross,
    termination: ledger.termination ? { ...ledger.termination } : null,
  };
  try {
    canonicalJson(metrics);
  } catch (error) {
    failure('NON_FINITE_LEDGER', 'metrics', cleanErrorMessage(error));
  }
  return metrics;
}

function ledgerCase(
  ledger: LedgerResult,
  schedule: PortfolioRunPayload['schedule'],
): LedgerCasePayload {
  return {
    costCase: ledger.costCase,
    boundaryFunding: ledger.boundaryFunding,
    ledger,
    metrics: ledgerMetrics(ledger, schedule),
  };
}

function runPortfolio(
  data: Readonly<ValidatedFamilyData>,
  trial: Readonly<FrozenTrialConfig>,
  portfolio: PortfolioKind,
  allSignals: readonly StrategySignal[],
  window: Readonly<TrialWindow>,
): PortfolioRunPayload {
  const signals = signalsForWindow(allSignals, window);
  let built: ReturnType<typeof buildAcceptedSchedule>;
  try {
    built = buildAcceptedSchedule({ trial, portfolio, signals, data, window });
  } catch (error) {
    failure('CHRONOLOGY', 'schedule', cleanErrorMessage(error));
  }

  let replay: ReturnType<typeof replayAcceptedCostCases>;
  let adverse: LedgerResult;
  try {
    replay = replayAcceptedCostCases({ schedule: built.schedule, data, window });
    adverse = replayAdverseBoundarySchedule({ schedule: built.schedule, data, window });
  } catch (error) {
    const message = cleanErrorMessage(error);
    const code = /finite|NaN|Infinity|positive NAV|non-positive NAV/iu.test(message)
      ? 'NON_FINITE_LEDGER'
      : 'CHRONOLOGY';
    failure(code, 'ledger', message);
  }
  assertFiniteLedger(built.stressController, 'Stress controller ledger is invalid');
  assertFiniteLedger(replay.base, 'Base replay ledger is invalid');
  assertFiniteLedger(replay.stress, 'Stress replay ledger is invalid');
  assertFiniteLedger(adverse, 'Adverse-boundary replay ledger is invalid');

  const stressControllerBytes = canonicalJson(built.stressController);
  const stressReplayBytes = canonicalJson(replay.stress);
  if (stressControllerBytes !== stressReplayBytes) {
    failure(
      'NON_DETERMINISTIC_REPLAY',
      'ledger',
      'Stress controller and stress replay are not byte-identical',
    );
  }
  const schedule = {
    trialId: built.schedule.trialId,
    positions: built.schedule.positions.map((position) => ({
      ...position,
      legs: position.legs.map((leg) => ({ ...leg })),
    })),
    skipped: built.schedule.skipped.map((item) => ({ ...item })),
  };
  return {
    portfolio,
    assets: [...(portfolio === 'primary' ? trial.primaryAssets : trial.exploratoryAssets)],
    window: { ...window },
    signals,
    schedule,
    scheduleSha256: sha256Canonical(schedule),
    stressControllerSha256: sha256(stressControllerBytes),
    stressReplaySha256: sha256(stressReplayBytes),
    stressControllerByteIdentical: true,
    cases: {
      base: ledgerCase(replay.base, schedule),
      stress: ledgerCase(replay.stress, schedule),
      adverseBoundaryStress: ledgerCase(adverse, schedule),
    },
  };
}

function primaryPayload(
  data: Readonly<ValidatedFamilyData>,
  trial: Readonly<FrozenTrialConfig>,
  signals: readonly StrategySignal[],
): PrimaryTrialPayload {
  return {
    fullHistory: runPortfolio(data, trial, 'primary', signals, fullHistoryWindow(trial, 'primary')),
    holdout: runPortfolio(data, trial, 'primary', signals, HOLDOUT_WINDOW),
    halves: [
      runPortfolio(data, trial, 'primary', signals, HOLDOUT_HALVES[0]),
      runPortfolio(data, trial, 'primary', signals, HOLDOUT_HALVES[1]),
    ],
  };
}

function exploratoryPayload(
  data: Readonly<ValidatedFamilyData>,
  trial: Readonly<FrozenTrialConfig>,
  signals: readonly StrategySignal[],
): ExploratoryTrialPayload | null {
  if (trial.id === 'H2') return null;
  const boundary = {
    asset: 'HYPE',
    classification: 'EXPLORATORY_ONLY',
    selectionEligible: false,
    historicalPromotionEligible: false,
  } as const;
  try {
    return {
      ...boundary,
      status: 'COMPLETE',
      fullHistory: runPortfolio(
        data,
        trial,
        'exploratory',
        signals,
        fullHistoryWindow(trial, 'exploratory'),
      ),
      holdout: runPortfolio(data, trial, 'exploratory', signals, HOLDOUT_WINDOW),
      error: null,
    };
  } catch (error) {
    const classified = error instanceof TrialEvaluationFailure
      ? error
      : new TrialEvaluationFailure(
        'UNCLASSIFIED_RUNTIME_FAILURE',
        'metrics',
        cleanErrorMessage(error),
      );
    return {
      ...boundary,
      status: 'ERROR',
      fullHistory: null,
      holdout: null,
      error: {
        code: classified.code,
        stage: classified.stage,
        message: cleanErrorMessage(classified),
      },
    };
  }
}

function isolatedExploratoryPayload(
  data: Readonly<ValidatedFamilyData>,
  trial: Readonly<FrozenTrialConfig>,
): ExploratoryTrialPayload | null {
  if (trial.id === 'H2') return null;
  try {
    return exploratoryPayload(data, trial, exploratorySignalsForTrial(data, trial));
  } catch (error) {
    const classified = error instanceof TrialEvaluationFailure
      ? error
      : new TrialEvaluationFailure(
        'UNCLASSIFIED_RUNTIME_FAILURE',
        'signals',
        cleanErrorMessage(error),
      );
    return {
      asset: 'HYPE',
      classification: 'EXPLORATORY_ONLY',
      selectionEligible: false,
      historicalPromotionEligible: false,
      status: 'ERROR',
      fullHistory: null,
      holdout: null,
      error: {
        code: classified.code,
        stage: classified.stage,
        message: cleanErrorMessage(classified),
      },
    };
  }
}

function gateMetrics(
  trial: Readonly<FrozenTrialConfig>,
  primary: Readonly<PrimaryTrialPayload>,
): GateMetricsPayload {
  const holdout = primary.holdout;
  const base = holdout.cases.base;
  const stress = holdout.cases.stress;
  const adverse = holdout.cases.adverseBoundaryStress;
  let bootstrapLowerBound: number | null;
  const validEarlyTermination = base.metrics.termination !== null
    || stress.metrics.termination !== null;
  if (
    validEarlyTermination
    && base.metrics.dailyReturns.length < BOOTSTRAP_CONFIG.blockLength
  ) {
    // A finite insolvency is a valid terminal ledger and has an explicit REJECT
    // outcome. Do not turn that known rejection into an ERROR merely because the
    // resulting series is shorter than the bootstrap block.
    bootstrapLowerBound = null;
  } else {
    try {
      bootstrapLowerBound = circularBlockBootstrapLowerBound(base.metrics.dailyReturns, trial.trialId);
    } catch (error) {
      failure('INVALID_INPUT', 'metrics', cleanErrorMessage(error));
    }
  }
  const requiredSleeves = trial.primaryAssets.map((asset) => ({
    asset,
    adjustedPnl: base.ledger.pnlByAsset[asset].adjustedPnl,
    hadExposure: base.ledger.completedPositions.some((position) => position.asset === asset),
  }));
  const applicable = TRIAL_GATE_CONFIG.assetConcentrationApplicable[trial.id];
  return {
    baseExpectancy: base.metrics.episodeExpectancy,
    stressExpectancy: stress.metrics.episodeExpectancy,
    adverseBoundaryStressExpectancy: adverse.metrics.episodeExpectancy,
    baseMaxDrawdown: base.metrics.fourHourMaxDrawdown,
    stressMaxDrawdown: stress.metrics.fourHourMaxDrawdown,
    requiredSleeves,
    halfAdjustedPnl: [
      primary.halves[0].cases.base.metrics.adjustedPnl,
      primary.halves[1].cases.base.metrics.adjustedPnl,
    ],
    effectiveEpisodes: base.metrics.effectiveEpisodes,
    baseAnnualizedSharpe: base.metrics.annualizedDailySharpe,
    baseProfitFactor: base.metrics.profitFactor,
    stressAdjustedPnl: stress.metrics.adjustedPnl,
    bootstrapLowerBound,
    topFiveConcentration: base.metrics.topFivePositiveEpisodeConcentration,
    assetConcentration: applicable ? positiveAssetConcentration({
      BTC: base.ledger.pnlByAsset.BTC.adjustedPnl,
      ETH: base.ledger.pnlByAsset.ETH.adjustedPnl,
      HYPE: base.ledger.pnlByAsset.HYPE.adjustedPnl,
    }) : null,
    assetConcentrationApplicable: applicable,
    requiredSleevesWithExposure: requiredSleeves.every((sleeve) => sleeve.hadExposure),
  };
}

function completeTrialPayload(
  data: Readonly<ValidatedFamilyData>,
  trial: Readonly<FrozenTrialConfig>,
): TrialReportPayload {
  const primary = primaryPayload(data, trial, primarySignalsForTrial(data, trial));
  const exploratory = isolatedExploratoryPayload(data, trial);
  return {
    schemaVersion: 1,
    kind: 'trial_metrics',
    familyId: FAMILY_ID,
    strategyId: trial.id,
    trialId: trial.trialId,
    status: 'COMPLETE',
    familyDecision: 'PENDING',
    historicalPromotionEligible: false,
    primary,
    exploratory,
    gateMetrics: gateMetrics(trial, primary),
    error: null,
    limitations: trialLimitations(trial.id),
  };
}

function errorTrialPayload(
  trial: Readonly<FrozenTrialConfig>,
  error: unknown,
): TrialReportPayload {
  const classified = error instanceof TrialEvaluationFailure
    ? error
    : new TrialEvaluationFailure(
      'UNCLASSIFIED_RUNTIME_FAILURE',
      'metrics',
      cleanErrorMessage(error),
    );
  return {
    schemaVersion: 1,
    kind: 'trial_metrics',
    familyId: FAMILY_ID,
    strategyId: trial.id,
    trialId: trial.trialId,
    status: 'ERROR',
    familyDecision: 'PENDING',
    historicalPromotionEligible: false,
    primary: null,
    exploratory: null,
    gateMetrics: null,
    error: {
      code: classified.code,
      stage: classified.stage,
      message: cleanErrorMessage(classified),
    },
    limitations: trialLimitations(trial.id),
  };
}

function evaluateTrialAtIndex(
  data: Readonly<ValidatedFamilyData>,
  trial: Readonly<FrozenTrialConfig>,
): TrialReportPayload {
  try {
    return completeTrialPayload(data, trial);
  } catch (error) {
    return errorTrialPayload(trial, error);
  }
}

/** Evaluate one frozen trial without performing I/O or making a family decision. */
export function evaluateFrozenTrial(
  data: Readonly<ValidatedFamilyData>,
  id: StrategyId,
): TrialReportPayload {
  const trial = TRIAL_BY_ID[id];
  if (!trial) throw new Error('Frozen trial evaluator requires H2, H3, or H4');
  return evaluateTrialAtIndex(data, trial);
}

/** Evaluate H2-H4 independently; an ERROR payload never short-circuits a later trial. */
export function evaluateFrozenTrials(
  data: Readonly<ValidatedFamilyData>,
): readonly [TrialReportPayload, TrialReportPayload, TrialReportPayload] {
  return Object.freeze([
    evaluateTrialAtIndex(data, FROZEN_TRIALS[0]),
    evaluateTrialAtIndex(data, FROZEN_TRIALS[1]),
    evaluateTrialAtIndex(data, FROZEN_TRIALS[2]),
  ]);
}
