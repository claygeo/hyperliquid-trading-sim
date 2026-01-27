import { v4 as uuidv4 } from 'uuid';
import { getSupabase } from '../../lib/supabase.js';
import { ValidationError, InsufficientFundsError } from '../../lib/errors.js';
import { TRADING_CONSTANTS } from '../../config/constants.js';
import { isValidAsset } from '../../config/assets.js';
import { PnlCalculator } from './pnlCalculator.js';
import type { Position, PlaceOrderRequest, OrderSide } from '../../types/trading.js';
import { logger } from '../../lib/logger.js';

export class OrderExecutor {
  private pnlCalculator: PnlCalculator;

  constructor() {
    this.pnlCalculator = new PnlCalculator();
  }

  // Get or create account for user
  private async getOrCreateAccount(userId: string) {
    const supabase = getSupabase();

    const { data: account, error: accountError } = await supabase
      .from('accounts')
      .select('*')
      .eq('user_id', userId)
      .single();

    if (accountError || !account) {
      logger.info(`Creating account for user ${userId}`);
      
      // Create account with initial balance
      const { data: newAccount, error: createError } = await supabase
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

      if (createError || !newAccount) {
        logger.error(`Failed to create account for user ${userId}:`, createError);
        throw new ValidationError(`Failed to create account: ${createError?.message || 'Unknown error'}`);
      }

      return newAccount;
    }

    return account;
  }

  async executeMarketOrder(
    userId: string,
    request: PlaceOrderRequest,
    currentPrice: number
  ): Promise<Position> {
    const { asset, side, size, leverage } = request;

    logger.info(`Executing order: ${side} ${size} ${asset} @ ${currentPrice} with ${leverage}x for user ${userId}`);

    // Validate inputs
    if (!isValidAsset(asset)) {
      throw new ValidationError(`Invalid asset: ${asset}`);
    }

    if (size < TRADING_CONSTANTS.MIN_ORDER_SIZE) {
      throw new ValidationError(`Size must be at least ${TRADING_CONSTANTS.MIN_ORDER_SIZE}`);
    }

    if (leverage < 1 || leverage > TRADING_CONSTANTS.MAX_LEVERAGE) {
      throw new ValidationError(`Leverage must be between 1 and ${TRADING_CONSTANTS.MAX_LEVERAGE}`);
    }

    if (currentPrice <= 0) {
      throw new ValidationError('Invalid price');
    }

    const supabase = getSupabase();

    // Get or create user's account
    const account = await this.getOrCreateAccount(userId);
    logger.info(`Account balance: ${account.balance}`);

    // Calculate margin required
    const notionalValue = size * currentPrice;
    const marginRequired = notionalValue / leverage;

    logger.info(`Notional: ${notionalValue}, Margin required: ${marginRequired}`);

    // Available balance is just the account balance
    // (margin is deducted from balance when positions are opened, so no need to subtract usedMargin)
    const availableBalance = account.balance;

    logger.info(`Available balance: ${availableBalance}`);

    if (marginRequired > availableBalance) {
      throw new InsufficientFundsError(
        `Insufficient margin. Required: $${marginRequired.toFixed(2)}, Available: $${availableBalance.toFixed(2)}`
      );
    }

    // Deduct margin from balance
    const newBalance = account.balance - marginRequired;
    const { error: balanceError } = await supabase
      .from('accounts')
      .update({ balance: newBalance })
      .eq('user_id', userId);

    if (balanceError) {
      logger.error(`Failed to update balance:`, balanceError);
      throw new Error(`Failed to update balance: ${balanceError.message}`);
    }

    logger.info(`Updated balance from ${account.balance} to ${newBalance}`);

    // Calculate liquidation price
    const liquidationPrice = this.pnlCalculator.calculateLiquidationPrice(
      currentPrice,
      leverage,
      side
    );

    // Create position
    const positionId = uuidv4();
    const position = {
      id: positionId,
      user_id: userId,
      asset,
      side,
      entry_price: currentPrice,
      current_price: currentPrice,
      size,
      leverage,
      margin: marginRequired,
      liquidation_price: liquidationPrice,
      unrealized_pnl: 0,
      unrealized_pnl_percent: 0,
      realized_pnl: 0,
      status: 'open',
      opened_at: new Date().toISOString(),
    };

    // Insert position
    const { data: newPosition, error: insertError } = await supabase
      .from('positions')
      .insert(position)
      .select()
      .single();

    if (insertError) {
      // Rollback balance deduction
      await supabase
        .from('accounts')
        .update({ balance: account.balance })
        .eq('user_id', userId);
      
      logger.error(`Failed to create position:`, insertError);
      throw new Error(`Failed to create position: ${insertError.message}`);
    }

    logger.info(`Position created: ${positionId}`);

    return this.mapDbPosition(newPosition);
  }

