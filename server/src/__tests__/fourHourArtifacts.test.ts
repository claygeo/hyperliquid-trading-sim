import { createHash } from 'node:crypto';
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  buildFamilyReport,
  buildStoredFamilySnapshot,
  buildTrialReport,
  calculateFamilySnapshotHashes,
  calculateSourceBundleSha256,
  canonicalJson,
  collectEvaluatorSourceBundle,
  deriveFamilyReportPayload,
  readFamilyReport,
  readFamilySnapshot,
  readInitialTrialBatch,
  readTrialReport,
  validateFamilySnapshot,
  writeFamilyReport,
  writeFamilySnapshot,
  writeInitialTrialBatch,
  writeTrialReport,
  type CanonicalFamilySnapshot,
  type FamilyReportEvidence,
  type StoredFamilySnapshot,
  type StoredTrialReport,
  type TrialReportPayload,
} from '../research/fourHour/artifacts.js';
import {
  FOUR_HOUR_MS,
  HOUR_MS,
  MARKET_SYMBOLS,
  PERP_ASSETS,
  type CandleSeriesSnapshot,
  type FundingSeriesSnapshot,
  type MarketSymbol,
  type PerpAsset,
  type RawPageEvidence,
  type SpotSymbol,
} from '../research/fourHour/contracts.js';
import {
  AS_OF_TIME,
  CANDLE_WINDOWS,
  FAMILY_ID,
  FUNDING_WINDOWS,
  H2_CONFIG,
  H3_CONFIG,
  H4_CONFIG,
  SPECIFICATION_COMMIT,
} from '../research/fourHour/frozenTrials.js';
import {
  HYPERLIQUID_INFO_ENDPOINT,
  type ParsedSpotPairMetadata,
  type ParsedSpotTokenMetadata,
} from '../research/fourHour/hyperliquid.js';
import type { StoredMarketSnapshot } from '../research/hyperliquid.js';
import {
  FROZEN_H1_FAMILY_INPUT,
  evaluateFrozenTrials,
  extractH1FamilyInput,
  familyDataFromSnapshot,
} from '../research/fourHour/runner.js';

const FETCHED_AT = '2026-07-23T06:00:00.000Z';
const SNAPSHOT_EVALUATOR = {
  codeCommit: 'a'.repeat(40),
  cleanWorktree: true as const,
  sourceBundleSha256: hash('synthetic snapshot evaluator'),
};
const RUN_EVALUATOR = {
  codeCommit: 'd'.repeat(40),
  cleanWorktree: true as const,
  sourceBundleSha256: hash('synthetic run evaluator'),
};

const temporaryDirectories: string[] = [];

function hash(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

async function temporaryDirectory(label: string): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), `hl-four-hour-${label}-`));
  temporaryDirectories.push(directory);
  return directory;
}

function repositoryRoot(): string {
  return path.basename(process.cwd()) === 'server' ? path.dirname(process.cwd()) : process.cwd();
}

function pageEvidence(
  label: string,
  page: number,
  requestedStartTime: number,
  requestedEndTime: number,
  rows: number,
): RawPageEvidence {
  return {
    page,
    requestedStartTime,
    requestedEndTime,
    responseRows: rows,
    acceptedRows: rows,
    firstTime: requestedStartTime,
    lastTime: requestedEndTime,
    rawResponseSha256: hash(`${label}-${page}`),
    fetchedAt: FETCHED_AT,
  };
}

function candleSnapshot(symbol: MarketSymbol): CandleSeriesSnapshot {
  const window = CANDLE_WINDOWS[symbol];
  const candles = Array.from({ length: window.expectedBars }, (_, index) => {
    const openTime = window.startTime + index * FOUR_HOUR_MS;
    const drift = index % 17 / 100;
    return {
      symbol,
      interval: '4h' as const,
      openTime,
      closeTime: openTime + FOUR_HOUR_MS - 1,
      open: 100 + drift,
      high: 102 + drift,
      low: 98 + drift,
      close: 101 + drift,
      volume: index % 101,
    };
  });
  const pages = Array.from({ length: Math.ceil(window.expectedBars / 500) }, (_, index) => {
    const offset = index * 500;
    const rows = Math.min(500, window.expectedBars - offset);
    const start = window.startTime + offset * FOUR_HOUR_MS;
    return pageEvidence(`${symbol}-candle`, index + 1, start, start + rows * FOUR_HOUR_MS - 1, rows);
  });
  return { ...window, pages, candles };
}

