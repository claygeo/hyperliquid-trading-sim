import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import {
  buildFamilyReport,
  buildStoredFamilySnapshot,
  buildTrialReport,
  calculateSourceBundleSha256,
  canonicalJson,
  collectEvaluatorSourceBundle,
  deriveFamilyReportPayload,
  readFamilyReport,
  readFamilySnapshot,
  readInitialTrialBatch,
  writeFamilyReport,
  writeFamilySnapshot,
  writeInitialTrialBatch,
  type CanonicalFamilySnapshot,
  type FamilyReportDraft,
  type FamilyReportEvidence,
  type FamilyReportPayload,
  type FrozenTrialId,
  type RetainedInitialTrialBatch,
  type SourceBundleFile,
  type StoredFamilyReport,
  type StoredFamilySnapshot,
  type StoredTrialReport,
  type TrialReportDraft,
  type TrialReportPayload,
} from './artifacts.js';
import {
  MARKET_SYMBOLS,
  PERP_ASSETS,
  type CandleSeriesSnapshot,
  type FundingSeriesSnapshot,
  type MarketSymbol,
  type PerpAsset,
  type StrategyId,
  type ValidatedFamilyData,
} from './contracts.js';
import {
  AS_OF_TIME,
  FAMILY_ID,
  SPECIFICATION_COMMIT,
} from './frozenTrials.js';
import {
  fetchFrozenFourHourCandles,
  fetchFrozenHourlyFunding,
  fetchRelevantSpotMeta,
  HYPERLIQUID_INFO_ENDPOINT,
  SOURCE_PAGE_ROWS,
  type SpotMetadataResult,
} from './hyperliquid.js';
import {
  extractH1FamilyInput,
  evaluateFrozenTrial,
  familyDataFromSnapshot,
  FROZEN_H1_FAMILY_INPUT,
  type H1FamilyInput,
} from './runner.js';

type FrozenH1Snapshot = Parameters<typeof extractH1FamilyInput>[1];

export const FOUR_HOUR_SPECIFICATION_PATH =
  'docs/specs/2026-07-22-independent-4h-trials.md';

export const FOUR_HOUR_SNAPSHOT_FETCH_ORDER = Object.freeze([
  'spotMeta',
  ...MARKET_SYMBOLS.map((symbol) => `candles:${symbol}` as const),
  ...PERP_ASSETS.map((coin) => `funding:${coin}` as const),
] as const);

export interface FourHourCliPaths {
  repositoryRoot: string;
  h1SnapshotPath: string;
  h1ReportPath: string;
  snapshotDirectory: string;
  resultsDirectory: string;
}

export interface RepositoryPin {
  codeCommit: string;
  specificationCommit: typeof SPECIFICATION_COMMIT;
  cleanWorktree: true;
  sourceBundleSha256: string;
  sourceBundleFiles: number;
}

export interface FourHourPreflight {
  repository: RepositoryPin;
  h1: H1FamilyInput;
}

export interface SnapshotCommandResult {
  kind: 'four_hour_family_snapshot';
  familyId: typeof FAMILY_ID;
  artifactSha256: string;
  dataSha256: string;
  outputPath: string;
  evaluator: CanonicalFamilySnapshot['evaluator'];
  authorization: typeof FOUR_HOUR_AUTHORIZATION_BOUNDARY;
}

export const FOUR_HOUR_AUTHORIZATION_BOUNDARY = Object.freeze({
  paperJobAuthorized: false as const,
  walletAuthorized: false as const,
  liveTradingAuthorized: false as const,
  hype: Object.freeze({
    asset: 'HYPE' as const,
    classification: 'EXPLORATORY_ONLY' as const,
    selectionEligible: false as const,
    historicalPromotionEligible: false as const,
    liveTradingEligible: false as const,
  }),
});

export const FOUR_HOUR_FAMILY_LIMITATIONS: readonly string[] = Object.freeze([
  'Historical simulation only; forward-paper admission, wallet authorization, and live trading remain unauthorized.',
  'HYPE is exploratory only and cannot affect candidate selection or historical promotion.',
  'H1 is immutable and rejected; H2-H4 are the final preregistered four-hour trials and no additional variants are authorized.',
]);

const STRATEGY_IDS = Object.freeze(['H2', 'H3', 'H4'] as const);

