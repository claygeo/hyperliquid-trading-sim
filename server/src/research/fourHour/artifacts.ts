import { createHash, randomUUID } from 'node:crypto';
import { link, mkdir, open, readFile, readdir, unlink } from 'node:fs/promises';
import path from 'node:path';

import {
  FOUR_HOUR_MS,
  HOUR_MS,
  MARKET_SYMBOLS,
  PERP_ASSETS,
  type AcceptedSchedule,
  type CandleSeriesSnapshot,
  type FundingSeriesSnapshot,
  type MarketSymbol,
  type PerpAsset,
  type SpotSymbol,
  type StrategyId,
  type StrategySignal,
  type TrialVerdict,
  type TrialWindow,
} from './contracts.js';
import {
  AS_OF_TIME,
  CANDLE_WINDOWS,
  FAMILY_ID,
  FROZEN_TRIALS,
  FUNDING_WINDOWS,
  HOLDOUT_HALVES,
  HOLDOUT_WINDOW,
  SPECIFICATION_COMMIT,
  SPOT_PAIR_CONTRACTS,
  TRIAL_GATE_CONFIG,
  TRIAL_BY_ID,
} from './frozenTrials.js';
import {
  aggregateFamily,
  deflatedSharpeFamily,
  evaluateTrial,
  type DsrFamilyResult,
  type FamilyGateResult,
  type TrialGateInput,
  type TrialGateResult,
} from './familyEvaluation.js';
import {
  HYPERLIQUID_INFO_ENDPOINT,
  type ParsedSpotPairMetadata,
} from './hyperliquid.js';
import {
  type AssetLedgerPnl,
  type LedgerResult,
  type LedgerTermination,
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

export interface CanonicalFamilySnapshot {
  schemaVersion: 1;
  familyId: typeof FAMILY_ID;
  specificationCommit: typeof SPECIFICATION_COMMIT;
  cutoffTime: typeof AS_OF_TIME;
  source: {
    name: 'Hyperliquid';
    endpoint: typeof HYPERLIQUID_INFO_ENDPOINT;
    candleRequestType: 'candleSnapshot';
    candleInterval: '4h';
    fundingRequestType: 'fundingHistory';
    spotRequestType: 'spotMeta';
    pageRows: 500;
  };
  evaluator: {
    codeCommit: string;
    cleanWorktree: true;
    sourceBundleSha256: string;
  };
  candles: Record<MarketSymbol, CandleSeriesSnapshot>;
  funding: Record<PerpAsset, FundingSeriesSnapshot>;
  spotMetadata: {
    fetchedAt: string;
    rawResponseSha256: string;
    pairs: Record<SpotSymbol, ParsedSpotPairMetadata>;
  };
}

export interface StoredFamilySnapshot {
  dataSha256: string;
  artifactSha256: string;
  canonical: CanonicalFamilySnapshot;
}

export interface SourceBundleFile {
  relativePath: string;
  bytes: string;
}

const validatedFrozenSnapshots = new WeakSet<object>();
const retainedFrozenSnapshots = new WeakSet<object>();
const retainedReports = new WeakSet<object>();
interface ValidatedReportCapability {
  trialId: ImmutableReportTrialId;
  snapshotArtifactSha256: string;
  snapshotDataSha256: string;
}
const validatedReportCapabilities = new WeakMap<object, ValidatedReportCapability>();

function deepFreeze(value: unknown): void {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return;
  Object.values(value as Record<string, unknown>).forEach(deepFreeze);
  Object.freeze(value);
}

const EVALUATOR_FIXED_FILES = [
  'docs/specs/2026-07-22-independent-4h-trials.md',
  'server/package.json',
  'server/tsconfig.json',
  'server/jest.config.cjs',
] as const;

/**
 * Canonical JSON is intentionally implemented inside the frozen four-hour
 * evaluator surface. Importing the legacy H1 kernel here would make artifact
 * hashes depend on source bytes that are absent from the evaluator bundle.
 */
export function canonicalJson(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('Canonical JSON cannot contain non-finite numbers');
    return JSON.stringify(value);
  }
  if (typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value !== 'object') {
    throw new Error(`Canonical JSON cannot contain ${typeof value}`);
  }
  if (Array.isArray(value)) return `[${Array.from(value, canonicalJson).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort(compareOrdinal).map((key) => (
    `${JSON.stringify(key)}:${canonicalJson(record[key])}`
  )).join(',')}}`;
}

function compareOrdinal(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function normalizeSourcePath(input: string): string {
  const relativePath = input.replaceAll('\\', '/');
  const segments = relativePath.split('/');
  if (
    !relativePath
    || relativePath.startsWith('/')
    || relativePath.endsWith('/')
    || /^[A-Za-z]:/u.test(relativePath)
    || segments.some((segment) => segment === '' || segment === '.' || segment === '..')
  ) throw new Error(`Invalid evaluator source path ${input}`);
  return relativePath;
}

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

export function calculateSourceBundleSha256(files: readonly SourceBundleFile[]): string {
  if (files.length === 0) throw new Error('Evaluator source bundle cannot be empty');
  const normalized = [...files]
    .map((file) => {
      const relativePath = normalizeSourcePath(file.relativePath);
      return { relativePath, sha256: sha256(file.bytes) };
    })
    .sort((left, right) => compareOrdinal(left.relativePath, right.relativePath));
  for (let index = 1; index < normalized.length; index += 1) {
    if (normalized[index].relativePath === normalized[index - 1].relativePath) {
      throw new Error(`Duplicate evaluator source path ${normalized[index].relativePath}`);
    }
  }
  return sha256(canonicalJson(normalized));
}

/**
 * Source of the evaluator bytes.
 *
 * This indirection exists because reading the WORKING TREE made sourceBundleSha256 a
 * function of (commit x local checkout normalization) rather than of the commit. With
 * core.autocrlf enabled and no .gitattributes, three bundle files held CRLF on disk and
 * LF in the object database while `git status` still reported clean, because git's clean
 * filter strips CR before comparing. That divergence would have been sealed permanently
 * into the one-shot canonical snapshot, and any later checkout could have flipped the
 * hash and made an already-fetched snapshot permanently unusable.
 *
 * Production therefore reads committed blobs. The disk reader is retained for tests,
 * which construct fixture trees that were never committed.
 */
export interface EvaluatorSourceReader {
  /** Recursively list files under a repository-relative directory, sorted by path. */
  list(relativeDirectory: string): Promise<EvaluatorSourceEntry[]>;
  /** Read a repository-relative file as UTF-8. */
  read(relativePath: string): Promise<string>;
}

export interface EvaluatorSourceEntry {
  relativePath: string;
  isSymbolicLink: boolean;
}

export function createDiskSourceReader(repositoryRoot: string): EvaluatorSourceReader {
  const root = path.resolve(repositoryRoot);
  const walk = async (relativeDirectory: string): Promise<EvaluatorSourceEntry[]> => {
    const entries = await readdir(path.resolve(root, relativeDirectory), { withFileTypes: true });
    const out: EvaluatorSourceEntry[] = [];
    for (const entry of entries.sort((left, right) => compareOrdinal(left.name, right.name))) {
      const relativePath = normalizeSourcePath(`${relativeDirectory}/${entry.name}`);
      if (entry.isSymbolicLink()) {
        out.push({ relativePath, isSymbolicLink: true });
      } else if (entry.isDirectory()) {
        out.push(...await walk(relativePath));
      } else if (entry.isFile()) {
        out.push({ relativePath, isSymbolicLink: false });
      } else {
        throw new Error(`Unsupported evaluator source entry ${relativePath}`);
      }
    }
    return out;
  };
  return {
    list: walk,
    read: (relativePath) => readFile(path.resolve(root, relativePath), 'utf8'),
  };
}

export async function collectEvaluatorSourceBundle(
  repositoryRoot: string,
  reader: EvaluatorSourceReader = createDiskSourceReader(repositoryRoot),
): Promise<SourceBundleFile[]> {
  const fixed = await Promise.all(EVALUATOR_FIXED_FILES.map(async (relativePath) => ({
    relativePath,
    bytes: await reader.read(relativePath),
  })));
  const entries = await reader.list('server/src/research/fourHour');
  const recursive: SourceBundleFile[] = [];
  for (const entry of entries) {
    const relativePath = normalizeSourcePath(entry.relativePath);
    if (entry.isSymbolicLink) throw new Error(`Evaluator source cannot contain symlink ${relativePath}`);
    recursive.push({ relativePath, bytes: await reader.read(relativePath) });
  }
  validateEvaluatorImportClosure(recursive);
  return [...fixed, ...recursive]
    .sort((left, right) => compareOrdinal(left.relativePath, right.relativePath));
}

function validateEvaluatorImportClosure(files: readonly SourceBundleFile[]): void {
  const staticImport = /\b(?:import|export)\s+(type\s+)?(?:[\s\S]*?\s+from\s+)?['"]([^'"]+)['"]/gu;
  const dynamicOrRequire = /\b(?:import\s*\(|require\s*\()\s*['"]([^'"]+)['"]/gu;
  for (const file of files) {
    if (!file.relativePath.endsWith('.ts')) continue;
    for (const match of file.bytes.matchAll(staticImport)) {
      const typeOnly = match[1] !== undefined;
      const specifier = match[2];
      if (specifier.startsWith('node:')) continue;
      if (specifier.startsWith('./') || specifier.startsWith('../')) {
        const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(file.relativePath), specifier));
        const insideSurface = resolved.startsWith('server/src/research/fourHour/');
        const approvedPinnedH1Type = typeOnly
          && file.relativePath === 'server/src/research/fourHour/runner.ts'
          && resolved === 'server/src/research/hyperliquid.js';
        if (insideSurface || approvedPinnedH1Type) continue;
      }
      throw new Error(`Evaluator source import escapes frozen surface: ${file.relativePath} -> ${specifier}`);
    }
    for (const match of file.bytes.matchAll(dynamicOrRequire)) {
      throw new Error(`Evaluator source cannot use dynamic import/require: ${file.relativePath} -> ${match[1]}`);
    }
  }
}

function normalizedSnapshotData(canonical: CanonicalFamilySnapshot): unknown {
  return {
    schemaVersion: canonical.schemaVersion,
    familyId: canonical.familyId,
    specificationCommit: canonical.specificationCommit,
    cutoffTime: canonical.cutoffTime,
    source: canonical.source,
    candles: Object.fromEntries(MARKET_SYMBOLS.map((symbol) => [
      symbol,
      {
        symbol,
        startTime: canonical.candles[symbol].startTime,
        endTime: canonical.candles[symbol].endTime,
        expectedBars: canonical.candles[symbol].expectedBars,
        candles: canonical.candles[symbol].candles,
      },
    ])),
    funding: Object.fromEntries(PERP_ASSETS.map((coin) => [
      coin,
      {
        coin,
        startTime: canonical.funding[coin].startTime,
        endTime: canonical.funding[coin].endTime,
        expectedHours: canonical.funding[coin].expectedHours,
        funding: canonical.funding[coin].funding,
      },
    ])),
    spotPairs: canonical.spotMetadata.pairs,
  };
}

export function calculateFamilySnapshotHashes(canonical: CanonicalFamilySnapshot): {
  dataSha256: string;
  artifactSha256: string;
} {
  return {
    dataSha256: sha256(canonicalJson(normalizedSnapshotData(canonical))),
    artifactSha256: sha256(canonicalJson(canonical)),
  };
}

function snapshotRawResponseHashes(canonical: CanonicalFamilySnapshot): string[] {
  return [
    ...MARKET_SYMBOLS.flatMap((symbol) => (
      canonical.candles[symbol].pages.map((page) => page.rawResponseSha256)
    )),
    ...PERP_ASSETS.flatMap((coin) => (
      canonical.funding[coin].pages.map((page) => page.rawResponseSha256)
    )),
    canonical.spotMetadata.rawResponseSha256,
  ];
}

function assertSha256(value: string, label: string): void {
  if (!/^[0-9a-f]{64}$/u.test(value)) throw new Error(`${label} must be lowercase SHA-256`);
}

function assertUtcIsoTimestamp(value: string, label: string): void {
  const parsed = typeof value === 'string' ? Date.parse(value) : Number.NaN;
  if (
    typeof value !== 'string'
    || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value)
    || !Number.isFinite(parsed)
    || new Date(parsed).toISOString() !== value
  ) throw new Error(`${label} must be a canonical UTC timestamp`);
}

function assertExactKeys(
  value: unknown,
  expected: readonly string[],
  label: string,
): asserts value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  const actual = Object.keys(value).sort(compareOrdinal);
  const wanted = [...expected].sort(compareOrdinal);
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    throw new Error(`${label} keys mismatch`);
  }
}

function validatePageEvidence(
  page: CandleSeriesSnapshot['pages'][number],
  pageIndex: number,
  requestedStartTime: number,
  requestedEndTime: number,
  expectedRows: number,
  label: string,
): void {
  assertExactKeys(page, [
    'page',
    'requestedStartTime',
    'requestedEndTime',
    'responseRows',
    'acceptedRows',
    'firstTime',
    'lastTime',
    'rawResponseSha256',
    'fetchedAt',
  ], `${label} page evidence`);
  if (
    page.page !== pageIndex + 1
    || page.requestedStartTime !== requestedStartTime
    || page.requestedEndTime !== requestedEndTime
    || page.responseRows !== expectedRows
    || page.acceptedRows !== expectedRows
    || page.firstTime !== requestedStartTime
    || page.lastTime !== requestedEndTime
  ) throw new Error(`${label} page ${pageIndex + 1} evidence mismatch`);
  assertSha256(page.rawResponseSha256, `${label} page ${pageIndex + 1} raw response`);
  assertUtcIsoTimestamp(page.fetchedAt, `${label} page ${pageIndex + 1} fetchedAt`);
}

