import { v4 as uuidv4 } from 'uuid';
import { getSupabase } from '../../lib/supabase.js';
import { NotFoundError } from '../../lib/errors.js';
import { TRADING_CONSTANTS } from '../../config/constants.js';
import { PnlCalculator } from './pnlCalculator.js';
import type { Account } from '../../types/trading.js';
import type { UserStats } from '../../types/user.js';

interface UserStats {
  totalPnl: number;
  totalPnlPercent: number;
  winRate: number;
  maxDrawdown: number;
  tradeCount: number;
  winningTrades: number;
  losingTrades: number;
  bestTrade: number;
  worstTrade: number;
  averageTrade: number;
  averageWin: number;
  averageLoss: number;
  profitFactor: number;
}

export class AccountManager {
  private pnlCalculator: PnlCalculator;

  constructor() {
    this.pnlCalculator = new PnlCalculator();
  }

  async getAccount(userId: string): Promise<Account> {
    const supabase = getSupabase();

    const { data: account, error } = await supabase
      .from('accounts')
      .select('*')
      .eq('user_id', userId)
      .single();

    // If account doesn't exist, create it
    if (error || !account) {
      return this.createAccount(userId);
    }

    // Get open positions to calculate unrealized PnL and used margin
    const { data: positions } = await supabase
      .from('positions')
      .select('*')
      .eq('user_id', userId)
      .eq('status', 'open');

    const unrealizedPnl = (positions || []).reduce(
      (sum, p) => sum + (p.unrealized_pnl || 0),
      0
    );
    const usedMargin = (positions || []).reduce((sum, p) => sum + p.margin, 0);

    // Note: balance already has margin deducted when positions are opened
    // So availableMargin = balance (not balance - usedMargin, which would double-count)
    // Equity = balance + usedMargin (locked in positions) + unrealizedPnl
    return {
      id: account.id,
      userId: account.user_id,
      balance: account.balance,
      initialBalance: account.initial_balance,
      equity: account.balance + usedMargin + unrealizedPnl,
      unrealizedPnl,
      usedMargin,
      availableMargin: account.balance,
      resetCount: account.reset_count || 0,
      createdAt: account.created_at,
    };
  }

  async createAccount(userId: string): Promise<Account> {
    const supabase = getSupabase();

    const { data: account, error } = await supabase
      .from('accounts')
      .insert({
        id: uuidv4(),
        user_id: userId,
        balance: TRADING_CONSTANTS.INITIAL_BALANCE,
        initial_balance: TRADING_CONSTANTS.INITIAL_BALANCE,
        reset_count: 0,
      })
      .select()
      .single();

    if (error) {
      throw new Error(`Failed to create account: ${error.message}`);
    }

    return {
      id: account.id,
      userId: account.user_id,
      balance: account.balance,
      initialBalance: account.initial_balance,
      equity: account.balance,
      unrealizedPnl: 0,
      usedMargin: 0,
      availableMargin: account.balance,
      resetCount: account.reset_count,
      createdAt: account.created_at,
    };
  }

  async resetAccount(userId: string): Promise<Account> {
    const supabase = getSupabase();

    // Close all open positions
    await supabase
      .from('positions')
      .update({
        status: 'closed',
        closed_at: new Date().toISOString(),
      })
      .eq('user_id', userId)
      .eq('status', 'open');

    // Reset account balance and increment reset count
    const { data: account, error } = await supabase
      .from('accounts')
      .update({
        balance: TRADING_CONSTANTS.INITIAL_BALANCE,
        initial_balance: TRADING_CONSTANTS.INITIAL_BALANCE,
        reset_count: supabase.rpc ? undefined : undefined,
      })
      .eq('user_id', userId)
      .select()
      .single();

    // Increment reset count separately
    await supabase.rpc('increment_reset_count', { user_id_param: userId });

    if (error || !account) {
      // If RPC doesn't exist, do it manually
      const { data: currentAccount } = await supabase
        .from('accounts')
        .select('reset_count')
        .eq('user_id', userId)
        .single();

      await supabase
        .from('accounts')
        .update({
          balance: TRADING_CONSTANTS.INITIAL_BALANCE,
          initial_balance: TRADING_CONSTANTS.INITIAL_BALANCE,
          reset_count: (currentAccount?.reset_count || 0) + 1,
        })
        .eq('user_id', userId);
    }

    // Clear trade history
    await supabase.from('trades').delete().eq('user_id', userId);

    // Reset leaderboard stats
    await supabase
      .from('leaderboard_stats')
      .update({
        total_pnl: 0,
        total_pnl_percent: 0,
        win_rate: 0,
        max_drawdown: 0,
        trade_count: 0,
        updated_at: new Date().toISOString(),
      })
      .eq('user_id', userId);

    return this.getAccount(userId);
  }

  async getUserStats(userId: string): Promise<UserStats> {
    const supabase = getSupabase();

    const { data: trades } = await supabase
      .from('trades')
      .select('*')
      .eq('user_id', userId)
      .order('closed_at', { ascending: true });

    if (!trades || trades.length === 0) {
      return {
        totalPnl: 0,
        totalPnlPercent: 0,
        winRate: 0,
        maxDrawdown: 0,
        tradeCount: 0,
        winningTrades: 0,
        losingTrades: 0,
        bestTrade: 0,
        worstTrade: 0,
        averageTrade: 0,
        averageWin: 0,
        averageLoss: 0,
        profitFactor: 0,
      };
    }

    const winningTrades = trades.filter((t) => t.pnl > 0);
    const losingTrades = trades.filter((t) => t.pnl < 0);

    const totalPnl = trades.reduce((sum, t) => sum + t.pnl, 0);
    const pnlHistory = trades.reduce((acc: number[], t) => {
      const prev = acc.length > 0 ? acc[acc.length - 1] : 0;
      acc.push(prev + t.pnl);
      return acc;
    }, []);

    return {
      totalPnl,
      totalPnlPercent: (totalPnl / TRADING_CONSTANTS.INITIAL_BALANCE) * 100,
      winRate: this.pnlCalculator.calculateWinRate(trades),
      maxDrawdown: this.pnlCalculator.calculateMaxDrawdown(pnlHistory),
      tradeCount: trades.length,
      winningTrades: winningTrades.length,
      losingTrades: losingTrades.length,
      bestTrade: Math.max(...trades.map((t) => t.pnl), 0),
      worstTrade: Math.min(...trades.map((t) => t.pnl), 0),
      averageTrade: totalPnl / trades.length,
      averageWin:
        winningTrades.length > 0
          ? winningTrades.reduce((sum, t) => sum + t.pnl, 0) / winningTrades.length
          : 0,
      averageLoss:
        losingTrades.length > 0
          ? losingTrades.reduce((sum, t) => sum + t.pnl, 0) / losingTrades.length
          : 0,
      profitFactor: this.pnlCalculator.calculateProfitFactor(trades),
    };
  }
}