export interface FourHourCliDependencies {
  git(repositoryRoot: string, args: readonly string[]): Promise<string>;
  readText(filename: string): Promise<string>;
  collectSourceBundle(repositoryRoot: string): Promise<SourceBundleFile[]>;
  calculateSourceBundle(files: readonly SourceBundleFile[]): string;
  isCommitAncestor(repositoryRoot: string, ancestor: string, descendant: string): Promise<boolean>;
  extractH1(report: unknown, snapshot: FrozenH1Snapshot): H1FamilyInput;
  fetchSpotMetadata(): Promise<SpotMetadataResult>;
  fetchCandles(symbol: MarketSymbol): Promise<CandleSeriesSnapshot>;
  fetchFunding(coin: PerpAsset): Promise<FundingSeriesSnapshot>;
  buildSnapshot(canonical: CanonicalFamilySnapshot): StoredFamilySnapshot;
  writeSnapshot(snapshot: StoredFamilySnapshot, directory: string): Promise<string>;
  readSnapshot(directory: string): Promise<StoredFamilySnapshot>;
  detachSnapshot(snapshot: StoredFamilySnapshot): ValidatedFamilyData;
  evaluateTrial(data: Readonly<ValidatedFamilyData>, id: StrategyId): TrialReportPayload;
  buildTrialReport(draft: TrialReportDraft, snapshot: Readonly<StoredFamilySnapshot>): StoredTrialReport;
  readInitialBatch(
    directory: string,
    snapshot: Readonly<StoredFamilySnapshot>,
  ): Promise<RetainedInitialTrialBatch | null>;
  writeInitialBatch(
    reports: readonly [StoredTrialReport, StoredTrialReport, StoredTrialReport],
    directory: string,
    snapshot: Readonly<StoredFamilySnapshot>,
  ): Promise<RetainedInitialTrialBatch>;
  deriveFamilyPayload(
    evidence: FamilyReportEvidence,
    snapshot: Readonly<StoredFamilySnapshot>,
    limitations: string[],
  ): FamilyReportPayload;
  buildFamilyReport(
    draft: FamilyReportDraft,
    snapshot: Readonly<StoredFamilySnapshot>,
    evidence: FamilyReportEvidence,
  ): StoredFamilyReport;
  readFamilyReport(
    directory: string,
    snapshot: Readonly<StoredFamilySnapshot>,
    evidence: FamilyReportEvidence,
    reportRevision?: number,
  ): Promise<StoredFamilyReport>;
  writeFamilyReport(
    report: StoredFamilyReport,
    directory: string,
    snapshot: Readonly<StoredFamilySnapshot>,
    evidence: FamilyReportEvidence,
  ): Promise<string>;
}

export interface FourHourCliIo {
  stdout(value: string): void;
  stderr(value: string): void;
}

function defaultPaths(): FourHourCliPaths {
  const executable = process.argv[1];
  const serverRoot = typeof executable === 'string' && isEntrypointPath(executable)
    ? path.resolve(path.dirname(executable), '../../..')
    : path.basename(process.cwd()) === 'server'
      ? path.resolve(process.cwd())
      : path.resolve(process.cwd(), 'server');
  const repositoryRoot = path.resolve(serverRoot, '..');
  return {
    repositoryRoot,
    h1SnapshotPath: path.join(
      serverRoot,
      'research-data',
      `${FROZEN_H1_FAMILY_INPUT.trialId}.${FROZEN_H1_FAMILY_INPUT.snapshotDataSha256}.json`,
    ),
    h1ReportPath: path.join(
      serverRoot,
      'research-results',
      `${FROZEN_H1_FAMILY_INPUT.trialId}.${FROZEN_H1_FAMILY_INPUT.reportSha256}.json`,
    ),
    snapshotDirectory: path.join(serverRoot, 'research-data'),
    resultsDirectory: path.join(serverRoot, 'research-results'),
  };
}

