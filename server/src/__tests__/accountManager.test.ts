import { AccountManager } from '../services/trading/accountManager';
import { priceService } from '../services/price/index';

const mockRpc = jest.fn();
const mockAccountInsertSingle = jest.fn();
const mockTradesOrder = jest.fn();
const mockFrom = jest.fn((table: string) => {
  if (table === 'accounts') {
    return {
      insert: jest.fn(() => ({
        select: jest.fn(() => ({ single: mockAccountInsertSingle })),
      })),
    };
  }

  if (table === 'trades') {
    return {
      select: jest.fn(() => ({
        eq: jest.fn(() => ({ order: mockTradesOrder })),
      })),
    };
  }

  throw new Error(`Unexpected table: ${table}`);
});

jest.mock('../lib/supabase', () => ({
  getSupabase: () => ({
    from: mockFrom,
    rpc: mockRpc,
  }),
}));

jest.mock('../services/price/index', () => ({
  priceService: { getCurrentPrice: jest.fn() },
}));

const mockGetCurrentPrice = priceService.getCurrentPrice as jest.MockedFunction<
  typeof priceService.getCurrentPrice
>;

describe('AccountManager reset', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRpc.mockImplementation((functionName: string) => {
      if (functionName === 'reset_account_atomic') {
        return Promise.resolve({
          data: {
            id: 'account-1',
            user_id: 'user-1',
            balance: 100000,
            initial_balance: 100000,
            reset_count: 2,
            created_at: '2026-07-29T00:00:00Z',
          },
          error: null,
        });
      }
      if (functionName === 'get_account_snapshot') {
        return Promise.resolve({
          data: {
            account: {
              id: 'account-1',
              user_id: 'user-1',
              balance: 100000,
              initial_balance: 100000,
              reset_count: 2,
              created_at: '2026-07-29T00:00:00Z',
            },
            positions: [],
          },
          error: null,
        });
      }
      throw new Error(`Unexpected RPC: ${functionName}`);
    });
    mockAccountInsertSingle.mockResolvedValue({
      data: {
        id: 'account-1',
        user_id: 'user-1',
        balance: 100000,
        initial_balance: 100000,
        reset_count: 2,
        created_at: '2026-07-29T00:00:00Z',
      },
      error: null,
    });
    mockTradesOrder.mockResolvedValue({ data: [], error: null });
    mockGetCurrentPrice.mockReturnValue(null);
  });

  it('returns the committed reset row without a fallible post-commit read', async () => {
    const account = await new AccountManager().resetAccount('user-1');

    expect(mockRpc).toHaveBeenCalledTimes(1);
    expect(mockRpc).toHaveBeenCalledWith('reset_account_atomic', {
      p_user_id: 'user-1',
    });
    expect(account).toEqual({
      id: 'account-1',
      userId: 'user-1',
      balance: 100000,
      initialBalance: 100000,
      equity: 100000,
      unrealizedPnl: 0,
      usedMargin: 0,
      availableMargin: 100000,
      priceStale: false,
      resetCount: 2,
      createdAt: '2026-07-29T00:00:00Z',
    });
  });

  it('surfaces a failed reset instead of returning partially reset state', async () => {
    mockRpc.mockImplementation((functionName: string) => {
      if (functionName === 'reset_account_atomic') {
        return Promise.resolve({
          data: null,
          error: { message: 'transaction rolled back' },
        });
      }
      throw new Error(`Unexpected RPC: ${functionName}`);
    });

    await expect(
      new AccountManager().resetAccount('user-1')
    ).rejects.toThrow('Failed to reset account: transaction rolled back');

    expect(mockFrom).not.toHaveBeenCalled();
  });

  it('does not report partial account totals when the snapshot cannot be read', async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: { message: 'snapshot unavailable' },
    });

    await expect(
      new AccountManager().getAccount('user-1')
    ).rejects.toThrow('Failed to fetch account snapshot: snapshot unavailable');
  });

  it('calculates account equity from live prices and locked margin', async () => {
    mockRpc.mockResolvedValue({
      data: {
        account: {
          id: 'account-1', user_id: 'user-1', balance: 900,
          initial_balance: 1000, reset_count: 0,
          created_at: '2026-07-29T00:00:00Z',
        },
        positions: [{
          id: 'position-1', asset: 'BTC', side: 'long', entry_price: 100,
          current_price: 100, size: 1, margin: 100,
        }],
      },
      error: null,
    });
    mockGetCurrentPrice.mockReturnValue(110);

    const account = await new AccountManager().getAccount('user-1');

    expect(account.unrealizedPnl).toBe(10);
    expect(account.usedMargin).toBe(100);
    expect(account.equity).toBe(1010);
  });

  it('caps open-position loss at isolated margin in account equity', async () => {
    mockRpc.mockResolvedValue({
      data: {
        account: {
          id: 'account-1', user_id: 'user-1', balance: 900,
          initial_balance: 1000, reset_count: 0,
          created_at: '2026-07-29T00:00:00Z',
        },
        positions: [{
          id: 'position-1', asset: 'BTC', side: 'short', entry_price: 100,
          current_price: 100, size: 1, margin: 100,
        }],
      },
      error: null,
    });
    mockGetCurrentPrice.mockReturnValue(1000);

    const account = await new AccountManager().getAccount('user-1');

    expect(account.unrealizedPnl).toBe(-100);
    expect(account.equity).toBe(900);
  });

  it('does not report zero stats when trade history cannot be read', async () => {
    mockTradesOrder.mockResolvedValue({
      data: null,
      error: { message: 'trades unavailable' },
    });

    await expect(
      new AccountManager().getUserStats('user-1')
    ).rejects.toThrow('Failed to fetch user stats: trades unavailable');
  });
});
