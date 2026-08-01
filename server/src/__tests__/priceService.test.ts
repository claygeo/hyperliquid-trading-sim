import { MAX_EXECUTION_PRICE_AGE_MS, PriceService } from '../services/price/index';

// Mock logger
jest.mock('../lib/logger', () => ({
  logger: {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
  },
}));

describe('PriceService', () => {
  let service: PriceService;

  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-07-29T12:00:00Z'));
    service = new PriceService();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('returns null when no HyperliquidService is set and no last known price', () => {
    expect(service.getCurrentPrice('BTC')).toBeNull();
  });

  it('returns live price from HyperliquidService', () => {
    const mockHL = {
      getPriceSnapshot: jest.fn().mockReturnValue({
        price: 50000,
        observedAt: Date.now(),
      }),
      getAllPrices: jest.fn().mockReturnValue(new Map([['BTC', 50000]])),
    };
    service.setHyperliquidService(mockHL as any);

    expect(service.getCurrentPrice('BTC')).toBe(50000);
    expect(mockHL.getPriceSnapshot).toHaveBeenCalledWith('BTC');
  });

  it('falls back to last known price when live price is 0', () => {
    const mockHL = {
      getPriceSnapshot: jest.fn(),
      getAllPrices: jest.fn().mockReturnValue(new Map()),
    };

    // First call: live price available
    mockHL.getPriceSnapshot.mockReturnValue({ price: 48000, observedAt: Date.now() });
    service.setHyperliquidService(mockHL as any);
    service.getCurrentPrice('BTC'); // caches 48000

    // Second call: live price unavailable
    mockHL.getPriceSnapshot.mockReturnValue(null);
    expect(service.getCurrentPrice('BTC')).toBe(48000);
  });

  it('rejects the last known price after the execution freshness window', () => {
    const mockHL = {
      getPriceSnapshot: jest.fn().mockReturnValue({
        price: 48000,
        observedAt: Date.now(),
      }),
      getAllPrices: jest.fn().mockReturnValue(new Map()),
    };
    service.setHyperliquidService(mockHL as any);
    expect(service.getCurrentPrice('BTC')).toBe(48000);

    mockHL.getPriceSnapshot.mockReturnValue(null);
    jest.advanceTimersByTime(MAX_EXECUTION_PRICE_AGE_MS + 1);

    expect(service.getCurrentPrice('BTC')).toBeNull();
  });

  it('rejects an upstream snapshot that is already stale', () => {
    const mockHL = {
      getPriceSnapshot: jest.fn().mockReturnValue({
        price: 48000,
        observedAt: Date.now() - MAX_EXECUTION_PRICE_AGE_MS - 1,
      }),
      getAllPrices: jest.fn().mockReturnValue(new Map()),
    };
    service.setHyperliquidService(mockHL as any);

    expect(service.getCurrentPrice('BTC')).toBeNull();
  });

  it('returns null when live returns 0 and no last known price', () => {
    const mockHL = {
      getPriceSnapshot: jest.fn().mockReturnValue(null),
      getAllPrices: jest.fn().mockReturnValue(new Map()),
    };
    service.setHyperliquidService(mockHL as any);

    expect(service.getCurrentPrice('UNKNOWN')).toBeNull();
  });
});
