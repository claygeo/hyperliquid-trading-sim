import { TrackerBridge } from '../services/tracker-bridge/index';
import { ExternalServiceError } from '../lib/errors';

// Mock logger
jest.mock('../lib/logger', () => ({
  logger: {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
  },
}));

// Mock config — tracker disabled by default
jest.mock('../config/index', () => ({
  config: {
    tracker: {
      enabled: false,
      supabaseUrl: '',
      supabaseKey: '',
    },
  },
}));

// Mock supabase client
const mockFrom = jest.fn();
const mockSelect = jest.fn();
const mockEq = jest.fn();
const mockOrder = jest.fn();
const mockIn = jest.fn();
const mockLimit = jest.fn();
const mockNot = jest.fn();
const mockHead = jest.fn();

jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(() => ({
    from: mockFrom,
  })),
}));

// Helper to build query chain
function makeChain(resolvedValue: { data: any; error: any; count?: number }) {
  const chain: Record<string, jest.Mock> = {};
  const returnSelf = () => chain;

  chain.select = jest.fn().mockImplementation(returnSelf);
  chain.eq = jest.fn().mockImplementation(returnSelf);
  chain.in = jest.fn().mockImplementation(returnSelf);
  chain.not = jest.fn().mockImplementation(returnSelf);
  chain.order = jest.fn().mockImplementation(returnSelf);
  chain.limit = jest.fn().mockImplementation(returnSelf);

  // Make the chain thenable so await works
  chain.then = jest.fn().mockImplementation((resolve) => resolve(resolvedValue));

  return chain;
}

describe('TrackerBridge', () => {
  let bridge: TrackerBridge;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('when disabled', () => {
    beforeEach(() => {
      bridge = new TrackerBridge();
    });

    it('returns empty suggestions when disabled', async () => {
      expect(await bridge.getSuggestedTrades()).toEqual([]);
    });

    it('returns null stats when disabled', async () => {
      expect(await bridge.getTrackerStats()).toBeNull();
    });

    it('isEnabled returns false', () => {
      expect(bridge.isEnabled()).toBe(false);
    });
  });

  describe('when enabled', () => {
    beforeEach(() => {
      // Override config for enabled bridge
      const configModule = require('../config/index');
      configModule.config.tracker.enabled = true;
      configModule.config.tracker.supabaseUrl = 'https://test.supabase.co';
      configModule.config.tracker.supabaseKey = 'test-key';

      bridge = new TrackerBridge();
    });

    it('validates signal rows with Zod and skips invalid ones', async () => {
      const validSignal = {
        id: 1,
        coin: 'BTC',
        direction: 'long',
        signal_tier: 'high',
        confidence: 80,
        avg_entry_price: 50000,
        current_price: 51000,
        stop_loss: 48000,
        take_profit_1: 55000,
        take_profit_2: null,
        take_profit_3: null,
        trader_count: 3,
        created_at: new Date().toISOString(), // Fresh signal
      };

      const invalidSignal = {
        id: 2,
        // missing required 'coin' field
        direction: 'long',
        created_at: new Date().toISOString(),
      };

      const signalChain = makeChain({ data: [validSignal, invalidSignal], error: null });
      const tradeChain = makeChain({ data: [], error: null });

      mockFrom.mockImplementation((table: string) => {
        if (table === 'quality_signals') return signalChain;
        if (table === 'user_trades') return tradeChain;
        return makeChain({ data: [], error: null });
      });

      const result = await bridge.getSuggestedTrades();

      // Only the valid signal should be returned
      expect(result.length).toBe(1);
      expect(result[0].coin).toBe('BTC');
      expect(result[0].confidence).toBe(80);
    });

    it('filters stale signals older than 24h', async () => {
      const freshSignal = {
        id: 1, coin: 'BTC', direction: 'long', confidence: 80,
        avg_entry_price: 50000, current_price: 51000,
        stop_loss: null, take_profit_1: null, take_profit_2: null, take_profit_3: null,
        trader_count: 2, signal_tier: null,
        created_at: new Date().toISOString(),
      };

      const staleSignal = {
        id: 2, coin: 'ETH', direction: 'short', confidence: 90,
        avg_entry_price: 3000, current_price: 2900,
        stop_loss: null, take_profit_1: null, take_profit_2: null, take_profit_3: null,
        trader_count: 1, signal_tier: null,
        created_at: new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString(), // 25 hours ago
      };

      const signalChain = makeChain({ data: [freshSignal, staleSignal], error: null });
      const tradeChain = makeChain({ data: [], error: null });

      mockFrom.mockImplementation((table: string) => {
        if (table === 'quality_signals') return signalChain;
        if (table === 'user_trades') return tradeChain;
        return makeChain({ data: [], error: null });
      });

      const result = await bridge.getSuggestedTrades();

      expect(result.length).toBe(1);
      expect(result[0].coin).toBe('BTC');
    });

    it('throws ExternalServiceError on DB failure', async () => {
      const errorChain = makeChain({ data: null, error: { message: 'connection refused' } });
      const tradeChain = makeChain({ data: [], error: null });

      mockFrom.mockImplementation((table: string) => {
        if (table === 'quality_signals') return errorChain;
        if (table === 'user_trades') return tradeChain;
        return makeChain({ data: [], error: null });
      });

      await expect(bridge.getSuggestedTrades()).rejects.toThrow(ExternalServiceError);
    });

    it('returns cached data when available', async () => {
      const signal = {
        id: 1, coin: 'BTC', direction: 'long', confidence: 80,
        avg_entry_price: 50000, current_price: 51000,
        stop_loss: null, take_profit_1: null, take_profit_2: null, take_profit_3: null,
        trader_count: 2, signal_tier: null,
        created_at: new Date().toISOString(),
      };

      const signalChain = makeChain({ data: [signal], error: null });
      const tradeChain = makeChain({ data: [], error: null });

      mockFrom.mockImplementation((table: string) => {
        if (table === 'quality_signals') return signalChain;
        if (table === 'user_trades') return tradeChain;
        return makeChain({ data: [], error: null });
      });

      // First call populates cache
      const first = await bridge.getSuggestedTrades();
      expect(first.length).toBe(1);

      // Clear mock to ensure second call doesn't hit DB
      mockFrom.mockClear();

      // Second call should use cache
      const second = await bridge.getSuggestedTrades();
      expect(second.length).toBe(1);
      expect(mockFrom).not.toHaveBeenCalled();
    });
  });
});