function defaultDependencies(): FourHourCliDependencies {
  return {
    git: async (repositoryRoot, args) => execFileSync('git', [...args], {
      cwd: repositoryRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim(),
    readText: (filename) => readFile(filename, 'utf8'),
    collectSourceBundle: collectEvaluatorSourceBundle,
    calculateSourceBundle: calculateSourceBundleSha256,
    isCommitAncestor: async (repositoryRoot, ancestor, descendant) => {
      try {
        execFileSync('git', ['merge-base', '--is-ancestor', ancestor, descendant], {
          cwd: repositoryRoot,
          stdio: ['ignore', 'ignore', 'pipe'],
        });
        return true;
      } catch {
        return false;
      }
    },
    extractH1: extractH1FamilyInput,
    // Production deliberately supplies no endpoint, economics, key, or signing overrides.
    fetchSpotMetadata: () => fetchRelevantSpotMeta(),
    fetchCandles: (symbol) => fetchFrozenFourHourCandles(symbol),
    fetchFunding: (coin) => fetchFrozenHourlyFunding(coin),
    buildSnapshot: buildStoredFamilySnapshot,
    writeSnapshot: writeFamilySnapshot,
    readSnapshot: readFamilySnapshot,
    detachSnapshot: familyDataFromSnapshot,
    evaluateTrial: evaluateFrozenTrial,
    buildTrialReport,
    readInitialBatch: readInitialTrialBatch,
    writeInitialBatch: writeInitialTrialBatch,
    deriveFamilyPayload: deriveFamilyReportPayload,
    buildFamilyReport,
    readFamilyReport,
    writeFamilyReport,
  };
}

function parseJsonArtifact(raw: string, label: string): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    throw new Error(`${label} is not valid JSON`);
  }
}

function assertCommit(value: string, label: string): string {
  if (!/^[0-9a-f]{40}$/u.test(value)) {
    throw new Error(`${label} must be an exact 40-character lowercase Git commit`);
  }
  return value;
}

async function readRepositoryIdentity(
  dependencies: FourHourCliDependencies,
  paths: FourHourCliPaths,
): Promise<{ codeCommit: string; specificationCommit: typeof SPECIFICATION_COMMIT }> {
  const status = await dependencies.git(paths.repositoryRoot, [
    'status',
    '--porcelain=v1',
    '--untracked-files=all',
  ]);
  if (status !== '') {
    throw new Error('Four-hour research requires a clean worktree, including no untracked files');
  }
  const codeCommit = assertCommit(
    await dependencies.git(paths.repositoryRoot, ['rev-parse', 'HEAD']),
    'Repository HEAD',
  );
  const specificationCommit = assertCommit(
    await dependencies.git(paths.repositoryRoot, [
      'log',
      '-1',
      '--format=%H',
      '--',
      FOUR_HOUR_SPECIFICATION_PATH,
    ]),
    'Specification path commit',
  );
  if (specificationCommit !== SPECIFICATION_COMMIT) {
    throw new Error(
      `Specification path must remain pinned to ${SPECIFICATION_COMMIT}`,
    );
  }
  return { codeCommit, specificationCommit };
}

/**
 * Capture a repository state whose source hash is bracketed by clean-tree/HEAD checks.
 * This closes the race where tracked evaluator bytes change while the bundle is read.
 */
export async function pinFourHourRepository(
  dependencies: FourHourCliDependencies = defaultDependencies(),
  paths: FourHourCliPaths = defaultPaths(),
): Promise<RepositoryPin> {
  const before = await readRepositoryIdentity(dependencies, paths);
  const sourceBundle = await dependencies.collectSourceBundle(paths.repositoryRoot);
  const sourceBundleSha256 = dependencies.calculateSourceBundle(sourceBundle);
  if (!/^[0-9a-f]{64}$/u.test(sourceBundleSha256)) {
    throw new Error('Evaluator source bundle hash must be an exact lowercase SHA-256');
  }
  const after = await readRepositoryIdentity(dependencies, paths);
  if (
    after.codeCommit !== before.codeCommit
    || after.specificationCommit !== before.specificationCommit
  ) {
    throw new Error('Repository identity changed while hashing the evaluator source bundle');
  }
  return Object.freeze({
    codeCommit: before.codeCommit,
    specificationCommit: SPECIFICATION_COMMIT,
    cleanWorktree: true,
    sourceBundleSha256,
    sourceBundleFiles: sourceBundle.length,
  });
}

export async function assertFourHourRepositoryPinned(
  pinned: RepositoryPin,
  dependencies: FourHourCliDependencies = defaultDependencies(),
  paths: FourHourCliPaths = defaultPaths(),
): Promise<void> {
  const current = await pinFourHourRepository(dependencies, paths);
  if (
    current.codeCommit !== pinned.codeCommit
    || current.specificationCommit !== pinned.specificationCommit
    || current.sourceBundleSha256 !== pinned.sourceBundleSha256
    || current.sourceBundleFiles !== pinned.sourceBundleFiles
  ) throw new Error('Repository or evaluator source bundle changed during the command');
}

