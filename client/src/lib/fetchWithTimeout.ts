export const DEFAULT_SUPABASE_REQUEST_TIMEOUT_MS = 30_000;

export const createFetchWithTimeout = (
  baseFetch: typeof fetch,
  timeoutMs = DEFAULT_SUPABASE_REQUEST_TIMEOUT_MS
): typeof fetch => async (input, init) => {
  const controller = new AbortController();
  const requestSignal = init?.signal
    ?? (typeof Request !== 'undefined' && input instanceof Request ? input.signal : undefined);
  const forwardAbort = () => controller.abort(requestSignal?.reason);

  if (requestSignal?.aborted) {
    forwardAbort();
  } else {
    requestSignal?.addEventListener('abort', forwardAbort, { once: true });
  }

  const timeout = setTimeout(() => {
    controller.abort(new DOMException('Supabase request timed out', 'TimeoutError'));
  }, timeoutMs);

  try {
    return await baseFetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
    requestSignal?.removeEventListener('abort', forwardAbort);
  }
};
