import { OrderExecutor } from '../services/trading/orderExecutor';
import { ConflictError, ValidationError, InsufficientFundsError, getHttpStatus } from '../lib/errors';
import { eventService } from '../services/events/index';

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

jest.mock('../services/events/index', () => ({
  eventService: { emit: jest.fn() },
}));

const mockEventEmit = eventService.emit as jest.MockedFunction<typeof eventService.emit>;

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
          expectedAccountResetCount: 0,
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
          expectedAccountResetCount: 0,
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
          expectedAccountResetCount: 0,
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
          expectedAccountResetCount: 0,
          asset: 'BTC',
          side: 'long',
          size: 1,
          leverage: 51,
        }, 50000)
      ).rejects.toThrow(ValidationError);
    });

    it('rejects fractional leverage before the integer RPC boundary', async () => {
      await expect(
        executor.executeMarketOrder('user-1', {
          expectedAccountResetCount: 0,
          asset: 'BTC',
          side: 'long',
          size: 1,
          leverage: 1.5,
        }, 50000)
      ).rejects.toThrow('Leverage must be a whole number');
    });

    it('requires a signal identifier for signal-attributed orders', async () => {
      await expect(
        executor.executeMarketOrder('user-1', {
          expectedAccountResetCount: 0,
          asset: 'BTC',
          side: 'long',
          size: 1,
          leverage: 10,
          source: 'signal',
        }, 50000)
      ).rejects.toThrow('signalId is required exactly when source is signal');
    });

    it('rejects a signal identifier on a manual order', async () => {
      await expect(
        executor.executeMarketOrder('user-1', {
          expectedAccountResetCount: 0,
          asset: 'BTC',
          side: 'long',
          size: 1,
          leverage: 10,
          source: 'manual',
          signalId: 'signal-123',
        }, 50000)
      ).rejects.toThrow('signalId is required exactly when source is signal');
    });

    it('rejects zero price', async () => {
      await expect(
        executor.executeMarketOrder('user-1', {
          expectedAccountResetCount: 0,
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
          expectedAccountResetCount: 0,
          asset: 'BTC',
          side: 'long',
          size: 1,
          leverage: 10,
        }, -100)
      ).rejects.toThrow(ValidationError);
    });

    it('rejects a malformed idempotency key before account access', async () => {
      await expect(
        executor.executeMarketOrder('user-1', {
          expectedAccountResetCount: 0, asset: 'BTC', side: 'long', size: 1, leverage: 10,
        }, 50000, 'not-a-uuid')
      ).rejects.toThrow('Invalid idempotency key');

      expect(mockSingle).not.toHaveBeenCalled();
      expect(mockRpc).not.toHaveBeenCalled();
    });

    it('rejects orders above the notional exposure limit before account access', async () => {
      await expect(
        executor.executeMarketOrder('user-1', {
          expectedAccountResetCount: 0,
          asset: 'BTC',
          side: 'short',
          size: 101,
          leverage: 50,
        }, 50000)
      ).rejects.toThrow('Order notional exceeds the $5,000,000 limit');

      expect(mockSingle).not.toHaveBeenCalled();
      expect(mockRpc).not.toHaveBeenCalled();
    });

    it('rejects a near-limit long when slippage pushes execution notional over the limit', async () => {
      await expect(
        executor.executeMarketOrder('user-1', {
          expectedAccountResetCount: 0,
          asset: 'BTC',
          side: 'long',
          size: 100,
          leverage: 50,
        }, 50000)
      ).rejects.toThrow('after slippage');

      expect(mockSingle).not.toHaveBeenCalled();
      expect(mockRpc).not.toHaveBeenCalled();
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
        expectedAccountResetCount: 0,
        asset: 'BTC',
        side: 'long',
        size: 0.1,
        leverage: 10,
      }, 50000);

      const rpcCall = mockRpc.mock.calls[0];
      expect(rpcCall[0]).toBe('execute_market_order');
      expect(rpcCall[1].p_user_id).toBe('user-1');
      expect(rpcCall[1].p_idempotency_key).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      );
      expect(rpcCall[1].p_expected_account_reset_count).toBe(0);
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
      expect(mockEventEmit).toHaveBeenCalledTimes(1);
      expect(mockEventEmit).toHaveBeenCalledWith(
        'trade_executed',
        expect.objectContaining({ entryFee: 2.500625 }),
        'user-1'
      );
    });

    it('returns an idempotent replay without emitting a duplicate event', async () => {
      const idempotencyKey = '50000000-0000-4000-8000-000000000001';
      mockRpc.mockResolvedValue({
        data: {
          id: 'pos-existing', user_id: 'user-1', asset: 'BTC', side: 'long',
          entry_price: 50012.5, current_price: 50012.5, size: 0.1, leverage: 10,
          margin: 500.125, liquidation_price: 45250, unrealized_pnl: 0,
          unrealized_pnl_percent: 0, realized_pnl: 0, status: 'open',
          opened_at: '2025-01-01T00:00:00Z', source: 'manual', signal_id: null,
          _created: false,
        },
        error: null,
      });

      const result = await executor.executeMarketOrder('user-1', {
        expectedAccountResetCount: 0, asset: 'BTC', side: 'long', size: 0.1, leverage: 10,
      }, 50000, idempotencyKey);

      expect(mockRpc).toHaveBeenCalledWith('execute_market_order', expect.objectContaining({
        p_idempotency_key: idempotencyKey,
      }));
      expect(result.id).toBe('pos-existing');
      expect(mockEventEmit).not.toHaveBeenCalled();
    });

    it('canonicalizes high-precision order values to the database storage boundary', async () => {
      mockRpc.mockResolvedValue({
        data: {
          id: 'pos-precision', user_id: 'user-1', asset: 'ETH', side: 'long',
          entry_price: 3000.075, current_price: 3000.075, size: 0.16666667,
          leverage: 10, margin: 50.001251, liquidation_price: 2715.067875,
          unrealized_pnl: 0, unrealized_pnl_percent: 0, realized_pnl: 0,
          status: 'open', opened_at: '2025-01-01T00:00:00Z',
          source: 'signal', signal_id: 'signal-precision',
        },
        error: null,
      });

      await executor.executeMarketOrder('user-1', {
        expectedAccountResetCount: 0, asset: 'ETH', side: 'long', size: 500 / 3000, leverage: 10,
        source: 'signal', signalId: 'signal-precision',
      }, 3000, '50000000-0000-4000-8000-000000000099');

      const params = mockRpc.mock.calls[0][1];
      expect(params.p_size).toBe(0.16666667);
      expect(params.p_entry_price).toBe(Number(params.p_entry_price.toFixed(8)));
      expect(params.p_margin).toBe(
        Number(((params.p_entry_price * params.p_size) / 10).toFixed(8))
      );
      expect(params.p_liquidation_price).toBe(
        Number((params.p_entry_price * (1 - 0.95 / 10)).toFixed(8))
      );
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
        expectedAccountResetCount: 0,
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
          expectedAccountResetCount: 0,
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
          expectedAccountResetCount: 0,
          asset: 'BTC',
          side: 'long',
          size: 1,
          leverage: 10,
        }, 50000)
      ).rejects.toThrow('Failed to execute order');
    });

    it('reports reset-generation failures as terminal conflicts while transport failures stay 500', async () => {
      mockRpc.mockResolvedValue({
        data: null,
        error: { message: 'Account reset generation changed. Expected: 0, Current: 1' },
      });

      const conflict = await executor.executeMarketOrder('user-1', {
        expectedAccountResetCount: 0,
        asset: 'BTC',
        side: 'long',
        size: 1,
        leverage: 10,
      }, 50000, '50000000-0000-4000-8000-000000000098').catch((error) => error);

      expect(conflict).toBeInstanceOf(ConflictError);
      expect(getHttpStatus(conflict)).toBe(409);
      expect(getHttpStatus(new Error('RPC transport failed after commit'))).toBe(500);
    });

    it('rejects an invalid expected reset generation before account access', async () => {
      await expect(
        executor.executeMarketOrder('user-1', {
          expectedAccountResetCount: Number.NaN,
          asset: 'BTC',
          side: 'long',
          size: 1,
          leverage: 10,
        }, 50000)
      ).rejects.toThrow('Invalid expected account reset generation');

      expect(mockSingle).not.toHaveBeenCalled();
      expect(mockRpc).not.toHaveBeenCalled();
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
        expectedAccountResetCount: 0,
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
        expectedAccountResetCount: 0,
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
      // Exit slippage (closing long = selling): 55000 * (1 - (55000/10000)*5/10000) = 54848.75
      // Entry fee = 50000 * 1 * 0.0005 = 25
      // Exit fee = 54848.75 * 1 * 0.0005 = 27.424375
      // Gross PnL = (slipped_exit - 50000) * 1
      // Net PnL = gross - 25 - 27.5
      const rpcCall = mockRpc.mock.calls[0];
      expect(rpcCall[0]).toBe('close_position_atomic');
      expect(rpcCall[1].p_position_id).toBe('pos-1');
      expect(rpcCall[1].p_current_price).toBeCloseTo(54848.75, 4);
      expect(rpcCall[1].p_pnl).toBeCloseTo(4796.325625, 6);
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
      expect(rpcCall[1].p_current_price).toBeCloseTo(3205.12, 4);
      expect(rpcCall[1].p_pnl).toBeCloseTo(-2082.2256, 4);
    });

    it('caps a gap loss at isolated margin before the accounting RPC', async () => {
      mockSingle.mockResolvedValue({
        data: {
          id: 'pos-3',
          user_id: 'user-1',
          asset: 'BTC',
          side: 'short',
          entry_price: 50000,
          size: 1,
          leverage: 50,
          margin: 1000,
          status: 'open',
          opened_at: '2025-01-01T00:00:00Z',
        },
        error: null,
      });

      mockRpc.mockResolvedValue({
        data: {
          id: 'pos-3', user_id: 'user-1', asset: 'BTC', side: 'short',
          entry_price: 50000, current_price: 101000, size: 1, leverage: 50,
          margin: 1000, liquidation_price: 50950, unrealized_pnl: 0,
          unrealized_pnl_percent: 0, realized_pnl: -1000, status: 'liquidated',
          opened_at: '2025-01-01T00:00:00Z', closed_at: '2025-01-02T00:00:00Z',
          source: 'manual', signal_id: null,
        },
        error: null,
      });

      await executor.closePosition('user-1', 'pos-3', 100000);

      expect(mockRpc).toHaveBeenCalledWith('close_position_atomic', expect.objectContaining({
        p_pnl: -1000,
        p_pnl_percent: -100,
      }));
    });

    it('rejects a non-finite close price before querying the position', async () => {
      await expect(
        executor.closePosition('user-1', 'pos-1', Number.POSITIVE_INFINITY)
      ).rejects.toThrow('Invalid price');

      expect(mockSingle).not.toHaveBeenCalled();
    });

    it('throws ValidationError when position not found', async () => {
      mockSingle.mockResolvedValue({ data: null, error: { message: 'Not found' } });

      await expect(
        executor.closePosition('user-1', 'nonexistent', 50000)
      ).rejects.toThrow(ValidationError);
    });
  });
});