export async function preflightFourHourResearch(
  dependencies: FourHourCliDependencies = defaultDependencies(),
  paths: FourHourCliPaths = defaultPaths(),
): Promise<FourHourPreflight> {
  const repository = await pinFourHourRepository(dependencies, paths);
  const reportRaw = await dependencies.readText(paths.h1ReportPath);
  const snapshotRaw = await dependencies.readText(paths.h1SnapshotPath);
  const report = parseJsonArtifact(reportRaw, 'Retained frozen H1 report');
  const snapshot = parseJsonArtifact(
    snapshotRaw,
    'Retained frozen H1 snapshot',
  ) as FrozenH1Snapshot;
  const h1 = dependencies.extractH1(report, snapshot);
  // The source and repository must still be the bytes that were validated above.
  await assertFourHourRepositoryPinned(repository, dependencies, paths);
  return Object.freeze({ repository, h1 });
}

function canonicalSnapshot(
  preflight: FourHourPreflight,
  spotMetadata: SpotMetadataResult,
  candles: Record<MarketSymbol, CandleSeriesSnapshot>,
  funding: Record<PerpAsset, FundingSeriesSnapshot>,
): CanonicalFamilySnapshot {
  const ubtc = spotMetadata.pairs['@142'];
  const ueth = spotMetadata.pairs['@151'];
  if (spotMetadata.requestType !== 'spotMeta' || !ubtc || !ueth) {
    throw new Error('Frozen spotMeta result is incomplete or has the wrong request identity');
  }
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
      pageRows: SOURCE_PAGE_ROWS,
    },
    evaluator: {
      codeCommit: preflight.repository.codeCommit,
      cleanWorktree: true,
      sourceBundleSha256: preflight.repository.sourceBundleSha256,
    },
    candles,
    funding,
    spotMetadata: {
      fetchedAt: spotMetadata.fetchedAt,
      rawResponseSha256: spotMetadata.rawResponseSha256,
      pairs: { '@142': ubtc, '@151': ueth },
    },
  };
}

/** Fetch the frozen family serially. Do not replace these awaits with Promise.all. */
export async function snapshotFourHourResearch(
  dependencies: FourHourCliDependencies = defaultDependencies(),
  paths: FourHourCliPaths = defaultPaths(),
): Promise<SnapshotCommandResult> {
  const preflight = await preflightFourHourResearch(dependencies, paths);
  // This is the final no-network invariant check before the first H2-H4 request.
  await assertFourHourRepositoryPinned(preflight.repository, dependencies, paths);

  const spotMetadata = await dependencies.fetchSpotMetadata();
  const candles = {} as Record<MarketSymbol, CandleSeriesSnapshot>;
  for (const symbol of MARKET_SYMBOLS) {
    candles[symbol] = await dependencies.fetchCandles(symbol);
  }
  const funding = {} as Record<PerpAsset, FundingSeriesSnapshot>;
  for (const coin of PERP_ASSETS) {
    funding[coin] = await dependencies.fetchFunding(coin);
  }

  const stored = dependencies.buildSnapshot(
    canonicalSnapshot(preflight, spotMetadata, candles, funding),
  );
  // No-clobber publication is the first permitted repository write.
  await assertFourHourRepositoryPinned(preflight.repository, dependencies, paths);
  const outputPath = await dependencies.writeSnapshot(stored, paths.snapshotDirectory);
  return {
    kind: 'four_hour_family_snapshot',
    familyId: FAMILY_ID,
    artifactSha256: stored.artifactSha256,
    dataSha256: stored.dataSha256,
    outputPath,
    evaluator: stored.canonical.evaluator,
    authorization: FOUR_HOUR_AUTHORIZATION_BOUNDARY,
  };
}

type TrialPayloadTuple = readonly [TrialReportPayload, TrialReportPayload, TrialReportPayload];
type TrialReportTuple = readonly [StoredTrialReport, StoredTrialReport, StoredTrialReport];

function assertEvaluatorShape(
  evaluator: CanonicalFamilySnapshot['evaluator'],
  label: string,
): void {
  assertCommit(evaluator.codeCommit, `${label} code commit`);
  if (evaluator.cleanWorktree !== true) throw new Error(`${label} must record a clean worktree`);
  if (!/^[0-9a-f]{64}$/u.test(evaluator.sourceBundleSha256)) {
    throw new Error(`${label} source bundle must be an exact lowercase SHA-256`);
  }
}

