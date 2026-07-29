import { describe, expect, it, vi } from 'vitest';
import {
  boundAuthLockTimeout,
  createBoundedAuthLock,
  type AuthLock,
} from './authLock';

describe('bounded auth lock', () => {
  it('replaces an unlimited wait and clamps an excessive positive wait', () => {
    expect(boundAuthLockTimeout(-1, 5_000)).toBe(5_000);
    expect(boundAuthLockTimeout(10_000, 5_000)).toBe(5_000);
    expect(boundAuthLockTimeout(1_000, 5_000)).toBe(1_000);
    expect(boundAuthLockTimeout(0, 5_000)).toBe(0);
  });

  it('passes the bounded timeout to the supported platform lock', async () => {
    const calls: Array<{ name: string; timeout: number }> = [];
    const baseLock: AuthLock = async <R>(name: string, timeout: number, fn: () => Promise<R>) => {
      calls.push({ name, timeout });
      return fn();
    };
    const lock = createBoundedAuthLock(baseLock, () => true, 5_000);

    await expect(lock('auth', -1, async () => 'done')).resolves.toBe('done');

    expect(calls).toEqual([{ name: 'auth', timeout: 5_000 }]);
  });

  it('uses the no-lock fallback when Web Locks are unavailable', async () => {
    let baseLockCalled = false;
    const baseLock: AuthLock = async <R>(
      _name: string,
      _timeout: number,
      fn: () => Promise<R>
    ) => {
      baseLockCalled = true;
      return fn();
    };
    const operation = vi.fn(async () => 'done');
    const lock = createBoundedAuthLock(baseLock, () => false);

    await expect(lock('auth', -1, operation)).resolves.toBe('done');

    expect(operation).toHaveBeenCalledOnce();
    expect(baseLockCalled).toBe(false);
  });
});