function fundingSnapshot(coin: PerpAsset): FundingSeriesSnapshot {
  const window = FUNDING_WINDOWS[coin];
  const funding = Array.from({ length: window.expectedHours }, (_, index) => ({
    coin,
    time: window.startTime + index * HOUR_MS,
    rate: (index % 7 - 3) / 1_000_000,
  }));
  const pages = Array.from({ length: Math.ceil(window.expectedHours / 500) }, (_, index) => {
    const offset = index * 500;
    const rows = Math.min(500, window.expectedHours - offset);
    const start = window.startTime + offset * HOUR_MS;
    return pageEvidence(`${coin}-funding`, index + 1, start, start + (rows - 1) * HOUR_MS, rows);
  });
  return { ...window, pages, funding };
}

function token(
  index: number,
  name: 'UBTC' | 'UETH' | 'USDC',
  isCanonical: boolean,
): ParsedSpotTokenMetadata {
  return {
    index,
    name,
    szDecimals: name === 'USDC' ? 8 : 5,
    weiDecimals: 8,
    tokenId: `0x${name.toLowerCase()}-${index}`,
    isCanonical,
    evmContract: name === 'USDC' ? null : `0x${name.toLowerCase()}-contract`,
    fullName: name === 'USDC' ? 'USD Coin' : `Unit ${name.slice(1)}`,
  };
}

function spotPair(symbol: SpotSymbol): ParsedSpotPairMetadata {
  const btc = symbol === '@142';
  const baseIndex = btc ? 197 : 221;
  return {
    symbol,
    index: btc ? 142 : 151,
    displayName: btc ? 'UBTC/USDC' : 'UETH/USDC',
    baseTokenIndex: baseIndex,
    quoteTokenIndex: 0,
    isCanonical: false,
    wrapperMultiplier: 1,
    tokens: [token(baseIndex, btc ? 'UBTC' : 'UETH', false), token(0, 'USDC', true)],
  };
}

function syntheticSnapshot(): CanonicalFamilySnapshot {
  return {
    schemaVersion: 1,
    familyId: FAMILY_ID,
    specificationCommit: SPECIFICATION_COMMIT,
    cutoffTime: AS_OF_TIME,
    source: {
      name: 'Hyperliquid',
      endpoint: HYPERLIQUID_INFO_ENDPOINT,
      candleRequestType: 'candleSnapshot',
      candleInterval: '4h',
      fundingRequestType: 'fundingHistory',
      spotRequestType: 'spotMeta',
      pageRows: 500,
    },
    evaluator: SNAPSHOT_EVALUATOR,
    candles: Object.fromEntries(MARKET_SYMBOLS.map((symbol) => [
      symbol,
      candleSnapshot(symbol),
    ])) as Record<MarketSymbol, CandleSeriesSnapshot>,
    funding: Object.fromEntries(PERP_ASSETS.map((coin) => [
      coin,
      fundingSnapshot(coin),
    ])) as Record<PerpAsset, FundingSeriesSnapshot>,
    spotMetadata: {
      fetchedAt: FETCHED_AT,
      rawResponseSha256: hash('spot-meta'),
      pairs: { '@142': spotPair('@142'), '@151': spotPair('@151') },
    },
  };
}

async function writeClaimOnly(
  directory: string,
  logicalId: string,
  outputFilename: string,
  contents: string,
): Promise<void> {
  const claims = path.join(directory, '.content-claims');
  await mkdir(claims, { recursive: true });
  const claim = {
    schemaVersion: 1,
    kind: 'content_claim',
    logicalId,
    outputFilename,
    contentSha256: hash(contents),
  };
  await writeFile(path.join(claims, `${logicalId}.json`), `${canonicalJson(claim)}\n`, 'utf8');
}

let canonicalSnapshot: CanonicalFamilySnapshot;
let builtSnapshot: StoredFamilySnapshot;
let retainedSnapshot: StoredFamilySnapshot;
let trialReports: [StoredTrialReport, StoredTrialReport, StoredTrialReport];
let storageReports: [StoredTrialReport, StoredTrialReport, StoredTrialReport];
let familyEvidence: FamilyReportEvidence;