async function assertEvaluatorCompatible(
  evaluator: CanonicalFamilySnapshot['evaluator'],
  repository: RepositoryPin,
  dependencies: FourHourCliDependencies,
  paths: FourHourCliPaths,
  label: string,
): Promise<void> {
  assertEvaluatorShape(evaluator, label);
  if (evaluator.sourceBundleSha256 !== repository.sourceBundleSha256) {
    throw new Error(`${label} source bundle is not byte-compatible with the pinned evaluator`);
  }
  const isAncestor = await dependencies.isCommitAncestor(
    paths.repositoryRoot,
    evaluator.codeCommit,
    repository.codeCommit,
  );
  if (!isAncestor) throw new Error(`${label} commit is not an ancestor of pinned HEAD`);
}

async function loadRetainedResearch(
  dependencies: FourHourCliDependencies,
  paths: FourHourCliPaths,
): Promise<{ preflight: FourHourPreflight; snapshot: StoredFamilySnapshot }> {
  const preflight = await preflightFourHourResearch(dependencies, paths);
  const snapshot = await dependencies.readSnapshot(paths.snapshotDirectory);
  await assertFourHourRepositoryPinned(preflight.repository, dependencies, paths);
  if (
    snapshot.canonical.familyId !== FAMILY_ID
    || snapshot.canonical.specificationCommit !== SPECIFICATION_COMMIT
  ) throw new Error('Retained family snapshot does not match the frozen family and specification');
  await assertEvaluatorCompatible(
    snapshot.canonical.evaluator,
    preflight.repository,
    dependencies,
    paths,
    'Retained family snapshot evaluator',
  );
  return { preflight, snapshot };
}

function assertTrialPayloadBoundary(payload: TrialReportPayload, id: StrategyId): void {
  if (
    payload.familyId !== FAMILY_ID
    || payload.strategyId !== id
    || payload.familyDecision !== 'PENDING'
    || payload.historicalPromotionEligible !== false
  ) throw new Error(`${id} evaluator violated the frozen trial authorization boundary`);
  if (payload.exploratory !== null && (
    payload.exploratory.asset !== 'HYPE'
    || payload.exploratory.classification !== 'EXPLORATORY_ONLY'
    || payload.exploratory.selectionEligible !== false
    || payload.exploratory.historicalPromotionEligible !== false
  )) throw new Error(`${id} evaluator made HYPE selection or promotion eligible`);
}

/** Run all three trials even if an injected evaluator throws; publication remains all-or-nothing. */
async function evaluateAllTrials(
  snapshot: StoredFamilySnapshot,
  dependencies: FourHourCliDependencies,
): Promise<TrialPayloadTuple> {
  const results: TrialReportPayload[] = [];
  const failures: string[] = [];
  for (const id of STRATEGY_IDS) {
    try {
      const detached = dependencies.detachSnapshot(snapshot);
      const payload = dependencies.evaluateTrial(detached, id);
      assertTrialPayloadBoundary(payload, id);
      results.push(payload);
    } catch (error: unknown) {
      failures.push(`${id}:${error instanceof Error ? error.message : 'unclassified evaluator failure'}`);
    }
  }
  if (failures.length > 0) {
    throw new Error(`Frozen trial execution failed after attempting H2,H3,H4: ${failures.join('; ')}`);
  }
  return results as unknown as TrialPayloadTuple;
}

async function deterministicTrialPayloads(
  snapshot: StoredFamilySnapshot,
  dependencies: FourHourCliDependencies,
): Promise<TrialPayloadTuple> {
  const first = await evaluateAllTrials(snapshot, dependencies);
  const second = await evaluateAllTrials(snapshot, dependencies);
  if (canonicalJson(first) !== canonicalJson(second)) {
    throw new Error('H2-H4 evaluation is not byte-identical across independently detached replay');
  }
  return first;
}

function buildInitialReports(
  payloads: TrialPayloadTuple,
  snapshot: StoredFamilySnapshot,
  evaluator: RepositoryPin,
  dependencies: FourHourCliDependencies,
): TrialReportTuple {
  const reports = payloads.map((payload, index) => {
    const trialId = payload.trialId as FrozenTrialId;
    if (payload.strategyId !== STRATEGY_IDS[index]) throw new Error('Trial payload order is not H2,H3,H4');
    return dependencies.buildTrialReport({
      trialId,
      reportRevision: 1,
      supersedesArtifactSha256: null,
      revisionEvidence: null,
      evaluator: {
        codeCommit: evaluator.codeCommit,
        cleanWorktree: true,
        sourceBundleSha256: evaluator.sourceBundleSha256,
      },
      payload,
    }, snapshot);
  });
  return reports as unknown as TrialReportTuple;
}