function validateCandleSnapshot(snapshot: CandleSeriesSnapshot, symbol: MarketSymbol): void {
  assertExactKeys(
    snapshot,
    ['symbol', 'startTime', 'endTime', 'expectedBars', 'pages', 'candles'],
    `${symbol} candle snapshot`,
  );
  const frozen = CANDLE_WINDOWS[symbol];
  if (
    snapshot.symbol !== symbol
    || snapshot.startTime !== frozen.startTime
    || snapshot.endTime !== frozen.endTime
    || snapshot.expectedBars !== frozen.expectedBars
    || snapshot.candles.length !== frozen.expectedBars
  ) throw new Error(`${symbol} candle snapshot contract mismatch`);
  snapshot.candles.forEach((candle, index) => {
    assertExactKeys(candle, [
      'symbol', 'interval', 'openTime', 'closeTime', 'open', 'high', 'low', 'close', 'volume',
    ], `${symbol} candle ${index}`);
    const expectedOpen = frozen.startTime + index * FOUR_HOUR_MS;
    if (
      candle.symbol !== symbol
      || candle.interval !== '4h'
      || candle.openTime !== expectedOpen
      || candle.closeTime !== expectedOpen + FOUR_HOUR_MS - 1
      || candle.closeTime >= AS_OF_TIME
      || ![candle.open, candle.high, candle.low, candle.close, candle.volume]
        .every(Number.isFinite)
      || candle.open <= 0
      || candle.high < Math.max(candle.open, candle.close)
      || candle.low > Math.min(candle.open, candle.close)
      || candle.low <= 0
      || candle.volume < 0
    ) throw new Error(`${symbol} candle ${index} is invalid`);
  });
  const expectedPages = Math.ceil(frozen.expectedBars / 500);
  if (snapshot.pages.length !== expectedPages) {
    throw new Error(`${symbol} candle page count mismatch`);
  }
  snapshot.pages.forEach((page, index) => {
    const offset = index * 500;
    const expectedRows = Math.min(500, frozen.expectedBars - offset);
    const requestedStartTime = frozen.startTime + offset * FOUR_HOUR_MS;
    validatePageEvidence(
      page,
      index,
      requestedStartTime,
      requestedStartTime + expectedRows * FOUR_HOUR_MS - 1,
      expectedRows,
      `${symbol} candle`,
    );
  });
}

function validateFundingSnapshot(snapshot: FundingSeriesSnapshot, coin: PerpAsset): void {
  assertExactKeys(
    snapshot,
    ['coin', 'startTime', 'endTime', 'expectedHours', 'pages', 'funding'],
    `${coin} funding snapshot`,
  );
  const frozen = FUNDING_WINDOWS[coin];
  if (
    snapshot.coin !== coin
    || snapshot.startTime !== frozen.startTime
    || snapshot.endTime !== frozen.endTime
    || snapshot.expectedHours !== frozen.expectedHours
    || snapshot.funding.length !== frozen.expectedHours
  ) throw new Error(`${coin} funding snapshot contract mismatch`);
  snapshot.funding.forEach((record, index) => {
    assertExactKeys(record, ['coin', 'time', 'rate'], `${coin} funding ${index}`);
    if (
      record.coin !== coin
      || record.time !== frozen.startTime + index * HOUR_MS
      || !Number.isFinite(record.rate)
    ) throw new Error(`${coin} funding ${index} is invalid`);
  });
  const expectedPages = Math.ceil(frozen.expectedHours / 500);
  if (snapshot.pages.length !== expectedPages) {
    throw new Error(`${coin} funding page count mismatch`);
  }
  snapshot.pages.forEach((page, index) => {
    const offset = index * 500;
    const expectedRows = Math.min(500, frozen.expectedHours - offset);
    const requestedStartTime = frozen.startTime + offset * HOUR_MS;
    validatePageEvidence(
      page,
      index,
      requestedStartTime,
      requestedStartTime + (expectedRows - 1) * HOUR_MS,
      expectedRows,
      `${coin} funding`,
    );
  });
}

function validateAlignedTail(
  left: CandleSeriesSnapshot,
  right: CandleSeriesSnapshot,
  startTime: number,
  label: string,
): void {
  const leftTail = left.candles.filter((candle) => candle.openTime >= startTime);
  const rightTail = right.candles.filter((candle) => candle.openTime >= startTime);
  if (leftTail.length !== rightTail.length || leftTail.length === 0) {
    throw new Error(`${label} aligned tail length mismatch`);
  }
  for (let index = 0; index < leftTail.length; index += 1) {
    if (
      leftTail[index].openTime !== rightTail[index].openTime
      || leftTail[index].closeTime !== rightTail[index].closeTime
    ) throw new Error(`${label} calendar mismatch at ${index}`);
  }
}

export function validateFamilySnapshot(canonical: CanonicalFamilySnapshot): void {
  assertExactKeys(canonical, [
    'schemaVersion',
    'familyId',
    'specificationCommit',
    'cutoffTime',
    'source',
    'evaluator',
    'candles',
    'funding',
    'spotMetadata',
  ], 'Family snapshot');
  assertExactKeys(canonical.source, [
    'name',
    'endpoint',
    'candleRequestType',
    'candleInterval',
    'fundingRequestType',
    'spotRequestType',
    'pageRows',
  ], 'Family snapshot source');
  assertExactKeys(
    canonical.evaluator,
    ['codeCommit', 'cleanWorktree', 'sourceBundleSha256'],
    'Family snapshot evaluator',
  );
  assertExactKeys(canonical.candles, MARKET_SYMBOLS, 'Family candle series');
  assertExactKeys(canonical.funding, PERP_ASSETS, 'Family funding series');
  if (
    canonical.schemaVersion !== 1
    || canonical.familyId !== FAMILY_ID
    || canonical.specificationCommit !== SPECIFICATION_COMMIT
    || canonical.cutoffTime !== AS_OF_TIME
  ) throw new Error('Family snapshot frozen identity mismatch');
  if (
    canonical.source.name !== 'Hyperliquid'
    || canonical.source.endpoint !== HYPERLIQUID_INFO_ENDPOINT
    || canonical.source.candleRequestType !== 'candleSnapshot'
    || canonical.source.candleInterval !== '4h'
    || canonical.source.fundingRequestType !== 'fundingHistory'
    || canonical.source.spotRequestType !== 'spotMeta'
    || canonical.source.pageRows !== 500
  ) throw new Error('Family snapshot source contract mismatch');
  if (!canonical.evaluator.cleanWorktree || !/^[0-9a-f]{40}$/u.test(canonical.evaluator.codeCommit)) {
    throw new Error('Family snapshot evaluator provenance mismatch');
  }
  assertSha256(canonical.evaluator.sourceBundleSha256, 'Evaluator source bundle');
  for (const symbol of MARKET_SYMBOLS) validateCandleSnapshot(canonical.candles[symbol], symbol);
  for (const coin of PERP_ASSETS) validateFundingSnapshot(canonical.funding[coin], coin);
  validateAlignedTail(canonical.candles.BTC, canonical.candles.ETH, CANDLE_WINDOWS.BTC.startTime, 'BTC/ETH');
  validateAlignedTail(canonical.candles.BTC, canonical.candles.HYPE, CANDLE_WINDOWS.HYPE.startTime, 'BTC/HYPE');
  validateAlignedTail(canonical.candles.BTC, canonical.candles['@142'], CANDLE_WINDOWS['@142'].startTime, 'BTC/UBTC');
  validateAlignedTail(canonical.candles.ETH, canonical.candles['@151'], CANDLE_WINDOWS['@151'].startTime, 'ETH/UETH');
  assertExactKeys(
    canonical.spotMetadata,
    ['fetchedAt', 'rawResponseSha256', 'pairs'],
    'spotMeta evidence',
  );
  assertUtcIsoTimestamp(canonical.spotMetadata.fetchedAt, 'spotMeta fetchedAt');
  assertSha256(canonical.spotMetadata.rawResponseSha256, 'spotMeta raw response');
  assertExactKeys(canonical.spotMetadata.pairs, ['@142', '@151'], 'spotMeta pairs');
  for (const symbol of ['@142', '@151'] as const) {
    const pair = canonical.spotMetadata.pairs[symbol];
    assertExactKeys(pair, [
      'symbol',
      'index',
      'displayName',
      'baseTokenIndex',
      'quoteTokenIndex',
      'isCanonical',
      'wrapperMultiplier',
      'tokens',
    ], `${symbol} spot pair`);
    if (
      pair.symbol !== symbol
      || pair.displayName !== SPOT_PAIR_CONTRACTS[symbol].displayName
      || pair.index !== Number(symbol.slice(1))
      || pair.isCanonical !== false
      || pair.wrapperMultiplier !== 1
      || pair.tokens.length !== 2
      || pair.tokens[0].index !== pair.baseTokenIndex
      || pair.tokens[1].index !== pair.quoteTokenIndex
    ) throw new Error(`${symbol} spot pair contract mismatch`);
    const expectedBaseName = symbol === '@142' ? 'UBTC' : 'UETH';
    pair.tokens.forEach((token, index) => {
      assertExactKeys(token, [
        'index',
        'name',
        'szDecimals',
        'weiDecimals',
        'tokenId',
        'isCanonical',
        'evmContract',
        'fullName',
      ], `${symbol} token ${index}`);
      if (
        !Number.isSafeInteger(token.index)
        || token.index < 0
        || !Number.isSafeInteger(token.szDecimals)
        || token.szDecimals < 0
        || !Number.isSafeInteger(token.weiDecimals)
        || token.weiDecimals < 0
        || typeof token.tokenId !== 'string'
        || token.tokenId.length === 0
        || (token.evmContract !== null && typeof token.evmContract !== 'string')
        || (token.fullName !== null && typeof token.fullName !== 'string')
      ) throw new Error(`${symbol} token ${index} metadata mismatch`);
    });
    if (
      pair.tokens[0].name !== expectedBaseName
      || pair.tokens[1].name !== 'USDC'
      || pair.tokens[0].isCanonical !== false
      || pair.tokens[1].isCanonical !== true
      || pair.baseTokenIndex === pair.quoteTokenIndex
    ) throw new Error(`${symbol} token identity mismatch`);
  }
}

export function buildStoredFamilySnapshot(canonical: CanonicalFamilySnapshot): StoredFamilySnapshot {
  validateFamilySnapshot(canonical);
  const snapshot = { ...calculateFamilySnapshotHashes(canonical), canonical };
  validateStoredFamilySnapshot(snapshot);
  return snapshot;
}

export function validateStoredFamilySnapshot(snapshot: StoredFamilySnapshot): void {
  if (validatedFrozenSnapshots.has(snapshot)) return;
  assertExactKeys(
    snapshot,
    ['dataSha256', 'artifactSha256', 'canonical'],
    'Stored family snapshot',
  );
  validateFamilySnapshot(snapshot.canonical);
  const hashes = calculateFamilySnapshotHashes(snapshot.canonical);
  if (hashes.dataSha256 !== snapshot.dataSha256 || hashes.artifactSha256 !== snapshot.artifactSha256) {
    throw new Error('Family snapshot hashes do not match payload');
  }
  deepFreeze(snapshot);
  validatedFrozenSnapshots.add(snapshot);
}

function requireRetainedFamilySnapshot(
  snapshot: Readonly<StoredFamilySnapshot>,
): asserts snapshot is StoredFamilySnapshot {
  if (!retainedFrozenSnapshots.has(snapshot as object)) {
    throw new Error('Reports require the exact retained snapshot object returned by readFamilySnapshot');
  }
  validateStoredFamilySnapshot(snapshot as StoredFamilySnapshot);
}

function familySnapshotFilenamePattern(): RegExp {
  const escaped = FAMILY_ID.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  return new RegExp(`^${escaped}\\.([0-9a-f]{64})\\.json$`, 'u');
}

interface ContentClaim {
  schemaVersion: 1;
  kind: 'content_claim';
  logicalId: string;
  outputFilename: string;
  contentSha256: string;
}

const CLAIM_DIRECTORY = '.content-claims';

function errorCode(error: unknown): string | null {
  return error && typeof error === 'object' && 'code' in error
    ? String((error as { code: unknown }).code)
    : null;
}

async function atomicNoClobberWrite(output: string, contents: string): Promise<void> {
  const directory = path.dirname(output);
  const temporary = path.join(
    directory,
    `.${path.basename(output)}.${process.pid}.${randomUUID()}.tmp`,
  );
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    handle = await open(temporary, 'wx');
    await handle.writeFile(contents, { encoding: 'utf8' });
    await handle.sync();
    await handle.close();
    handle = undefined;
    // A hard link publishes the already-synced bytes atomically and fails if output exists.
    await link(temporary, output);
  } finally {
    await handle?.close().catch(() => undefined);
    await unlink(temporary).catch(() => undefined);
  }
}

async function readUtf8IfPresent(filename: string): Promise<string | null> {
  try {
    return await readFile(filename, 'utf8');
  } catch (error: unknown) {
    if (errorCode(error) === 'ENOENT') return null;
    throw error;
  }
}

async function readDirectoryIfPresent(directory: string): Promise<string[]> {
  try {
    return await readdir(directory);
  } catch (error: unknown) {
    if (errorCode(error) === 'ENOENT') return [];
    throw error;
  }
}

function validateContentClaim(value: unknown, expectedLogicalId: string): ContentClaim {
  assertExactKeys(
    value,
    ['schemaVersion', 'kind', 'logicalId', 'outputFilename', 'contentSha256'],
    'Content claim',
  );
  const claim = value as unknown as ContentClaim;
  if (
    claim.schemaVersion !== 1
    || claim.kind !== 'content_claim'
    || claim.logicalId !== expectedLogicalId
    || typeof claim.outputFilename !== 'string'
    || path.basename(claim.outputFilename) !== claim.outputFilename
  ) throw new Error(`Invalid content claim for ${expectedLogicalId}`);
  assertSha256(claim.contentSha256, `Content claim ${expectedLogicalId}`);
  return claim;
}

