import { navigatorLock } from '@supabase/auth-js';

export const DEFAULT_AUTH_LOCK_TIMEOUT_MS = 30_000;

export type AuthLock = <R>(
  name: string,
  acquireTimeout: number,
  fn: () => Promise<R>
) => Promise<R>;

export const boundAuthLockTimeout = (
  requestedTimeout: number,
  maximumTimeout = DEFAULT_AUTH_LOCK_TIMEOUT_MS
) => requestedTimeout < 0
  ? maximumTimeout
  : Math.min(requestedTimeout, maximumTimeout);

export const createBoundedAuthLock = (
  baseLock: AuthLock = navigatorLock,
  isLockSupported = () => Boolean(globalThis.navigator?.locks),
  maximumTimeout = DEFAULT_AUTH_LOCK_TIMEOUT_MS
): AuthLock => async (name, requestedTimeout, fn) => {
  // Match auth-js's no-op fallback in browsers without the Web Locks API.
  if (!isLockSupported()) return fn();

  return baseLock(
    name,
    boundAuthLockTimeout(requestedTimeout, maximumTimeout),
    fn
  );
};

export const boundedNavigatorLock = createBoundedAuthLock();
