import { PriceService } from '../services/price/index';

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
    service = new PriceService();
  });

  it('returns null when no HyperliquidService is set and no last known price', () => {
    expect(service.getCurrentPrice('BTC')).toBeNull();
  });

  it('returns live price from HyperliquidService', () => {
    const mockHL = {
      getPrice: jest.fn().mockReturnValue(50000),
      getAllPrices: jest.fn().mockReturnValue(new Map([['BTC', 50000]])),
    };
    service.setHyperliquidService(mockHL as any);

    expect(service.getCurrentPrice('BTC')).toBe(50000);
    expect(mockHL.getPrice).toHaveBeenCalledWith('BTC');
  });

  it('falls back to last known price when live price is 0', () => {
    const mockHL = {
      getPrice: jest.fn(),
      getAllPrices: jest.fn().mockReturnValue(new Map()),
    };

    // First call: live price available
    mockHL.getPrice.mockReturnValue(48000);
    service.setHyperliquidService(mockHL as any);
    service.getCurrentPrice('BTC'); // caches 48000

    // Second call: live price unavailable (0)
    mockHL.getPrice.mockReturnValue(0);
    expect(service.getCurrentPrice('BTC')).toBe(48000);
  });

  it('returns null when live returns 0 and no last known price', () => {
    const mockHL = {
      getPrice: jest.fn().mockReturnValue(0),
      getAllPrices: jest.fn().mockReturnValue(new Map()),
    };
    service.setHyperliquidService(mockHL as any);

    expect(service.getCurrentPrice('UNKNOWN')).toBeNull();
  });
});
