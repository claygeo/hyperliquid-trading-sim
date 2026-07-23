import { createHash } from 'node:crypto';

import {
  FOUR_HOUR_MS,
  HOUR_MS,
  type CandleSeriesSnapshot,
  type FourHourCandle,
  type FundingSeriesSnapshot,
  type HourlyFunding,
  type MarketSymbol,
  type PerpAsset,
  type RawPageEvidence,
  type SpotPairMetadata,
  type SpotSymbol,
  type SpotTokenMetadata,
} from './contracts.js';
import {
  CANDLE_WINDOWS,
  FUNDING_WINDOWS,
  SPOT_PAIR_CONTRACTS,
  type CandleWindow as FrozenCandleWindow,
  type FundingWindow as FrozenFundingWindow,
} from './frozenTrials.js';

export const HYPERLIQUID_INFO_ENDPOINT = 'https://api.hyperliquid.xyz/info';
export const SOURCE_PAGE_ROWS = 500;

interface FetchResponseLike {
  ok: boolean;
  status: number;
  statusText: string;
  text(): Promise<string>;
}

export type FourHourFetch = (
  input: string,
  init: { method: string; headers: Record<string, string>; body: string },
) => Promise<FetchResponseLike>;

export type CandleRequestWindow = Readonly<FrozenCandleWindow>;
export type FundingRequestWindow = Readonly<FrozenFundingWindow>;

export interface ParsedSpotTokenMetadata extends SpotTokenMetadata {
  isCanonical: boolean;
  evmContract: string | null;
  fullName: string | null;
}

export interface ParsedSpotPairMetadata extends SpotPairMetadata {
  index: number;
  isCanonical: false;
  tokens: [ParsedSpotTokenMetadata, ParsedSpotTokenMetadata];
}

export interface SpotPairExpectation {
  symbol: SpotSymbol;
  index: number;
  baseName: 'UBTC' | 'UETH';
  quoteName: 'USDC';
}

export const FROZEN_SPOT_PAIR_EXPECTATIONS: readonly SpotPairExpectation[] = Object.freeze([
  Object.freeze({ symbol: '@142', index: 142, baseName: 'UBTC', quoteName: 'USDC' }),
  Object.freeze({ symbol: '@151', index: 151, baseName: 'UETH', quoteName: 'USDC' }),
]);

export interface SpotMetadataResult {
  requestType: 'spotMeta';
  rawResponseSha256: string;
  fetchedAt: string;
  pairs: Partial<Record<SpotSymbol, ParsedSpotPairMetadata>>;
}

export type FourHourClock = () => Date;

export interface FourHourFetchOptions {
  endpoint?: string;
  fetchImpl?: FourHourFetch;
  clock?: FourHourClock;
}

export type SpotMetaFetchOptions = FourHourFetchOptions;

export type FrozenSpotMetadataPairs = Record<SpotSymbol, ParsedSpotPairMetadata>;

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function finiteNumber(value: unknown, label: string, positive = false): number {
  const parsed = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  if (
    typeof parsed !== 'number'
    || !Number.isFinite(parsed)
    || (positive && parsed <= 0)
  ) {
    throw new Error(`${label} must be a ${positive ? 'positive ' : ''}finite number`);
  }
  return parsed;
}

function integer(value: unknown, label: string, nonNegative = false): number {
  if (
    typeof value !== 'number'
    || !Number.isSafeInteger(value)
    || (nonNegative && value < 0)
  ) {
    throw new Error(`${label} must be a${nonNegative ? ' non-negative' : 'n'} integer`);
  }
  return value;
}

function optionalString(value: unknown, label: string): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') throw new Error(`${label} must be a string or null`);
  return value;
}

function requireOfficialEndpoint(endpoint: string): void {
  if (endpoint !== HYPERLIQUID_INFO_ENDPOINT) {
    throw new Error('Four-hour research requires the official Hyperliquid info endpoint');
  }
}