beforeAll(async () => {
  canonicalSnapshot = syntheticSnapshot();
  builtSnapshot = buildStoredFamilySnapshot(canonicalSnapshot);
  const snapshotDirectory = await temporaryDirectory('retained-snapshot');
  await writeFamilySnapshot(builtSnapshot, snapshotDirectory);
  retainedSnapshot = await readFamilySnapshot(snapshotDirectory);

  const payloads = evaluateFrozenTrials(familyDataFromSnapshot(retainedSnapshot));
  const configs = [H2_CONFIG, H3_CONFIG, H4_CONFIG] as const;
  trialReports = payloads.map((payload, index) => buildTrialReport({
    trialId: configs[index].trialId,
    reportRevision: 1,
    supersedesArtifactSha256: null,
    revisionEvidence: null,
    evaluator: RUN_EVALUATOR,
    payload,
  }, retainedSnapshot)) as [StoredTrialReport, StoredTrialReport, StoredTrialReport];
  storageReports = configs.map((config) => buildTrialReport({
    trialId: config.trialId,
    reportRevision: 1,
    supersedesArtifactSha256: null,
    revisionEvidence: null,
    evaluator: RUN_EVALUATOR,
    payload: {
      schemaVersion: 1,
      kind: 'trial_metrics',
      familyId: FAMILY_ID,
      strategyId: config.id,
      trialId: config.trialId,
      status: 'ERROR',
      familyDecision: 'PENDING',
      historicalPromotionEligible: false,
      primary: null,
      exploratory: null,
      gateMetrics: null,
      error: { code: 'INVALID_INPUT', stage: 'signals', message: `Synthetic ${config.id} storage failure.` },
      limitations: ['Synthetic storage fixture; no authorization.'],
    },
  }, retainedSnapshot)) as [StoredTrialReport, StoredTrialReport, StoredTrialReport];

  const root = repositoryRoot();
  const h1ReportName = `H1-TREND-DAILY-20260722-001.${FROZEN_H1_FAMILY_INPUT.reportSha256}.json`;
  const h1SnapshotName = `H1-TREND-DAILY-20260722-001.${FROZEN_H1_FAMILY_INPUT.snapshotDataSha256}.json`;
  const [h1Report, h1Snapshot] = await Promise.all([
    readFile(path.join(root, 'server', 'research-results', h1ReportName), 'utf8').then(JSON.parse),
    readFile(path.join(root, 'server', 'research-data', h1SnapshotName), 'utf8')
      .then((value) => JSON.parse(value) as StoredMarketSnapshot),
  ]);
  familyEvidence = {
    h1: extractH1FamilyInput(h1Report, h1Snapshot),
    trialReports: storageReports,
  };
}, 600_000);

afterAll(async () => {
  await Promise.all(temporaryDirectories.map((directory) => rm(directory, { recursive: true, force: true })));
}, 60_000);