async function readContentClaim(claimPath: string, logicalId: string): Promise<ContentClaim | null> {
  const raw = await readUtf8IfPresent(claimPath);
  if (raw === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`Corrupted content claim for ${logicalId}`);
  }
  return validateContentClaim(parsed, logicalId);
}

async function reconcileContentClaim(
  directory: string,
  logicalId: string,
  outputFilename: string,
  contents: string,
): Promise<string> {
  await mkdir(directory, { recursive: true });
  const output = path.join(directory, outputFilename);
  const contentSha256 = sha256(contents);
  const claim: ContentClaim = {
    schemaVersion: 1,
    kind: 'content_claim',
    logicalId,
    outputFilename,
    contentSha256,
  };
  const claimDirectory = path.join(directory, CLAIM_DIRECTORY);
  await mkdir(claimDirectory, { recursive: true });
  const claimPath = path.join(claimDirectory, `${logicalId}.json`);

  // Final-only is a valid crash boundary. Verify it before creating a claim so
  // conflicting retained bytes never acquire a claim for the retry payload.
  const retainedBeforeClaim = await readUtf8IfPresent(output);
  if (retainedBeforeClaim !== null && retainedBeforeClaim !== contents) {
    throw new Error(`Conflicting retained content for ${logicalId}`);
  }

  try {
    await atomicNoClobberWrite(claimPath, `${canonicalJson(claim)}\n`);
  } catch (error: unknown) {
    if (errorCode(error) !== 'EEXIST') throw error;
  }

  const retainedClaim = await readContentClaim(claimPath, logicalId);
  if (!retainedClaim || canonicalJson(retainedClaim) !== canonicalJson(claim)) {
    throw new Error(`Conflicting content claim for ${logicalId}`);
  }

  const retainedAfterClaim = await readUtf8IfPresent(output);
  if (retainedAfterClaim === null) {
    try {
      await atomicNoClobberWrite(output, contents);
    } catch (error: unknown) {
      if (errorCode(error) !== 'EEXIST') throw error;
    }
  }
  const retainedFinal = await readUtf8IfPresent(output);
  if (retainedFinal !== contents || sha256(retainedFinal) !== retainedClaim.contentSha256) {
    throw new Error(`Content claim final mismatch for ${logicalId}`);
  }
  const verifiedClaim = await readContentClaim(claimPath, logicalId);
  if (!verifiedClaim || canonicalJson(verifiedClaim) !== canonicalJson(claim)) {
    throw new Error(`Content claim changed for ${logicalId}`);
  }
  return output;
}

export async function writeFamilySnapshot(
  snapshot: StoredFamilySnapshot,
  directory: string,
): Promise<string> {
  validateStoredFamilySnapshot(snapshot);
  await mkdir(directory, { recursive: true });
  const filename = `${FAMILY_ID}.${snapshot.artifactSha256}.json`;
  const existing = (await readdir(directory))
    .filter((name) => familySnapshotFilenamePattern().test(name));
  if (existing.some((name) => name !== filename)) {
    throw new Error(`Conflicting family snapshot already exists for ${FAMILY_ID}`);
  }
  return reconcileContentClaim(
    directory,
    `${FAMILY_ID}.snapshot`,
    filename,
    `${canonicalJson(snapshot)}\n`,
  );
}

export async function readFamilySnapshot(
  directory: string,
): Promise<StoredFamilySnapshot> {
  const matching = (await readDirectoryIfPresent(directory))
    .filter((name) => familySnapshotFilenamePattern().test(name));
  if (matching.length !== 1) {
    throw new Error(`Expected one ${FAMILY_ID} snapshot, found ${matching.length}`);
  }
  const filename = matching[0];
  const raw = await readFile(path.join(directory, filename), 'utf8');
  const parsed = JSON.parse(raw) as StoredFamilySnapshot;
  if (!parsed?.canonical) throw new Error('Family snapshot artifact is malformed');
  validateStoredFamilySnapshot(parsed);
  const hashes = calculateFamilySnapshotHashes(parsed.canonical);
  if (
    parsed.dataSha256 !== hashes.dataSha256
    || parsed.artifactSha256 !== hashes.artifactSha256
    || filename !== `${FAMILY_ID}.${hashes.artifactSha256}.json`
  ) throw new Error('Family snapshot content hash verification failed');
  await verifyContentClaimIfPresent(directory, `${FAMILY_ID}.snapshot`, filename, raw);
  retainedFrozenSnapshots.add(parsed);
  return parsed;
}

export type FrozenTrialId = (typeof FROZEN_TRIALS)[number]['trialId'];
export type ImmutableReportTrialId = FrozenTrialId | typeof FAMILY_ID;

export interface ReportSourceEvidence {
  snapshotArtifactSha256: string;
  snapshotEvaluator: CanonicalFamilySnapshot['evaluator'];
  rawResponseSha256: readonly string[];
  candleWindows: typeof CANDLE_WINDOWS;
  fundingWindows: typeof FUNDING_WINDOWS;
  spotRequestType: 'spotMeta';
}

export interface MechanicalCorrectionEvidence {
  classification: 'MECHANICAL_ONLY';
  incidentId: string;
  regressionTestPath: string;
  regressionTestSha256: string;
  correctionCommit: string;
  correctionSourceBundleSha256: string;
}

interface ReportEnvelope<TPayload> {
  familyId: typeof FAMILY_ID;
  trialId: ImmutableReportTrialId;
  reportRevision: number;
  supersedesArtifactSha256: string | null;
  revisionEvidence: MechanicalCorrectionEvidence | null;
  dataSha256: string;
  specificationCommit: typeof SPECIFICATION_COMMIT;
  evaluator: CanonicalFamilySnapshot['evaluator'];
  sourceEvidence: ReportSourceEvidence;
  parameters: unknown;
  payload: TPayload;
}

export interface LedgerMetricsPayload {
  endingNav: number;
  adjustedPnl: number;
  funding: number;
  fees: number;
  slippage: number;
  turnover: number;
  fourHourMaxDrawdown: number;
  dailyReturns: number[];
  dailyReturnsSha256: string;
  dailyVolatility: number | null;
  annualizedDailySharpe: number | null;
  rawLegs: number;
  completedAssetTrades: number;
  effectiveEpisodes: number;
  episodeExpectancy: number | null;
  winRate: number | null;
  profitFactor: number | null;
  largestPositiveEpisodePnl: number | null;
  topFivePositiveEpisodeConcentration: number | null;
  pnlByAsset: Record<PerpAsset, AssetLedgerPnl>;
  maximumMarkedGross: number;
  maximumGrossToNav: number;
  maximumLongGross: number;
  maximumShortGross: number;
  termination: LedgerTermination | null;
}

export interface LedgerCasePayload {
  costCase: 'base' | 'stress';
  boundaryFunding: 'exclude' | 'adverse_debits';
  ledger: LedgerResult;
  metrics: LedgerMetricsPayload;
}

export interface PortfolioRunPayload {
  portfolio: 'primary' | 'exploratory';
  assets: PerpAsset[];
  window: TrialWindow;
  signals: StrategySignal[];
  schedule: AcceptedSchedule;
  scheduleSha256: string;
  stressControllerSha256: string;
  stressReplaySha256: string;
  stressControllerByteIdentical: true;
  cases: {
    base: LedgerCasePayload;
    stress: LedgerCasePayload;
    adverseBoundaryStress: LedgerCasePayload;
  };
}

export interface PrimaryTrialPayload {
  fullHistory: PortfolioRunPayload;
  holdout: PortfolioRunPayload;
  halves: [PortfolioRunPayload, PortfolioRunPayload];
}

export interface ExploratoryTrialPayload {
  asset: 'HYPE';
  classification: 'EXPLORATORY_ONLY';
  selectionEligible: false;
  historicalPromotionEligible: false;
  status: 'COMPLETE' | 'ERROR';
  fullHistory: PortfolioRunPayload | null;
  holdout: PortfolioRunPayload | null;
  error: TrialReportError | null;
}

export interface RequiredSleevePayload {
  asset: PerpAsset;
  adjustedPnl: number;
  hadExposure: boolean;
}

export interface GateMetricsPayload {
  baseExpectancy: number | null;
  stressExpectancy: number | null;
  adverseBoundaryStressExpectancy: number | null;
  baseMaxDrawdown: number;
  stressMaxDrawdown: number;
  requiredSleeves: RequiredSleevePayload[];
  halfAdjustedPnl: [number, number];
  effectiveEpisodes: number;
  baseAnnualizedSharpe: number | null;
  baseProfitFactor: number | null;
  stressAdjustedPnl: number;
  bootstrapLowerBound: number | null;
  topFiveConcentration: number | null;
  assetConcentration: number | null;
  assetConcentrationApplicable: boolean;
  requiredSleevesWithExposure: boolean;
}

export type TrialReportErrorCode =
  | 'INVALID_INPUT'
  | 'CHRONOLOGY'
  | 'NON_FINITE_LEDGER'
  | 'NON_DETERMINISTIC_REPLAY'
  | 'UNCLASSIFIED_RUNTIME_FAILURE';

export interface TrialReportError {
  code: TrialReportErrorCode;
  stage: 'signals' | 'schedule' | 'ledger' | 'metrics';
  message: string;
}

export interface TrialReportPayload {
  schemaVersion: 1;
  kind: 'trial_metrics';
  familyId: typeof FAMILY_ID;
  strategyId: StrategyId;
  trialId: FrozenTrialId;
  status: 'COMPLETE' | 'ERROR';
  familyDecision: 'PENDING';
  historicalPromotionEligible: false;
  primary: PrimaryTrialPayload | null;
  exploratory: ExploratoryTrialPayload | null;
  gateMetrics: GateMetricsPayload | null;
  error: TrialReportError | null;
  limitations: string[];
}

export interface TrialReportReference {
  id: StrategyId;
  trialId: FrozenTrialId;
  reportRevision: number;
  reportArtifactSha256: string;
  dataSha256: string;
  specificationCommit: typeof SPECIFICATION_COMMIT;
  evaluator: CanonicalFamilySnapshot['evaluator'];
  snapshotArtifactSha256: string;
  primaryDailyReturnsSha256: string | null;
  metricsStatus: 'COMPLETE' | 'ERROR';
}

export interface H1FamilyInputPayload {
  id: 'H1';
  trialId: 'H1-TREND-DAILY-20260722-001';
  reportSha256: string;
  codeCommit: string;
  specificationCommit: string;
  snapshotArtifactSha256: string;
  snapshotDataSha256: string;
  dailyNavCount: 360;
  dailyReturnCount: 359;
  dailyReturnsSha256: string;
  familyDsrInputAvailable: boolean;
  unavailabilityReason: string | null;
}

export interface FamilyTrialGatePayload {
  id: StrategyId;
  input: TrialGateInput;
  result: TrialGateResult;
}

export interface SelectedCandidatePayload {
  id: StrategyId;
  trialId: FrozenTrialId;
  rank: 1 | 2 | 3;
}

export interface HypeBoundaryPayload {
  asset: 'HYPE';
  classification: 'EXPLORATORY_ONLY';
  selectionEligible: false;
  historicalPromotionEligible: false;
  liveTradingEligible: false;
}

export interface ForwardPaperBoundaryPayload {
  numericalCandidate: StrategyId | null;
  admissionManifestRequired: true;
  paperJobAuthorized: false;
  walletAuthorized: false;
  liveTradingAuthorized: false;
}

export interface FamilyReportPayload {
  schemaVersion: 1;
  kind: 'family_decision';
  familyId: typeof FAMILY_ID;
  status: 'ADJUDICATED';
  stopMining: true;
  selectionAttemptCount: 4;
  h1Input: H1FamilyInputPayload;
  trialReports: [TrialReportReference, TrialReportReference, TrialReportReference];
  familyDsr: DsrFamilyResult;
  trialGates: [FamilyTrialGatePayload, FamilyTrialGatePayload, FamilyTrialGatePayload];
  familyGate: FamilyGateResult;
  selectedCandidate: SelectedCandidatePayload | null;
  hypeBoundary: HypeBoundaryPayload;
  forwardPaperBoundary: ForwardPaperBoundaryPayload;
  limitations: string[];
}

export type TrialReportEnvelope = ReportEnvelope<TrialReportPayload>;
export type FamilyReportEnvelope = ReportEnvelope<FamilyReportPayload>;

export interface StoredTrialReport {
  artifactSha256: string;
  canonical: TrialReportEnvelope;
}

export interface StoredFamilyReport {
  artifactSha256: string;
  canonical: FamilyReportEnvelope;
}

export interface TrialReportDraft {
  trialId: FrozenTrialId;
  reportRevision: number;
  supersedesArtifactSha256: string | null;
  revisionEvidence: MechanicalCorrectionEvidence | null;
  evaluator: CanonicalFamilySnapshot['evaluator'];
  payload: TrialReportPayload;
}

export interface FamilyReportDraft {
  reportRevision: number;
  supersedesArtifactSha256: string | null;
  revisionEvidence: MechanicalCorrectionEvidence | null;
  evaluator: CanonicalFamilySnapshot['evaluator'];
  payload: FamilyReportPayload;
}

export interface H1FamilyEvidence extends H1FamilyInputPayload {
  returns: readonly number[];
}

export interface FamilyReportEvidence {
  h1: H1FamilyEvidence;
  trialReports: readonly [StoredTrialReport, StoredTrialReport, StoredTrialReport];
}

export interface InitialTrialBatchManifest {
  schemaVersion: 1;
  kind: 'initial_trial_batch';
  familyId: typeof FAMILY_ID;
  dataSha256: string;
  snapshotArtifactSha256: string;
  evaluator: CanonicalFamilySnapshot['evaluator'];
  reports: readonly [TrialReportReference, TrialReportReference, TrialReportReference];
}

export interface StoredInitialTrialBatch {
  artifactSha256: string;
  canonical: InitialTrialBatchManifest;
}

