export const TRADING_CONSTANTS = {
  INITIAL_BALANCE: 100_000,
  MIN_ORDER_SIZE: 0.001,
  MAX_LEVERAGE: 50,
  DEFAULT_LEVERAGE: 10,
  MAKER_FEE: 0.0002,
  TAKER_FEE: 0.0005,
  MAINTENANCE_MARGIN: 0.05,
  LIQUIDATION_THRESHOLD: 0.8,
} as const;

export const WS_CONSTANTS = {
  HEARTBEAT_INTERVAL: 30000,
  RECONNECT_DELAY: 3000,
  MAX_RECONNECT_ATTEMPTS: 10,
} as const;

export const STRESS_TEST_CONFIG = {
  SLOW_TPS: 10,
  MEDIUM_TPS: 100,
  FAST_TPS: 500,
  MAX_TPS: 1000,
} as const;

export const CACHE_TTL = {
  CANDLES: 60 * 1000, // 1 minute
  ORDERBOOK: 5 * 1000, // 5 seconds
  LEADERBOARD: 30 * 1000, // 30 seconds
} as const;

export const TIMEFRAME_MAP: Record<string, number> = {
  '1m': 60,
  '5m': 300,
  '15m': 900,
  '1h': 3600,
  '4h': 14400,
  '1d': 86400,
};