describe('four-hour immutable artifact trust boundary', () => {
  test('validates full frozen snapshot shape and separates data from provenance hashes', () => {
    validateFamilySnapshot(canonicalSnapshot);
    const original = calculateFamilySnapshotHashes(canonicalSnapshot);
    const changed = structuredClone(canonicalSnapshot);
    changed.evaluator.codeCommit = 'b'.repeat(40);
    changed.spotMetadata.fetchedAt = '2026-07-23T06:00:01.000Z';
    changed.spotMetadata.rawResponseSha256 = hash('changed-spot-meta');
    validateFamilySnapshot(changed);
    const changedHashes = calculateFamilySnapshotHashes(changed);
    expect(changedHashes.dataSha256).toBe(original.dataSha256);
    expect(changedHashes.artifactSha256).not.toBe(original.artifactSha256);
    expect(calculateSourceBundleSha256([
      { relativePath: 'b.ts', bytes: 'b' },
      { relativePath: 'a.ts', bytes: 'a' },
    ])).toBe(calculateSourceBundleSha256([
      { relativePath: 'a.ts', bytes: 'a' },
      { relativePath: 'b.ts', bytes: 'b' },
    ]));
  });

  test('keeps every read path non-mutating for missing and malformed stores', async () => {
    const parent = await temporaryDirectory('read-only-store');
    const missing = path.join(parent, 'never-created');
    await expect(readInitialTrialBatch(missing, retainedSnapshot)).resolves.toBeNull();
    await expect(readTrialReport(missing, H2_CONFIG.trialId, retainedSnapshot))
      .rejects.toThrow(/No immutable report/);
    await expect(readFamilySnapshot(missing)).rejects.toThrow(/found 0/);
    await expect(readdir(missing)).rejects.toMatchObject({ code: 'ENOENT' });

    const malformed = path.join(parent, 'malformed');
    await mkdir(malformed);
    const filename = `${FAMILY_ID}.initial-batch.${'0'.repeat(64)}.json`;
    const output = path.join(malformed, filename);
    await writeFile(output, '{broken', 'utf8');
    const beforeEntries = await readdir(malformed);
    const beforeBytes = await readFile(output, 'utf8');
    await expect(readInitialTrialBatch(malformed, retainedSnapshot))
      .rejects.toThrow(/Malformed initial trial batch/);
    expect(await readdir(malformed)).toEqual(beforeEntries);
    expect(await readFile(output, 'utf8')).toBe(beforeBytes);
  });

  test('rejects evaluator dependency escapes and dynamic import bypasses', async () => {
    const root = await temporaryDirectory('source-closure');
    const fixed = [
      'docs/specs/2026-07-22-independent-4h-trials.md',
      'server/package.json',
      'server/tsconfig.json',
      'server/jest.config.cjs',
    ];
    await Promise.all(fixed.map(async (relativePath) => {
      const output = path.join(root, relativePath);
      await mkdir(path.dirname(output), { recursive: true });
      await writeFile(output, '{}', 'utf8');
    }));
    const surface = path.join(root, 'server', 'src', 'research', 'fourHour');
    await mkdir(surface, { recursive: true });
    const runner = path.join(surface, 'runner.ts');
    await writeFile(runner, "import type { StoredMarketSnapshot } from '../hyperliquid.js';\n", 'utf8');
    await expect(collectEvaluatorSourceBundle(root)).resolves.toHaveLength(5);
    await writeFile(runner, "import { legacy } from '../hyperliquid.js';\n", 'utf8');
    await expect(collectEvaluatorSourceBundle(root)).rejects.toThrow(/escapes frozen surface/);
    await writeFile(runner, "const load = () => import('./local.js');\n", 'utf8');
    await expect(collectEvaluatorSourceBundle(root)).rejects.toThrow(/dynamic import\/require/);
  });

  test('requires retained snapshot capability and recomputes hashes and metrics', () => {
    const draft = {
      trialId: H2_CONFIG.trialId,
      reportRevision: 1,
      supersedesArtifactSha256: null,
      revisionEvidence: null,
      evaluator: RUN_EVALUATOR,
      payload: trialReports[0].canonical.payload,
    } as const;
    expect(Object.isFrozen(trialReports[0])).toBe(true);
    expect(Object.isFrozen(trialReports[0].canonical.payload)).toBe(true);
    expect(() => {
      (trialReports[0] as { artifactSha256: string }).artifactSha256 = '0'.repeat(64);
    }).toThrow(TypeError);
    expect(() => buildTrialReport(draft, builtSnapshot)).toThrow(/exact retained snapshot object/);
    const hashForgery = structuredClone(draft.payload);
    hashForgery.primary!.holdout.scheduleSha256 = '0'.repeat(64);
    expect(() => buildTrialReport({ ...draft, payload: hashForgery }, retainedSnapshot))
      .toThrow(/replay hashes|byte-identity/);
    const metricForgery = structuredClone(draft.payload);
    metricForgery.primary!.holdout.cases.base.metrics.endingNav += 1;
    expect(() => buildTrialReport({ ...draft, payload: metricForgery }, retainedSnapshot))
      .toThrow(/metrics do not match/);
  }, 60_000);

  test('does not transfer validation capability to clones or another snapshot', async () => {
    const forged = structuredClone(storageReports[0]);
    forged.canonical.payload.error!.message = 'C:\\Users\\attacker\\forged-stack.txt';
    forged.artifactSha256 = hash(canonicalJson(forged.canonical));
    const directory = await temporaryDirectory('forged-clone');
    await expect(writeInitialTrialBatch(
      [forged, storageReports[1], storageReports[2]],
      directory,
      retainedSnapshot,
    )).rejects.toThrow(/unsafe or invalid/);

    const otherCanonical = structuredClone(canonicalSnapshot);
    otherCanonical.evaluator.codeCommit = 'c'.repeat(40);
    const otherBuilt = buildStoredFamilySnapshot(otherCanonical);
    const snapshotDirectory = await temporaryDirectory('different-snapshot');
    await writeFamilySnapshot(otherBuilt, snapshotDirectory);
    const otherRetained = await readFamilySnapshot(snapshotDirectory);
    await expect(writeInitialTrialBatch(
      storageReports,
      await temporaryDirectory('cross-snapshot-report'),
      otherRetained,
    )).rejects.toThrow(/cannot cross trial or snapshot identity/);
  }, 120_000);

  test('publishes all initial reports atomically and recovers a manifest claim-only crash', async () => {
    const directory = await temporaryDirectory('atomic-batch');
    await expect(readInitialTrialBatch(directory, retainedSnapshot)).resolves.toBeNull();
    await expect(writeTrialReport(trialReports[0], directory, retainedSnapshot))
      .rejects.toThrow(/writeInitialTrialBatch/);
    const [first, retry] = await Promise.all([
      writeInitialTrialBatch(storageReports, directory, retainedSnapshot),
      writeInitialTrialBatch(storageReports, directory, retainedSnapshot),
    ]);
    expect(retry.manifest.artifactSha256).toBe(first.manifest.artifactSha256);
    expect((await readdir(directory)).filter((name) => name.endsWith('.json'))).toHaveLength(1);
    await expect(readTrialReport(directory, H2_CONFIG.trialId, retainedSnapshot, 1))
      .resolves.toEqual(first.reports[0]);

    const recovery = await temporaryDirectory('batch-claim-only');
    const batchHash = first.manifest.artifactSha256;
    await mkdir(path.join(recovery, '.initial-trial-batches'), { recursive: true });
    await cp(
      path.join(directory, '.initial-trial-batches', batchHash),
      path.join(recovery, '.initial-trial-batches', batchHash),
      { recursive: true },
    );
    const filename = `${FAMILY_ID}.initial-batch.${batchHash}.json`;
    const contents = `${canonicalJson(first.manifest)}\n`;
    await writeClaimOnly(recovery, `${FAMILY_ID}.initial-batch`, filename, contents);
    const recovered = await writeInitialTrialBatch(storageReports, recovery, retainedSnapshot);
    expect(recovered.manifest).toEqual(first.manifest);
  }, 120_000);

  test('rejects a conflicting complete initial batch', async () => {
    const directory = await temporaryDirectory('batch-conflict');
    await writeInitialTrialBatch(storageReports, directory, retainedSnapshot);
    const changedPayload = structuredClone(storageReports[0].canonical.payload);
    changedPayload.limitations.push('Conflicting candidate.');
    const changed = buildTrialReport({
      trialId: H2_CONFIG.trialId,
      reportRevision: 1,
      supersedesArtifactSha256: null,
      revisionEvidence: null,
      evaluator: RUN_EVALUATOR,
      payload: changedPayload,
    }, retainedSnapshot);
    await expect(writeInitialTrialBatch(
      [changed, storageReports[1], storageReports[2]],
      directory,
      retainedSnapshot,
    )).rejects.toThrow(/conflicting immutable initial trial batch/);
  }, 120_000);

  test('derives family decisions only from retained exact evidence', async () => {
    const directory = await temporaryDirectory('family-boundary');
    const batch = await writeInitialTrialBatch(storageReports, directory, retainedSnapshot);
    const retainedEvidence: FamilyReportEvidence = {
      h1: familyEvidence.h1,
      trialReports: batch.reports,
    };
    const payload = deriveFamilyReportPayload(
      retainedEvidence,
      retainedSnapshot,
      ['Synthetic fixture; no authorization.'],
    );
    expect(() => buildFamilyReport({
      reportRevision: 1,
      supersedesArtifactSha256: null,
      revisionEvidence: null,
      evaluator: RUN_EVALUATOR,
      payload,
    }, retainedSnapshot, familyEvidence)).toThrow(/retained H2 report capability/);

    const forged = structuredClone(payload);
    forged.familyGate = { verdict: 'ADVANCE_TO_FORWARD_PAPER', selectedTrial: 'H2' };
    forged.selectedCandidate = { id: 'H2', trialId: H2_CONFIG.trialId, rank: 1 };
    forged.forwardPaperBoundary.numericalCandidate = 'H2';
    expect(() => buildFamilyReport({
      reportRevision: 1,
      supersedesArtifactSha256: null,
      revisionEvidence: null,
      evaluator: RUN_EVALUATOR,
      payload: forged,
    }, retainedSnapshot, retainedEvidence)).toThrow(/recomputed gates|inconsistent/);

    const family = buildFamilyReport({
      reportRevision: 1,
      supersedesArtifactSha256: null,
      revisionEvidence: null,
      evaluator: RUN_EVALUATOR,
      payload,
    }, retainedSnapshot, retainedEvidence);
    await writeFamilyReport(family, directory, retainedSnapshot, retainedEvidence);
    await expect(readFamilyReport(directory, retainedSnapshot, retainedEvidence)).resolves.toEqual(family);
  }, 120_000);

  test('forces family ERROR with no authorization when any primary trial errors', async () => {
    const errorPayload: TrialReportPayload = {
      schemaVersion: 1,
      kind: 'trial_metrics',
      familyId: FAMILY_ID,
      strategyId: 'H2',
      trialId: H2_CONFIG.trialId,
      status: 'ERROR',
      familyDecision: 'PENDING',
      historicalPromotionEligible: false,
      primary: null,
      exploratory: null,
      gateMetrics: null,
      error: { code: 'INVALID_INPUT', stage: 'signals', message: 'Synthetic deterministic failure.' },
      limitations: ['Synthetic fixture.'],
    };
    const errorReport = buildTrialReport({
      trialId: H2_CONFIG.trialId,
      reportRevision: 1,
      supersedesArtifactSha256: null,
      revisionEvidence: null,
      evaluator: RUN_EVALUATOR,
      payload: errorPayload,
    }, retainedSnapshot);
    const directory = await temporaryDirectory('family-error');
    const batch = await writeInitialTrialBatch(
      [errorReport, storageReports[1], storageReports[2]],
      directory,
      retainedSnapshot,
    );
    const evidence: FamilyReportEvidence = { h1: familyEvidence.h1, trialReports: batch.reports };
    const payload = deriveFamilyReportPayload(evidence, retainedSnapshot, ['Synthetic fixture.']);
    expect(payload.familyGate).toEqual({ verdict: 'ERROR', selectedTrial: null });
    expect(payload.selectedCandidate).toBeNull();
    expect(payload.forwardPaperBoundary).toMatchObject({
      numericalCandidate: null,
      paperJobAuthorized: false,
      walletAuthorized: false,
      liveTradingAuthorized: false,
    });
  }, 120_000);

  test('requires exact mechanical correction evidence for revision two', async () => {
    const directory = await temporaryDirectory('correction');
    const batch = await writeInitialTrialBatch(storageReports, directory, retainedSnapshot);
    const payload = structuredClone(batch.reports[0].canonical.payload);
    payload.limitations.push('Incident-logged report-only correction.');
    expect(() => buildTrialReport({
      trialId: H2_CONFIG.trialId,
      reportRevision: 2,
      supersedesArtifactSha256: batch.reports[0].artifactSha256,
      revisionEvidence: null,
      evaluator: RUN_EVALUATOR,
      payload,
    }, retainedSnapshot)).toThrow(/mechanical evidence/);

    const evaluator = {
      codeCommit: 'e'.repeat(40),
      cleanWorktree: true as const,
      sourceBundleSha256: hash('correction source bundle'),
    };
    const corrected = buildTrialReport({
      trialId: H2_CONFIG.trialId,
      reportRevision: 2,
      supersedesArtifactSha256: batch.reports[0].artifactSha256,
      revisionEvidence: {
        classification: 'MECHANICAL_ONLY',
        incidentId: 'INC-20260723-001',
        regressionTestPath: 'server/src/__tests__/fourHourArtifacts.test.ts',
        regressionTestSha256: hash('regression fixture'),
        correctionCommit: evaluator.codeCommit,
        correctionSourceBundleSha256: evaluator.sourceBundleSha256,
      },
      evaluator,
      payload,
    }, retainedSnapshot);
    await writeTrialReport(corrected, directory, retainedSnapshot);
    await expect(readTrialReport(directory, H2_CONFIG.trialId, retainedSnapshot, 2))
      .resolves.toEqual(corrected);
  }, 120_000);

  test('quarantines an exploratory HYPE failure from complete primary metrics', () => {
    const payload = structuredClone(trialReports[1].canonical.payload);
    expect(payload.status).toBe('COMPLETE');
    payload.exploratory = {
      asset: 'HYPE',
      classification: 'EXPLORATORY_ONLY',
      selectionEligible: false,
      historicalPromotionEligible: false,
      status: 'ERROR',
      fullHistory: null,
      holdout: null,
      error: { code: 'CHRONOLOGY', stage: 'ledger', message: 'Synthetic HYPE-only failure.' },
    };
    expect(() => buildTrialReport({
      trialId: H3_CONFIG.trialId,
      reportRevision: 1,
      supersedesArtifactSha256: null,
      revisionEvidence: null,
      evaluator: RUN_EVALUATOR,
      payload,
    }, retainedSnapshot)).not.toThrow();
  }, 60_000);
});
