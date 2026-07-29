import { randomUUID } from 'node:crypto';
import { getSupabase } from '../../lib/supabase.js';
import { TRADING_CONSTANTS } from '../../config/constants.js';
import { PnlCalculator } from './pnlCalculator.js';
import { priceService } from '../price/index.js';
import type { Account, OrderSide } from '../../types/trading.js';
import type { UserStats } from '../../types/user.js';

interface AccountSnapshotRow {
  id: string;
  user_id: string;
  balance: number | string;
  initial_balance: number | string;
  reset_count: number | string;
  created_at: string;
}

interface OpenPositionSnapshotRow {
  id: string;
  asset: string;
  side: OrderSide;
  entry_price: number | string;
  current_price: number | string;
  size: number | string;
  margin: number | string;
}

export class AccountManager {
  private pnlCalculator: PnlCalculator;

  constructor() {
    this.pnlCalculator = new PnlCalculator();
  }

  async getAccount(userId: string): Promise<Account> {
    const supabase = getSupabase();

    const { data: snapshot, error } = await supabase.rpc('get_account_snapshot', {
      p_user_id: userId,
    });

    if (error) {
      throw new Error(`Failed to fetch account snapshot: ${error.message}`);
    }

    // Provisioning creates this row with the auth user. Retain a checked legacy
    // fallback for accounts created before that trigger existed.
    if (!snapshot?.account) {
      return this.createAccount(userId);
    }

    const account = snapshot.account as AccountSnapshotRow;
    const positions = Array.isArray(snapshot.positions)
      ? snapshot.positions as OpenPositionSnapshotRow[]
      : [];

    let unrealizedPnl = 0;
    let usedMargin = 0;
    let priceStale = false;
    for (const position of positions) {
      const entryPrice = Number(position.entry_price);
      const size = Number(position.size);
      const margin = Number(position.margin);
      const livePrice = priceService.getCurrentPrice(position.asset);
      if (livePrice === null) priceStale = true;
      const currentPrice = livePrice ?? Number(position.current_price);

      if (
        !Number.isFinite(entryPrice)
        || entryPrice <= 0
        || !Number.isFinite(size)
        || size <= 0
        || !Number.isFinite(margin)
        || margin <= 0
        || !Number.isFinite(currentPrice)
        || currentPrice <= 0
        || !['long', 'short'].includes(position.side)
      ) {
        throw new Error(`Position ${position.id} contains invalid accounting values`);
      }

      const rawPnl = this.pnlCalculator.calculatePnl(
        entryPrice,
        currentPrice,
        size,
        position.side
      );
      unrealizedPnl += Math.max(rawPnl, -margin);
      usedMargin += margin;
    }

    // Note: balance already has margin deducted when positions are opened
    // So availableMargin = balance (not balance - usedMargin, which would double-count)
    // Equity = available balance + locked margin + live unrealized PnL.
    return {
      id: account.id,
      userId: account.user_id,
      balance: Number(account.balance),
      initialBalance: Number(account.initial_balance),
      equity: Number(account.balance) + usedMargin + unrealizedPnl,
      unrealizedPnl,
      usedMargin,
      availableMargin: Number(account.balance),
      priceStale,
      resetCount: Number(account.reset_count) || 0,
      createdAt: account.created_at,
    };
  }

  async createAccount(userId: string): Promise<Account> {
    const supabase = getSupabase();

    const { data: account, error } = await supabase
      .from('accounts')
      .insert({
        id: randomUUID(),
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
      priceStale: false,
      resetCount: account.reset_count,
      createdAt: account.created_at,
    };
  }

  async resetAccount(userId: string): Promise<Account> {
    const supabase = getSupabase();

    const { data, error } = await supabase.rpc('reset_account_atomic', {
      p_user_id: userId,
    });

    if (error || !data) {
      throw new Error(
        `Failed to reset account: ${error?.message || 'database returned no account'}`
      );
    }

    // The reset RPC returns the row committed by the same transaction that
    // cleared positions, history, and leaderboard state. Do not perform a
    // second snapshot read here: if that follow-up failed, the API would report
    // failure after a destructive reset had already committed and invite an
    // unnecessary second generation increment on retry.
    const account = data as AccountSnapshotRow;
    const balance = Number(account.balance);
    const initialBalance = Number(account.initial_balance);
    const resetCount = Number(account.reset_count);

    if (
      !account.id
      || account.user_id !== userId
      || !Number.isFinite(balance)
      || balance < 0
      || !Number.isFinite(initialBalance)
      || initialBalance <= 0
      || !Number.isSafeInteger(resetCount)
      || resetCount < 0
      || !account.created_at
    ) {
      throw new Error('Failed to reset account: database returned an invalid account');
    }

    return {
      id: account.id,
      userId: account.user_id,
      balance,
      initialBalance,
      equity: balance,
      unrealizedPnl: 0,
      usedMargin: 0,
      availableMargin: balance,
      priceStale: false,
      resetCount,
      createdAt: account.created_at,
    };
  }

  async getUserStats(userId: string): Promise<UserStats> {
    const supabase = getSupabase();

    const { data: trades, error: tradesError } = await supabase
      .from('trades')
      .select('*')
      .eq('user_id', userId)
      .order('closed_at', { ascending: true });

    if (tradesError) {
      throw new Error(`Failed to fetch user stats: ${tradesError.message}`);
    }

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
