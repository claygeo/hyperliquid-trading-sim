import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ApiResponseError,
  ApiClient,
  AuthSessionChangedError,
  api,
} from './api';
import { useAccountStore } from '../hooks/useAccount';
import { usePositionsStore } from '../hooks/usePositions';

const account = {
  id: 'account-a',
  userId: 'user-a',
  balance: 100_000,
  initialBalance: 100_000,
  equity: 100_000,
  unrealizedPnl: 0,
  usedMargin: 0,
  availableMargin: 100_000,
  priceStale: false,
  resetCount: 0,
  createdAt: '2026-07-29T00:00:00.000Z',
};

const orderA = {
  asset: 'BTC',
  side: 'long' as const,
  size: 0.1,
  leverage: 5,
  expectedAccountResetCount: 0,
};

const orderB = {
  asset: 'ETH',
  side: 'short' as const,
  size: 1,
  leverage: 3,
  expectedAccountResetCount: 0,
};

const resetAccount = { ...account, resetCount: 1 };

const makePosition = (
  id: string,
  order: typeof orderA | typeof orderB
) => ({
  id,
  userId: 'user-a',
  asset: order.asset,
  side: order.side,
  entryPrice: 100,
  currentPrice: 100,
  size: order.size,
  leverage: order.leverage,
  margin: 2,
  liquidationPrice: 81,
  unrealizedPnl: 0,
  unrealizedPnlPercent: 0,
  realizedPnl: 0,
  status: 'open' as const,
  source: 'manual' as const,
  openedAt: '2026-07-29T00:00:00.000Z',
});

