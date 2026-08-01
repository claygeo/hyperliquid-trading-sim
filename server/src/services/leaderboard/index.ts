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
    limit = 20,
    offset = 0
  ): Promise<{ entries: LeaderboardEntry[]; total: number }> {
    const supabase = getSupabase();

    const countQuery = supabase
      .from('leaderboard_stats')
      .select('*', { count: 'exact', head: true })
      .gt('trade_count', 0);

    const { count, error: countError } = await countQuery;
    if (countError) {
      throw new Error(`Failed to count leaderboard: ${countError.message}`);
    }

    // Get leaderboard stats
    const query = supabase
      .from('leaderboard_stats')
      .select('*')
      .gt('trade_count', 0)
      .order('total_pnl_percent', { ascending: false })
      .range(offset, offset + limit - 1);

    const { data: statsEntries, error: statsError } = await query;

    if (statsError) {
      throw new Error(`Failed to fetch leaderboard: ${statsError.message}`);
    }

    if (!statsEntries || statsEntries.length === 0) {
      return { entries: [], total: count || 0 };
    }

    // Get usernames from profiles
    const userIds = statsEntries.map((e) => e.user_id);
    const { data: profiles, error: profilesError } = await supabase
      .from('profiles')
      .select('user_id, username')
      .in('user_id', userIds);

    if (profilesError) {
      throw new Error(`Failed to fetch leaderboard profiles: ${profilesError.message}`);
    }

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

}
