import { afterEach, describe, expect, it, vi } from 'vitest';
import { createFetchWithTimeout } from './fetchWithTimeout';

const pendingFetch = () => vi.fn<typeof fetch>((_input, init) => new Promise<Response>((_resolve, reject) => {
  init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true });
}));

describe('createFetchWithTimeout', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('aborts a request that exceeds the configured timeout', async () => {
    vi.useFakeTimers();
    const baseFetch = pendingFetch();
    const request = createFetchWithTimeout(baseFetch, 100)('https://example.test');
    const rejection = expect(request).rejects.toMatchObject({ name: 'TimeoutError' });

    await vi.advanceTimersByTimeAsync(100);

    await rejection;
    expect(baseFetch).toHaveBeenCalledOnce();
  });

  it('forwards a caller abort to the underlying request', async () => {
    const baseFetch = pendingFetch();
    const caller = new AbortController();
    const reason = new DOMException('Caller stopped', 'AbortError');
    const request = createFetchWithTimeout(baseFetch, 30_000)(
      'https://example.test',
      { signal: caller.signal }
    );

    caller.abort(reason);

    await expect(request).rejects.toBe(reason);
  });

  it('clears the timeout after a successful response', async () => {
    vi.useFakeTimers();
    let forwardedSignal: AbortSignal | null | undefined;
    const response = new Response(null, { status: 204 });
    const baseFetch = vi.fn<typeof fetch>(async (_input, init) => {
      forwardedSignal = init?.signal;
      return response;
    });

    await expect(
      createFetchWithTimeout(baseFetch, 100)('https://example.test')
    ).resolves.toBe(response);
    await vi.advanceTimersByTimeAsync(100);

    expect(forwardedSignal?.aborted).toBe(false);
  });
});