async function assertRetainedBatchCompatible(
  batch: RetainedInitialTrialBatch,
  payloads: TrialPayloadTuple,
  repository: RepositoryPin,
  dependencies: FourHourCliDependencies,
  paths: FourHourCliPaths,
): Promise<void> {
  await assertEvaluatorCompatible(
    batch.manifest.canonical.evaluator,
    repository,
    dependencies,
    paths,
    'Initial batch evaluator',
  );
  for (let index = 0; index < STRATEGY_IDS.length; index += 1) {
    const report = batch.reports[index];
    await assertEvaluatorCompatible(
      report.canonical.evaluator,
      repository,
      dependencies,
      paths,
      `${STRATEGY_IDS[index]} report evaluator`,
    );
    if (
      report.canonical.reportRevision !== 1
      || report.canonical.payload.strategyId !== STRATEGY_IDS[index]
      || canonicalJson(report.canonical.payload) !== canonicalJson(payloads[index])
    ) throw new Error(`${STRATEGY_IDS[index]} retained report is not the exact canonical replay payload`);
  }
}

function familyEvidence(
  h1: H1FamilyInput,
  reports: TrialReportTuple,
): FamilyReportEvidence {
  return { h1, trialReports: reports };
}

function assertFamilyBoundary(payload: FamilyReportPayload): void {
  if (
    payload.hypeBoundary.asset !== 'HYPE'
    || payload.hypeBoundary.classification !== 'EXPLORATORY_ONLY'
    || payload.hypeBoundary.selectionEligible !== false
    || payload.hypeBoundary.historicalPromotionEligible !== false
    || payload.hypeBoundary.liveTradingEligible !== false
    || payload.forwardPaperBoundary.paperJobAuthorized !== false
    || payload.forwardPaperBoundary.walletAuthorized !== false
    || payload.forwardPaperBoundary.liveTradingAuthorized !== false
  ) throw new Error('Family adjudication violated the frozen authorization boundary');
}

function deriveDeterministicFamily(
  evidence: FamilyReportEvidence,
  snapshot: StoredFamilySnapshot,
  limitations: readonly string[],
  dependencies: FourHourCliDependencies,
): FamilyReportPayload {
  const first = dependencies.deriveFamilyPayload(evidence, snapshot, [...limitations]);
  const second = dependencies.deriveFamilyPayload(evidence, snapshot, [...limitations]);
  if (canonicalJson(first) !== canonicalJson(second)) {
    throw new Error('Family adjudication is not byte-identical across replay');
  }
  assertFamilyBoundary(first);
  return first;
}

export async function evaluateFourHourResearch(
  dependencies: FourHourCliDependencies = defaultDependencies(),
  paths: FourHourCliPaths = defaultPaths(),
): Promise<unknown> {
  const { preflight, snapshot } = await loadRetainedResearch(dependencies, paths);
  const payloads = await deterministicTrialPayloads(snapshot, dependencies);
  const reports = buildInitialReports(payloads, snapshot, preflight.repository, dependencies);
  await assertFourHourRepositoryPinned(preflight.repository, dependencies, paths);
  const retained = await dependencies.writeInitialBatch(reports, paths.resultsDirectory, snapshot);
  await assertRetainedBatchCompatible(
    retained,
    payloads,
    preflight.repository,
    dependencies,
    paths,
  );
  if (canonicalJson(retained.reports) !== canonicalJson(reports)) {
    throw new Error('Atomic initial batch writer did not retain the exact built H2,H3,H4 reports');
  }
  return {
    kind: 'four_hour_initial_evaluation',
    familyId: FAMILY_ID,
    batchArtifactSha256: retained.manifest.artifactSha256,
    trials: retained.reports.map((report) => ({
      strategyId: report.canonical.payload.strategyId,
      trialId: report.canonical.trialId,
      status: report.canonical.payload.status,
      reportArtifactSha256: report.artifactSha256,
    })),
    familyDecision: 'PENDING',
    authorization: FOUR_HOUR_AUTHORIZATION_BOUNDARY,
  };
}

