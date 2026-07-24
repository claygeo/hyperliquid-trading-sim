import { createHash } from 'node:crypto';

import { FOUR_HOUR_MS, HOUR_MS, type MarketSymbol, type PerpAsset } from '../research/fourHour/contracts.js';
import {
  HYPERLIQUID_INFO_ENDPOINT,
  fetchFourHourCandles,
  fetchFrozenFourHourCandles,
  fetchFrozenHourlyFunding,
  fetchHourlyFunding,
  fetchRelevantSpotMeta,
  parseFourHourCandle,
  parseHourlyFunding,
  parseRelevantSpotMeta,
  type FourHourFetch,
} from '../research/fourHour/hyperliquid.js';

interface MockResponseOptions {
  ok?: boolean;
  status?: number;
  statusText?: string;
  retryAfter?: string;
}

function response(raw: string, options: MockResponseOptions = {}) {
  const retryAfter = options.retryAfter;
  return {
    ok: options.ok ?? true,
    status: options.status ?? 200,
    statusText: options.statusText ?? 'OK',
    async text() { return raw; },
    headers: {
      get(name: string): string | null {
        if (name.toLowerCase() === 'retry-after' && retryAfter !== undefined) return retryAfter;
        return null;
      },
    },
  };
}

/** Retry tests must not actually wait; pacing/backoff timing is injected. */
const noSleep = async (): Promise<void> => {};