describe('authenticated API session isolation', () => {
  afterEach(() => {
    api.setToken(null);
    useAccountStore.getState().clear();
    usePositionsStore.getState().clear();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('rejects a private response after the active session changes', async () => {
    const client = new ApiClient('https://api.example.test');
    let resolveFetch!: (response: Response) => void;
    const fetchPromise = new Promise<Response>((resolve) => {
      resolveFetch = resolve;
    });
    vi.stubGlobal('fetch', vi.fn(() => fetchPromise));

    client.setToken('token-a', 'user-a');
    const request = client.getAccount();

    client.setToken(null);
    resolveFetch(Response.json(account));

    await expect(request).rejects.toBeInstanceOf(AuthSessionChangedError);
  });

  it('keeps an in-flight request valid across a token refresh for the same user', async () => {
    const client = new ApiClient('https://api.example.test');
    let resolveFetch!: (response: Response) => void;
    const fetchPromise = new Promise<Response>((resolve) => {
      resolveFetch = resolve;
    });
    vi.stubGlobal('fetch', vi.fn(() => fetchPromise));

    client.setToken('token-a1', 'user-a');
    const request = client.getAccount();

    client.setToken('token-a2', 'user-a');
    resolveFetch(Response.json(account));

    await expect(request).resolves.toEqual(account);
  });

  it('preserves the HTTP status on a received API error response', async () => {
    const client = new ApiClient('https://api.example.test');
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(Response.json(
      { error: 'Idempotency key is no longer valid' },
      { status: 409 }
    ))));
    client.setToken('token-a', 'user-a');

    const request = client.placeOrder(orderA, '00000000-0000-4000-8000-000000000001');

    await expect(request).rejects.toMatchObject({
      name: 'ApiResponseError',
      status: 409,
      message: 'Idempotency key is no longer valid',
    });
  });

  it('sends a reusable UUID idempotency key for order placement', async () => {
    const client = new ApiClient('https://api.example.test');
    const requestKey = '00000000-0000-4000-8000-000000000001';
    let headers: Headers | undefined;
    let body: string | undefined;
    vi.stubGlobal('fetch', vi.fn((_url: string | URL | Request, init?: RequestInit) => {
      headers = new Headers(init?.headers);
      body = init?.body as string | undefined;
      return Promise.resolve(Response.json({ id: 'position-a' }));
    }));

    client.setToken('token-a', 'user-a');
    await client.placeOrder({
      asset: 'BTC',
      side: 'long',
      size: 0.1,
      leverage: 5,
      expectedAccountResetCount: 7,
    }, requestKey);

    expect(headers?.get('Idempotency-Key')).toBe(requestKey);
    expect(JSON.parse(body!)).toMatchObject({ expectedAccountResetCount: 7 });
  });

  it('generates an idempotency key when the caller does not provide one', async () => {
    const client = new ApiClient('https://api.example.test');
    let headers: Headers | undefined;
    vi.stubGlobal('fetch', vi.fn((_url: string | URL | Request, init?: RequestInit) => {
      headers = new Headers(init?.headers);
      return Promise.resolve(Response.json({ id: 'position-a' }));
    }));

    client.setToken('token-a', 'user-a');
    await client.placeOrder({
      asset: 'BTC',
      side: 'long',
      size: 0.1,
      leverage: 5,
      expectedAccountResetCount: 0,
    });

    expect(headers?.get('Idempotency-Key')).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    );
  });

  it('does not let a stale account request overwrite replacement state', async () => {
    let rejectRequest!: (error: unknown) => void;
    const request = new Promise<never>((_resolve, reject) => {
      rejectRequest = reject;
    });
    vi.spyOn(api, 'getAccount').mockReturnValue(request);

    const fetchAccount = useAccountStore.getState().fetchAccount();
    const replacementAccount = { ...account, id: 'account-b', userId: 'user-b' };
    useAccountStore.setState({ account: replacementAccount, isLoading: false });
    rejectRequest(new AuthSessionChangedError());

    await fetchAccount;
    expect(useAccountStore.getState().account).toEqual(replacementAccount);
    expect(useAccountStore.getState().error).toBeNull();
  });

  it('does not let a stale positions request overwrite replacement state', async () => {
    let rejectRequest!: (error: unknown) => void;
    const request = new Promise<never>((_resolve, reject) => {
      rejectRequest = reject;
    });
    vi.spyOn(api, 'getPositions').mockReturnValue(request);

    const fetchPositions = usePositionsStore.getState().fetchPositions();
    const replacementPositions = [{
      id: 'position-b',
      userId: 'user-b',
      asset: 'BTC',
      side: 'long' as const,
      entryPrice: 100,
      currentPrice: 100,
      size: 1,
      leverage: 1,
      margin: 100,
      liquidationPrice: 0,
      unrealizedPnl: 0,
      unrealizedPnlPercent: 0,
      realizedPnl: 0,
      status: 'open' as const,
      source: 'manual' as const,
      openedAt: '2026-07-29T00:00:00.000Z',
    }];
    usePositionsStore.setState({ positions: replacementPositions, isLoading: false });
    rejectRequest(new AuthSessionChangedError());

    await fetchPositions;
    expect(usePositionsStore.getState().positions).toEqual(replacementPositions);
    expect(usePositionsStore.getState().error).toBeNull();
  });

  it('reuses an uncertain order key and does not duplicate the replayed position', async () => {
    const position = makePosition('position-a', orderA);
    const placeOrder = vi.spyOn(api, 'placeOrder')
      .mockRejectedValueOnce(new Error('Response lost'))
      .mockResolvedValue(position);

    await expect(usePositionsStore.getState().placeOrder(orderA)).rejects.toThrow('Response lost');
    const firstKey = placeOrder.mock.calls[0][1];

    await usePositionsStore.getState().placeOrder({ ...orderA, asset: ' btc ' });
    expect(placeOrder.mock.calls[1][1]).toBe(firstKey);
    expect(usePositionsStore.getState().positions).toEqual([position]);

    await usePositionsStore.getState().placeOrder(orderA, firstKey);
    expect(usePositionsStore.getState().positions).toEqual([position]);
  });

  it('does not let success under a different key erase an uncertain fingerprint', async () => {
    const positionA = makePosition('position-a', orderA);
    const explicitKey = '00000000-0000-4000-8000-000000000099';
    const placeOrder = vi.spyOn(api, 'placeOrder')
      .mockRejectedValueOnce(new Error('Response lost'))
      .mockResolvedValue(positionA);

    await expect(usePositionsStore.getState().placeOrder(orderA)).rejects.toThrow('Response lost');
    const uncertainKey = placeOrder.mock.calls[0][1];
    await usePositionsStore.getState().placeOrder(orderA, explicitKey);
    await usePositionsStore.getState().placeOrder(orderA);

    expect(uncertainKey).not.toBe(explicitKey);
    expect(placeOrder.mock.calls[2][1]).toBe(uncertainKey);
  });

  it('retains order A uncertainty when order B succeeds before A is retried', async () => {
    const positionA = makePosition('position-a', orderA);
    const positionB = makePosition('position-b', orderB);
    const placeOrder = vi.spyOn(api, 'placeOrder')
      .mockRejectedValueOnce(new Error('A response lost'))
      .mockResolvedValueOnce(positionB)
      .mockResolvedValueOnce(positionA);

    await expect(usePositionsStore.getState().placeOrder(orderA)).rejects.toThrow('A response lost');
    const keyA = placeOrder.mock.calls[0][1];
    await usePositionsStore.getState().placeOrder(orderB);
    const keyB = placeOrder.mock.calls[1][1];
    await usePositionsStore.getState().placeOrder(orderA);

    expect(keyB).not.toBe(keyA);
    expect(placeOrder.mock.calls[2][1]).toBe(keyA);
    expect(usePositionsStore.getState().positions).toEqual([positionB, positionA]);
  });

  it('retains independent uncertainty for A when both A and B fail', async () => {
    const positionA = makePosition('position-a', orderA);
    const placeOrder = vi.spyOn(api, 'placeOrder')
      .mockRejectedValueOnce(new Error('A response lost'))
      .mockRejectedValueOnce(new Error('B response lost'))
      .mockResolvedValueOnce(positionA);

    await expect(usePositionsStore.getState().placeOrder(orderA)).rejects.toThrow('A response lost');
    const keyA = placeOrder.mock.calls[0][1];
    await expect(usePositionsStore.getState().placeOrder(orderB)).rejects.toThrow('B response lost');
    const keyB = placeOrder.mock.calls[1][1];
    await usePositionsStore.getState().placeOrder(orderA);

    expect(keyB).not.toBe(keyA);
    expect(placeOrder.mock.calls[2][1]).toBe(keyA);
  });

  it('keeps concurrent A and B attempts isolated until both settle', async () => {
    const positionA = makePosition('position-a', orderA);
    const positionB = makePosition('position-b', orderB);
    let rejectA!: (error: unknown) => void;
    let resolveB!: (position: typeof positionB) => void;
    const placeOrder = vi.spyOn(api, 'placeOrder')
      .mockImplementationOnce(() => new Promise((_resolve, reject) => {
        rejectA = reject;
      }))
      .mockImplementationOnce(() => new Promise((resolve) => {
        resolveB = resolve;
      }));

    const attemptA = usePositionsStore.getState().placeOrder(orderA);
    const rejectedA = expect(attemptA).rejects.toThrow('A response lost');
    const attemptB = usePositionsStore.getState().placeOrder(orderB);
    const keyA = placeOrder.mock.calls[0][1];
    const keyB = placeOrder.mock.calls[1][1];
    expect(usePositionsStore.getState().isPlacingOrder).toBe(true);

    resolveB(positionB);
    await attemptB;
    expect(usePositionsStore.getState().isPlacingOrder).toBe(true);
    rejectA(new Error('A response lost'));
    await rejectedA;
    expect(usePositionsStore.getState().isPlacingOrder).toBe(false);

    placeOrder.mockResolvedValueOnce(positionA);
    await usePositionsStore.getState().placeOrder(orderA);
    expect(keyB).not.toBe(keyA);
    expect(placeOrder.mock.calls[2][1]).toBe(keyA);
  });

  it('forgets uncertain order keys when private auth state is cleared', async () => {
    const positionA = makePosition('position-a', orderA);
    const placeOrder = vi.spyOn(api, 'placeOrder')
      .mockRejectedValueOnce(new Error('Response lost'))
      .mockResolvedValueOnce(positionA);

    await expect(usePositionsStore.getState().placeOrder(orderA)).rejects.toThrow('Response lost');
    const oldKey = placeOrder.mock.calls[0][1];
    usePositionsStore.getState().clear();
    await usePositionsStore.getState().placeOrder(orderA);

    expect(placeOrder.mock.calls[1][1]).not.toBe(oldKey);
  });

  it('starts a fresh order generation after a successful account reset', async () => {
    const positionA = makePosition('position-a', orderA);
    const placeOrder = vi.spyOn(api, 'placeOrder')
      .mockRejectedValueOnce(new Error('Response lost'))
      .mockResolvedValueOnce(positionA);
    vi.spyOn(api, 'resetAccount').mockResolvedValue(resetAccount);

    await expect(usePositionsStore.getState().placeOrder(orderA)).rejects.toThrow('Response lost');
    const preResetKey = placeOrder.mock.calls[0][1];
    await useAccountStore.getState().resetAccount();
    await usePositionsStore.getState().placeOrder({
      ...orderA,
      expectedAccountResetCount: resetAccount.resetCount,
    });

    expect(placeOrder.mock.calls[1][1]).not.toBe(preResetKey);
    expect(usePositionsStore.getState().positions).toEqual([positionA]);
  });

  it('does not commit a delayed pre-reset order success after reset', async () => {
    const positionA = makePosition('position-a', orderA);
    let resolveOrder!: (position: typeof positionA) => void;
    vi.spyOn(api, 'placeOrder').mockReturnValue(new Promise((resolve) => {
      resolveOrder = resolve;
    }));
    vi.spyOn(api, 'resetAccount').mockResolvedValue(resetAccount);

    const oldOrder = usePositionsStore.getState().placeOrder(orderA);
    await useAccountStore.getState().resetAccount();
    resolveOrder(positionA);
    await oldOrder;

    expect(usePositionsStore.getState().positions).toEqual([]);
  });

  it('does not restore a delayed pre-reset order key after reset', async () => {
    const positionA = makePosition('position-a', orderA);
    let rejectOrder!: (error: unknown) => void;
    const placeOrder = vi.spyOn(api, 'placeOrder').mockReturnValueOnce(
      new Promise((_resolve, reject) => {
        rejectOrder = reject;
      })
    );
    vi.spyOn(api, 'resetAccount').mockResolvedValue(resetAccount);

    const oldOrder = usePositionsStore.getState().placeOrder(orderA);
    const oldOrderRejection = expect(oldOrder).rejects.toThrow('Old response lost');
    const oldKey = placeOrder.mock.calls[0][1];
    await useAccountStore.getState().resetAccount();
    rejectOrder(new Error('Old response lost'));
    await oldOrderRejection;

    placeOrder.mockResolvedValueOnce(positionA);
    await usePositionsStore.getState().placeOrder({
      ...orderA,
      expectedAccountResetCount: resetAccount.resetCount,
    });
    expect(placeOrder.mock.calls[1][1]).not.toBe(oldKey);
  });

  it('rotates an uncertain key after a stale reset-generation conflict', async () => {
    const positionA = makePosition('position-a', orderA);
    const placeOrder = vi.spyOn(api, 'placeOrder')
      .mockRejectedValueOnce(new Error('Response lost'))
      .mockRejectedValueOnce(new ApiResponseError(
        409,
        'Account reset generation changed. Expected: 0, Current: 1'
      ))
      .mockResolvedValueOnce(positionA);

    await expect(usePositionsStore.getState().placeOrder(orderA)).rejects.toThrow('Response lost');
    const uncertainKey = placeOrder.mock.calls[0][1];
    await expect(usePositionsStore.getState().placeOrder(orderA)).rejects.toThrow(
      'Account reset generation changed'
    );
    expect(placeOrder.mock.calls[1][1]).toBe(uncertainKey);

    // Retry the exact same fingerprint. This proves the 409 classifier deleted
    // the uncertain key instead of getting a free rotation from a new reset count.
    await usePositionsStore.getState().placeOrder(orderA);
    expect(placeOrder.mock.calls[2][1]).not.toBe(uncertainKey);
  });

  it('does not let pre-reset account or positions reads overwrite reset state', async () => {
    const oldAccount = { ...account, balance: 25_000, equity: 25_000 };
    const oldPosition = makePosition('position-old', orderA);
    let resolveAccount!: (value: typeof oldAccount) => void;
    let resolvePositions!: (value: typeof oldPosition[]) => void;
    vi.spyOn(api, 'getAccount').mockReturnValue(new Promise((resolve) => {
      resolveAccount = resolve;
    }));
    vi.spyOn(api, 'getPositions').mockReturnValue(new Promise((resolve) => {
      resolvePositions = resolve;
    }));
    vi.spyOn(api, 'resetAccount').mockResolvedValue(resetAccount);

    const accountRead = useAccountStore.getState().fetchAccount();
    const positionsRead = usePositionsStore.getState().fetchPositions();
    await useAccountStore.getState().resetAccount();
    resolveAccount(oldAccount);
    resolvePositions([oldPosition]);
    await Promise.all([accountRead, positionsRead]);

    expect(useAccountStore.getState().account).toEqual(resetAccount);
    expect(usePositionsStore.getState().positions).toEqual([]);
  });

  it('rotates an uncertain key after an explicit unusable-key response', async () => {
    const positionA = makePosition('position-a', orderA);
    const placeOrder = vi.spyOn(api, 'placeOrder')
      .mockRejectedValueOnce(new Error('Response lost'))
      .mockRejectedValueOnce(new ApiResponseError(400, 'Idempotency key belongs to a prior account reset'))
      .mockResolvedValueOnce(positionA);

    await expect(usePositionsStore.getState().placeOrder(orderA)).rejects.toThrow('Response lost');
    const uncertainKey = placeOrder.mock.calls[0][1];
    await expect(usePositionsStore.getState().placeOrder(orderA)).rejects.toThrow(
      'Idempotency key belongs to a prior account reset'
    );
    expect(placeOrder.mock.calls[1][1]).toBe(uncertainKey);

    await usePositionsStore.getState().placeOrder(orderA);
    expect(placeOrder.mock.calls[2][1]).not.toBe(uncertainKey);
  });

  it('retains an uncertain key for an ambiguous HTTP 400 execution failure', async () => {
    const positionA = makePosition('position-a', orderA);
    const placeOrder = vi.spyOn(api, 'placeOrder')
      .mockRejectedValueOnce(new ApiResponseError(400, 'Failed to execute order: fetch failed'))
      .mockResolvedValueOnce(positionA);

    await expect(usePositionsStore.getState().placeOrder(orderA)).rejects.toThrow(
      'Failed to execute order: fetch failed'
    );
    const uncertainKey = placeOrder.mock.calls[0][1];
    await usePositionsStore.getState().placeOrder(orderA);

    expect(placeOrder.mock.calls[1][1]).toBe(uncertainKey);
  });

  it('retains an uncertain key after a received 5xx response', async () => {
    const positionA = makePosition('position-a', orderA);
    const placeOrder = vi.spyOn(api, 'placeOrder')
      .mockRejectedValueOnce(new ApiResponseError(503, 'Service unavailable'))
      .mockResolvedValueOnce(positionA);

    await expect(usePositionsStore.getState().placeOrder(orderA)).rejects.toThrow(
      'Service unavailable'
    );
    const uncertainKey = placeOrder.mock.calls[0][1];
    await usePositionsStore.getState().placeOrder(orderA);

    expect(placeOrder.mock.calls[1][1]).toBe(uncertainKey);
  });

  it('bounds retained uncertainty and evicts the least recently failed fingerprint', async () => {
    const placeOrder = vi.spyOn(api, 'placeOrder').mockRejectedValue(new Error('Response lost'));
    let firstKey: string | undefined;

    for (let index = 0; index <= 50; index += 1) {
      const order = { ...orderA, asset: `ASSET-${index}` };
      await expect(usePositionsStore.getState().placeOrder(order)).rejects.toThrow('Response lost');
      if (index === 0) firstKey = placeOrder.mock.calls[0][1];
    }

    placeOrder.mockResolvedValueOnce(makePosition('position-first', orderA));
    await usePositionsStore.getState().placeOrder({ ...orderA, asset: 'ASSET-0' });
    expect(placeOrder.mock.calls[51][1]).not.toBe(firstKey);
  });
});