export async function adjudicateFourHourResearch(
  dependencies: FourHourCliDependencies = defaultDependencies(),
  paths: FourHourCliPaths = defaultPaths(),
): Promise<unknown> {
  const { preflight, snapshot } = await loadRetainedResearch(dependencies, paths);
  const retained = await dependencies.readInitialBatch(paths.resultsDirectory, snapshot);
  if (retained === null) throw new Error('Adjudication requires the exact retained atomic H2,H3,H4 r1 batch');
  const payloads = await deterministicTrialPayloads(snapshot, dependencies);
  await assertRetainedBatchCompatible(
    retained,
    payloads,
    preflight.repository,
    dependencies,
    paths,
  );
  const evidence = familyEvidence(preflight.h1, retained.reports);
  const payload = deriveDeterministicFamily(
    evidence,
    snapshot,
    FOUR_HOUR_FAMILY_LIMITATIONS,
    dependencies,
  );
  const report = dependencies.buildFamilyReport({
    reportRevision: 1,
    supersedesArtifactSha256: null,
    revisionEvidence: null,
    evaluator: {
      codeCommit: preflight.repository.codeCommit,
      cleanWorktree: true,
      sourceBundleSha256: preflight.repository.sourceBundleSha256,
    },
    payload,
  }, snapshot, evidence);
  await assertFourHourRepositoryPinned(preflight.repository, dependencies, paths);
  const outputPath = await dependencies.writeFamilyReport(
    report,
    paths.resultsDirectory,
    snapshot,
    evidence,
  );
  const retainedFamily = await dependencies.readFamilyReport(
    paths.resultsDirectory,
    snapshot,
    evidence,
    1,
  );
  if (canonicalJson(retainedFamily) !== canonicalJson(report)) {
    throw new Error('Family writer did not retain the exact built adjudication report');
  }
  return {
    kind: 'four_hour_family_adjudication',
    familyId: FAMILY_ID,
    reportArtifactSha256: retainedFamily.artifactSha256,
    outputPath,
    familyDecision: payload.familyGate.verdict,
    selectedCandidate: payload.selectedCandidate,
    authorization: FOUR_HOUR_AUTHORIZATION_BOUNDARY,
  };
}

export async function replayFourHourResearch(
  dependencies: FourHourCliDependencies = defaultDependencies(),
  paths: FourHourCliPaths = defaultPaths(),
): Promise<unknown> {
  const { preflight, snapshot } = await loadRetainedResearch(dependencies, paths);
  const retained = await dependencies.readInitialBatch(paths.resultsDirectory, snapshot);
  if (retained === null) throw new Error('Replay requires the exact retained atomic H2,H3,H4 r1 batch');
  const payloads = await deterministicTrialPayloads(snapshot, dependencies);
  await assertRetainedBatchCompatible(
    retained,
    payloads,
    preflight.repository,
    dependencies,
    paths,
  );
  const rebuiltReports = payloads.map((payload, index) => dependencies.buildTrialReport({
    trialId: retained.reports[index].canonical.trialId as FrozenTrialId,
    reportRevision: retained.reports[index].canonical.reportRevision,
    supersedesArtifactSha256: retained.reports[index].canonical.supersedesArtifactSha256,
    revisionEvidence: retained.reports[index].canonical.revisionEvidence,
    evaluator: retained.reports[index].canonical.evaluator,
    payload,
  }, snapshot)) as unknown as TrialReportTuple;
  if (canonicalJson(rebuiltReports) !== canonicalJson(retained.reports)) {
    throw new Error('Replay did not reproduce the exact retained H2,H3,H4 report artifacts');
  }
  const evidence = familyEvidence(preflight.h1, retained.reports);
  const family = await dependencies.readFamilyReport(paths.resultsDirectory, snapshot, evidence);
  await assertEvaluatorCompatible(
    family.canonical.evaluator,
    preflight.repository,
    dependencies,
    paths,
    'Family report evaluator',
  );
  if (canonicalJson(family.canonical.payload.limitations) !== canonicalJson(FOUR_HOUR_FAMILY_LIMITATIONS)) {
    throw new Error('Retained family limitations do not match the frozen adjudication limitations');
  }
  const payload = deriveDeterministicFamily(
    evidence,
    snapshot,
    FOUR_HOUR_FAMILY_LIMITATIONS,
    dependencies,
  );
  if (canonicalJson(payload) !== canonicalJson(family.canonical.payload)) {
    throw new Error('Replay did not reproduce the exact retained family payload');
  }
  const rebuiltFamily = dependencies.buildFamilyReport({
    reportRevision: family.canonical.reportRevision,
    supersedesArtifactSha256: family.canonical.supersedesArtifactSha256,
    revisionEvidence: family.canonical.revisionEvidence,
    evaluator: family.canonical.evaluator,
    payload,
  }, snapshot, evidence);
  if (canonicalJson(rebuiltFamily) !== canonicalJson(family)) {
    throw new Error('Replay did not reproduce the exact retained family report artifact');
  }
  await assertFourHourRepositoryPinned(preflight.repository, dependencies, paths);
  return {
    kind: 'four_hour_read_only_replay',
    familyId: FAMILY_ID,
    batchArtifactSha256: retained.manifest.artifactSha256,
    reportArtifactSha256: family.artifactSha256,
    familyDecision: family.canonical.payload.familyGate.verdict,
    selectedCandidate: family.canonical.payload.selectedCandidate,
    byteIdentical: true,
    authorization: FOUR_HOUR_AUTHORIZATION_BOUNDARY,
  };
}