function resolveFetch(options: FourHourFetchOptions): { endpoint: string; fetchImpl: FourHourFetch } {
  const endpoint = options.endpoint ?? HYPERLIQUID_INFO_ENDPOINT;
  requireOfficialEndpoint(endpoint);
  const fetchImpl = options.fetchImpl ?? (globalThis.fetch as unknown as FourHourFetch);
  if (typeof fetchImpl !== 'function') throw new Error('Fetch implementation is unavailable');
  return { endpoint, fetchImpl };
}

function fetchedAtFromClock(options: FourHourFetchOptions): string {
  const clock = options.clock ?? (() => new Date());
  if (typeof clock !== 'function') throw new Error('Clock implementation is unavailable');
  const instant = clock();
  if (!(instant instanceof Date) || !Number.isFinite(instant.getTime())) {
    throw new Error('Clock must return a valid Date');
  }
  return instant.toISOString();
}

async function postOfficial(
  body: Record<string, unknown>,
  label: string,
  options: FourHourFetchOptions,
): Promise<{ decoded: unknown; rawResponseSha256: string; fetchedAt: string }> {
  const { endpoint, fetchImpl } = resolveFetch(options);
  const response = await fetchImpl(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const raw = await response.text();
  if (!response.ok) {
    throw new Error(`${label} failed ${response.status} ${response.statusText}`);
  }
  let decoded: unknown;
  try {
    decoded = JSON.parse(raw);
  } catch {
    throw new Error(`${label} was not valid JSON`);
  }
  return {
    decoded,
    rawResponseSha256: sha256(raw),
    fetchedAt: fetchedAtFromClock(options),
  };
}

function validateWindow(
  startTime: number,
  endTimeExclusive: number,
  stepMs: number,
  label: string,
): number {
  if (
    !Number.isSafeInteger(startTime)
    || !Number.isSafeInteger(endTimeExclusive)
    || startTime % stepMs !== 0
    || endTimeExclusive % stepMs !== 0
    || endTimeExclusive <= startTime
  ) {
    throw new Error(`${label} must be a positive, aligned, exclusive window`);
  }
  const rows = (endTimeExclusive - startTime) / stepMs;
  if (!Number.isSafeInteger(rows) || rows <= 0) {
    throw new Error(`${label} row count must be a positive safe integer`);
  }
  return rows;
}

export function parseFourHourCandle(
  row: unknown,
  expectedSymbol: MarketSymbol,
): FourHourCandle {
  const value = requireRecord(row, `${expectedSymbol} candle row`);
  if (value.s !== expectedSymbol) throw new Error(`${expectedSymbol} candle has wrong symbol`);
  if (value.i !== '4h') throw new Error(`${expectedSymbol} candle has wrong interval`);

  const openTime = integer(value.t, `${expectedSymbol}.t`);
  const closeTime = integer(value.T, `${expectedSymbol}.T`);
  const open = finiteNumber(value.o, `${expectedSymbol}.o`, true);
  const high = finiteNumber(value.h, `${expectedSymbol}.h`, true);
  const low = finiteNumber(value.l, `${expectedSymbol}.l`, true);
  const close = finiteNumber(value.c, `${expectedSymbol}.c`, true);
  const volume = finiteNumber(value.v, `${expectedSymbol}.v`);

  if (openTime % FOUR_HOUR_MS !== 0 || closeTime !== openTime + FOUR_HOUR_MS - 1) {
    throw new Error(`${expectedSymbol} candle is not aligned to a complete four-hour bar`);
  }
  if (volume < 0) throw new Error(`${expectedSymbol} candle volume cannot be negative`);
  if (high < Math.max(open, close) || low > Math.min(open, close) || high < low) {
    throw new Error(`${expectedSymbol} candle violates OHLC ordering`);
  }
  return {
    symbol: expectedSymbol,
    interval: '4h',
    openTime,
    closeTime,
    open,
    high,
    low,
    close,
    volume,
  };
}

export function parseHourlyFunding(
  row: unknown,
  expectedCoin: PerpAsset,
): HourlyFunding {
  const value = requireRecord(row, `${expectedCoin} funding row`);
  if (value.coin !== expectedCoin) throw new Error(`${expectedCoin} funding has wrong coin`);
  const time = integer(value.time, `${expectedCoin}.funding.time`);
  const fundingRate = finiteNumber(value.fundingRate, `${expectedCoin}.fundingRate`);
  if (time % HOUR_MS !== 0) throw new Error(`${expectedCoin} funding is not UTC-hour aligned`);
  return { coin: expectedCoin, time, rate: fundingRate };
}

function validateExactTimestamps<T>(
  rows: T[],
  timestamp: (row: T) => number,
  expectedStart: number,
  expectedRows: number,
  stepMs: number,
  label: string,
): void {
  if (rows.length !== expectedRows) {
    throw new Error(`${label} expected ${expectedRows} rows, received ${rows.length}`);
  }
  for (let index = 0; index < rows.length; index += 1) {
    const actual = timestamp(rows[index]);
    const expected = expectedStart + index * stepMs;
    if (index > 0 && actual === timestamp(rows[index - 1])) {
      throw new Error(`${label} duplicate timestamp ${actual}`);
    }
    if (actual !== expected) {
      throw new Error(`${label} gap or out-of-window timestamp at index ${index}; expected ${expected}`);
    }
  }
}

export async function fetchFourHourCandles(
  window: CandleRequestWindow,
  options: FourHourFetchOptions = {},
): Promise<CandleSeriesSnapshot> {
  const totalRows = validateWindow(
    window.startTime,
    window.endTime,
    FOUR_HOUR_MS,
    `${window.symbol} candle window`,
  );
  if (window.expectedBars !== totalRows) {
    throw new Error(`${window.symbol} frozen expectedBars mismatch`);
  }
  // Resolve before iteration so a non-official endpoint cannot result in even one request.
  resolveFetch(options);
  const pages: RawPageEvidence[] = [];
  const candles: FourHourCandle[] = [];

  for (let offset = 0, page = 1; offset < totalRows; offset += SOURCE_PAGE_ROWS, page += 1) {
    const expectedRows = Math.min(SOURCE_PAGE_ROWS, totalRows - offset);
    const requestedStartTime = window.startTime + offset * FOUR_HOUR_MS;
    const requestedEndTime = requestedStartTime + expectedRows * FOUR_HOUR_MS - 1;
    const { decoded, rawResponseSha256, fetchedAt } = await postOfficial({
      type: 'candleSnapshot',
      req: {
        coin: window.symbol,
        interval: '4h',
        startTime: requestedStartTime,
        endTime: requestedEndTime,
      },
    }, `${window.symbol} candle page ${page}`, options);
    if (!Array.isArray(decoded) || decoded.length === 0) {
      throw new Error(`${window.symbol} candle page ${page} was empty or malformed`);
    }
    const parsed = decoded
      .map((row) => parseFourHourCandle(row, window.symbol))
      .sort((left, right) => left.openTime - right.openTime);
    validateExactTimestamps(
      parsed,
      (row) => row.openTime,
      requestedStartTime,
      expectedRows,
      FOUR_HOUR_MS,
      `${window.symbol} candle page ${page}`,
    );
    if (parsed.at(-1)?.closeTime !== requestedEndTime) {
      throw new Error(`${window.symbol} candle page ${page} did not cover its requested end`);
    }
    pages.push({
      page,
      requestedStartTime,
      requestedEndTime,
      responseRows: decoded.length,
      acceptedRows: parsed.length,
      firstTime: parsed[0].openTime,
      lastTime: parsed.at(-1)!.closeTime,
      rawResponseSha256,
      fetchedAt,
    });
    candles.push(...parsed);
  }

  validateExactTimestamps(
    candles,
    (row) => row.openTime,
    window.startTime,
    totalRows,
    FOUR_HOUR_MS,
    `${window.symbol} complete candle window`,
  );
  if (candles.at(-1)?.closeTime !== window.endTime - 1) {
    throw new Error(`${window.symbol} candle window did not end at the frozen cutoff`);
  }
  return { ...window, pages, candles };
}

export async function fetchHourlyFunding(
  window: FundingRequestWindow,
  options: FourHourFetchOptions = {},
): Promise<FundingSeriesSnapshot> {
  const totalRows = validateWindow(
    window.startTime,
    window.endTime + HOUR_MS,
    HOUR_MS,
    `${window.coin} funding window`,
  );
  if (window.expectedHours !== totalRows) {
    throw new Error(`${window.coin} frozen expectedHours mismatch`);
  }
  resolveFetch(options);
  const pages: RawPageEvidence[] = [];
  const funding: HourlyFunding[] = [];

  for (let offset = 0, page = 1; offset < totalRows; offset += SOURCE_PAGE_ROWS, page += 1) {
    const expectedRows = Math.min(SOURCE_PAGE_ROWS, totalRows - offset);
    const requestedStartTime = window.startTime + offset * HOUR_MS;
    const requestedEndTime = requestedStartTime + (expectedRows - 1) * HOUR_MS;
    const { decoded, rawResponseSha256, fetchedAt } = await postOfficial({
      type: 'fundingHistory',
      coin: window.coin,
      startTime: requestedStartTime,
      endTime: requestedEndTime,
    }, `${window.coin} funding page ${page}`, options);
    if (!Array.isArray(decoded) || decoded.length === 0) {
      throw new Error(`${window.coin} funding page ${page} was empty or malformed`);
    }
    const parsed = decoded
      .map((row) => parseHourlyFunding(row, window.coin))
      .sort((left, right) => left.time - right.time);
    validateExactTimestamps(
      parsed,
      (row) => row.time,
      requestedStartTime,
      expectedRows,
      HOUR_MS,
      `${window.coin} funding page ${page}`,
    );
    if (parsed.at(-1)?.time !== requestedEndTime) {
      throw new Error(`${window.coin} funding page ${page} did not cover its requested end`);
    }
    pages.push({
      page,
      requestedStartTime,
      requestedEndTime,
      responseRows: decoded.length,
      acceptedRows: parsed.length,
      firstTime: parsed[0].time,
      lastTime: parsed.at(-1)!.time,
      rawResponseSha256,
      fetchedAt,
    });
    funding.push(...parsed);
  }

  validateExactTimestamps(
    funding,
    (row) => row.time,
    window.startTime,
    totalRows,
    HOUR_MS,
    `${window.coin} complete funding window`,
  );
  if (funding.at(-1)?.time !== window.endTime) {
    throw new Error(`${window.coin} funding window did not end at the frozen cutoff hour`);
  }
  return { ...window, pages, funding };
}

function parseSpotToken(row: unknown): ParsedSpotTokenMetadata {
  const value = requireRecord(row, 'spot token');
  const indexValue = integer(value.index, 'spot token index', true);
  if (typeof value.name !== 'string' || value.name.length === 0) {
    throw new Error(`spot token ${indexValue} has invalid name`);
  }
  if (typeof value.tokenId !== 'string' || value.tokenId.length === 0) {
    throw new Error(`spot token ${indexValue} has invalid tokenId`);
  }
  if (typeof value.isCanonical !== 'boolean') {
    throw new Error(`spot token ${indexValue} has invalid isCanonical`);
  }
  return {
    index: indexValue,
    name: value.name,
    szDecimals: integer(value.szDecimals, `spot token ${indexValue} szDecimals`, true),
    weiDecimals: integer(value.weiDecimals, `spot token ${indexValue} weiDecimals`, true),
    tokenId: value.tokenId,
    isCanonical: value.isCanonical,
    evmContract: optionalString(value.evmContract, `spot token ${indexValue} evmContract`),
    fullName: optionalString(value.fullName, `spot token ${indexValue} fullName`),
  };
}

export function parseRelevantSpotMeta(
  decoded: unknown,
  expectations: readonly SpotPairExpectation[] = FROZEN_SPOT_PAIR_EXPECTATIONS,
): Partial<Record<SpotSymbol, ParsedSpotPairMetadata>> {
  const root = requireRecord(decoded, 'spotMeta response');
  if (!Array.isArray(root.tokens) || !Array.isArray(root.universe)) {
    throw new Error('spotMeta response must contain token and universe arrays');
  }
  const tokens = root.tokens.map(parseSpotToken);
  const tokenByIndex = new Map<number, ParsedSpotTokenMetadata>();
  for (const token of tokens) {
    if (tokenByIndex.has(token.index)) throw new Error(`spotMeta duplicate token index ${token.index}`);
    tokenByIndex.set(token.index, token);
  }

  const pairs: Partial<Record<SpotSymbol, ParsedSpotPairMetadata>> = {};
  for (const expected of expectations) {
    const matches = root.universe.filter((candidate) => {
      if (candidate === null || typeof candidate !== 'object' || Array.isArray(candidate)) return false;
      const value = candidate as Record<string, unknown>;
      return value.name === expected.symbol || value.index === expected.index;
    });
    if (matches.length !== 1) {
      throw new Error(`spotMeta expected exactly one mapping for ${expected.symbol}`);
    }
    const pair = requireRecord(matches[0], `${expected.symbol} spot pair`);
    if (pair.name !== expected.symbol || integer(pair.index, `${expected.symbol} index`, true) !== expected.index) {
      throw new Error(`spotMeta ${expected.symbol} identity mismatch`);
    }
    if (pair.isCanonical !== false) {
      throw new Error(`spotMeta ${expected.symbol} must remain non-canonical`);
    }
    if (
      !Array.isArray(pair.tokens)
      || pair.tokens.length !== 2
      || pair.tokens.some((tokenIndex) => !Number.isInteger(tokenIndex) || Number(tokenIndex) < 0)
    ) {
      throw new Error(`spotMeta ${expected.symbol} must contain two integer token indexes`);
    }
    const tokenIndexes: [number, number] = [Number(pair.tokens[0]), Number(pair.tokens[1])];
    const base = tokenByIndex.get(tokenIndexes[0]);
    const quote = tokenByIndex.get(tokenIndexes[1]);
    if (!base || !quote) throw new Error(`spotMeta ${expected.symbol} references a missing token`);
    if (base.name !== expected.baseName || quote.name !== expected.quoteName) {
      throw new Error(`spotMeta ${expected.symbol} no longer maps to ${expected.baseName}/${expected.quoteName}`);
    }
    const frozenPair = SPOT_PAIR_CONTRACTS[expected.symbol];
    pairs[expected.symbol] = {
      symbol: expected.symbol,
      displayName: frozenPair.displayName,
      index: expected.index,
      baseTokenIndex: tokenIndexes[0],
      quoteTokenIndex: tokenIndexes[1],
      wrapperMultiplier: frozenPair.wrapperMultiplier,
      isCanonical: false,
      tokens: [base, quote],
    };
  }
  return pairs;
}

export async function fetchRelevantSpotMeta(
  options: SpotMetaFetchOptions = {},
): Promise<SpotMetadataResult> {
  resolveFetch(options);
  const { decoded, rawResponseSha256, fetchedAt } = await postOfficial(
    { type: 'spotMeta' },
    'spotMeta request',
    options,
  );
  const parsed = parseRelevantSpotMeta(decoded);
  const ubtc = parsed['@142'];
  const ueth = parsed['@151'];
  if (!ubtc || !ueth) {
    throw new Error('spotMeta response did not contain both frozen wrapper pairs');
  }
  return {
    requestType: 'spotMeta',
    rawResponseSha256,
    fetchedAt,
    pairs: { '@142': ubtc, '@151': ueth },
  };
}

export function fetchFrozenFourHourCandles(
  symbol: MarketSymbol,
  options: FourHourFetchOptions = {},
): Promise<CandleSeriesSnapshot> {
  return fetchFourHourCandles(CANDLE_WINDOWS[symbol], options);
}

export function fetchFrozenHourlyFunding(
  coin: PerpAsset,
  options: FourHourFetchOptions = {},
): Promise<FundingSeriesSnapshot> {
  return fetchHourlyFunding(FUNDING_WINDOWS[coin], options);
}
