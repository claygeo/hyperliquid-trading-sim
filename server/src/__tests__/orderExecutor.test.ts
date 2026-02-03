import { OrderExecutor } from '../services/trading/orderExecutor';
import { ValidationError, InsufficientFundsError } from '../lib/errors';

// Mock the Supabase module
const mockRpc = jest.fn();
const mockSelect = jest.fn();
const mockInsert = jest.fn();
const mockUpdate = jest.fn();
const mockEq = jest.fn();
const mockSingle = jest.fn();

const chainable = () => ({
  select: mockSelect.mockReturnThis(),
  insert: mockInsert.mockReturnThis(),
  update: mockUpdate.mockReturnThis(),
  eq: mockEq.mockReturnThis(),
  single: mockSingle,
});

jest.mock('../lib/supabase', () => ({
  getSupabase: () => ({
    from: jest.fn(() => chainable()),
    rpc: mockRpc,
  }),
}));

// Mock the assets module
jest.mock('../config/assets', () => ({
  isValidAsset: (symbol: string) => ['BTC', 'ETH', 'SOL'].includes(symbol.toUpperCase()),
}));

// Mock logger to suppress output during tests
jest.mock('../lib/logger', () => ({
  logger: {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
  },
}));

describe('OrderExecutor', () => {
  let executor: OrderExecutor;

  beforeEach(() => {
    executor = new OrderExecutor();
    jest.clearAllMocks();
  });

  describe('executeMarketOrder - validation', () => {
    it('rejects invalid assets', async () => {
      await expect(
        executor.executeMarketOrder('user-1', {
          asset: 'INVALID',
          side: 'long',
          size: 1,
          leverage: 10,
        }, 50000)
      ).rejects.toThrow(ValidationError);
    });

    it('rejects size below minimum', async () => {
      await expect(
        executor.executeMarketOrder('user-1', {
          asset: 'BTC',
          side: 'long',
          size: 0.0001,
          leverage: 10,
        }, 50000)
      ).rejects.toThrow(ValidationError);
    });

    it('rejects leverage below 1', async () => {
      await expect(
        executor.executeMarketOrder('user-1', {
          asset: 'BTC',
          side: 'long',
          size: 1,
          leverage: 0,
        }, 50000)
      ).rejects.toThrow(ValidationError);
    });

    it('rejects leverage above 50', async () => {
      await expect(
        executor.executeMarketOrder('user-1', {
          asset: 'BTC',
          side: 'long',
          size: 1,
          leverage: 51,
        }, 50000)
      ).rejects.toThrow(ValidationError);
    });

    it('rejects zero price', async () => {
      await expect(
        executor.executeMarketOrder('user-1', {
          asset: 'BTC',
          side: 'long',
          size: 1,
          leverage: 10,
        }, 0)
      ).rejects.toThrow(ValidationError);
    });

    it('rejects negative price', async () => {
      await expect(
        executor.executeMarketOrder('user-1', {
          asset: 'BTC',
          side: 'long',
          size: 1,
          leverage: 10,
        }, -100)
      ).rejects.toThrow(ValidationError);
    });
  });

  describe('executeMarketOrder - execution flow', () => {
    beforeEach(() => {
      // Mock account exists
      mockSingle.mockResolvedValue({
        data: {
          id: 'account-1',
          user_id: 'user-1',
          balance: 100000,
          initial_balance: 100000,
          reset_count: 0,
        },
        error: null,
      });
    });

    it('calls RPC with correct parameters for a long order', async () => {
      const mockPosition = {
        id: 'pos-1',
        user_id: 'user-1',
        asset: 'BTC',
        side: 'long',
        entry_price: 50000,
        current_price: 50000,
        size: 0.1,
        leverage: 10,
        margin: 500,
        liquidation_price: 45250,
        unrealized_pnl: 0,
        unrealized_pnl_percent: 0,
        realized_pnl: 0,
        status: 'open',
        opened_at: '2025-01-01T00:00:00Z',
      };

      mockRpc.mockResolvedValue({ data: mockPosition, error: null });

      const result = await executor.executeMarketOrder('user-1', {
        asset: 'BTC',
        side: 'long',
        size: 0.1,
        leverage: 10,
      }, 50000);

      expect(mockRpc).toHaveBeenCalledWith('execute_market_order', expect.objectContaining({
        p_user_id: 'user-1',
        p_asset: 'BTC',
        p_side: 'long',
        p_size: 0.1,
        p_leverage: 10,
        p_entry_price: 50000,
        p_margin: 500, // 0.1 * 50000 / 10
      }));

      expect(result.side).toBe('long');
      expect(result.asset).toBe('BTC');
      expect(result.status).toBe('open');
    });

    it('correctly calculates margin for the RPC call', async () => {
      mockRpc.mockResolvedValue({
        data: {
          id: 'pos-1', user_id: 'user-1', asset: 'ETH', side: 'short',
          entry_price: 3000, current_price: 3000, size: 5, leverage: 20,
          margin: 750, liquidation_price: 3142.5, unrealized_pnl: 0,
          unrealized_pnl_percent: 0, realized_pnl: 0, status: 'open',
          opened_at: '2025-01-01T00:00:00Z',
        },
        error: null,
      });

      await executor.executeMarketOrder('user-1', {
        asset: 'ETH',
        side: 'short',
        size: 5,
        leverage: 20,
      }, 3000);

      // Margin = (5 * 3000) / 20 = 750
      expect(mockRpc).toHaveBeenCalledWith('execute_market_order',
        expect.objectContaining({ p_margin: 750 })
      );
    });

    it('maps insufficient funds error from RPC', async () => {
      mockRpc.mockResolvedValue({
        data: null,
        error: { message: 'Insufficient margin. Required: 5000, Available: 100' },
      });

      await expect(
        executor.executeMarketOrder('user-1', {
          asset: 'BTC',
          side: 'long',
          size: 1,
          leverage: 10,
        }, 50000)
      ).rejects.toThrow(InsufficientFundsError);
    });

    it('throws generic error for other RPC failures', async () => {
      mockRpc.mockResolvedValue({
        data: null,
        error: { message: 'Database connection error' },
      });

      await expect(
        executor.executeMarketOrder('user-1', {
          asset: 'BTC',
          side: 'long',
          size: 1,
          leverage: 10,
        }, 50000)
      ).rejects.toThrow('Failed to execute order');
    });
  });

  describe('closePosition', () => {
    it('calls RPC with correct PnL for profitable long', async () => {
      // Mock position lookup
      mockSingle.mockResolvedValue({
        data: {
          id: 'pos-1',
          user_id: 'user-1',
          asset: 'BTC',
          side: 'long',
          entry_price: 50000,
          size: 1,
          leverage: 10,
          margin: 5000,
          status: 'open',
          opened_at: '2025-01-01T00:00:00Z',
        },
        error: null,
      });

      // Mock close RPC
      mockRpc.mockResolvedValue({
        data: {
          id: 'pos-1', user_id: 'user-1', asset: 'BTC', side: 'long',
          entry_price: 50000, current_price: 55000, size: 1, leverage: 10,
          margin: 5000, liquidation_price: 45250, unrealized_pnl: 0,
          unrealized_pnl_percent: 0, realized_pnl: 5000, status: 'closed',
          opened_at: '2025-01-01T00:00:00Z', closed_at: '2025-01-02T00:00:00Z',
        },
        error: null,
      });

      const result = await executor.closePosition('user-1', 'pos-1', 55000);

      // PnL = (55000 - 50000) * 1 = 5000
      expect(mockRpc).toHaveBeenCalledWith('close_position_atomic', expect.objectContaining({
        p_position_id: 'pos-1',
        p_user_id: 'user-1',
        p_current_price: 55000,
        p_pnl: 5000,
      }));

      expect(result.status).toBe('closed');
      expect(result.realizedPnl).toBe(5000);
    });

    it('calculates negative PnL for losing short', async () => {
      mockSingle.mockResolvedValue({
        data: {
          id: 'pos-2',
          user_id: 'user-1',
          asset: 'ETH',
          side: 'short',
          entry_price: 3000,
          size: 10,
          leverage: 5,
          margin: 6000,
          status: 'open',
          opened_at: '2025-01-01T00:00:00Z',
        },
        error: null,
      });

      mockRpc.mockResolvedValue({
        data: {
          id: 'pos-2', user_id: 'user-1', asset: 'ETH', side: 'short',
          entry_price: 3000, current_price: 3200, size: 10, leverage: 5,
          margin: 6000, liquidation_price: 3570, unrealized_pnl: 0,
          unrealized_pnl_percent: 0, realized_pnl: -2000, status: 'closed',
          opened_at: '2025-01-01T00:00:00Z', closed_at: '2025-01-02T00:00:00Z',
        },
        error: null,
      });

      await executor.closePosition('user-1', 'pos-2', 3200);

      // PnL = (3000 - 3200) * 10 = -2000
      expect(mockRpc).toHaveBeenCalledWith('close_position_atomic', expect.objectContaining({
        p_pnl: -2000,
      }));
    });

    it('throws ValidationError when position not found', async () => {
      mockSingle.mockResolvedValue({ data: null, error: { message: 'Not found' } });

      await expect(
        executor.closePosition('user-1', 'nonexistent', 50000)
      ).rejects.toThrow(ValidationError);
    });
  });
});