function preflightOutput(preflight: FourHourPreflight): unknown {
  return {
    kind: 'four_hour_preflight',
    familyId: FAMILY_ID,
    repository: preflight.repository,
    h1FamilyInput: {
      id: preflight.h1.id,
      trialId: preflight.h1.trialId,
      reportSha256: preflight.h1.reportSha256,
      snapshotArtifactSha256: preflight.h1.snapshotArtifactSha256,
      snapshotDataSha256: preflight.h1.snapshotDataSha256,
      codeCommit: preflight.h1.codeCommit,
      specificationCommit: preflight.h1.specificationCommit,
      dailyNavCount: preflight.h1.dailyNavCount,
      dailyReturnCount: preflight.h1.dailyReturnCount,
      dailyReturnsSha256: preflight.h1.dailyReturnsSha256,
      familyDsrInputAvailable: preflight.h1.familyDsrInputAvailable,
      unavailabilityReason: preflight.h1.unavailabilityReason,
    },
    authorization: FOUR_HOUR_AUTHORIZATION_BOUNDARY,
  };
}

export async function executeFourHourCommand(
  command: string,
  dependencies: FourHourCliDependencies = defaultDependencies(),
  paths: FourHourCliPaths = defaultPaths(),
): Promise<unknown> {
  if (command === 'preflight') {
    return preflightOutput(await preflightFourHourResearch(dependencies, paths));
  }
  if (command === 'snapshot') return snapshotFourHourResearch(dependencies, paths);
  if (command === 'evaluate') return evaluateFourHourResearch(dependencies, paths);
  if (command === 'adjudicate') return adjudicateFourHourResearch(dependencies, paths);
  if (command === 'replay') return replayFourHourResearch(dependencies, paths);
  throw new Error(`Unknown four-hour research command: ${command}`);
}

export async function runFourHourCli(
  command: string,
  dependencies: FourHourCliDependencies = defaultDependencies(),
  paths: FourHourCliPaths = defaultPaths(),
  io: FourHourCliIo = {
    stdout: (value) => process.stdout.write(value),
    stderr: (value) => process.stderr.write(value),
  },
): Promise<0 | 1> {
  try {
    const output = await executeFourHourCommand(command, dependencies, paths);
    io.stdout(`${canonicalJson(output)}\n`);
    return 0;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unclassified four-hour CLI failure';
    io.stderr(`${canonicalJson({
      command,
      error: message,
      familyDecision: 'ERROR',
      authorization: FOUR_HOUR_AUTHORIZATION_BOUNDARY,
    })}\n`);
    return 1;
  }
}

function isEntrypointPath(executable: string): boolean {
  return /(?:^|[\\/])research[\\/]fourHour[\\/]cli\.(?:ts|js)$/u.test(executable);
}

function isEntrypoint(): boolean {
  const executable = process.argv[1];
  return typeof executable === 'string' && isEntrypointPath(executable);
}

if (isEntrypoint()) {
  const argumentsAfterEntrypoint = process.argv.slice(2);
  const command = argumentsAfterEntrypoint.length === 0
    ? 'preflight'
    : argumentsAfterEntrypoint.join(' ');
  void runFourHourCli(command).then((exitCode) => {
    process.exitCode = exitCode;
  });
}