function assertFiniteNumber(value: unknown, label: string): asserts value is number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`${label} must be finite`);
}

function assertNullableFinite(value: unknown, label: string): void {
  if (value !== null) assertFiniteNumber(value, label);
}

function assertNonNegativeInteger(value: unknown, label: string): asserts value is number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new Error(`${label} must be a non-negative integer`);
  }
}

function assertStringArray(value: unknown, label: string): asserts value is string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || item.length === 0)) {
    throw new Error(`${label} must contain non-empty strings`);
  }
}

function assertFiniteJson(value: unknown, label: string): void {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number') {
    assertFiniteNumber(value, label);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertFiniteJson(item, `${label}[${index}]`));
    return;
  }
  if (typeof value !== 'object') throw new Error(`${label} is not canonical JSON`);
  Object.entries(value as Record<string, unknown>).forEach(([key, item]) => (
    assertFiniteJson(item, `${label}.${key}`)
  ));
}

function validateWindow(value: TrialWindow, label: string): void {
  assertExactKeys(value, ['startTime', 'endTime'], label);
  if (!Number.isSafeInteger(value.startTime) || !Number.isSafeInteger(value.endTime)
    || value.endTime <= value.startTime) throw new Error(`${label} is invalid`);
}

function validateSignal(signal: StrategySignal, strategyId: StrategyId, label: string): void {
  if (strategyId === 'H2') {
    assertExactKeys(signal, [
      'strategy', 'asset', 'signalIndex', 'decisionTime', 'entryIndex', 'exitIndex',
      'fundingSum', 'perpClose', 'spotClose',
    ], label);
  } else {
    assertExactKeys(signal, strategyId === 'H4' ? [
      'strategy', 'asset', 'signalIndex', 'decisionTime', 'entryIndex', 'exitIndex',
      'direction', 'score', 'residual', 'residualScale',
    ] : [
      'strategy', 'asset', 'signalIndex', 'decisionTime', 'entryIndex', 'exitIndex',
      'direction', 'score',
    ], label);
  }
  if (signal.strategy !== strategyId) throw new Error(`${label} has wrong strategy`);
  assertFiniteJson(signal, label);
}

function validateSchedule(schedule: AcceptedSchedule, trialId: FrozenTrialId, label: string): void {
  assertExactKeys(schedule, ['trialId', 'positions', 'skipped'], label);
  if (schedule.trialId !== trialId || !Array.isArray(schedule.positions) || !Array.isArray(schedule.skipped)) {
    throw new Error(`${label} identity is invalid`);
  }
  schedule.positions.forEach((position, index) => {
    assertExactKeys(position, [
      'id', 'trialId', 'strategy', 'asset', 'signalIndex', 'decisionTime', 'entryTime',
      'exitTime', 'entryGross', 'legs',
    ], `${label}.positions[${index}]`);
    if (!Array.isArray(position.legs)) throw new Error(`${label}.positions[${index}].legs is invalid`);
    position.legs.forEach((leg, legIndex) => assertExactKeys(
      leg,
      ['instrument', 'market', 'asset', 'signedUnits', 'entryReferencePrice'],
      `${label}.positions[${index}].legs[${legIndex}]`,
    ));
  });
  schedule.skipped.forEach((skipped, index) => assertExactKeys(
    skipped,
    ['strategy', 'asset', 'decisionTime', 'reason'],
    `${label}.skipped[${index}]`,
  ));
  assertFiniteJson(schedule, label);
}

const LEDGER_RESULT_KEYS = [
  'trialId', 'costCase', 'boundaryFunding', 'initialNav', 'endingNav', 'adjustedPnl',
  'cash', 'pricePnl', 'funding', 'fees', 'slippage', 'turnover', 'navPoints', 'dailyNav',
  'episodes', 'completedPositions', 'truncatedPositionIds', 'pnlByAsset',
  'maximumMarkedGross', 'maximumGrossToNav', 'maximumLongGross', 'maximumShortGross',
  'events', 'termination',
] as const;

function validateAssetLedgerPnl(value: AssetLedgerPnl, label: string): void {
  assertExactKeys(value, ['pricePnl', 'funding', 'fees', 'slippage', 'adjustedPnl'], label);
  Object.values(value).forEach((item) => assertFiniteNumber(item, label));
}

function validateTermination(value: LedgerTermination | null, label: string): void {
  if (value === null) return;
  assertExactKeys(value, ['time', 'phase', 'reason', 'reference', 'navBeforeClose'], label);
  assertFiniteJson(value, label);
}

function validateLedgerResult(value: LedgerResult, label: string): void {
  assertExactKeys(value, LEDGER_RESULT_KEYS, label);
  assertExactKeys(value.pnlByAsset, PERP_ASSETS, `${label}.pnlByAsset`);
  for (const asset of PERP_ASSETS) validateAssetLedgerPnl(value.pnlByAsset[asset], `${label}.${asset}`);
  validateTermination(value.termination, `${label}.termination`);
  assertFiniteJson(value, label);
}

function deriveLedgerMetrics(
  ledger: Readonly<LedgerResult>,
  schedule: Readonly<AcceptedSchedule>,
): LedgerMetricsPayload {
  const dailyReturns = navReturns(ledger.dailyNav);
  const dailyVolatility = sampleStandardDeviation(dailyReturns);
  const annualizedSharpe = dailyReturns.length === 0
    ? null
    : annualizedDailySharpe(dailyReturns);
  const episodes = episodeMetrics(ledger.episodes);
  const scheduledById = new Map(schedule.positions.map((position) => [position.id, position]));
  const completedIds = new Set<string>();
  let rawLegs = 0;
  for (const position of ledger.completedPositions) {
    if (completedIds.has(position.id)) throw new Error(`Duplicate completed position ${position.id}`);
    completedIds.add(position.id);
    const scheduled = scheduledById.get(position.id);
    if (!scheduled) throw new Error(`Completed position ${position.id} is absent from its schedule`);
    rawLegs += scheduled.legs.length;
  }
  const largestPositiveEpisodePnl = ledger.episodes.reduce<number | null>(
    (largest, episode) => episode.pnl > 0 && (largest === null || episode.pnl > largest)
      ? episode.pnl
      : largest,
    null,
  );
  return {
    endingNav: ledger.endingNav,
    adjustedPnl: ledger.adjustedPnl,
    funding: ledger.funding,
    fees: ledger.fees,
    slippage: ledger.slippage,
    turnover: ledger.turnover,
    fourHourMaxDrawdown: maxDrawdown(ledger.navPoints),
    dailyReturns,
    dailyReturnsSha256: sha256(canonicalJson(dailyReturns)),
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
}

function validateLedgerMetrics(value: LedgerMetricsPayload, label: string): void {
  assertExactKeys(value, [
    'endingNav', 'adjustedPnl', 'funding', 'fees', 'slippage', 'turnover',
    'fourHourMaxDrawdown', 'dailyReturns', 'dailyReturnsSha256', 'dailyVolatility',
    'annualizedDailySharpe', 'rawLegs', 'completedAssetTrades', 'effectiveEpisodes',
    'episodeExpectancy', 'winRate', 'profitFactor', 'largestPositiveEpisodePnl',
    'topFivePositiveEpisodeConcentration', 'pnlByAsset', 'maximumMarkedGross',
    'maximumGrossToNav', 'maximumLongGross', 'maximumShortGross', 'termination',
  ], label);
  for (const key of [
    'endingNav', 'adjustedPnl', 'funding', 'fees', 'slippage', 'turnover',
    'fourHourMaxDrawdown', 'maximumMarkedGross', 'maximumGrossToNav',
    'maximumLongGross', 'maximumShortGross',
  ] as const) assertFiniteNumber(value[key], `${label}.${key}`);
  for (const key of [
    'dailyVolatility', 'annualizedDailySharpe', 'episodeExpectancy', 'winRate',
    'profitFactor', 'largestPositiveEpisodePnl', 'topFivePositiveEpisodeConcentration',
  ] as const) assertNullableFinite(value[key], `${label}.${key}`);
  for (const key of ['rawLegs', 'completedAssetTrades', 'effectiveEpisodes'] as const) {
    assertNonNegativeInteger(value[key], `${label}.${key}`);
  }
  if (!Array.isArray(value.dailyReturns)) throw new Error(`${label}.dailyReturns must be an array`);
  value.dailyReturns.forEach((item) => assertFiniteNumber(item, `${label}.dailyReturns`));
  assertSha256(value.dailyReturnsSha256, `${label}.dailyReturnsSha256`);
  assertExactKeys(value.pnlByAsset, PERP_ASSETS, `${label}.pnlByAsset`);
  for (const asset of PERP_ASSETS) validateAssetLedgerPnl(value.pnlByAsset[asset], `${label}.${asset}`);
  validateTermination(value.termination, `${label}.termination`);
}

function validateLedgerCase(
  value: LedgerCasePayload,
  expectedCostCase: 'base' | 'stress',
  expectedBoundary: 'exclude' | 'adverse_debits',
  trialId: FrozenTrialId,
  schedule: Readonly<AcceptedSchedule>,
  label: string,
): void {
  assertExactKeys(value, ['costCase', 'boundaryFunding', 'ledger', 'metrics'], label);
  if (
    value.costCase !== expectedCostCase
    || value.boundaryFunding !== expectedBoundary
    || value.ledger.trialId !== trialId
    || value.ledger.costCase !== expectedCostCase
    || value.ledger.boundaryFunding !== expectedBoundary
  ) throw new Error(`${label} identity is invalid`);
  validateLedgerResult(value.ledger, `${label}.ledger`);
  validateLedgerMetrics(value.metrics, `${label}.metrics`);
  const expectedMetrics = deriveLedgerMetrics(value.ledger, schedule);
  if (canonicalJson(value.metrics) !== canonicalJson(expectedMetrics)) {
    throw new Error(`${label}.metrics do not match the embedded ledger and schedule`);
  }
}

function validatePortfolio(
  value: PortfolioRunPayload,
  strategyId: StrategyId,
  trialId: FrozenTrialId,
  portfolio: 'primary' | 'exploratory',
  assets: readonly PerpAsset[],
  expectedWindow: TrialWindow | null,
  label: string,
): void {
  assertExactKeys(value, [
    'portfolio', 'assets', 'window', 'signals', 'schedule', 'scheduleSha256',
    'stressControllerSha256', 'stressReplaySha256', 'stressControllerByteIdentical', 'cases',
  ], label);
  if (
    value.portfolio !== portfolio
    || canonicalJson(value.assets) !== canonicalJson(assets)
    || !Array.isArray(value.signals)
    || value.stressControllerByteIdentical !== true
  ) throw new Error(`${label} identity is invalid`);
  validateWindow(value.window, `${label}.window`);
  if (expectedWindow && canonicalJson(value.window) !== canonicalJson(expectedWindow)) {
    throw new Error(`${label} window does not match the frozen window`);
  }
  value.signals.forEach((signal, index) => validateSignal(signal, strategyId, `${label}.signals[${index}]`));
  validateSchedule(value.schedule, trialId, `${label}.schedule`);
  assertSha256(value.scheduleSha256, `${label}.scheduleSha256`);
  assertSha256(value.stressControllerSha256, `${label}.stressControllerSha256`);
  assertSha256(value.stressReplaySha256, `${label}.stressReplaySha256`);
  assertExactKeys(value.cases, ['base', 'stress', 'adverseBoundaryStress'], `${label}.cases`);
  validateLedgerCase(value.cases.base, 'base', 'exclude', trialId, value.schedule, `${label}.cases.base`);
  validateLedgerCase(value.cases.stress, 'stress', 'exclude', trialId, value.schedule, `${label}.cases.stress`);
  validateLedgerCase(
    value.cases.adverseBoundaryStress,
    'stress',
    'adverse_debits',
    trialId,
    value.schedule,
    `${label}.cases.adverseBoundaryStress`,
  );
  const scheduleSha256 = sha256(canonicalJson(value.schedule));
  const stressReplaySha256 = sha256(canonicalJson(value.cases.stress.ledger));
  if (
    value.scheduleSha256 !== scheduleSha256
    || value.stressControllerSha256 !== stressReplaySha256
    || value.stressReplaySha256 !== stressReplaySha256
  ) throw new Error(`${label} replay hashes or byte-identity claim are invalid`);
}

function validatePrimaryPayload(value: PrimaryTrialPayload, strategyId: StrategyId, trialId: FrozenTrialId): void {
  assertExactKeys(value, ['fullHistory', 'holdout', 'halves'], 'Trial primary payload');
  if (!Array.isArray(value.halves) || value.halves.length !== 2) {
    throw new Error('Trial primary halves must contain exactly two runs');
  }
  const assets = TRIAL_BY_ID[strategyId].primaryAssets;
  const fullHistoryWindow = {
    startTime: strategyId === 'H2'
      ? Math.max(CANDLE_WINDOWS['@142'].startTime, CANDLE_WINDOWS['@151'].startTime)
      : Math.max(CANDLE_WINDOWS.BTC.startTime, CANDLE_WINDOWS.ETH.startTime),
    endTime: AS_OF_TIME,
  };
  validatePortfolio(
    value.fullHistory,
    strategyId,
    trialId,
    'primary',
    assets,
    fullHistoryWindow,
    'Primary full history',
  );
  validatePortfolio(value.holdout, strategyId, trialId, 'primary', assets, HOLDOUT_WINDOW, 'Primary holdout');
  validatePortfolio(value.halves[0], strategyId, trialId, 'primary', assets, HOLDOUT_HALVES[0], 'Primary first half');
  validatePortfolio(value.halves[1], strategyId, trialId, 'primary', assets, HOLDOUT_HALVES[1], 'Primary second half');
}

function validateExploratoryPayload(
  value: ExploratoryTrialPayload | null,
  strategyId: StrategyId,
  trialId: FrozenTrialId,
): void {
  if (strategyId === 'H2') {
    if (value !== null) throw new Error('H2 cannot contain exploratory results');
    return;
  }
  if (value === null) throw new Error(`${strategyId} COMPLETE report requires HYPE exploratory results`);
  assertExactKeys(value, [
    'asset', 'classification', 'selectionEligible', 'historicalPromotionEligible',
    'status', 'fullHistory', 'holdout', 'error',
  ], 'Trial exploratory payload');
  if (
    value.asset !== 'HYPE'
    || value.classification !== 'EXPLORATORY_ONLY'
    || value.selectionEligible !== false
    || value.historicalPromotionEligible !== false
  ) throw new Error('HYPE exploratory boundary is invalid');
  if (value.status === 'COMPLETE') {
    if (value.fullHistory === null || value.holdout === null || value.error !== null) {
      throw new Error('COMPLETE HYPE exploratory report has incomplete runs');
    }
    validatePortfolio(
      value.fullHistory,
      strategyId,
      trialId,
      'exploratory',
      ['HYPE'],
      { startTime: CANDLE_WINDOWS.HYPE.startTime, endTime: AS_OF_TIME },
      'Exploratory full history',
    );
    validatePortfolio(
      value.holdout,
      strategyId,
      trialId,
      'exploratory',
      ['HYPE'],
      HOLDOUT_WINDOW,
      'Exploratory holdout',
    );
  } else if (value.status === 'ERROR') {
    if (value.fullHistory !== null || value.holdout !== null || value.error === null) {
      throw new Error('ERROR HYPE exploratory report must contain only a structured error');
    }
    validateTrialError(value.error, 'HYPE exploratory error');
  } else {
    throw new Error('HYPE exploratory status is invalid');
  }
}

function validateGateMetrics(value: GateMetricsPayload, strategyId: StrategyId): void {
  assertExactKeys(value, [
    'baseExpectancy', 'stressExpectancy', 'adverseBoundaryStressExpectancy',
    'baseMaxDrawdown', 'stressMaxDrawdown', 'requiredSleeves', 'halfAdjustedPnl',
    'effectiveEpisodes', 'baseAnnualizedSharpe', 'baseProfitFactor', 'stressAdjustedPnl',
    'bootstrapLowerBound', 'topFiveConcentration', 'assetConcentration',
    'assetConcentrationApplicable', 'requiredSleevesWithExposure',
  ], 'Trial gate metrics');
  for (const key of [
    'baseExpectancy', 'stressExpectancy', 'adverseBoundaryStressExpectancy',
    'baseAnnualizedSharpe', 'baseProfitFactor', 'bootstrapLowerBound',
    'topFiveConcentration', 'assetConcentration',
  ] as const) assertNullableFinite(value[key], `Trial gate metrics.${key}`);
  for (const key of ['baseMaxDrawdown', 'stressMaxDrawdown', 'stressAdjustedPnl'] as const) {
    assertFiniteNumber(value[key], `Trial gate metrics.${key}`);
  }
  assertNonNegativeInteger(value.effectiveEpisodes, 'Trial gate metrics.effectiveEpisodes');
  if (!Array.isArray(value.halfAdjustedPnl) || value.halfAdjustedPnl.length !== 2) {
    throw new Error('Trial gate metrics halves are invalid');
  }
  value.halfAdjustedPnl.forEach((item) => assertFiniteNumber(item, 'Trial half adjusted PnL'));
  if (!Array.isArray(value.requiredSleeves)) throw new Error('Trial required sleeves are invalid');
  const expectedAssets = TRIAL_BY_ID[strategyId].primaryAssets;
  if (value.requiredSleeves.map((sleeve) => sleeve.asset).join(',') !== expectedAssets.join(',')) {
    throw new Error('Trial required sleeves do not match the frozen primary assets');
  }
  value.requiredSleeves.forEach((sleeve, index) => {
    assertExactKeys(sleeve, ['asset', 'adjustedPnl', 'hadExposure'], `Required sleeve ${index}`);
    assertFiniteNumber(sleeve.adjustedPnl, `Required sleeve ${index}.adjustedPnl`);
    if (typeof sleeve.hadExposure !== 'boolean') throw new Error('Required sleeve exposure is invalid');
  });
  if (
    typeof value.assetConcentrationApplicable !== 'boolean'
    || typeof value.requiredSleevesWithExposure !== 'boolean'
    || value.requiredSleevesWithExposure !== value.requiredSleeves.every((sleeve) => sleeve.hadExposure)
  ) throw new Error('Trial gate metric booleans are inconsistent');
}

function deriveGateMetrics(
  primary: Readonly<PrimaryTrialPayload>,
  strategyId: StrategyId,
  trialId: FrozenTrialId,
): GateMetricsPayload {
  const base = primary.holdout.cases.base;
  const stress = primary.holdout.cases.stress;
  const adverse = primary.holdout.cases.adverseBoundaryStress;
  const requiredSleeves = TRIAL_BY_ID[strategyId].primaryAssets.map((asset) => ({
    asset,
    adjustedPnl: base.ledger.pnlByAsset[asset].adjustedPnl,
    hadExposure: base.ledger.completedPositions.some((position) => position.asset === asset),
  }));
  const assetConcentrationApplicable = TRIAL_GATE_CONFIG.assetConcentrationApplicable[strategyId];
  let bootstrapLowerBound: number | null;
  if (base.metrics.dailyReturns.length < 7) {
    if (base.ledger.termination === null && stress.ledger.termination === null) {
      throw new Error('Non-terminated holdout has fewer than seven daily returns');
    }
    bootstrapLowerBound = null;
  } else {
    bootstrapLowerBound = circularBlockBootstrapLowerBound(base.metrics.dailyReturns, trialId);
  }
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
    assetConcentration: assetConcentrationApplicable ? positiveAssetConcentration({
      BTC: base.ledger.pnlByAsset.BTC.adjustedPnl,
      ETH: base.ledger.pnlByAsset.ETH.adjustedPnl,
      HYPE: base.ledger.pnlByAsset.HYPE.adjustedPnl,
    }) : null,
    assetConcentrationApplicable,
    requiredSleevesWithExposure: requiredSleeves.every((sleeve) => sleeve.hadExposure),
  };
}