  async closePosition(
    userId: string,
    positionId: string,
    currentPrice: number
  ): Promise<Position> {
    const supabase = getSupabase();

    // Get position
    const { data: position, error: posError } = await supabase
      .from('positions')
      .select('*')
      .eq('id', positionId)
      .eq('user_id', userId)
      .eq('status', 'open')
      .single();

    if (posError || !position) {
      throw new ValidationError('Position not found');
    }

    // Calculate PnL
    const pnl = this.pnlCalculator.calculatePnl(
      position.entry_price,
      currentPrice,
      position.size,
      position.side as OrderSide
    );

    const pnlPercent = this.pnlCalculator.calculatePnlPercent(
      position.entry_price,
      currentPrice,
      position.side as OrderSide,
      position.leverage
    );

    // Update position to closed
    const { data: closedPosition, error: updateError } = await supabase
      .from('positions')
      .update({
        current_price: currentPrice,
        unrealized_pnl: 0,
        unrealized_pnl_percent: 0,
        realized_pnl: pnl,
        status: 'closed',
        closed_at: new Date().toISOString(),
      })
      .eq('id', positionId)
      .select()
      .single();

    if (updateError) {
      throw new Error(`Failed to close position: ${updateError.message}`);
    }

    // Update account balance - return margin + PnL
    const { data: account } = await supabase
      .from('accounts')
      .select('balance')
      .eq('user_id', userId)
      .single();

    if (account) {
      const newBalance = account.balance + position.margin + pnl;
      await supabase
        .from('accounts')
        .update({ balance: newBalance })
        .eq('user_id', userId);
      
      logger.info(`Position closed. Returned margin ${position.margin} + PnL ${pnl}. New balance: ${newBalance}`);
    }

    // Record trade history
    await supabase.from('trades').insert({
      id: uuidv4(),
      user_id: userId,
      asset: position.asset,
      side: position.side,
      entry_price: position.entry_price,
      exit_price: currentPrice,
      size: position.size,
      pnl,
      pnl_percent: pnlPercent,
      opened_at: position.opened_at,
      closed_at: new Date().toISOString(),
    });

    return this.mapDbPosition(closedPosition);
  }

  private mapDbPosition(db: Record<string, unknown>): Position {
    return {
      id: db.id as string,
      userId: db.user_id as string,
      asset: db.asset as string,
      side: db.side as OrderSide,
      entryPrice: db.entry_price as number,
      currentPrice: db.current_price as number,
      size: db.size as number,
      leverage: db.leverage as number,
      margin: db.margin as number,
      liquidationPrice: db.liquidation_price as number,
      unrealizedPnl: db.unrealized_pnl as number,
      unrealizedPnlPercent: db.unrealized_pnl_percent as number,
      realizedPnl: db.realized_pnl as number,
      status: db.status as Position['status'],
      openedAt: db.opened_at as string,
      closedAt: db.closed_at as string | undefined,
    };
  }
}