function rawSha256(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

const FIXED_FETCHED_AT = '2026-07-23T04:05:06.789Z';
const fixedClock = () => new Date(FIXED_FETCHED_AT);

function candleRow(symbol: MarketSymbol, openTime: number, overrides: Record<string, unknown> = {}) {
  return {
    t: openTime,
    T: openTime + FOUR_HOUR_MS - 1,
    s: symbol,
    i: '4h',
    o: '100',
    h: '103',
    l: '98',
    c: '101',
    v: '12.5',
    n: 1,
    ...overrides,
  };
}

function fundingRow(coin: PerpAsset, time: number, fundingRate = '0.00001') {
  return { coin, time, fundingRate, premium: '0.001' };
}

function injectedFetch(
  handler: (body: Record<string, any>, call: number) => string | ReturnType<typeof response>,
): jest.MockedFunction<FourHourFetch> {
  let call = 0;
  return jest.fn(async (input, init) => {
    expect(input).toBe(HYPERLIQUID_INFO_ENDPOINT);
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({ 'content-type': 'application/json' });
    const result = handler(JSON.parse(init.body), call);
    call += 1;
    return typeof result === 'string' ? response(result) : result;
  });
}

const validSpotMeta = {
  tokens: [
    {
      name: 'USDC',
      szDecimals: 8,
      weiDecimals: 8,
      index: 0,
      tokenId: '0xusdc',
      isCanonical: true,
      evmContract: null,
      fullName: 'USD Coin',
    },
    {
      name: 'UBTC',
      szDecimals: 5,
      weiDecimals: 8,
      index: 197,
      tokenId: '0xubtc',
      isCanonical: false,
      evmContract: '0xbtc-contract',
      fullName: 'Unit Bitcoin',
    },
    {
      name: 'UETH',
      szDecimals: 4,
      weiDecimals: 8,
      index: 221,
      tokenId: '0xueth',
      isCanonical: false,
      evmContract: '0xeth-contract',
      fullName: 'Unit Ether',
    },
  ],
  universe: [
    { name: '@151', index: 151, tokens: [221, 0], isCanonical: false },
    { name: '@142', index: 142, tokens: [197, 0], isCanonical: false },
  ],
};

describe('four-hour Hyperliquid data adapter', () => {
  test('requests exact non-overlapping candle pages, hashes raw pages, and normalizes order', async () => {
    const startTime = 0;
    const expectedBars = 501;
    const rawPages: string[] = [];
    const clock = jest.fn()
      .mockReturnValueOnce(new Date('2026-07-23T04:05:06.001Z'))
      .mockReturnValueOnce(new Date('2026-07-23T04:05:06.002Z'));
    const fetchImpl = injectedFetch((body) => {
      expect(body.type).toBe('candleSnapshot');
      expect(body.req.coin).toBe('BTC');
      expect(body.req.interval).toBe('4h');
      const rows = (body.req.endTime - body.req.startTime + 1) / FOUR_HOUR_MS;
      const payload = Array.from({ length: rows }, (_, index) => (
        candleRow('BTC', body.req.startTime + index * FOUR_HOUR_MS)
      )).reverse();
      const raw = JSON.stringify(payload);
      rawPages.push(raw);
      return raw;
    });

    const result = await fetchFourHourCandles({
      symbol: 'BTC',
      startTime,
      endTime: startTime + expectedBars * FOUR_HOUR_MS,
      expectedBars,
    }, { fetchImpl, clock });

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body).req).toEqual({
      coin: 'BTC',
      interval: '4h',
      startTime,
      endTime: startTime + 500 * FOUR_HOUR_MS - 1,
    });
    expect(JSON.parse(fetchImpl.mock.calls[1][1].body).req).toEqual({
      coin: 'BTC',
      interval: '4h',
      startTime: startTime + 500 * FOUR_HOUR_MS,
      endTime: startTime + 501 * FOUR_HOUR_MS - 1,
    });
    expect(result.candles).toHaveLength(expectedBars);
    expect(result.candles[0].openTime).toBe(startTime);
    expect(result.candles.at(-1)?.closeTime).toBe(startTime + expectedBars * FOUR_HOUR_MS - 1);
    expect(result.pages).toEqual([
      expect.objectContaining({
        page: 1,
        responseRows: 500,
        acceptedRows: 500,
        rawResponseSha256: rawSha256(rawPages[0]),
        fetchedAt: '2026-07-23T04:05:06.001Z',
      }),
      expect.objectContaining({
        page: 2,
        responseRows: 1,
        acceptedRows: 1,
        rawResponseSha256: rawSha256(rawPages[1]),
        fetchedAt: '2026-07-23T04:05:06.002Z',
      }),
    ]);
    expect(clock).toHaveBeenCalledTimes(2);
  });

  test('rejects a non-official endpoint before issuing a request', async () => {
    const fetchImpl = jest.fn() as jest.MockedFunction<FourHourFetch>;
    await expect(fetchFourHourCandles({
      symbol: 'BTC',
      startTime: 0,
      endTime: FOUR_HOUR_MS,
      expectedBars: 1,
    }, { endpoint: 'https://example.com/info', fetchImpl, clock: fixedClock }))
      .rejects.toThrow('official Hyperliquid info endpoint');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  test('rejects an injected clock that cannot produce valid UTC provenance', async () => {
    const fetchImpl = injectedFetch(() => JSON.stringify([candleRow('BTC', 0)]));
    await expect(fetchFourHourCandles({
      symbol: 'BTC',
      startTime: 0,
      endTime: FOUR_HOUR_MS,
      expectedBars: 1,
    }, { fetchImpl, clock: () => new Date(Number.NaN) }))
      .rejects.toThrow('Clock must return a valid Date');
  });

  test('rejects HTTP, JSON, empty, short, duplicate, and gapped candle responses', async () => {
    const window = {
      symbol: 'BTC' as const,
      startTime: 0,
      endTime: 2 * FOUR_HOUR_MS,
      expectedBars: 2,
    };
    const cases: Array<[string, FourHourFetch, RegExp]> = [
      [
        'non-transient HTTP failure',
        injectedFetch(() => response('bad', { ok: false, status: 400, statusText: 'Bad Request' })),
        /failed 400 Bad Request/,
      ],
      ['malformed JSON', injectedFetch(() => '{'), /not valid JSON/],
      ['empty page', injectedFetch(() => '[]'), /empty or malformed/],
      ['short page', injectedFetch(() => JSON.stringify([candleRow('BTC', 0)])), /expected 2 rows/],
      [
        'duplicate',
        injectedFetch(() => JSON.stringify([candleRow('BTC', 0), candleRow('BTC', 0)])),
        /duplicate timestamp/,
      ],
      [
        'gap',
        injectedFetch(() => JSON.stringify([candleRow('BTC', 0), candleRow('BTC', 2 * FOUR_HOUR_MS)])),
        /gap or out-of-window/,
      ],
    ];
    for (const [label, fetchImpl, error] of cases) {
      await expect(fetchFourHourCandles(window, { fetchImpl, clock: fixedClock })).rejects.toThrow(error);
      expect(fetchImpl).toHaveBeenCalledTimes(1);
      expect(label).toBeTruthy();
    }
  });

  /*
   * Transient-failure handling exists because a canonical family snapshot is 151
   * requests against a 1200-weight-per-minute per-IP budget. Before this, a single 429
   * or 503 anywhere in that sequence aborted the whole acquisition. The snapshot is
   * one-shot and the specification forbids replacing data without new trial IDs, so a
   * partial fetch wastes the attempt rather than degrading.
   */
  describe('transient failure handling', () => {
    const window = {
      symbol: 'BTC' as const,
      startTime: 0,
      endTime: 2 * FOUR_HOUR_MS,
      expectedBars: 2,
    };
    const goodPage = () => JSON.stringify([candleRow('BTC', 0), candleRow('BTC', FOUR_HOUR_MS)]);

    test('retries a 429 and then succeeds, without altering the stored raw hash', async () => {
      let call = 0;
      const fetchImpl = jest.fn(async () => {
        call += 1;
        if (call === 1) return response('slow down', { ok: false, status: 429, statusText: 'Too Many Requests' });
        return response(goodPage());
      }) as unknown as jest.MockedFunction<FourHourFetch>;

      const result = await fetchFourHourCandles(window, { fetchImpl, clock: fixedClock, sleep: noSleep });

      expect(fetchImpl).toHaveBeenCalledTimes(2);
      expect(result.candles).toHaveLength(2);
      // The hash must cover only the successful response body.
      expect(result.pages[0].rawResponseSha256).toBe(rawSha256(goodPage()));
    });

    test('retries a 5xx and then succeeds', async () => {
      let call = 0;
      const fetchImpl = jest.fn(async () => {
        call += 1;
        if (call <= 2) return response('busy', { ok: false, status: 503, statusText: 'Unavailable' });
        return response(goodPage());
      }) as unknown as jest.MockedFunction<FourHourFetch>;

      const result = await fetchFourHourCandles(window, { fetchImpl, clock: fixedClock, sleep: noSleep });

      expect(fetchImpl).toHaveBeenCalledTimes(3);
      expect(result.candles).toHaveLength(2);
    });

    test('honours a Retry-After header instead of the default backoff', async () => {
      const waits: number[] = [];
      let call = 0;
      const fetchImpl = jest.fn(async () => {
        call += 1;
        if (call === 1) {
          return response('slow down', {
            ok: false, status: 429, statusText: 'Too Many Requests', retryAfter: '7',
          });
        }
        return response(goodPage());
      }) as unknown as jest.MockedFunction<FourHourFetch>;

      await fetchFourHourCandles(window, {
        fetchImpl,
        clock: fixedClock,
        sleep: async (ms: number) => { waits.push(ms); },
      });

      expect(waits).toContain(7000);
    });

    test('throws after exhausting attempts rather than returning partial data', async () => {
      const fetchImpl = injectedFetch(
        () => response('busy', { ok: false, status: 503, statusText: 'Unavailable' }),
      );

      await expect(fetchFourHourCandles(window, { fetchImpl, clock: fixedClock, sleep: noSleep }))
        .rejects.toThrow(/failed 503 Unavailable after 6 attempts/);
      expect(fetchImpl).toHaveBeenCalledTimes(6);
    });

    test('pacing is opt-in, so mocked transports are never delayed', async () => {
      const waits: number[] = [];
      const fetchImpl = injectedFetch(() => goodPage());

      await fetchFourHourCandles(window, {
        fetchImpl,
        clock: fixedClock,
        sleep: async (ms: number) => { waits.push(ms); },
      });

      expect(waits).toHaveLength(0);
    });

    test('pacing inserts a delay when explicitly enabled', async () => {
      const waits: number[] = [];
      const fetchImpl = injectedFetch(() => goodPage());

      await fetchFourHourCandles(window, {
        fetchImpl,
        clock: fixedClock,
        pacingEnabled: true,
        sleep: async (ms: number) => { waits.push(ms); },
      });
      await fetchFourHourCandles(window, {
        fetchImpl,
        clock: fixedClock,
        pacingEnabled: true,
        sleep: async (ms: number) => { waits.push(ms); },
      });

      // The second acquisition must be held back behind the shared pacer.
      expect(waits.some((ms) => ms > 0)).toBe(true);
    });
  });

  test('rejects invalid candle windows before fetching', async () => {
    const fetchImpl = jest.fn() as jest.MockedFunction<FourHourFetch>;
    await expect(fetchFourHourCandles({
      symbol: 'ETH',
      startTime: 1,
      endTime: FOUR_HOUR_MS,
      expectedBars: 1,
    }, { fetchImpl, clock: fixedClock })).rejects.toThrow(/aligned/);
    await expect(fetchFourHourCandles({
      symbol: 'ETH',
      startTime: 0,
      endTime: FOUR_HOUR_MS,
      expectedBars: 2,
    }, { fetchImpl, clock: fixedClock })).rejects.toThrow(/expectedBars mismatch/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  test('validates every candle identity, timestamp, price, volume, and OHLC invariant', () => {
    const valid = parseFourHourCandle(candleRow('ETH', 0), 'ETH');
    expect(valid).toEqual({
      symbol: 'ETH',
      interval: '4h',
      openTime: 0,
      closeTime: FOUR_HOUR_MS - 1,
      open: 100,
      high: 103,
      low: 98,
      close: 101,
      volume: 12.5,
    });

    const invalidRows: Array<[Record<string, unknown>, RegExp]> = [
      [candleRow('BTC', 0), /wrong symbol/],
      [candleRow('ETH', 0, { i: '1h' }), /wrong interval/],
      [candleRow('ETH', 0, { t: '0' }), /must be an integer/],
      [candleRow('ETH', 0, { T: FOUR_HOUR_MS }), /complete four-hour bar/],
      [candleRow('ETH', 0, { o: '0' }), /positive finite number/],
      [candleRow('ETH', 0, { h: 'Infinity' }), /positive finite number/],
      [candleRow('ETH', 0, { h: '100' }), /OHLC ordering/],
      [candleRow('ETH', 0, { l: '102' }), /OHLC ordering/],
      [candleRow('ETH', 0, { v: '-1' }), /volume cannot be negative/],
    ];
    for (const [row, error] of invalidRows) {
      expect(() => parseFourHourCandle(row, 'ETH')).toThrow(error);
    }
  });

  test('requests inclusive funding pages and rejects partial calendars', async () => {
    const expectedHours = 501;
    const rawPages: string[] = [];
    const clock = jest.fn()
      .mockReturnValueOnce(new Date('2026-07-23T05:00:00.001Z'))
      .mockReturnValueOnce(new Date('2026-07-23T05:00:00.002Z'));
    const fetchImpl = injectedFetch((body) => {
      expect(body.type).toBe('fundingHistory');
      expect(body.coin).toBe('ETH');
      const rows = (body.endTime - body.startTime) / HOUR_MS + 1;
      const raw = JSON.stringify(Array.from({ length: rows }, (_, index) => (
        fundingRow('ETH', body.startTime + index * HOUR_MS)
      )).reverse());
      rawPages.push(raw);
      return raw;
    });

    const result = await fetchHourlyFunding({
      coin: 'ETH',
      startTime: 0,
      endTime: 500 * HOUR_MS,
      expectedHours,
    }, { fetchImpl, clock });

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body)).toEqual({
      type: 'fundingHistory', coin: 'ETH', startTime: 0, endTime: 499 * HOUR_MS,
    });
    expect(JSON.parse(fetchImpl.mock.calls[1][1].body)).toEqual({
      type: 'fundingHistory', coin: 'ETH', startTime: 500 * HOUR_MS, endTime: 500 * HOUR_MS,
    });
    expect(result.funding).toHaveLength(expectedHours);
    expect(result.funding[0]).toEqual({ coin: 'ETH', time: 0, rate: 0.00001 });
    expect(result.funding.at(-1)?.time).toBe(500 * HOUR_MS);
    expect(result.pages.map((page) => page.rawResponseSha256)).toEqual(rawPages.map(rawSha256));
    expect(result.pages.map((page) => page.fetchedAt)).toEqual([
      '2026-07-23T05:00:00.001Z',
      '2026-07-23T05:00:00.002Z',
    ]);
    expect(clock).toHaveBeenCalledTimes(2);

    const partial = injectedFetch((body) => JSON.stringify([
      fundingRow('ETH', body.startTime),
    ]));
    await expect(fetchHourlyFunding({
      coin: 'ETH',
      startTime: 0,
      endTime: HOUR_MS,
      expectedHours: 2,
    }, { fetchImpl: partial, clock: fixedClock })).rejects.toThrow(/expected 2 rows/);
  });

  test('validates funding identity, exact UTC-hour timestamps, and finite rates', () => {
    expect(parseHourlyFunding(fundingRow('HYPE', 0, '-0.0002'), 'HYPE'))
      .toEqual({ coin: 'HYPE', time: 0, rate: -0.0002 });
    expect(() => parseHourlyFunding(fundingRow('BTC', 0), 'ETH')).toThrow(/wrong coin/);
    expect(() => parseHourlyFunding({ coin: 'BTC', time: '0', fundingRate: '0.1' }, 'BTC'))
      .toThrow(/must be an integer/);
    expect(() => parseHourlyFunding(fundingRow('BTC', 1), 'BTC')).toThrow(/UTC-hour aligned/);
    expect(() => parseHourlyFunding(fundingRow('BTC', 0, 'NaN'), 'BTC')).toThrow(/finite number/);
  });

  test('parses, reports, and hashes both frozen non-canonical wrapper mappings', async () => {
    const raw = JSON.stringify(validSpotMeta);
    const fetchImpl = injectedFetch((body) => {
      expect(body).toEqual({ type: 'spotMeta' });
      return raw;
    });
    const result = await fetchRelevantSpotMeta({ fetchImpl, clock: fixedClock });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(result.rawResponseSha256).toBe(rawSha256(raw));
    expect(result.fetchedAt).toBe(FIXED_FETCHED_AT);
    expect(Object.keys(result.pairs).sort()).toEqual(['@142', '@151']);
    expect(result.pairs['@142']).toEqual(expect.objectContaining({
      symbol: '@142',
      displayName: 'UBTC/USDC',
      index: 142,
      baseTokenIndex: 197,
      quoteTokenIndex: 0,
      wrapperMultiplier: 1,
      isCanonical: false,
    }));
    expect(result.pairs['@142']?.tokens[0]).toEqual(expect.objectContaining({
      index: 197,
      name: 'UBTC',
      szDecimals: 5,
      weiDecimals: 8,
      tokenId: '0xubtc',
      isCanonical: false,
      evmContract: '0xbtc-contract',
      fullName: 'Unit Bitcoin',
    }));
  });

  test('fails closed on spot pair identity, canonicality, token, or duplicate drift', () => {
    const clone = () => JSON.parse(JSON.stringify(validSpotMeta));
    const wrongPair = clone();
    wrongPair.universe[1].tokens = [221, 0];
    const canonicalPair = clone();
    canonicalPair.universe[1].isCanonical = true;
    const missingPair = clone();
    missingPair.universe.pop();
    const duplicatePair = clone();
    duplicatePair.universe.push({ ...duplicatePair.universe[1] });
    const duplicateToken = clone();
    duplicateToken.tokens[2].index = 197;
    const badDecimals = clone();
    badDecimals.tokens[1].szDecimals = 1.5;
    const badTokenId = clone();
    badTokenId.tokens[1].tokenId = '';

    const cases: Array<[unknown, RegExp]> = [
      [wrongPair, /no longer maps to UBTC\/USDC/],
      [canonicalPair, /must remain non-canonical/],
      [missingPair, /exactly one mapping/],
      [duplicatePair, /exactly one mapping/],
      [duplicateToken, /duplicate token index/],
      [badDecimals, /non-negative integer/],
      [badTokenId, /invalid tokenId/],
      [{ tokens: [], universe: null }, /token and universe arrays/],
    ];
    for (const [metadata, error] of cases) {
      expect(() => parseRelevantSpotMeta(metadata)).toThrow(error);
    }
  });

  test('frozen convenience fetchers use the preregistered windows without network access', async () => {
    const fetchImpl = injectedFetch((body) => {
      if (body.type === 'candleSnapshot') {
        const rows = (body.req.endTime - body.req.startTime + 1) / FOUR_HOUR_MS;
        return JSON.stringify(Array.from({ length: rows }, (_, index) => (
          candleRow(body.req.coin, body.req.startTime + index * FOUR_HOUR_MS)
        )));
      }
      const rows = (body.endTime - body.startTime) / HOUR_MS + 1;
      return JSON.stringify(Array.from({ length: rows }, (_, index) => (
        fundingRow(body.coin, body.startTime + index * HOUR_MS)
      )));
    });

    const [candles, funding] = await Promise.all([
      fetchFrozenFourHourCandles('HYPE', { fetchImpl, clock: fixedClock }),
      fetchFrozenHourlyFunding('HYPE', { fetchImpl, clock: fixedClock }),
    ]);
    expect(candles.candles).toHaveLength(3_562);
    expect(candles.pages).toHaveLength(8);
    expect(funding.funding).toHaveLength(14_248);
    expect(funding.pages).toHaveLength(29);
    expect(candles.pages.every((page) => page.fetchedAt === FIXED_FETCHED_AT)).toBe(true);
    expect(funding.pages.every((page) => page.fetchedAt === FIXED_FETCHED_AT)).toBe(true);
  });
});