function validateTrialError(value: TrialReportError, label: string): void {
  assertExactKeys(value, ['code', 'stage', 'message'], label);
  const codes: readonly TrialReportErrorCode[] = [
    'INVALID_INPUT', 'CHRONOLOGY', 'NON_FINITE_LEDGER',
    'NON_DETERMINISTIC_REPLAY', 'UNCLASSIFIED_RUNTIME_FAILURE',
  ];
  if (
    !codes.includes(value.code)
    || !['signals', 'schedule', 'ledger', 'metrics'].includes(value.stage)
    || typeof value.message !== 'string'
    || value.message.length === 0
    || /(?:[A-Za-z]:[\\/]|\/(?:Users|home|var|tmp)\/|\n|\r|\bat\s+\S+\s+\()/u.test(value.message)
  ) throw new Error(`${label} is unsafe or invalid`);
}

function assertNoFinalDecisionClaim(value: unknown, label: string): void {
  if (typeof value === 'string' && value === 'ADVANCE_TO_FORWARD_PAPER') {
    throw new Error(`${label} cannot claim final family advancement`);
  }
  if (Array.isArray(value)) {
    value.forEach((item) => assertNoFinalDecisionClaim(item, label));
    return;
  }
  if (value !== null && typeof value === 'object') {
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      if (['trialGates', 'familyGate', 'selectedCandidate', 'verdict'].includes(key)) {
        throw new Error(`${label} cannot contain ${key}`);
      }
      assertNoFinalDecisionClaim(item, label);
    }
  }
}

function validateTrialPayload(payload: TrialReportPayload, trialId: FrozenTrialId): void {
  assertExactKeys(payload, [
    'schemaVersion', 'kind', 'familyId', 'strategyId', 'trialId', 'status',
    'familyDecision', 'historicalPromotionEligible', 'primary', 'exploratory',
    'gateMetrics', 'error', 'limitations',
  ], 'Trial report payload');
  const frozen = FROZEN_TRIALS.find((trial) => trial.trialId === trialId);
  if (
    !frozen
    || payload.schemaVersion !== 1
    || payload.kind !== 'trial_metrics'
    || payload.familyId !== FAMILY_ID
    || payload.strategyId !== frozen.id
    || payload.trialId !== trialId
    || payload.familyDecision !== 'PENDING'
    || payload.historicalPromotionEligible !== false
    || (payload.status !== 'COMPLETE' && payload.status !== 'ERROR')
  ) throw new Error('Trial report payload identity is invalid');
  assertStringArray(payload.limitations, 'Trial report limitations');
  assertNoFinalDecisionClaim(payload, 'Trial report');
  if (payload.status === 'COMPLETE') {
    if (payload.primary === null || payload.gateMetrics === null || payload.error !== null) {
      throw new Error('COMPLETE trial report has incomplete metrics');
    }
    validatePrimaryPayload(payload.primary, frozen.id, trialId);
    validateExploratoryPayload(payload.exploratory, frozen.id, trialId);
    validateGateMetrics(payload.gateMetrics, frozen.id);
    const expectedGateMetrics = deriveGateMetrics(payload.primary, frozen.id, trialId);
    if (canonicalJson(payload.gateMetrics) !== canonicalJson(expectedGateMetrics)) {
      throw new Error('Trial gate metrics do not match the embedded primary runs');
    }
  } else {
    if (payload.primary !== null || payload.exploratory !== null || payload.gateMetrics !== null || payload.error === null) {
      throw new Error('ERROR trial report must contain only a structured error');
    }
    validateTrialError(payload.error, 'Trial report error');
  }
}

function validateEvaluator(value: CanonicalFamilySnapshot['evaluator'], label: string): void {
  assertExactKeys(value, ['codeCommit', 'cleanWorktree', 'sourceBundleSha256'], label);
  if (value.cleanWorktree !== true || !/^[0-9a-f]{40}$/u.test(value.codeCommit)) {
    throw new Error(`${label} identity is invalid`);
  }
  assertSha256(value.sourceBundleSha256, `${label}.sourceBundleSha256`);
}

function validateDsrFamily(value: DsrFamilyResult): void {
  assertExactKeys(value, ['available', 'sigmaSharpe', 'expectedMaxSharpe', 'trials'], 'Family DSR');
  if (typeof value.available !== 'boolean' || !Array.isArray(value.trials) || value.trials.length !== 4) {
    throw new Error('Family DSR shape is invalid');
  }
  assertNullableFinite(value.sigmaSharpe, 'Family DSR sigmaSharpe');
  assertNullableFinite(value.expectedMaxSharpe, 'Family DSR expectedMaxSharpe');
  const ids = ['H1', 'H2', 'H3', 'H4'] as const;
  value.trials.forEach((trial, index) => {
    assertExactKeys(trial, ['id', 'moments', 'selectionSharpe', 'dsr'], `Family DSR trial ${index}`);
    if (trial.id !== ids[index]) throw new Error('Family DSR order is invalid');
    assertNullableFinite(trial.selectionSharpe, `Family DSR trial ${index} Sharpe`);
    assertNullableFinite(trial.dsr, `Family DSR trial ${index} DSR`);
    if (trial.moments !== null) {
      assertExactKeys(
        trial.moments,
        ['mean', 'sampleStd', 'perPeriodSharpe', 'skewness', 'kurtosis'],
        `Family DSR trial ${index} moments`,
      );
      assertFiniteNumber(trial.moments.mean, `Family DSR trial ${index} mean`);
      for (const key of ['sampleStd', 'perPeriodSharpe', 'skewness', 'kurtosis'] as const) {
        assertNullableFinite(trial.moments[key], `Family DSR trial ${index}.${key}`);
      }
    }
  });
}

const TRIAL_GATE_INPUT_KEYS = [
  'id', 'error', 'baseExpectancy', 'stressExpectancy', 'adverseBoundaryStressExpectancy',
  'baseMaxDrawdown', 'stressMaxDrawdown', 'requiredSleevePnl', 'halfAdjustedPnl',
  'effectiveEpisodes', 'baseAnnualizedSharpe', 'baseProfitFactor', 'stressAdjustedPnl',
  'bootstrapLowerBound', 'dsr', 'topFiveConcentration', 'assetConcentration',
  'assetConcentrationApplicable', 'requiredSleevesWithExposure',
] as const;

function validateTrialGateRecord(value: FamilyTrialGatePayload, id: StrategyId): void {
  assertExactKeys(value, ['id', 'input', 'result'], `Family trial gate ${id}`);
  assertExactKeys(value.input, TRIAL_GATE_INPUT_KEYS, `Family trial gate ${id} input`);
  assertExactKeys(value.result, ['id', 'verdict', 'reasons'], `Family trial gate ${id} result`);
  if (value.id !== id || value.input.id !== id || value.result.id !== id) {
    throw new Error(`Family trial gate ${id} identity is invalid`);
  }
  assertFiniteJson(value.input, `Family trial gate ${id} input`);
  const verdicts: readonly TrialVerdict[] = ['ERROR', 'REJECT', 'INSUFFICIENT', 'ADVANCE_TO_FORWARD_PAPER'];
  if (!verdicts.includes(value.result.verdict)) throw new Error(`Family trial gate ${id} verdict is invalid`);
  assertStringArray(value.result.reasons, `Family trial gate ${id} reasons`);
}

