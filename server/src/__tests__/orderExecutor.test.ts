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

    it('calls RPC with slipped price for a long order', async () => {
      // Notional = 0.1 * 50000 = 5000
      // Slippage = (5000/10000) * 5 bps = 2.5 bps = 0.00025
      // Slipped price (long) = 50000 * 1.00025 = 50012.5
      // Margin = (0.1 * 50012.5) / 10 = 500.125
      const mockPosition = {
        id: 'pos-1',
        user_id: 'user-1',
        asset: 'BTC',
        side: 'long',
        entry_price: 50012.5,
        current_price: 50012.5,
        size: 0.1,
        leverage: 10,
        margin: 500.125,
        liquidation_price: 45250,
        unrealized_pnl: 0,
        unrealized_pnl_percent: 0,
        realized_pnl: 0,
        status: 'open',
        opened_at: '2025-01-01T00:00:00Z',
        source: 'manual',
        signal_id: null,
      };

      mockRpc.mockResolvedValue({ data: mockPosition, error: null });

      const result = await executor.executeMarketOrder('user-1', {
        asset: 'BTC',
        side: 'long',
        size: 0.1,
        leverage: 10,
      }, 50000);

      const rpcCall = mockRpc.mock.calls[0];
      expect(rpcCall[0]).toBe('execute_market_order');
      expect(rpcCall[1].p_user_id).toBe('user-1');
      expect(rpcCall[1].p_asset).toBe('BTC');
      expect(rpcCall[1].p_side).toBe('long');
      expect(rpcCall[1].p_size).toBe(0.1);
      expect(rpcCall[1].p_leverage).toBe(10);
      // Entry price includes slippage (long slips up)
      expect(rpcCall[1].p_entry_price).toBeCloseTo(50012.5, 1);
      // Margin based on slipped notional
      expect(rpcCall[1].p_margin).toBeCloseTo(500.125, 1);

      expect(result.side).toBe('long');
      expect(result.asset).toBe('BTC');
      expect(result.status).toBe('open');
    });

    it('applies slippage in opposite direction for short orders', async () => {
      // Notional = 5 * 3000 = 15000
      // Slippage = (15000/10000) * 5 bps = 7.5 bps = 0.00075
      // Slipped price (short) = 3000 * (1 - 0.00075) = 2997.75
      // Margin = (5 * 2997.75) / 20 = 749.4375
      mockRpc.mockResolvedValue({
        data: {
          id: 'pos-1', user_id: 'user-1', asset: 'ETH', side: 'short',
          entry_price: 2997.75, current_price: 2997.75, size: 5, leverage: 20,
          margin: 749.4375, liquidation_price: 3142.5, unrealized_pnl: 0,
          unrealized_pnl_percent: 0, realized_pnl: 0, status: 'open',
          opened_at: '2025-01-01T00:00:00Z', source: 'manual', signal_id: null,
        },
        error: null,
      });

      await executor.executeMarketOrder('user-1', {
        asset: 'ETH',
        side: 'short',
        size: 5,
        leverage: 20,
      }, 3000);

      const rpcCall = mockRpc.mock.calls[0];
      // Short slips down (worse entry for shorts)
      expect(rpcCall[1].p_entry_price).toBeCloseTo(2997.75, 1);
      expect(rpcCall[1].p_margin).toBeCloseTo(749.4375, 1);
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

  describe('executeMarketOrder - source attribution', () => {
    beforeEach(() => {
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

    it('passes source=signal and signalId to RPC when provided', async () => {
      const mockPosition = {
        id: 'pos-1', user_id: 'user-1', asset: 'BTC', side: 'long',
        entry_price: 50012.5, current_price: 50012.5, size: 0.1, leverage: 10,
        margin: 500.125, liquidation_price: 45250, unrealized_pnl: 0,
        unrealized_pnl_percent: 0, realized_pnl: 0, status: 'open',
        opened_at: '2025-01-01T00:00:00Z', source: 'signal',
        signal_id: 'sig-abc-123',
      };

      mockRpc.mockResolvedValue({ data: mockPosition, error: null });

      const result = await executor.executeMarketOrder('user-1', {
        asset: 'BTC',
        side: 'long',
        size: 0.1,
        leverage: 10,
        source: 'signal',
        signalId: 'sig-abc-123',
      }, 50000);

      expect(mockRpc).toHaveBeenCalledWith('execute_market_order', expect.objectContaining({
        p_source: 'signal',
        p_signal_id: 'sig-abc-123',
      }));

      expect(result.source).toBe('signal');
      expect(result.signalId).toBe('sig-abc-123');
    });

    it('defaults source to manual when not provided', async () => {
      const mockPosition = {
        id: 'pos-1', user_id: 'user-1', asset: 'BTC', side: 'long',
        entry_price: 50012.5, current_price: 50012.5, size: 0.1, leverage: 10,
        margin: 500.125, liquidation_price: 45250, unrealized_pnl: 0,
        unrealized_pnl_percent: 0, realized_pnl: 0, status: 'open',
        opened_at: '2025-01-01T00:00:00Z', source: 'manual',
        signal_id: null,
      };

      mockRpc.mockResolvedValue({ data: mockPosition, error: null });

      const result = await executor.executeMarketOrder('user-1', {
        asset: 'BTC',
        side: 'long',
        size: 0.1,
        leverage: 10,
      }, 50000);

      expect(mockRpc).toHaveBeenCalledWith('execute_market_order', expect.objectContaining({
        p_source: 'manual',
        p_signal_id: null,
      }));

      expect(result.source).toBe('manual');
    });
  });

  describe('closePosition', () => {
    it('deducts fees and slippage from PnL for profitable long', async () => {
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
          source: 'manual', signal_id: null,
        },
        error: null,
      });

      await executor.closePosition('user-1', 'pos-1', 55000);

      // Exit notional = 1 * 55000 = 55000
      // Exit slippage (closing long = selling = short direction): 55000 * (1 - (55000/10000)*5/10000) = ~54998.4875
      // Entry fee = 50000 * 1 * 0.0005 = 25
      // Exit fee = 55000 * 1 * 0.0005 = 27.5
      // Gross PnL = (slipped_exit - 50000) * 1
      // Net PnL = gross - 25 - 27.5
      const rpcCall = mockRpc.mock.calls[0];
      expect(rpcCall[0]).toBe('close_position_atomic');
      expect(rpcCall[1].p_position_id).toBe('pos-1');
      // PnL should be less than the naive 5000 due to fees and slippage
      expect(rpcCall[1].p_pnl).toBeLessThan(5000);
      // Still profitable (fees ~$52.50, slippage ~$151 on exit)
      expect(rpcCall[1].p_pnl).toBeGreaterThan(4700);
    });

    it('fees make losing short even worse', async () => {
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
          source: 'manual', signal_id: null,
        },
        error: null,
      });

      await executor.closePosition('user-1', 'pos-2', 3200);

      const rpcCall = mockRpc.mock.calls[0];
      // Gross PnL is ~-2000, fees make it worse
      expect(rpcCall[1].p_pnl).toBeLessThan(-2000);
    });

    it('throws ValidationError when position not found', async () => {
      mockSingle.mockResolvedValue({ data: null, error: { message: 'Not found' } });

      await expect(
        executor.closePosition('user-1', 'nonexistent', 50000)
      ).rejects.toThrow(ValidationError);
    });
  });
});
