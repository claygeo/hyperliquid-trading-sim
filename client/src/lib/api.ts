import { config } from '../config';
import type {
  Account,
  Position,
  PlaceOrderRequest,
  TradeHistory,
} from '../types/trading';
import type { LeaderboardEntry, UserStats } from '../types/user';
import type { Candle, MarketData } from '../types/market';

class ApiClient {
  private baseUrl: string;
  private token: string | null = null;

  constructor() {
    this.baseUrl = config.apiUrl;
  }

  setToken(token: string | null) {
    this.token = token;
  }

  private async request<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<T> {
    const headers: HeadersInit = {
      'Content-Type': 'application/json',
      ...options.headers,
    };

    if (this.token) {
      headers['Authorization'] = `Bearer ${this.token}`;
    }

    const response = await fetch(`${this.baseUrl}${endpoint}`, {
      ...options,
      headers,
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.message || `HTTP ${response.status}`);
    }

    return response.json();
  }

  // Auth
  async register(email: string, password: string, username: string) {
    return this.request<{ user: { id: string; email: string }; token: string }>(
      '/api/auth/register',
      {
        method: 'POST',
        body: JSON.stringify({ email, password, username }),
      }
    );
  }

  async login(email: string, password: string) {
    return this.request<{ user: { id: string; email: string }; token: string }>(
      '/api/auth/login',
      {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      }
    );
  }

  // Account
  async getAccount(): Promise<Account> {
    return this.request<Account>('/api/account');
  }

  async resetAccount(): Promise<Account> {
    return this.request<Account>('/api/account/reset', { method: 'POST' });
  }

  async getUserStats(): Promise<UserStats> {
    return this.request<UserStats>('/api/account/stats');
  }

  // Trading
  async placeOrder(order: PlaceOrderRequest): Promise<Position> {
    return this.request<Position>('/api/trading/order', {
      method: 'POST',
      body: JSON.stringify(order),
    });
  }

  async getPositions(): Promise<Position[]> {
    return this.request<Position[]>('/api/trading/positions');
  }

  async closePosition(positionId: string): Promise<Position> {
    return this.request<Position>(`/api/trading/close/${positionId}`, {
      method: 'POST',
    });
  }

  async getTradeHistory(
    limit = 50,
    offset = 0
  ): Promise<{ trades: TradeHistory[]; total: number }> {
    return this.request<{ trades: TradeHistory[]; total: number }>(
      `/api/trading/history?limit=${limit}&offset=${offset}`
    );
  }

  // Market
  async getCandles(
    asset: string,
    timeframe: string,
    limit = 500
  ): Promise<Candle[]> {
    return this.request<Candle[]>(
      `/api/market/candles?asset=${asset}&timeframe=${timeframe}&limit=${limit}`
    );
  }

  async getMarketData(asset: string): Promise<MarketData> {
    return this.request<MarketData>(`/api/market/data?asset=${asset}`);
  }

  async getPrice(asset: string): Promise<{ price: number }> {
    return this.request<{ price: number }>(`/api/market/price?asset=${asset}`);
  }

  // Leaderboard
  async getLeaderboard(
    period: 'daily' | 'alltime' = 'alltime',
    limit = 20,
    offset = 0
  ): Promise<{ entries: LeaderboardEntry[]; total: number }> {
    return this.request<{ entries: LeaderboardEntry[]; total: number }>(
      `/api/leaderboard?period=${period}&limit=${limit}&offset=${offset}`
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