function validateH1Input(value: H1FamilyInputPayload): void {
  assertExactKeys(value, [
    'id', 'trialId', 'reportSha256', 'codeCommit', 'specificationCommit',
    'snapshotArtifactSha256', 'snapshotDataSha256', 'dailyNavCount', 'dailyReturnCount',
    'dailyReturnsSha256', 'familyDsrInputAvailable', 'unavailabilityReason',
  ], 'H1 family input');
  if (
    value.id !== 'H1'
    || value.trialId !== 'H1-TREND-DAILY-20260722-001'
    || value.reportSha256 !== '7dda9c692b4ffc0c2c14857570cff83513cfc49aed11088c934633b189064541'
    || value.codeCommit !== '411f2d9a120da19a0fd65cb98879e6b9a5122695'
    || value.specificationCommit !== '87293cd8a4717c6ff766d22fc4cc0414c5838869'
    || value.snapshotArtifactSha256 !== '7b5d1e864a9ac838dd13e6b8039179f1dc8e3917a7309cb518cde91dd2f404a4'
    || value.snapshotDataSha256 !== '66cb46b27b36fbd28329f11d39ae25a57956bbe9563326d0f7551b67a7b0f0c4'
    || value.dailyNavCount !== 360
    || value.dailyReturnCount !== 359
    || value.dailyReturnsSha256 !== 'dd948c743c3a24f2b8c9eaddeb5be540343db908f3877db3f525bb09049daaaa'
    || value.familyDsrInputAvailable !== true
    || value.unavailabilityReason !== null
  ) throw new Error('H1 family input identity is invalid');
  for (const hash of [
    value.reportSha256, value.snapshotArtifactSha256, value.snapshotDataSha256,
    value.dailyReturnsSha256,
  ]) assertSha256(hash, 'H1 family input hash');
}

function validateTrialReference(
  value: TrialReportReference,
  id: StrategyId,
  snapshot: Readonly<StoredFamilySnapshot>,
): void {
  assertExactKeys(value, [
    'id', 'trialId', 'reportRevision', 'reportArtifactSha256', 'dataSha256',
    'specificationCommit', 'evaluator', 'snapshotArtifactSha256',
    'primaryDailyReturnsSha256', 'metricsStatus',
  ], `Family trial reference ${id}`);
  const frozen = TRIAL_BY_ID[id];
  if (
    value.id !== id
    || value.trialId !== frozen.trialId
    || !Number.isSafeInteger(value.reportRevision)
    || value.reportRevision < 1
    || value.dataSha256 !== snapshot.dataSha256
    || value.specificationCommit !== SPECIFICATION_COMMIT
    || value.snapshotArtifactSha256 !== snapshot.artifactSha256
    || (value.metricsStatus !== 'COMPLETE' && value.metricsStatus !== 'ERROR')
    || (value.metricsStatus === 'COMPLETE') !== (value.primaryDailyReturnsSha256 !== null)
  ) throw new Error(`Family trial reference ${id} is invalid`);
  assertSha256(value.reportArtifactSha256, `Family trial reference ${id} report`);
  if (value.primaryDailyReturnsSha256 !== null) {
    assertSha256(value.primaryDailyReturnsSha256, `Family trial reference ${id} returns`);
  }
  validateEvaluator(value.evaluator, `Family trial reference ${id} evaluator`);
}

function validateFamilyPayload(
  payload: FamilyReportPayload,
  snapshot: Readonly<StoredFamilySnapshot>,
): void {
  assertExactKeys(payload, [
    'schemaVersion', 'kind', 'familyId', 'status', 'stopMining', 'selectionAttemptCount',
    'h1Input', 'trialReports', 'familyDsr', 'trialGates', 'familyGate',
    'selectedCandidate', 'hypeBoundary', 'forwardPaperBoundary', 'limitations',
  ], 'Family report payload');
  if (
    payload.schemaVersion !== 1
    || payload.kind !== 'family_decision'
    || payload.familyId !== FAMILY_ID
    || payload.status !== 'ADJUDICATED'
    || payload.stopMining !== true
    || payload.selectionAttemptCount !== 4
  ) throw new Error('Family report payload identity is invalid');
  assertStringArray(payload.limitations, 'Family report limitations');
  validateH1Input(payload.h1Input);
  if (!Array.isArray(payload.trialReports) || payload.trialReports.length !== 3) {
    throw new Error('Family report requires H2,H3,H4 report references');
  }
  const ids = ['H2', 'H3', 'H4'] as const;
  payload.trialReports.forEach((reference, index) => (
    validateTrialReference(reference, ids[index], snapshot)
  ));
  validateDsrFamily(payload.familyDsr);
  if (!Array.isArray(payload.trialGates) || payload.trialGates.length !== 3) {
    throw new Error('Family report requires H2,H3,H4 gates');
  }
  payload.trialGates.forEach((gate, index) => validateTrialGateRecord(gate, ids[index]));
  assertExactKeys(payload.familyGate, ['verdict', 'selectedTrial'], 'Family gate');
  const verdicts: readonly TrialVerdict[] = ['ERROR', 'REJECT', 'INSUFFICIENT', 'ADVANCE_TO_FORWARD_PAPER'];
  if (!verdicts.includes(payload.familyGate.verdict)) throw new Error('Family gate verdict is invalid');
  if (payload.selectedCandidate !== null) {
    assertExactKeys(payload.selectedCandidate, ['id', 'trialId', 'rank'], 'Selected candidate');
    const selected = TRIAL_BY_ID[payload.selectedCandidate.id];
    if (
      !selected
      || payload.selectedCandidate.trialId !== selected.trialId
      || payload.selectedCandidate.rank !== selected.rank
    ) throw new Error('Selected candidate identity is invalid');
  }
  assertExactKeys(payload.hypeBoundary, [
    'asset', 'classification', 'selectionEligible', 'historicalPromotionEligible',
    'liveTradingEligible',
  ], 'HYPE family boundary');
  if (
    payload.hypeBoundary.asset !== 'HYPE'
    || payload.hypeBoundary.classification !== 'EXPLORATORY_ONLY'
    || payload.hypeBoundary.selectionEligible !== false
    || payload.hypeBoundary.historicalPromotionEligible !== false
    || payload.hypeBoundary.liveTradingEligible !== false
  ) throw new Error('HYPE family boundary is invalid');
  assertExactKeys(payload.forwardPaperBoundary, [
    'numericalCandidate', 'admissionManifestRequired', 'paperJobAuthorized',
    'walletAuthorized', 'liveTradingAuthorized',
  ], 'Forward-paper boundary');
  if (
    payload.forwardPaperBoundary.admissionManifestRequired !== true
    || payload.forwardPaperBoundary.paperJobAuthorized !== false
    || payload.forwardPaperBoundary.walletAuthorized !== false
    || payload.forwardPaperBoundary.liveTradingAuthorized !== false
  ) throw new Error('Forward-paper authorization boundary is invalid');
  const selectedId = payload.selectedCandidate?.id ?? null;
  if (
    payload.familyGate.selectedTrial !== selectedId
    || payload.forwardPaperBoundary.numericalCandidate !== selectedId
    || (payload.familyGate.verdict === 'ADVANCE_TO_FORWARD_PAPER') !== (selectedId !== null)
  ) throw new Error('Family selection fields are inconsistent');
}

function derivedSourceEvidence(snapshot: Readonly<StoredFamilySnapshot>): ReportSourceEvidence {
  return {
    snapshotArtifactSha256: snapshot.artifactSha256,
    snapshotEvaluator: snapshot.canonical.evaluator,
    rawResponseSha256: snapshotRawResponseHashes(snapshot.canonical),
    candleWindows: CANDLE_WINDOWS,
    fundingWindows: FUNDING_WINDOWS,
    spotRequestType: 'spotMeta',
  };
}

function validateCorrectionEvidence(
  evidence: MechanicalCorrectionEvidence,
  evaluator: CanonicalFamilySnapshot['evaluator'],
): void {
  assertExactKeys(evidence, [
    'classification', 'incidentId', 'regressionTestPath', 'regressionTestSha256',
    'correctionCommit', 'correctionSourceBundleSha256',
  ], 'Mechanical correction evidence');
  if (
    evidence.classification !== 'MECHANICAL_ONLY'
    || !/^[A-Z0-9][A-Z0-9._-]{2,127}$/u.test(evidence.incidentId)
    || !evidence.regressionTestPath.startsWith('server/src/__tests__/')
    || !evidence.regressionTestPath.endsWith('.test.ts')
    || normalizeSourcePath(evidence.regressionTestPath) !== evidence.regressionTestPath
    || evidence.correctionCommit !== evaluator.codeCommit
    || evidence.correctionSourceBundleSha256 !== evaluator.sourceBundleSha256
  ) throw new Error('Mechanical correction evidence is invalid or does not match the run evaluator');
  assertSha256(evidence.regressionTestSha256, 'Mechanical correction regression test');
  if (!/^[0-9a-f]{40}$/u.test(evidence.correctionCommit)) {
    throw new Error('Mechanical correction commit is invalid');
  }
  assertSha256(evidence.correctionSourceBundleSha256, 'Mechanical correction source bundle');
}

function validateRevision(
  reportRevision: number,
  supersedesArtifactSha256: string | null,
  revisionEvidence: MechanicalCorrectionEvidence | null,
  evaluator: CanonicalFamilySnapshot['evaluator'],
): void {
  if (!Number.isSafeInteger(reportRevision) || reportRevision < 1) {
    throw new Error('Invalid immutable report revision');
  }
  if (reportRevision === 1) {
    if (supersedesArtifactSha256 !== null || revisionEvidence !== null) {
      throw new Error('First report revision cannot contain correction evidence');
    }
    return;
  }
  if (supersedesArtifactSha256 === null || revisionEvidence === null) {
    throw new Error('Correction revision requires a prior artifact and exact mechanical evidence');
  }
  assertSha256(supersedesArtifactSha256, 'Superseded report hash');
  validateCorrectionEvidence(revisionEvidence, evaluator);
}

function storeReport<TPayload>(canonical: ReportEnvelope<TPayload>): {
  artifactSha256: string;
  canonical: ReportEnvelope<TPayload>;
} {
  return { artifactSha256: sha256(canonicalJson(canonical)), canonical };
}

function certifyStoredReport<TReport extends StoredTrialReport | StoredFamilyReport>(
  report: TReport,
  snapshot: Readonly<StoredFamilySnapshot>,
): TReport {
  deepFreeze(report);
  validatedReportCapabilities.set(report, {
    trialId: report.canonical.trialId,
    snapshotArtifactSha256: snapshot.artifactSha256,
    snapshotDataSha256: snapshot.dataSha256,
  });
  return report;
}

function h1PayloadFromEvidence(evidence: H1FamilyEvidence): H1FamilyInputPayload {
  assertExactKeys(evidence, [
    'id', 'trialId', 'reportSha256', 'codeCommit', 'specificationCommit',
    'snapshotArtifactSha256', 'snapshotDataSha256', 'dailyNavCount', 'dailyReturnCount',
    'dailyReturnsSha256', 'familyDsrInputAvailable', 'unavailabilityReason', 'returns',
  ], 'H1 family evidence');
  if (!Array.isArray(evidence.returns) || evidence.returns.length !== 359) {
    throw new Error('H1 family evidence must contain exactly 359 returns');
  }
  evidence.returns.forEach((value) => assertFiniteNumber(value, 'H1 family return'));
  if (sha256(canonicalJson(evidence.returns)) !== evidence.dailyReturnsSha256) {
    throw new Error('H1 family return vector hash mismatch');
  }
  const payload: H1FamilyInputPayload = {
    id: evidence.id,
    trialId: evidence.trialId,
    reportSha256: evidence.reportSha256,
    codeCommit: evidence.codeCommit,
    specificationCommit: evidence.specificationCommit,
    snapshotArtifactSha256: evidence.snapshotArtifactSha256,
    snapshotDataSha256: evidence.snapshotDataSha256,
    dailyNavCount: evidence.dailyNavCount,
    dailyReturnCount: evidence.dailyReturnCount,
    dailyReturnsSha256: evidence.dailyReturnsSha256,
    familyDsrInputAvailable: evidence.familyDsrInputAvailable,
    unavailabilityReason: evidence.unavailabilityReason,
  };
  validateH1Input(payload);
  return payload;
}

function familyTrialReports(
  evidence: FamilyReportEvidence,
  snapshot: Readonly<StoredFamilySnapshot>,
  requireRetained = false,
): readonly [StoredTrialReport, StoredTrialReport, StoredTrialReport] {
  assertExactKeys(evidence, ['h1', 'trialReports'], 'Family report evidence');
  h1PayloadFromEvidence(evidence.h1);
  if (!Array.isArray(evidence.trialReports) || evidence.trialReports.length !== 3) {
    throw new Error('Family evidence requires exact H2,H3,H4 trial reports');
  }
  const expectedIds = ['H2', 'H3', 'H4'] as const;
  const rebuilt = evidence.trialReports.map((report, index) => {
    if (requireRetained && !retainedReports.has(report)) {
      throw new Error(`Family build requires retained ${expectedIds[index]} report capability`);
    }
    const expectedTrialId = TRIAL_BY_ID[expectedIds[index]].trialId;
    const validated = rebuildStoredReport(report, expectedTrialId, snapshot) as StoredTrialReport;
    if (canonicalJson(validated) !== canonicalJson(report)) {
      throw new Error(`Family ${expectedIds[index]} report evidence is not canonical`);
    }
    return validated;
  });
  return rebuilt as unknown as readonly [StoredTrialReport, StoredTrialReport, StoredTrialReport];
}

function trialReference(
  report: Readonly<StoredTrialReport>,
  id: StrategyId,
  snapshot: Readonly<StoredFamilySnapshot>,
): TrialReportReference {
  const payload = report.canonical.payload;
  return {
    id,
    trialId: TRIAL_BY_ID[id].trialId,
    reportRevision: report.canonical.reportRevision,
    reportArtifactSha256: report.artifactSha256,
    dataSha256: snapshot.dataSha256,
    specificationCommit: SPECIFICATION_COMMIT,
    evaluator: report.canonical.evaluator,
    snapshotArtifactSha256: snapshot.artifactSha256,
    primaryDailyReturnsSha256: payload.status === 'COMPLETE'
      ? payload.primary!.holdout.cases.base.metrics.dailyReturnsSha256
      : null,
    metricsStatus: payload.status,
  };
}

