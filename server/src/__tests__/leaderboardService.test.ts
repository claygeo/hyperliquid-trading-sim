import { LeaderboardService } from '../services/leaderboard/index';

const mockCountGt = jest.fn();
const mockRange = jest.fn();
const mockOrder = jest.fn(() => ({ range: mockRange }));
const mockStatsGt = jest.fn(() => ({ order: mockOrder }));
const mockStatsSelect = jest.fn((_: string, options?: { head?: boolean }) => {
  if (options?.head) {
    return { gt: mockCountGt };
  }
  return { gt: mockStatsGt };
});
const mockProfileIn = jest.fn();
const mockFrom = jest.fn((table: string) => {
  if (table === 'leaderboard_stats') {
    return { select: mockStatsSelect };
  }
  if (table === 'profiles') {
    return { select: jest.fn(() => ({ in: mockProfileIn })) };
  }
  throw new Error(`Unexpected table: ${table}`);
});

jest.mock('../lib/supabase', () => ({
  getSupabase: () => ({ from: mockFrom }),
}));

describe('LeaderboardService getLeaderboard', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('preserves the total count when the requested page is empty', async () => {
    mockCountGt.mockResolvedValue({ count: 42, error: null });
    mockRange.mockResolvedValue({ data: [], error: null });

    await expect(
      new LeaderboardService().getLeaderboard(20, 40)
    ).resolves.toEqual({ entries: [], total: 42 });

    expect(mockOrder).toHaveBeenCalledWith('total_pnl_percent', { ascending: false });
    expect(mockRange).toHaveBeenCalledWith(40, 59);
    expect(mockFrom).not.toHaveBeenCalledWith('profiles');
  });

  it('surfaces count failures instead of returning misleading pagination', async () => {
    mockCountGt.mockResolvedValue({ count: null, error: { message: 'count denied' } });

    await expect(
      new LeaderboardService().getLeaderboard()
    ).rejects.toThrow('Failed to count leaderboard: count denied');

    expect(mockRange).not.toHaveBeenCalled();
  });

  it('maps stored transactional stats to public entries', async () => {
    mockCountGt.mockResolvedValue({ count: 1, error: null });
    mockRange.mockResolvedValue({
      data: [{
        user_id: 'user-1', total_pnl: 250, total_pnl_percent: 0.25,
        win_rate: 60, max_drawdown: 1.5, trade_count: 5, updated_at: '2026-07-29T00:00:00Z',
      }],
      error: null,
    });
    mockProfileIn.mockResolvedValue({ data: [{ user_id: 'user-1', username: 'clay' }], error: null });

    await expect(new LeaderboardService().getLeaderboard()).resolves.toEqual({
      total: 1,
      entries: [{
        rank: 1, userId: 'user-1', username: 'clay', totalPnl: 250,
        totalPnlPercent: 0.25, winRate: 60, maxDrawdown: 1.5,
        tradeCount: 5, updatedAt: '2026-07-29T00:00:00Z',
      }],
    });
  });
});
