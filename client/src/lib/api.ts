import { config } from '../config';
import type {
  Account,
  Position,
  PlaceOrderRequest,
  TradeHistory,
} from '../types/trading';
import type { LeaderboardEntry, UserStats } from '../types/user';
import type { Candle } from '../types/market';
import type { Asset } from '../config/assets';

export class AuthSessionChangedError extends Error {
  constructor() {
    super('Authenticated session changed while the request was in flight');
    this.name = 'AuthSessionChangedError';
  }
}

export const isAuthSessionChangedError = (
  error: unknown
): error is AuthSessionChangedError => error instanceof AuthSessionChangedError;

export class ApiResponseError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'ApiResponseError';
    this.status = status;
  }
}

const UNUSABLE_IDEMPOTENCY_KEY_ERROR = /(?:valid UUID Idempotency-Key|invalid idempotency key|Idempotency key reused with different order parameters|Idempotency key belongs to a prior account reset|Account reset generation changed|Idempotent order result is unavailable)/i;

export const isUnusableOrderKeyResponseError = (
  error: unknown
): error is ApiResponseError =>
  error instanceof ApiResponseError
  && error.status >= 400
  && error.status < 500
  && UNUSABLE_IDEMPOTENCY_KEY_ERROR.test(error.message);

export class ApiClient {
  private baseUrl: string;
  private token: string | null = null;
  private sessionSubject: string | null = null;
  private sessionGeneration = 0;
  private authenticatedRequests = new Set<AbortController>();

  constructor(baseUrl = config.apiUrl) {
    this.baseUrl = baseUrl;
  }

  setToken(token: string | null, userId: string | null = token) {
    const nextSubject = token ? userId : null;
    const sessionChanged = nextSubject !== this.sessionSubject;

    this.token = token;
    this.sessionSubject = nextSubject;

    if (sessionChanged) {
      this.sessionGeneration += 1;
      for (const controller of this.authenticatedRequests) {
        controller.abort();
      }
      this.authenticatedRequests.clear();
    }
  }

  private async request<T>(
    endpoint: string,
    options: RequestInit = {},
    authenticated = false
  ): Promise<T> {
    const requestGeneration = this.sessionGeneration;
    const requestToken = this.token;
    const controller = authenticated ? new AbortController() : null;
    const headers = new Headers(options.headers);
    headers.set('Content-Type', 'application/json');

    if (requestToken) {
      headers.set('Authorization', `Bearer ${requestToken}`);
    }

    const abortFromCaller = () => controller?.abort();
    if (controller) {
      this.authenticatedRequests.add(controller);
      if (options.signal?.aborted) {
        controller.abort();
      } else {
        options.signal?.addEventListener('abort', abortFromCaller, { once: true });
      }
    }

    const assertCurrentSession = () => {
      if (authenticated && requestGeneration !== this.sessionGeneration) {
        throw new AuthSessionChangedError();
      }
    };

    try {
      const response = await fetch(`${this.baseUrl}${endpoint}`, {
        ...options,
        headers,
        signal: controller?.signal ?? options.signal,
      });
      assertCurrentSession();

      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        assertCurrentSession();
        const message = typeof error.error === 'string'
          ? error.error
          : typeof error.message === 'string'
            ? error.message
            : `HTTP ${response.status}`;
        throw new ApiResponseError(response.status, message);
      }

      const data = await response.json();
      assertCurrentSession();
      return data as T;
    } catch (error) {
      assertCurrentSession();
      throw error;
    } finally {
      if (controller) {
        this.authenticatedRequests.delete(controller);
        options.signal?.removeEventListener('abort', abortFromCaller);
      }
    }
  }

  // Account
  async getAccount(): Promise<Account> {
    return this.request<Account>('/api/account', {}, true);
  }

  async resetAccount(): Promise<Account> {
    return this.request<Account>('/api/account/reset', { method: 'POST' }, true);
  }

  async getUserStats(): Promise<UserStats> {
    return this.request<UserStats>('/api/account/stats', {}, true);
  }

  // Trading
  async placeOrder(
    order: PlaceOrderRequest,
    idempotencyKey: string = crypto.randomUUID()
  ): Promise<Position> {
    return this.request<Position>('/api/trading/order', {
      method: 'POST',
      headers: { 'Idempotency-Key': idempotencyKey },
      body: JSON.stringify(order),
    }, true);
  }

  async getPositions(): Promise<Position[]> {
    return this.request<Position[]>('/api/trading/positions', {}, true);
  }

  async closePosition(positionId: string): Promise<Position> {
    return this.request<Position>(`/api/trading/close/${positionId}`, {
      method: 'POST',
    }, true);
  }

  async getTradeHistory(
    limit = 50,
    offset = 0
  ): Promise<{ trades: TradeHistory[]; total: number }> {
    return this.request<{ trades: TradeHistory[]; total: number }>(
      `/api/trading/history?limit=${limit}&offset=${offset}`,
      {},
      true
    );
  }

  // Market
  async getAssets(): Promise<Asset[]> {
    return this.request<Asset[]>('/api/market/assets');
  }

  async getCandles(
    asset: string,
    timeframe: string,
    limit = 500
  ): Promise<Candle[]> {
    return this.request<Candle[]>(
      `/api/market/candles?asset=${asset}&timeframe=${timeframe}&limit=${limit}`
    );
  }

  async getPrice(asset: string): Promise<{ price: number }> {
    return this.request<{ price: number }>(`/api/market/price?asset=${asset}`);
  }

  // Leaderboard
  async getLeaderboard(
    limit = 20,
    offset = 0
  ): Promise<{ entries: LeaderboardEntry[]; total: number }> {
    return this.request<{ entries: LeaderboardEntry[]; total: number }>(
      `/api/leaderboard?limit=${limit}&offset=${offset}`
    );
  }

  // Stress Test
  async setStressTestSpeed(speed: 'off' | 'slow' | 'medium' | 'fast') {
    return this.request<{ success: boolean }>('/api/stress-test/speed', {
      method: 'POST',
      body: JSON.stringify({ speed }),
    });
  }
}

export const api = new ApiClient();