function errorTrialGateInput(
  id: StrategyId,
  error: TrialReportError,
): TrialGateInput {
  const applicable = TRIAL_GATE_CONFIG.assetConcentrationApplicable[id];
  return {
    id,
    error: `${error.code}:${error.stage}:${error.message}`,
    baseExpectancy: null,
    stressExpectancy: null,
    adverseBoundaryStressExpectancy: null,
    baseMaxDrawdown: 0,
    stressMaxDrawdown: 0,
    requiredSleevePnl: Array.from({ length: TRIAL_BY_ID[id].primaryAssets.length }, () => 0),
    halfAdjustedPnl: [0, 0],
    effectiveEpisodes: 0,
    baseAnnualizedSharpe: null,
    baseProfitFactor: null,
    stressAdjustedPnl: 0,
    bootstrapLowerBound: null,
    dsr: null,
    topFiveConcentration: null,
    assetConcentration: null,
    assetConcentrationApplicable: applicable,
    requiredSleevesWithExposure: false,
  };
}

function completeTrialGateInput(
  id: StrategyId,
  metrics: Readonly<GateMetricsPayload>,
  dsr: number | null,
): TrialGateInput {
  return {
    id,
    error: null,
    baseExpectancy: metrics.baseExpectancy,
    stressExpectancy: metrics.stressExpectancy,
    adverseBoundaryStressExpectancy: metrics.adverseBoundaryStressExpectancy,
    baseMaxDrawdown: metrics.baseMaxDrawdown,
    stressMaxDrawdown: metrics.stressMaxDrawdown,
    requiredSleevePnl: metrics.requiredSleeves.map((sleeve) => sleeve.adjustedPnl),
    halfAdjustedPnl: [...metrics.halfAdjustedPnl],
    effectiveEpisodes: metrics.effectiveEpisodes,
    baseAnnualizedSharpe: metrics.baseAnnualizedSharpe,
    baseProfitFactor: metrics.baseProfitFactor,
    stressAdjustedPnl: metrics.stressAdjustedPnl,
    bootstrapLowerBound: metrics.bootstrapLowerBound,
    dsr,
    topFiveConcentration: metrics.topFiveConcentration,
    assetConcentration: metrics.assetConcentration,
    assetConcentrationApplicable: metrics.assetConcentrationApplicable,
    requiredSleevesWithExposure: metrics.requiredSleevesWithExposure,
  };
}

export function deriveFamilyReportPayload(
  evidence: FamilyReportEvidence,
  snapshot: Readonly<StoredFamilySnapshot>,
  limitations: string[],
): FamilyReportPayload {
  const h1Input = h1PayloadFromEvidence(evidence.h1);
  const reports = familyTrialReports(evidence, snapshot);
  const ids = ['H2', 'H3', 'H4'] as const;
  const familyDsr = deflatedSharpeFamily([
    { id: 'H1', returns: evidence.h1.returns },
    ...reports.map((report, index) => ({
      id: ids[index],
      returns: report.canonical.payload.status === 'COMPLETE'
        ? report.canonical.payload.primary!.holdout.cases.base.metrics.dailyReturns
        : [],
    })),
  ]);
  const trialGates = reports.map((report, index): FamilyTrialGatePayload => {
    const id = ids[index];
    const payload = report.canonical.payload;
    const input = payload.status === 'ERROR'
      ? errorTrialGateInput(id, payload.error!)
      : completeTrialGateInput(id, payload.gateMetrics!, familyDsr.trials[index + 1].dsr);
    return { id, input, result: evaluateTrial(input) };
  }) as unknown as [FamilyTrialGatePayload, FamilyTrialGatePayload, FamilyTrialGatePayload];
  const familyGate = aggregateFamily(trialGates.map((gate) => gate.result));
  const selected = familyGate.selectedTrial === null ? null : TRIAL_BY_ID[familyGate.selectedTrial];
  return {
    schemaVersion: 1,
    kind: 'family_decision',
    familyId: FAMILY_ID,
    status: 'ADJUDICATED',
    stopMining: true,
    selectionAttemptCount: 4,
    h1Input,
    trialReports: reports.map((report, index) => (
      trialReference(report, ids[index], snapshot)
    )) as unknown as [TrialReportReference, TrialReportReference, TrialReportReference],
    familyDsr,
    trialGates,
    familyGate,
    selectedCandidate: selected ? {
      id: selected.id,
      trialId: selected.trialId,
      rank: selected.rank,
    } : null,
    hypeBoundary: {
      asset: 'HYPE',
      classification: 'EXPLORATORY_ONLY',
      selectionEligible: false,
      historicalPromotionEligible: false,
      liveTradingEligible: false,
    },
    forwardPaperBoundary: {
      numericalCandidate: selected?.id ?? null,
      admissionManifestRequired: true,
      paperJobAuthorized: false,
      walletAuthorized: false,
      liveTradingAuthorized: false,
    },
    limitations: [...limitations],
  };
}

export function buildTrialReport(
  draft: TrialReportDraft,
  snapshot: Readonly<StoredFamilySnapshot>,
): StoredTrialReport {
  assertExactKeys(draft, [
    'trialId', 'reportRevision', 'supersedesArtifactSha256', 'revisionEvidence',
    'evaluator', 'payload',
  ], 'Trial report draft');
  requireRetainedFamilySnapshot(snapshot);
  validateEvaluator(draft.evaluator, 'Trial report run evaluator');
  validateRevision(
    draft.reportRevision,
    draft.supersedesArtifactSha256,
    draft.revisionEvidence,
    draft.evaluator,
  );
  validateTrialPayload(draft.payload, draft.trialId);
  const frozen = FROZEN_TRIALS.find((trial) => trial.trialId === draft.trialId)!;
  return certifyStoredReport(storeReport({
    familyId: FAMILY_ID,
    trialId: draft.trialId,
    reportRevision: draft.reportRevision,
    supersedesArtifactSha256: draft.supersedesArtifactSha256,
    revisionEvidence: draft.revisionEvidence,
    dataSha256: snapshot.dataSha256,
    specificationCommit: SPECIFICATION_COMMIT,
    evaluator: draft.evaluator,
    sourceEvidence: derivedSourceEvidence(snapshot),
    parameters: frozen,
    payload: draft.payload,
  }) as StoredTrialReport, snapshot);
}

export function buildFamilyReport(
  draft: FamilyReportDraft,
  snapshot: Readonly<StoredFamilySnapshot>,
  evidence: FamilyReportEvidence,
): StoredFamilyReport {
  assertExactKeys(draft, [
    'reportRevision', 'supersedesArtifactSha256', 'revisionEvidence', 'evaluator', 'payload',
  ], 'Family report draft');
  requireRetainedFamilySnapshot(snapshot);
  validateEvaluator(draft.evaluator, 'Family report run evaluator');
  validateRevision(
    draft.reportRevision,
    draft.supersedesArtifactSha256,
    draft.revisionEvidence,
    draft.evaluator,
  );
  validateFamilyPayload(draft.payload, snapshot);
  familyTrialReports(evidence, snapshot, true);
  const expectedPayload = deriveFamilyReportPayload(evidence, snapshot, draft.payload.limitations);
  if (canonicalJson(draft.payload) !== canonicalJson(expectedPayload)) {
    throw new Error('Family report does not match exact retained trial evidence and recomputed gates');
  }
  return certifyStoredReport(storeReport({
    familyId: FAMILY_ID,
    trialId: FAMILY_ID,
    reportRevision: draft.reportRevision,
    supersedesArtifactSha256: draft.supersedesArtifactSha256,
    revisionEvidence: draft.revisionEvidence,
    dataSha256: snapshot.dataSha256,
    specificationCommit: SPECIFICATION_COMMIT,
    evaluator: draft.evaluator,
    sourceEvidence: derivedSourceEvidence(snapshot),
    parameters: FROZEN_TRIALS,
    payload: draft.payload,
  }) as StoredFamilyReport, snapshot);
}

function reportFilenamePattern(trialId: ImmutableReportTrialId): RegExp {
  const escaped = trialId.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  return new RegExp(`^${escaped}\\.r([1-9][0-9]*)\\.([0-9a-f]{64})\\.json$`, 'u');
}

const INITIAL_BATCH_DIRECTORY = '.initial-trial-batches';

function initialBatchFilenamePattern(): RegExp {
  const escaped = FAMILY_ID.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  return new RegExp(`^${escaped}\\.initial-batch\\.([0-9a-f]{64})\\.json$`, 'u');
}

function buildInitialBatch(
  reports: readonly [StoredTrialReport, StoredTrialReport, StoredTrialReport],
  snapshot: Readonly<StoredFamilySnapshot>,
): StoredInitialTrialBatch {
  requireRetainedFamilySnapshot(snapshot);
  const ids = ['H2', 'H3', 'H4'] as const;
  const canonicalReports = reports.map((report, index) => (
    rebuildStoredReport(report, TRIAL_BY_ID[ids[index]].trialId, snapshot) as StoredTrialReport
  )) as unknown as [StoredTrialReport, StoredTrialReport, StoredTrialReport];
  canonicalReports.forEach((report, index) => {
    if (
      report.canonical.reportRevision !== 1
      || report.canonical.supersedesArtifactSha256 !== null
      || report.canonical.revisionEvidence !== null
      || report.canonical.payload.strategyId !== ids[index]
    ) throw new Error('Initial batch requires exact ordered H2,H3,H4 r1 reports');
  });
  const evaluator = canonicalReports[0].canonical.evaluator;
  if (canonicalReports.some((report) => (
    canonicalJson(report.canonical.evaluator) !== canonicalJson(evaluator)
  ))) throw new Error('Initial batch reports must use one exact run evaluator');
  const canonical: InitialTrialBatchManifest = {
    schemaVersion: 1,
    kind: 'initial_trial_batch',
    familyId: FAMILY_ID,
    dataSha256: snapshot.dataSha256,
    snapshotArtifactSha256: snapshot.artifactSha256,
    evaluator,
    reports: canonicalReports.map((report, index) => (
      trialReference(report, ids[index], snapshot)
    )) as unknown as [TrialReportReference, TrialReportReference, TrialReportReference],
  };
  return { artifactSha256: sha256(canonicalJson(canonical)), canonical };
}

function validateInitialBatch(
  stored: StoredInitialTrialBatch,
  snapshot: Readonly<StoredFamilySnapshot>,
): void {
  assertExactKeys(stored, ['artifactSha256', 'canonical'], 'Stored initial trial batch');
  assertExactKeys(stored.canonical, [
    'schemaVersion', 'kind', 'familyId', 'dataSha256', 'snapshotArtifactSha256',
    'evaluator', 'reports',
  ], 'Initial trial batch');
  if (
    stored.canonical.schemaVersion !== 1
    || stored.canonical.kind !== 'initial_trial_batch'
    || stored.canonical.familyId !== FAMILY_ID
    || stored.canonical.dataSha256 !== snapshot.dataSha256
    || stored.canonical.snapshotArtifactSha256 !== snapshot.artifactSha256
    || !Array.isArray(stored.canonical.reports)
    || stored.canonical.reports.length !== 3
    || stored.artifactSha256 !== sha256(canonicalJson(stored.canonical))
  ) throw new Error('Initial trial batch identity or hash is invalid');
  validateEvaluator(stored.canonical.evaluator, 'Initial trial batch evaluator');
  const ids = ['H2', 'H3', 'H4'] as const;
  stored.canonical.reports.forEach((reference, index) => {
    validateTrialReference(reference, ids[index], snapshot);
    if (
      reference.reportRevision !== 1
      || canonicalJson(reference.evaluator) !== canonicalJson(stored.canonical.evaluator)
    ) throw new Error('Initial trial batch report reference is invalid');
  });
}

function rebuildStoredReport(
  value: unknown,
  expectedTrialId: ImmutableReportTrialId,
  snapshot: Readonly<StoredFamilySnapshot>,
  familyEvidence?: FamilyReportEvidence,
): StoredTrialReport | StoredFamilyReport {
  if (value !== null && typeof value === 'object') {
    const capability = validatedReportCapabilities.get(value);
    if (capability) {
      if (!Object.isFrozen(value)) throw new Error('Validated report capability lost immutability');
      if (
        capability.trialId !== expectedTrialId
        || capability.snapshotArtifactSha256 !== snapshot.artifactSha256
        || capability.snapshotDataSha256 !== snapshot.dataSha256
      ) throw new Error('Validated report capability cannot cross trial or snapshot identity');
      // Trial reports contain the large ledgers. A certified, deeply frozen
      // object is byte-stable and may skip the repeated semantic rebuild.
      // Family reports remain evidence-sensitive and are always recomputed.
      if (expectedTrialId !== FAMILY_ID) return value as StoredTrialReport;
    }
  }
  assertExactKeys(value, ['artifactSha256', 'canonical'], 'Stored immutable report');
  const stored = value as unknown as StoredTrialReport | StoredFamilyReport;
  assertExactKeys(stored.canonical, [
    'familyId', 'trialId', 'reportRevision', 'supersedesArtifactSha256', 'revisionEvidence',
    'dataSha256', 'specificationCommit', 'evaluator', 'sourceEvidence', 'parameters', 'payload',
  ], 'Immutable report');
  if (stored.canonical.trialId !== expectedTrialId || stored.canonical.familyId !== FAMILY_ID) {
    throw new Error('Immutable report identity is invalid');
  }
  if (expectedTrialId === FAMILY_ID && familyEvidence === undefined) {
    throw new Error('Family report validation requires exact H1 and retained H2,H3,H4 evidence');
  }
  const rebuilt = expectedTrialId === FAMILY_ID
    ? buildFamilyReport({
      reportRevision: stored.canonical.reportRevision,
      supersedesArtifactSha256: stored.canonical.supersedesArtifactSha256,
      revisionEvidence: stored.canonical.revisionEvidence,
      evaluator: stored.canonical.evaluator,
      payload: stored.canonical.payload as FamilyReportPayload,
    }, snapshot, familyEvidence!)
    : buildTrialReport({
      trialId: expectedTrialId,
      reportRevision: stored.canonical.reportRevision,
      supersedesArtifactSha256: stored.canonical.supersedesArtifactSha256,
      revisionEvidence: stored.canonical.revisionEvidence,
      evaluator: stored.canonical.evaluator,
      payload: stored.canonical.payload as TrialReportPayload,
    }, snapshot);
  if (
    stored.artifactSha256 !== rebuilt.artifactSha256
    || canonicalJson(stored.canonical) !== canonicalJson(rebuilt.canonical)
  ) throw new Error('Report provenance or content hash does not match the retained snapshot');
  return rebuilt;
}

