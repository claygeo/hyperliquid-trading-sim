import { beforeEach, describe, expect, it, vi } from 'vitest';

const supabaseMocks = vi.hoisted(() => {
  const mocks = {
    authCallback: null as ((event: string, session: any) => void) | null,
    getSession: vi.fn(),
    onAuthStateChange: vi.fn((callback: (event: string, session: any) => void) => {
      mocks.authCallback = callback;
      return { data: { subscription: { unsubscribe: vi.fn() } } };
    }),
    signInWithPassword: vi.fn(),
    signUp: vi.fn(),
    signOut: vi.fn(),
    from: vi.fn(),
  };
  return mocks;
});

vi.mock('../config', () => ({
  config: {
    apiUrl: 'https://api.example.test',
    wsUrl: 'wss://api.example.test/ws',
    supabaseUrl: 'https://project.example.test',
    supabaseAnonKey: 'anon-key',
    enableSyntheticEmailSignup: false,
  },
}));

vi.mock('../lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: supabaseMocks.getSession,
      onAuthStateChange: supabaseMocks.onAuthStateChange,
      signInWithPassword: supabaseMocks.signInWithPassword,
      signUp: supabaseMocks.signUp,
      signOut: supabaseMocks.signOut,
    },
    from: supabaseMocks.from,
  },
}));

import { api } from '../lib/api';
import { useAccountStore } from './useAccount';
import { AuthOperationSupersededError, useAuthStore } from './useAuth';
import { usePositionsStore } from './usePositions';

const initialAuthState = {
  user: null,
  profile: null,
  isAuthenticated: false,
  isLoading: false,
  error: null,
};

const makeSession = (userId: string, username: string, accessToken: string) => ({
  access_token: accessToken,
  user: {
    id: userId,
    email: `${username}@hypersim.local`,
    created_at: '2026-07-29T00:00:00.000Z',
    user_metadata: { username },
  },
});

const makeProfile = (userId: string, username: string) => ({
  id: `profile-${userId}`,
  user_id: userId,
  username,
  created_at: '2026-07-29T00:00:00.000Z',
});

