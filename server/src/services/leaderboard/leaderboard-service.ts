import { getSupabase } from '../../lib/supabase.js';

interface LeaderboardEntry {
  rank: number;
  userId: string;
  username: string;
  totalPnl: number;
  totalPnlPercent: number;
  winRate: number;
  maxDrawdown: number;
  tradeCount: number;
  updatedAt: string;
}

export class LeaderboardService {
  async getLeaderboard(
    period: 'daily' | 'alltime' = 'alltime',
    limit = 20,
    offset = 0
  ): Promise<{ entries: LeaderboardEntry[]; total: number }> {
    const supabase = getSupabase();

    // Get total count
    const { count } = await supabase
      .from('leaderboard_stats')
      .select('*', { count: 'exact', head: true })
      .gt('trade_count', 0);

    // Get leaderboard stats
    let query = supabase
      .from('leaderboard_stats')
      .select('*')
      .gt('trade_count', 0)
      .order('total_pnl_percent', { ascending: false })
      .range(offset, offset + limit - 1);

    // For daily, filter by updated_at within last 24 hours
    if (period === 'daily') {
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      query = query.gte('updated_at', yesterday.toISOString());
    }

    const { data: statsEntries, error: statsError } = await query;

    if (statsError) {
      throw new Error(`Failed to fetch leaderboard: ${statsError.message}`);
    }

    if (!statsEntries || statsEntries.length === 0) {
      return { entries: [], total: 0 };
    }

    // Get usernames from profiles
    const userIds = statsEntries.map((e) => e.user_id);
    const { data: profiles } = await supabase
      .from('profiles')
      .select('user_id, username')
      .in('user_id', userIds);

    // Create a map of user_id to username
    const usernameMap = new Map<string, string>();
    (profiles || []).forEach((p) => {
      usernameMap.set(p.user_id, p.username);
    });

    return {
      entries: statsEntries.map((entry, index) => ({
        rank: offset + index + 1,
        userId: entry.user_id,
        username: usernameMap.get(entry.user_id) || 'Anonymous',
        totalPnl: entry.total_pnl,
        totalPnlPercent: entry.total_pnl_percent,
        winRate: entry.win_rate,
        maxDrawdown: entry.max_drawdown,
        tradeCount: entry.trade_count,
        updatedAt: entry.updated_at,
      })),
      total: count || 0,
    };
  }

  async updateUserStats(userId: string): Promise<void> {
    const supabase = getSupabase();

    // Get user's trades
    const { data: trades } = await supabase
      .from('trades')
      .select('*')
      .eq('user_id', userId);

    if (!trades || trades.length === 0) {
      // Remove from leaderboard if no trades
      await supabase
        .from('leaderboard_stats')
        .delete()
        .eq('user_id', userId);
      return;
    }

    const totalPnl = trades.reduce((sum, t) => sum + t.pnl, 0);
    const winningTrades = trades.filter((t) => t.pnl > 0);
    const winRate = (winningTrades.length / trades.length) * 100;

    // Calculate max drawdown
    const pnlHistory = trades.reduce((acc: number[], t) => {
      const prev = acc.length > 0 ? acc[acc.length - 1] : 0;
      acc.push(prev + t.pnl);
      return acc;
    }, []);

    let peak = pnlHistory[0] || 0;
    let maxDrawdown = 0;
    for (const pnl of pnlHistory) {
      if (pnl > peak) peak = pnl;
      const drawdown = peak - pnl;
      if (drawdown > maxDrawdown) maxDrawdown = drawdown;
    }
    const maxDrawdownPercent = peak > 0 ? (maxDrawdown / peak) * 100 : 0;

    // Upsert leaderboard stats
    await supabase
      .from('leaderboard_stats')
      .upsert({
        user_id: userId,
        total_pnl: totalPnl,
        total_pnl_percent: (totalPnl / 100000) * 100, // Assuming 100k initial
        win_rate: winRate,
        max_drawdown: maxDrawdownPercent,
        trade_count: trades.length,
        updated_at: new Date().toISOString(),
      });
  }

  async syncAllUsers(): Promise<void> {
    const supabase = getSupabase();

    // Get all unique user IDs from trades table
    const { data: userIds } = await supabase
      .from('trades')
      .select('user_id')
      .order('user_id');

    if (!userIds || userIds.length === 0) {
      return;
    }

    // Get unique user IDs
    const uniqueUserIds = [...new Set(userIds.map(u => u.user_id))];

    // Update stats for each user
    for (const userId of uniqueUserIds) {
      await this.updateUserStats(userId);
    }
  }
}