async function verifyContentClaimIfPresent(
  directory: string,
  logicalId: string,
  filename: string,
  contents: string,
): Promise<void> {
  const claimPath = path.join(directory, CLAIM_DIRECTORY, `${logicalId}.json`);
  const claim = await readContentClaim(claimPath, logicalId);
  if (claim === null) return;
  if (
    claim.outputFilename !== filename
    || claim.contentSha256 !== sha256(contents)
  ) throw new Error(`Content claim does not match retained ${logicalId}`);
}

async function readReportFile(
  directory: string,
  filename: string,
  trialId: ImmutableReportTrialId,
  snapshot: Readonly<StoredFamilySnapshot>,
  familyEvidence?: FamilyReportEvidence,
): Promise<StoredTrialReport | StoredFamilyReport> {
  const match = reportFilenamePattern(trialId).exec(filename);
  if (!match) throw new Error(`Malformed report filename for ${trialId}: ${filename}`);
  const raw = await readFile(path.join(directory, filename), 'utf8');
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`Malformed immutable report ${filename}`);
  }
  const rebuilt = rebuildStoredReport(parsed, trialId, snapshot, familyEvidence);
  if (
    rebuilt.canonical.reportRevision !== Number(match[1])
    || rebuilt.artifactSha256 !== match[2]
  ) throw new Error(`Report content hash verification failed for ${filename}`);
  await verifyContentClaimIfPresent(
    directory,
    `${trialId}.r${rebuilt.canonical.reportRevision}`,
    filename,
    raw,
  );
  retainedReports.add(rebuilt);
  return rebuilt;
}

export interface RetainedInitialTrialBatch {
  manifest: StoredInitialTrialBatch;
  reports: readonly [StoredTrialReport, StoredTrialReport, StoredTrialReport];
}

export async function readInitialTrialBatch(
  directory: string,
  snapshot: Readonly<StoredFamilySnapshot>,
): Promise<RetainedInitialTrialBatch | null> {
  requireRetainedFamilySnapshot(snapshot);
  const filenames = (await readDirectoryIfPresent(directory))
    .filter((name) => initialBatchFilenamePattern().test(name));
  if (filenames.length === 0) return null;
  if (filenames.length !== 1) throw new Error(`Expected at most one initial trial batch, found ${filenames.length}`);
  const filename = filenames[0];
  const raw = await readFile(path.join(directory, filename), 'utf8');
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('Malformed initial trial batch manifest');
  }
  const stored = parsed as StoredInitialTrialBatch;
  validateInitialBatch(stored, snapshot);
  const match = initialBatchFilenamePattern().exec(filename);
  if (!match || match[1] !== stored.artifactSha256) {
    throw new Error('Initial trial batch filename hash mismatch');
  }
  await verifyContentClaimIfPresent(
    directory,
    `${FAMILY_ID}.initial-batch`,
    filename,
    raw,
  );
  const batchDirectory = path.join(directory, INITIAL_BATCH_DIRECTORY, stored.artifactSha256);
  const ids = ['H2', 'H3', 'H4'] as const;
  const reports = await Promise.all(stored.canonical.reports.map(async (reference, index) => {
    const trialId = TRIAL_BY_ID[ids[index]].trialId;
    const reportFilename = `${trialId}.r1.${reference.reportArtifactSha256}.json`;
    const report = await readReportFile(batchDirectory, reportFilename, trialId, snapshot);
    if (
      report.artifactSha256 !== reference.reportArtifactSha256
      || report.canonical.reportRevision !== 1
      || canonicalJson(trialReference(report as StoredTrialReport, ids[index], snapshot))
        !== canonicalJson(reference)
    ) throw new Error(`Initial batch ${ids[index]} report does not match its manifest`);
    return report as StoredTrialReport;
  }));
  return {
    manifest: stored,
    reports: reports as [StoredTrialReport, StoredTrialReport, StoredTrialReport],
  };
}

export async function writeInitialTrialBatch(
  reports: readonly [StoredTrialReport, StoredTrialReport, StoredTrialReport],
  directory: string,
  snapshot: Readonly<StoredFamilySnapshot>,
): Promise<RetainedInitialTrialBatch> {
  const manifest = buildInitialBatch(reports, snapshot);
  const existing = await readInitialTrialBatch(directory, snapshot);
  if (existing !== null) {
    if (existing.manifest.artifactSha256 !== manifest.artifactSha256) {
      throw new Error('A conflicting immutable initial trial batch already exists');
    }
    return existing;
  }
  const rootEntries = await readdir(directory);
  const premature = rootEntries.filter((name) => FROZEN_TRIALS.some((trial) => (
    name.startsWith(`${trial.trialId}.r`)
  )));
  if (premature.length > 0) {
    throw new Error('Initial batch cannot publish over standalone or premature trial reports');
  }
  const batchDirectory = path.join(directory, INITIAL_BATCH_DIRECTORY, manifest.artifactSha256);
  await mkdir(batchDirectory, { recursive: true });
  const ids = ['H2', 'H3', 'H4'] as const;
  // Validate the entire batch before publishing any discoverability marker.
  const canonicalReports = reports.map((report, index) => (
    rebuildStoredReport(report, TRIAL_BY_ID[ids[index]].trialId, snapshot) as StoredTrialReport
  )) as unknown as [StoredTrialReport, StoredTrialReport, StoredTrialReport];
  await Promise.all(canonicalReports.map(async (report) => {
    const filename = `${report.canonical.trialId}.r1.${report.artifactSha256}.json`;
    await reconcileContentClaim(
      batchDirectory,
      `${report.canonical.trialId}.r1`,
      filename,
      `${canonicalJson(report)}\n`,
    );
  }));
  const filename = `${FAMILY_ID}.initial-batch.${manifest.artifactSha256}.json`;
  await reconcileContentClaim(
    directory,
    `${FAMILY_ID}.initial-batch`,
    filename,
    `${canonicalJson(manifest)}\n`,
  );
  const retained = await readInitialTrialBatch(directory, snapshot);
  if (retained === null || retained.manifest.artifactSha256 !== manifest.artifactSha256) {
    throw new Error('Initial trial batch publication did not retain the exact manifest');
  }
  return retained;
}

async function listReports(
  directory: string,
  trialId: ImmutableReportTrialId,
  snapshot: Readonly<StoredFamilySnapshot>,
  familyEvidence?: FamilyReportEvidence,
): Promise<Array<StoredTrialReport | StoredFamilyReport>> {
  const prefix = `${trialId}.r`;
  const filenames = (await readDirectoryIfPresent(directory)).filter((name) => name.startsWith(prefix));
  const rootReports = await Promise.all(filenames.map((filename) => (
    readReportFile(directory, filename, trialId, snapshot, familyEvidence)
  )));
  const reports: Array<StoredTrialReport | StoredFamilyReport> = [];
  if (trialId !== FAMILY_ID) {
    if (rootReports.some((report) => report.canonical.reportRevision === 1)) {
      throw new Error('Initial trial r1 is discoverable only through the atomic batch manifest');
    }
    const batch = await readInitialTrialBatch(directory, snapshot);
    if (batch !== null) {
      const initial = batch.reports.find((report) => report.canonical.trialId === trialId);
      if (!initial) throw new Error(`Initial batch is missing ${trialId}`);
      reports.push(initial);
    }
  }
  reports.push(...rootReports);
  reports.sort((left, right) => left.canonical.reportRevision - right.canonical.reportRevision);
  reports.forEach((report, index) => {
    const expectedRevision = index + 1;
    const prior = reports[index - 1];
    if (report.canonical.reportRevision !== expectedRevision) {
      throw new Error(`Report revisions for ${trialId} are not contiguous`);
    }
    if (
      expectedRevision === 1
        ? report.canonical.supersedesArtifactSha256 !== null
        : report.canonical.supersedesArtifactSha256 !== prior.artifactSha256
          || report.canonical.dataSha256 !== prior.canonical.dataSha256
          || report.canonical.sourceEvidence.snapshotArtifactSha256
            !== prior.canonical.sourceEvidence.snapshotArtifactSha256
    ) throw new Error(`Report revision chain is invalid for ${trialId} r${expectedRevision}`);
  });
  return reports;
}

async function readReport(
  directory: string,
  trialId: ImmutableReportTrialId,
  snapshot: Readonly<StoredFamilySnapshot>,
  reportRevision?: number,
  familyEvidence?: FamilyReportEvidence,
): Promise<StoredTrialReport | StoredFamilyReport> {
  requireRetainedFamilySnapshot(snapshot);
  const reports = await listReports(directory, trialId, snapshot, familyEvidence);
  if (reports.length === 0) throw new Error(`No immutable report exists for ${trialId}`);
  if (reportRevision === undefined) return reports.at(-1)!;
  if (!Number.isSafeInteger(reportRevision) || reportRevision < 1) {
    throw new Error('Invalid requested report revision');
  }
  const report = reports.find((candidate) => candidate.canonical.reportRevision === reportRevision);
  if (!report) throw new Error(`Report revision ${reportRevision} does not exist for ${trialId}`);
  return report;
}

export async function readTrialReport(
  directory: string,
  trialId: FrozenTrialId,
  snapshot: Readonly<StoredFamilySnapshot>,
  reportRevision?: number,
): Promise<StoredTrialReport> {
  if (!FROZEN_TRIALS.some((trial) => trial.trialId === trialId)) throw new Error('Unknown frozen trial ID');
  return readReport(directory, trialId, snapshot, reportRevision) as Promise<StoredTrialReport>;
}

async function loadRetainedFamilyEvidence(
  directory: string,
  snapshot: Readonly<StoredFamilySnapshot>,
  evidence: FamilyReportEvidence,
): Promise<FamilyReportEvidence> {
  const supplied = familyTrialReports(evidence, snapshot);
  const retained = await Promise.all(supplied.map(async (report) => {
    const loaded = await readTrialReport(
      directory,
      report.canonical.trialId as FrozenTrialId,
      snapshot,
      report.canonical.reportRevision,
    );
    if (loaded.artifactSha256 !== report.artifactSha256) {
      throw new Error(`Family evidence report ${report.canonical.trialId} is not the exact retained artifact`);
    }
    return loaded;
  }));
  return {
    h1: evidence.h1,
    trialReports: retained as [StoredTrialReport, StoredTrialReport, StoredTrialReport],
  };
}

export async function readFamilyReport(
  directory: string,
  snapshot: Readonly<StoredFamilySnapshot>,
  evidence: FamilyReportEvidence,
  reportRevision?: number,
): Promise<StoredFamilyReport> {
  const retainedEvidence = await loadRetainedFamilyEvidence(directory, snapshot, evidence);
  return readReport(
    directory,
    FAMILY_ID,
    snapshot,
    reportRevision,
    retainedEvidence,
  ) as Promise<StoredFamilyReport>;
}

async function writeReport(
  report: StoredTrialReport | StoredFamilyReport,
  directory: string,
  snapshot: Readonly<StoredFamilySnapshot>,
  familyEvidence?: FamilyReportEvidence,
): Promise<string> {
  const rebuilt = rebuildStoredReport(report, report.canonical.trialId, snapshot, familyEvidence);
  if (canonicalJson(rebuilt) !== canonicalJson(report)) throw new Error('Report hash mismatch');
  const { trialId, reportRevision } = rebuilt.canonical;
  const existing = await listReports(directory, trialId, snapshot, familyEvidence);
  const sameRevision = existing.find((item) => item.canonical.reportRevision === reportRevision);
  if (sameRevision && sameRevision.artifactSha256 !== rebuilt.artifactSha256) {
    throw new Error(`Conflicting retained report for ${trialId} r${reportRevision}`);
  }
  if (!sameRevision) {
    const expectedRevision = existing.length + 1;
    const prior = existing.at(-1);
    if (reportRevision !== expectedRevision) {
      throw new Error(`Expected report revision ${expectedRevision} for ${trialId}`);
    }
    if (reportRevision > 1 && rebuilt.canonical.supersedesArtifactSha256 !== prior?.artifactSha256) {
      throw new Error(`Report r${reportRevision} does not supersede retained r${reportRevision - 1}`);
    }
  }
  const filename = `${trialId}.r${reportRevision}.${rebuilt.artifactSha256}.json`;
  return reconcileContentClaim(
    directory,
    `${trialId}.r${reportRevision}`,
    filename,
    `${canonicalJson(rebuilt)}\n`,
  );
}

export async function writeTrialReport(
  report: StoredTrialReport,
  directory: string,
  snapshot: Readonly<StoredFamilySnapshot>,
): Promise<string> {
  if (report.canonical.trialId === FAMILY_ID) throw new Error('Trial writer cannot publish a family report');
  if (report.canonical.reportRevision === 1) {
    throw new Error('Initial H2,H3,H4 r1 reports require writeInitialTrialBatch');
  }
  return writeReport(report, directory, snapshot);
}

export async function writeFamilyReport(
  report: StoredFamilyReport,
  directory: string,
  snapshot: Readonly<StoredFamilySnapshot>,
  evidence: FamilyReportEvidence,
): Promise<string> {
  if (report.canonical.trialId !== FAMILY_ID) throw new Error('Family writer requires a family report');
  const retainedEvidence = await loadRetainedFamilyEvidence(directory, snapshot, evidence);
  return writeReport(report, directory, snapshot, retainedEvidence);
}