const accountA = {
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

const positionA = {
  id: 'position-a',
  userId: 'user-a',
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
};

const initializeWithoutSession = async () => {
  supabaseMocks.getSession.mockResolvedValue({ data: { session: null } });
  await useAuthStore.getState().initialize();
  expect(supabaseMocks.authCallback).not.toBeNull();
};

const mockProfile = (profile: ReturnType<typeof makeProfile>) => {
  const query = {
    select: vi.fn(() => query),
    eq: vi.fn(() => query),
    single: vi.fn().mockResolvedValue({ data: profile, error: null }),
  };
  supabaseMocks.from.mockReturnValue(query);
  return query;
};

describe('auth lifecycle isolation', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    supabaseMocks.authCallback = null;
    api.setToken(null, null);
    useAuthStore.setState(initialAuthState);
    useAccountStore.getState().clear();
    usePositionsStore.getState().clear();
  });

  it('blocks synthetic-email signup unless the deployment explicitly enables it', async () => {
    await expect(
      useAuthStore.getState().register('clayton', 'password123')
    ).rejects.toThrow(/registration is disabled/i);

    expect(supabaseMocks.signUp).not.toHaveBeenCalled();
    expect(useAuthStore.getState().error).toMatch(/registration is disabled/i);
  });

  it('checks a returned sign-out error while clearing private client state', async () => {
    useAuthStore.setState({
      user: {
        id: 'user-a',
        email: 'clayton@hypersim.local',
        username: 'clayton',
        createdAt: '2026-07-29T00:00:00.000Z',
      },
      isAuthenticated: true,
    });
    useAccountStore.setState({ account: accountA });
    api.setToken('token-a', 'user-a');
    supabaseMocks.signOut.mockResolvedValue({
      error: new Error('Remote session revocation failed'),
    });

    await expect(useAuthStore.getState().logout()).rejects.toThrow(
      'Remote session revocation failed'
    );

    expect(useAuthStore.getState()).toMatchObject({
      user: null,
      profile: null,
      isAuthenticated: false,
      isLoading: false,
      error: 'Remote session revocation failed',
    });
    expect(useAccountStore.getState().account).toBeNull();
    expect(usePositionsStore.getState().positions).toEqual([]);
    expect(supabaseMocks.signOut).toHaveBeenCalledWith({ scope: 'global' });
  });

  it('does not commit a login response superseded by logout', async () => {
    let resolveLogin!: (value: unknown) => void;
    supabaseMocks.signInWithPassword.mockReturnValue(
      new Promise((resolve) => {
        resolveLogin = resolve;
      })
    );
    supabaseMocks.signOut.mockResolvedValue({ error: null });

    const login = useAuthStore.getState().login('clayton', 'password123');
    const logout = useAuthStore.getState().logout();
    resolveLogin({
      data: {
        user: {
          id: 'user-a',
          email: 'clayton@hypersim.local',
          created_at: '2026-07-29T00:00:00.000Z',
          user_metadata: { username: 'clayton' },
        },
        session: { access_token: 'token-a' },
      },
      error: null,
    });

    const [loginResult, logoutResult] = await Promise.allSettled([login, logout]);

    expect(loginResult).toMatchObject({
      status: 'rejected',
      reason: expect.any(AuthOperationSupersededError),
    });
    expect(logoutResult).toEqual({ status: 'fulfilled', value: undefined });

    expect(useAuthStore.getState()).toMatchObject({
      user: null,
      profile: null,
      isAuthenticated: false,
      isLoading: false,
    });
    expect(supabaseMocks.from).not.toHaveBeenCalled();
  });

  it('keeps logout active until a delayed login session is removed from the provider', async () => {
    await initializeWithoutSession();
    const sessionA = makeSession('user-a', 'clayton', 'token-a');
    const profileQuery = mockProfile(makeProfile('user-a', 'clayton'));
    const setToken = vi.spyOn(api, 'setToken');
    setToken.mockClear();

    let finishLogin!: () => void;
    supabaseMocks.signInWithPassword.mockReturnValue(
      new Promise((resolve) => {
        finishLogin = () => {
          // Supabase persists the session and emits this callback before the
          // signInWithPassword promise gives control back to the caller.
          supabaseMocks.authCallback?.('SIGNED_IN', sessionA);
          resolve({
            data: { user: sessionA.user, session: sessionA },
            error: null,
          });
        };
      })
    );
    let initialSignOutCompleted = false;
    supabaseMocks.signOut.mockImplementation(async () => {
      supabaseMocks.authCallback?.('SIGNED_OUT', null);
      initialSignOutCompleted = true;
      return { error: null };
    });

    const login = useAuthStore.getState().login('clayton', 'password123');
    const logout = useAuthStore.getState().logout();
    let logoutSettled = false;
    void logout.finally(() => {
      logoutSettled = true;
    });

    await vi.waitFor(() => expect(supabaseMocks.signOut).toHaveBeenCalledOnce());
    await Promise.resolve();
    await Promise.resolve();
    expect(initialSignOutCompleted).toBe(true);
    const logoutWasSettledBeforeLateSession = logoutSettled;

    finishLogin();
    const [loginResult, logoutResult] = await Promise.allSettled([login, logout]);

    expect(loginResult).toMatchObject({
      status: 'rejected',
      reason: expect.any(AuthOperationSupersededError),
    });
    expect(logoutResult).toEqual({ status: 'fulfilled', value: undefined });
    expect(logoutWasSettledBeforeLateSession).toBe(false);
    expect(supabaseMocks.signOut).toHaveBeenCalledTimes(2);
    expect(profileQuery.single).not.toHaveBeenCalled();
    expect(setToken).not.toHaveBeenCalledWith('token-a', 'user-a');
    expect(setToken).toHaveBeenLastCalledWith(null, null);
    expect(useAuthStore.getState()).toMatchObject({
      user: null,
      profile: null,
      isAuthenticated: false,
      isLoading: false,
      error: null,
    });
  });

  it('starts a newer login only after logout removes a delayed prior session', async () => {
    await initializeWithoutSession();
    const sessionA = makeSession('user-a', 'clayton', 'token-a');
    const setToken = vi.spyOn(api, 'setToken');
    setToken.mockClear();

    let finishFirstLogin!: () => void;
    supabaseMocks.signInWithPassword
      .mockReturnValueOnce(
        new Promise((resolve) => {
          finishFirstLogin = () => {
            supabaseMocks.authCallback?.('SIGNED_IN', sessionA);
            resolve({
              data: { user: sessionA.user, session: sessionA },
              error: null,
            });
          };
        })
      )
      .mockResolvedValueOnce({
        data: { user: null, session: null },
        error: new Error('Invalid login credentials'),
      });
    supabaseMocks.signOut.mockImplementation(async () => {
      supabaseMocks.authCallback?.('SIGNED_OUT', null);
      return { error: null };
    });

    const firstLogin = useAuthStore.getState().login('clayton', 'password123');
    const logout = useAuthStore.getState().logout();
    const newerLogin = useAuthStore.getState().login('brooke', 'password456');

    await vi.waitFor(() => expect(supabaseMocks.signOut).toHaveBeenCalledOnce());
    expect(supabaseMocks.signInWithPassword).toHaveBeenCalledOnce();

    finishFirstLogin();
    const [firstLoginResult, logoutResult, newerLoginResult] = await Promise.allSettled([
      firstLogin,
      logout,
      newerLogin,
    ]);

    expect(firstLoginResult).toMatchObject({
      status: 'rejected',
      reason: expect.any(AuthOperationSupersededError),
    });
    expect(logoutResult).toEqual({ status: 'fulfilled', value: undefined });
    expect(newerLoginResult).toMatchObject({
      status: 'rejected',
      reason: expect.objectContaining({ message: 'Invalid username or password' }),
    });
    // Logout clears the pre-existing and late sessions; the queued login then
    // performs its own clean-slate sign-out before attempting new credentials.
    expect(supabaseMocks.signOut).toHaveBeenCalledTimes(3);
    expect(supabaseMocks.signInWithPassword).toHaveBeenCalledTimes(2);
    expect(supabaseMocks.from).not.toHaveBeenCalled();
    expect(setToken).not.toHaveBeenCalledWith('token-a', 'user-a');
    expect(setToken).toHaveBeenLastCalledWith(null, null);
    expect(useAuthStore.getState()).toMatchObject({
      user: null,
      profile: null,
      isAuthenticated: false,
      isLoading: false,
      error: 'Invalid username or password',
    });
  });

  it('keeps a login behind every logout already queued ahead of it', async () => {
    await initializeWithoutSession();
    const finishSignOuts: Array<() => void> = [];
    supabaseMocks.signOut.mockImplementation(() => new Promise((resolve) => {
      finishSignOuts.push(() => resolve({ error: null }));
    }));
    supabaseMocks.signInWithPassword.mockResolvedValue({
      data: { user: null, session: null },
      error: new Error('Invalid login credentials'),
    });

    const firstLogout = useAuthStore.getState().logout();
    await vi.waitFor(() => expect(supabaseMocks.signOut).toHaveBeenCalledOnce());

    const secondLogout = useAuthStore.getState().logout();
    const queuedLogin = useAuthStore.getState().login('brooke', 'password456');
    expect(supabaseMocks.signInWithPassword).not.toHaveBeenCalled();

    finishSignOuts[0]();
    await vi.waitFor(() => expect(supabaseMocks.signOut).toHaveBeenCalledTimes(2));
    expect(supabaseMocks.signInWithPassword).not.toHaveBeenCalled();

    finishSignOuts[1]();
    const [firstLogoutResult, secondLogoutResult, queuedLoginResult] = await Promise.allSettled([
      firstLogout,
      secondLogout,
      queuedLogin,
    ]);

    expect(firstLogoutResult).toEqual({ status: 'fulfilled', value: undefined });
    expect(secondLogoutResult).toEqual({ status: 'fulfilled', value: undefined });
    expect(queuedLoginResult).toMatchObject({
      status: 'rejected',
      reason: expect.objectContaining({ message: 'Invalid username or password' }),
    });
    expect(supabaseMocks.signInWithPassword).toHaveBeenCalledOnce();
  });

  it('does not start an earlier queued login after a newer logout', async () => {
    await initializeWithoutSession();
    const finishSignOuts: Array<() => void> = [];
    supabaseMocks.signOut.mockImplementation(() => new Promise((resolve) => {
      finishSignOuts.push(() => resolve({ error: null }));
    }));
    supabaseMocks.signInWithPassword.mockResolvedValue({
      data: { user: null, session: null },
      error: new Error('Invalid login credentials'),
    });

    const firstLogout = useAuthStore.getState().logout();
    await vi.waitFor(() => expect(supabaseMocks.signOut).toHaveBeenCalledOnce());

    const queuedLogin = useAuthStore.getState().login('brooke', 'password456');
    const newerLogout = useAuthStore.getState().logout();

    finishSignOuts[0]();
    await vi.waitFor(() => expect(supabaseMocks.signOut).toHaveBeenCalledTimes(2));
    expect(supabaseMocks.signInWithPassword).not.toHaveBeenCalled();

    finishSignOuts[1]();
    const [firstLogoutResult, queuedLoginResult, newerLogoutResult] = await Promise.allSettled([
      firstLogout,
      queuedLogin,
      newerLogout,
    ]);

    expect(firstLogoutResult).toEqual({ status: 'fulfilled', value: undefined });
    expect(queuedLoginResult).toMatchObject({
      status: 'rejected',
      reason: expect.any(AuthOperationSupersededError),
    });
    expect(newerLogoutResult).toEqual({ status: 'fulfilled', value: undefined });
    expect(supabaseMocks.signInWithPassword).not.toHaveBeenCalled();
    expect(useAuthStore.getState()).toMatchObject({
      user: null,
      profile: null,
      isAuthenticated: false,
      isLoading: false,
      error: null,
    });
  });

  it('clears an earlier successful provider session before a newer login fails', async () => {
    await initializeWithoutSession();
    const sessionA = makeSession('user-a', 'clayton', 'token-a');
    const setToken = vi.spyOn(api, 'setToken');
    setToken.mockClear();

    let finishFirstLogin!: () => void;
    supabaseMocks.signInWithPassword
      .mockReturnValueOnce(new Promise((resolve) => {
        finishFirstLogin = () => {
          supabaseMocks.authCallback?.('SIGNED_IN', sessionA);
          resolve({ data: { user: sessionA.user, session: sessionA }, error: null });
        };
      }))
      .mockResolvedValueOnce({
        data: { user: null, session: null },
        error: new Error('Invalid login credentials'),
      });
    supabaseMocks.signOut.mockImplementation(async () => {
      supabaseMocks.authCallback?.('SIGNED_OUT', null);
      return { error: null };
    });

    const firstLogin = useAuthStore.getState().login('clayton', 'password123');
    const newerLogin = useAuthStore.getState().login('brooke', 'password456');
    expect(supabaseMocks.signInWithPassword).toHaveBeenCalledOnce();

    finishFirstLogin();
    const [firstLoginResult, newerLoginResult] = await Promise.allSettled([
      firstLogin,
      newerLogin,
    ]);

    expect(firstLoginResult).toMatchObject({
      status: 'rejected',
      reason: expect.any(AuthOperationSupersededError),
    });
    expect(newerLoginResult).toMatchObject({
      status: 'rejected',
      reason: expect.objectContaining({ message: 'Invalid username or password' }),
    });
    expect(supabaseMocks.signOut).toHaveBeenCalledOnce();
    expect(supabaseMocks.signOut).toHaveBeenCalledWith({ scope: 'local' });
    expect(supabaseMocks.signInWithPassword).toHaveBeenCalledTimes(2);
    expect(supabaseMocks.from).not.toHaveBeenCalled();
    expect(setToken).not.toHaveBeenCalledWith('token-a', 'user-a');
    expect(setToken).toHaveBeenLastCalledWith(null, null);
    expect(useAuthStore.getState()).toMatchObject({
      user: null,
      profile: null,
      isAuthenticated: false,
      isLoading: false,
      error: 'Invalid username or password',
    });
  });

  it('does not let the SIGNED_IN event emitted by login supersede that login', async () => {
    await initializeWithoutSession();
    const sessionA = makeSession('user-a', 'clayton', 'token-a');
    const profileQuery = mockProfile(makeProfile('user-a', 'clayton'));
    supabaseMocks.signInWithPassword.mockImplementation(async () => {
      supabaseMocks.authCallback?.('SIGNED_IN', sessionA);
      return {
        data: { user: sessionA.user, session: sessionA },
        error: null,
      };
    });

    await useAuthStore.getState().login('clayton', 'password123');

    expect(useAuthStore.getState()).toMatchObject({
      user: { id: 'user-a', username: 'clayton' },
      profile: { userId: 'user-a' },
      isAuthenticated: true,
      isLoading: false,
    });
    expect(profileQuery.single).toHaveBeenCalledOnce();
  });

  it('does not let the SIGNED_OUT event emitted by logout supersede that logout', async () => {
    await initializeWithoutSession();
    useAuthStore.setState({
      user: {
        id: 'user-a',
        email: 'clayton@hypersim.local',
        username: 'clayton',
        createdAt: '2026-07-29T00:00:00.000Z',
      },
      isAuthenticated: true,
    });
    api.setToken('token-a', 'user-a');
    supabaseMocks.signOut.mockImplementation(async () => {
      supabaseMocks.authCallback?.('SIGNED_OUT', null);
      return { error: null };
    });

    await useAuthStore.getState().logout();

    expect(useAuthStore.getState()).toMatchObject({
      user: null,
      profile: null,
      isAuthenticated: false,
      isLoading: false,
      error: null,
    });
  });

  it('does not restore an initializing session after a sign-out event', async () => {
    let resolveProfile!: (value: unknown) => void;
    const profileQuery = {
      select: vi.fn(() => profileQuery),
      eq: vi.fn(() => profileQuery),
      single: vi.fn(() => new Promise((resolve) => {
        resolveProfile = resolve;
      })),
    };
    supabaseMocks.from.mockReturnValue(profileQuery);
    supabaseMocks.getSession.mockResolvedValue({
      data: {
        session: {
          access_token: 'token-a',
          user: {
            id: 'user-a',
            email: 'clayton@hypersim.local',
            created_at: '2026-07-29T00:00:00.000Z',
            user_metadata: { username: 'clayton' },
          },
        },
      },
    });

    const initialize = useAuthStore.getState().initialize();
    await vi.waitFor(() => expect(profileQuery.single).toHaveBeenCalled());
    supabaseMocks.authCallback?.('SIGNED_OUT', null);
    resolveProfile({
      data: {
        id: 'profile-a',
        user_id: 'user-a',
        username: 'clayton',
        created_at: '2026-07-29T00:00:00.000Z',
      },
    });

    await initialize;

    expect(useAuthStore.getState()).toMatchObject({
      user: null,
      profile: null,
      isAuthenticated: false,
      isLoading: false,
    });
  });

  it('clears user A before hydrating a SIGNED_IN event for user B', async () => {
    await initializeWithoutSession();
    const sessionB = makeSession('user-b', 'brooke', 'token-b');
    const profileB = makeProfile('user-b', 'brooke');
    const profileQuery = mockProfile(profileB);

    useAuthStore.setState({
      user: {
        id: 'user-a',
        email: 'clayton@hypersim.local',
        username: 'clayton',
        createdAt: '2026-07-29T00:00:00.000Z',
      },
      profile: {
        id: 'profile-user-a',
        userId: 'user-a',
        username: 'clayton',
        createdAt: '2026-07-29T00:00:00.000Z',
      },
      isAuthenticated: true,
    });
    useAccountStore.setState({ account: accountA });
    usePositionsStore.setState({ positions: [positionA] });
    api.setToken('token-a', 'user-a');
    const setToken = vi.spyOn(api, 'setToken');
    setToken.mockClear();

    supabaseMocks.authCallback?.('SIGNED_IN', sessionB);

    expect(useAuthStore.getState()).toMatchObject({
      user: null,
      profile: null,
      isAuthenticated: false,
      isLoading: true,
    });
    expect(useAccountStore.getState().account).toBeNull();
    expect(usePositionsStore.getState().positions).toEqual([]);
    expect(setToken).toHaveBeenCalledWith(null, null);
    expect(setToken).not.toHaveBeenCalledWith('token-b', 'user-b');

    await vi.waitFor(() => expect(profileQuery.single).toHaveBeenCalled());
    await vi.waitFor(() => expect(useAuthStore.getState().user?.id).toBe('user-b'));

    expect(useAuthStore.getState()).toMatchObject({
      user: { id: 'user-b', username: 'brooke' },
      profile: { userId: 'user-b', username: 'brooke' },
      isAuthenticated: true,
      isLoading: false,
    });
    expect(setToken).toHaveBeenLastCalledWith('token-b', 'user-b');
  });

  it('hydrates a new SIGNED_IN session that arrives after logout completes', async () => {
    await initializeWithoutSession();
    useAuthStore.setState({
      user: {
        id: 'user-a',
        email: 'clayton@hypersim.local',
        username: 'clayton',
        createdAt: '2026-07-29T00:00:00.000Z',
      },
      isAuthenticated: true,
    });
    api.setToken('token-a', 'user-a');
    supabaseMocks.signOut.mockResolvedValue({ error: null });

    await useAuthStore.getState().logout();
    expect(useAuthStore.getState().isAuthenticated).toBe(false);

    const sessionB = makeSession('user-b', 'brooke', 'token-b');
    mockProfile(makeProfile('user-b', 'brooke'));
    supabaseMocks.authCallback?.('SIGNED_IN', sessionB);

    await vi.waitFor(() => expect(useAuthStore.getState().user?.id).toBe('user-b'));
    expect(useAuthStore.getState()).toMatchObject({
      user: { id: 'user-b', username: 'brooke' },
      profile: { userId: 'user-b' },
      isAuthenticated: true,
      isLoading: false,
    });
  });

  it('rotates a same-user TOKEN_REFRESHED credential without clearing private state', async () => {
    await initializeWithoutSession();
    const userA = {
      id: 'user-a',
      email: 'clayton@hypersim.local',
      username: 'clayton',
      createdAt: '2026-07-29T00:00:00.000Z',
    };
    const profileA = {
      id: 'profile-user-a',
      userId: 'user-a',
      username: 'clayton',
      createdAt: '2026-07-29T00:00:00.000Z',
    };
    useAuthStore.setState({ user: userA, profile: profileA, isAuthenticated: true });
    useAccountStore.setState({ account: accountA });
    usePositionsStore.setState({ positions: [positionA] });
    api.setToken('token-a1', 'user-a');
    const setToken = vi.spyOn(api, 'setToken');
    setToken.mockClear();

    supabaseMocks.authCallback?.(
      'TOKEN_REFRESHED',
      makeSession('user-a', 'clayton', 'token-a2')
    );

    expect(setToken).toHaveBeenCalledOnce();
    expect(setToken).toHaveBeenCalledWith('token-a2', 'user-a');
    expect(useAuthStore.getState().user).toBe(userA);
    expect(useAuthStore.getState().profile).toBe(profileA);
    expect(useAccountStore.getState().account).toBe(accountA);
    expect(usePositionsStore.getState().positions).toEqual([positionA]);
    expect(supabaseMocks.from).not.toHaveBeenCalled();
  });
});
