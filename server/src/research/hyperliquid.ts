import { createHash } from 'node:crypto';
import { mkdir, open, readFile, readdir, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

import {
  ASSETS,
  canonicalJson,
  DAY_MS,
  FROZEN_CONFIG,
  type FrozenResearchConfig,
  type ResearchAsset,
  type ResearchCandle,
} from './kernel.js';

export const HYPERLIQUID_INFO_ENDPOINT = 'https://api.hyperliquid.xyz/info';
const HISTORY_LIMIT = 5_000;

interface FetchResponseLike {
  ok: boolean;
  status: number;
  statusText: string;
  text(): Promise<string>;
}

export type ResearchFetch = (
  input: string,
  init: { method: string; headers: Record<string, string>; body: string },
) => Promise<FetchResponseLike>;

export interface RawPageEvidence {
  page: number;
  requestedStartTime: number;
  requestedEndTime: number;
  responseRows: number;
  acceptedRows: number;
  firstOpenTime: number;
  lastCloseTime: number;
  rawResponseSha256: string;
}

export interface AssetSnapshot {
  asset: ResearchAsset;
  pages: RawPageEvidence[];
  candles: ResearchCandle[];
}

export interface CanonicalMarketSnapshot {
  schemaVersion: 1;
  trialId: string;
  source: {
    name: 'Hyperliquid';
    endpoint: string;
    requestType: 'candleSnapshot';
    interval: '1d';
  };
  requestedWindow: {
    startTime: number;
    endTime: number;
    asOfTime: number;
    expectedCandles: number;
  };
  assets: Record<ResearchAsset, AssetSnapshot>;
}

export interface StoredMarketSnapshot {
  dataSha256: string;
  artifactSha256: string;
  canonical: CanonicalMarketSnapshot;
}

export function calculateSnapshotHashes(canonical: CanonicalMarketSnapshot): {
  dataSha256: string;
  artifactSha256: string;
} {
  const normalizedData = {
    schemaVersion: canonical.schemaVersion,
    trialId: canonical.trialId,
    source: canonical.source,
    requestedWindow: canonical.requestedWindow,
    assets: {
      BTC: canonical.assets.BTC.candles,
      ETH: canonical.assets.ETH.candles,
    },
  };
  return {
    dataSha256: sha256(canonicalJson(normalizedData)),
    artifactSha256: sha256(canonicalJson(canonical)),
  };
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function assertFiniteNumber(value: unknown, label: string, positive = false): number {
  const parsed = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  if (typeof parsed !== 'number' || !Number.isFinite(parsed) || (positive && parsed <= 0)) {
    throw new Error(`${label} must be a ${positive ? 'positive ' : ''}finite number`);
  }
  return parsed;
}

export function parseCandleRow(
  row: unknown,
  expectedAsset: ResearchAsset,
): ResearchCandle {
  if (row === null || typeof row !== 'object' || Array.isArray(row)) {
    throw new Error(`${expectedAsset} candle row must be an object`);
  }
  const value = row as Record<string, unknown>;
  if (value.s !== expectedAsset) throw new Error(`${expectedAsset} candle has wrong symbol`);
  if (value.i !== '1d') throw new Error(`${expectedAsset} candle has wrong interval`);

  const openTime = assertFiniteNumber(value.t, `${expectedAsset}.t`);
  const closeTime = assertFiniteNumber(value.T, `${expectedAsset}.T`);
  const open = assertFiniteNumber(value.o, `${expectedAsset}.o`, true);
  const high = assertFiniteNumber(value.h, `${expectedAsset}.h`, true);
  const low = assertFiniteNumber(value.l, `${expectedAsset}.l`, true);
  const close = assertFiniteNumber(value.c, `${expectedAsset}.c`, true);
  const volume = assertFiniteNumber(value.v, `${expectedAsset}.v`);

  if (!Number.isInteger(openTime) || !Number.isInteger(closeTime)) {
    throw new Error(`${expectedAsset} candle timestamps must be integer milliseconds`);
  }
  if (openTime % DAY_MS !== 0 || closeTime !== openTime + DAY_MS - 1) {
    throw new Error(`${expectedAsset} candle is not aligned to a complete UTC day`);
  }
  if (volume < 0) throw new Error(`${expectedAsset} candle volume cannot be negative`);
  if (high < Math.max(open, close) || low > Math.min(open, close) || high < low) {
    throw new Error(`${expectedAsset} candle violates OHLC ordering`);
  }

  return {
    symbol: expectedAsset,
    interval: '1d',
    openTime,
    closeTime,
    open,
    high,
    low,
    close,
    volume,
  };
}

function validateFrozenCandles(
  candles: ResearchCandle[],
  asset: ResearchAsset,
  config: FrozenResearchConfig,
): void {
  if (!Array.isArray(candles)) throw new Error(`${asset} candles must be an array`);
  const expected = (config.asOfTime - config.startTime) / DAY_MS;
  if (!Number.isInteger(expected) || expected <= 0) {
    throw new Error('Requested window must contain a positive whole number of UTC days');
  }
  if (expected > HISTORY_LIMIT) {
    throw new Error(`Requested ${expected} candles exceeds the ${HISTORY_LIMIT}-candle limit`);
  }
  if (candles.length !== expected) {
    throw new Error(`${asset} expected ${expected} candles, received ${candles.length}`);
  }

  const seen = new Set<number>();
  candles.forEach((candle, index) => {
    if (candle === null || typeof candle !== 'object') {
      throw new Error(`${asset} normalized candle must be an object`);
    }
    if (candle.symbol !== asset || candle.interval !== '1d') {
      throw new Error(`${asset} normalized candle identity mismatch at index ${index}`);
    }
    const numericValues = [
      candle.openTime,
      candle.closeTime,
      candle.open,
      candle.high,
      candle.low,
      candle.close,
      candle.volume,
    ];
    if (numericValues.some((value) => !Number.isFinite(value))) {
      throw new Error(`${asset} normalized candle has a non-finite value at index ${index}`);
    }
    if (!Number.isInteger(candle.openTime) || !Number.isInteger(candle.closeTime)) {
      throw new Error(`${asset} normalized candle timestamps are not integer milliseconds`);
    }
    if (
      candle.openTime % DAY_MS !== 0
      || candle.closeTime !== candle.openTime + DAY_MS - 1
    ) throw new Error(`${asset} normalized candle is not a complete UTC day`);
    if (
      candle.open <= 0
      || candle.high <= 0
      || candle.low <= 0
      || candle.close <= 0
      || candle.volume < 0
    ) throw new Error(`${asset} normalized candle has invalid OHLCV at index ${index}`);
    if (
      candle.high < Math.max(candle.open, candle.close)
      || candle.low > Math.min(candle.open, candle.close)
      || candle.high < candle.low
    ) throw new Error(`${asset} normalized candle violates OHLC ordering at index ${index}`);
    const expectedOpen = config.startTime + index * DAY_MS;
    if (seen.has(candle.openTime)) throw new Error(`${asset} duplicate candle ${candle.openTime}`);
    seen.add(candle.openTime);
    if (candle.openTime !== expectedOpen) {
      throw new Error(`${asset} candle gap at index ${index}; expected ${expectedOpen}`);
    }
    if (candle.closeTime >= config.asOfTime) {
      throw new Error(`${asset} includes a candle that was not closed at as-of`);
    }
  });
  if (candles[candles.length - 1].closeTime !== config.asOfTime - 1) {
    throw new Error(`${asset} does not cover the frozen end boundary`);
  }
}

export async function fetchFrozenDailyCandles(
  asset: ResearchAsset,
  options: {
    config?: FrozenResearchConfig;
    endpoint?: string;
    fetchImpl?: ResearchFetch;
  } = {},
): Promise<AssetSnapshot> {
  const config = options.config ?? FROZEN_CONFIG;
  const endpoint = options.endpoint ?? HYPERLIQUID_INFO_ENDPOINT;
  const fetchImpl = options.fetchImpl ?? (globalThis.fetch as unknown as ResearchFetch);
  if (typeof fetchImpl !== 'function') throw new Error('Fetch implementation is unavailable');

  const expectedCandles = (config.asOfTime - config.startTime) / DAY_MS;
  if (!Number.isInteger(expectedCandles) || expectedCandles <= 0 || expectedCandles > HISTORY_LIMIT) {
    throw new Error('Frozen request exceeds Hyperliquid candle history or is not day-aligned');
  }
  const requestEnd = config.asOfTime - 1;
  const body = canonicalJson({
    req: {
      coin: asset,
      endTime: requestEnd,
      interval: '1d',
      startTime: config.startTime,
    },
    type: 'candleSnapshot',
  });
  const response = await fetchImpl(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body,
  });
  const raw = await response.text();
  if (!response.ok) {
    throw new Error(`${asset} candle request failed ${response.status} ${response.statusText}`);
  }

  let decoded: unknown;
  try {
    decoded = JSON.parse(raw);
  } catch {
    throw new Error(`${asset} candle response was not valid JSON`);
  }
  if (!Array.isArray(decoded) || decoded.length === 0) {
    throw new Error(`${asset} candle response was empty`);
  }

  const parsed = decoded.map((row) => parseCandleRow(row, asset))
    .sort((left, right) => left.openTime - right.openTime);
  if (parsed[0].openTime !== config.startTime) {
    throw new Error(`${asset} response did not begin at requested timestamp ${config.startTime}`);
  }
  for (let index = 1; index < parsed.length; index += 1) {
    if (parsed[index].openTime === parsed[index - 1].openTime) {
      throw new Error(`${asset} duplicate candle ${parsed[index].openTime}`);
    }
  }

  const candles = parsed.filter((candle) => candle.closeTime < config.asOfTime);
  if (candles.length === 0) {
    throw new Error(`${asset} response contained no candles closed at as-of`);
  }
  const pages: RawPageEvidence[] = [{
    page: 1,
    requestedStartTime: config.startTime,
    requestedEndTime: requestEnd,
    responseRows: parsed.length,
    acceptedRows: candles.length,
    firstOpenTime: candles[0].openTime,
    lastCloseTime: candles[candles.length - 1].closeTime,
    rawResponseSha256: sha256(raw),
  }];

  validateFrozenCandles(candles, asset, config);
  return { asset, pages, candles };
}

function assertIdenticalCalendar(snapshot: CanonicalMarketSnapshot): void {
  const btc = snapshot.assets.BTC.candles;
  const eth = snapshot.assets.ETH.candles;
  if (btc.length !== eth.length) throw new Error('BTC/ETH calendars differ in length');
  for (let index = 0; index < btc.length; index += 1) {
    if (btc[index].openTime !== eth[index].openTime || btc[index].closeTime !== eth[index].closeTime) {
      throw new Error(`BTC/ETH calendar mismatch at index ${index}`);
    }
  }
}

export async function buildFrozenSnapshot(
  options: {
    config?: FrozenResearchConfig;
    endpoint?: string;
    fetchImpl?: ResearchFetch;
  } = {},
): Promise<StoredMarketSnapshot> {
  const config = options.config ?? FROZEN_CONFIG;
  const endpoint = options.endpoint ?? HYPERLIQUID_INFO_ENDPOINT;
  if (endpoint !== HYPERLIQUID_INFO_ENDPOINT) {
    throw new Error('Research snapshots require the official Hyperliquid info endpoint');
  }
  const btc = await fetchFrozenDailyCandles('BTC', { ...options, config, endpoint });
  const eth = await fetchFrozenDailyCandles('ETH', { ...options, config, endpoint });
  const canonical: CanonicalMarketSnapshot = {
    schemaVersion: 1,
    trialId: config.trialId,
    source: {
      name: 'Hyperliquid',
      endpoint,
      requestType: 'candleSnapshot',
      interval: '1d',
    },
    requestedWindow: {
      startTime: config.startTime,
      endTime: config.asOfTime - 1,
      asOfTime: config.asOfTime,
      expectedCandles: (config.asOfTime - config.startTime) / DAY_MS,
    },
    assets: { BTC: btc, ETH: eth },
  };
  assertIdenticalCalendar(canonical);
  return { ...calculateSnapshotHashes(canonical), canonical };
}

export async function writeSnapshot(
  snapshot: StoredMarketSnapshot,
  directory: string,
): Promise<string> {
  const calculatedHashes = calculateSnapshotHashes(snapshot.canonical);
  if (
    snapshot.dataSha256 !== calculatedHashes.dataSha256
    || snapshot.artifactSha256 !== calculatedHashes.artifactSha256
  ) throw new Error('Snapshot hashes do not match its canonical payload');
  await mkdir(directory, { recursive: true });
  const trialId = snapshot.canonical.trialId;
  const lockPath = path.join(directory, `.${trialId}.snapshot.lock`);
  let lockHandle;
  try {
    lockHandle = await open(lockPath, 'wx');
  } catch (error: unknown) {
    const code = error && typeof error === 'object' && 'code' in error
      ? String((error as { code: unknown }).code)
      : 'UNKNOWN';
    if (code === 'EEXIST') throw new Error(`Snapshot write already in progress for ${trialId}`);
    throw error;
  }

  try {
    const existing = (await readdir(directory))
      .filter((name) => name.startsWith(`${trialId}.`) && name.endsWith('.json'));
    if (existing.length > 0) {
      throw new Error(`Snapshot already exists for trial ${trialId}`);
    }
    const filename = `${trialId}.${snapshot.dataSha256}.json`;
    const outputPath = path.join(directory, filename);
    await writeFile(outputPath, `${canonicalJson(snapshot)}\n`, { encoding: 'utf8', flag: 'wx' });
    return outputPath;
  } finally {
    await lockHandle.close();
    await unlink(lockPath).catch(() => undefined);
  }
}

function validateSnapshotContract(
  stored: StoredMarketSnapshot,
  trialId: string,
  config: FrozenResearchConfig,
): void {
  const canonical = stored.canonical;
  if (canonical.schemaVersion !== 1) throw new Error('Snapshot schema version mismatch');
  if (canonical.trialId !== trialId || canonical.trialId !== config.trialId) {
    throw new Error('Snapshot trial ID mismatch');
  }
  if (
    !canonical.source
    || canonical.source.name !== 'Hyperliquid'
    || canonical.source.endpoint !== HYPERLIQUID_INFO_ENDPOINT
    || canonical.source.requestType !== 'candleSnapshot'
    || canonical.source.interval !== '1d'
  ) throw new Error('Snapshot source contract mismatch');
  const expectedCandles = (config.asOfTime - config.startTime) / DAY_MS;
  if (
    !canonical.requestedWindow
    || canonical.requestedWindow.startTime !== config.startTime
    || canonical.requestedWindow.endTime !== config.asOfTime - 1
    || canonical.requestedWindow.asOfTime !== config.asOfTime
    || canonical.requestedWindow.expectedCandles !== expectedCandles
  ) throw new Error('Snapshot requested window mismatch');
  for (const asset of ASSETS) {
    if (!canonical.assets?.[asset] || canonical.assets[asset].asset !== asset) {
      throw new Error(`Snapshot asset identity mismatch for ${asset}`);
    }
  }
}

function validatePageEvidence(
  canonical: CanonicalMarketSnapshot,
  config: FrozenResearchConfig,
): void {
  const expectedCandles = (config.asOfTime - config.startTime) / DAY_MS;
  for (const asset of ASSETS) {
    const snapshot = canonical.assets[asset];
    if (!Array.isArray(snapshot.pages) || snapshot.pages.length !== 1) {
      throw new Error(`${asset} snapshot must contain exactly one response evidence entry`);
    }
    const page = snapshot.pages[0];
    if (page === null || typeof page !== 'object') {
      throw new Error(`${asset} response evidence is malformed`);
    }
    if (
      page.page !== 1
      || page.requestedStartTime !== config.startTime
      || page.requestedEndTime !== config.asOfTime - 1
    ) throw new Error(`${asset} response request boundary mismatch`);
    if (
      !Number.isInteger(page.responseRows)
      || !Number.isInteger(page.acceptedRows)
      || page.acceptedRows !== expectedCandles
      || page.acceptedRows !== snapshot.candles.length
      || page.responseRows < page.acceptedRows
      || page.responseRows > page.acceptedRows + 1
    ) throw new Error(`${asset} response row counts are invalid`);
    if (
      page.firstOpenTime !== config.startTime
      || page.firstOpenTime !== snapshot.candles[0].openTime
      || page.lastCloseTime !== config.asOfTime - 1
      || page.lastCloseTime !== snapshot.candles[snapshot.candles.length - 1].closeTime
    ) throw new Error(`${asset} response evidence does not cover the frozen window`);
    if (!/^[0-9a-f]{64}$/u.test(page.rawResponseSha256)) {
      throw new Error(`${asset} response raw hash is invalid`);
    }
  }
}

export async function readFrozenSnapshot(
  directory: string,
  trialId = FROZEN_CONFIG.trialId,
  config: FrozenResearchConfig = FROZEN_CONFIG,
): Promise<StoredMarketSnapshot> {
  const matching = (await readdir(directory))
    .filter((name) => name.startsWith(`${trialId}.`) && name.endsWith('.json'));
  if (matching.length !== 1) {
    throw new Error(`Expected exactly one snapshot for ${trialId}, found ${matching.length}`);
  }
  const filename = matching[0];
  const stored = JSON.parse(
    await readFile(path.join(directory, filename), 'utf8'),
  ) as StoredMarketSnapshot;
  if (
    !stored
    || typeof stored !== 'object'
    || !stored.canonical
    || !stored.dataSha256
    || !stored.artifactSha256
  ) {
    throw new Error('Snapshot artifact is malformed');
  }
  const {
    dataSha256: actualDataHash,
    artifactSha256: actualArtifactHash,
  } = calculateSnapshotHashes(stored.canonical);
  if (
    actualDataHash !== stored.dataSha256
    || actualArtifactHash !== stored.artifactSha256
    || filename !== `${trialId}.${actualDataHash}.json`
  ) {
    throw new Error('Snapshot content hash verification failed');
  }
  validateSnapshotContract(stored, trialId, config);
  for (const asset of ASSETS) {
    validateFrozenCandles(stored.canonical.assets[asset].candles, asset, config);
  }
  assertIdenticalCalendar(stored.canonical);
  validatePageEvidence(stored.canonical, config);
  return stored;
}

export function snapshotSeries(
  snapshot: StoredMarketSnapshot,
): Record<ResearchAsset, ResearchCandle[]> {
  return {
    BTC: snapshot.canonical.assets.BTC.candles,
    ETH: snapshot.canonical.assets.ETH.candles,
  };
}
