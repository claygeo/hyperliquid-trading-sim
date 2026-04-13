import { v4 as uuidv4 } from 'uuid';
import { getSupabase } from '../../lib/supabase.js';
import { ValidationError, InsufficientFundsError } from '../../lib/errors.js';
import { TRADING_CONSTANTS } from '../../config/constants.js';
import { isValidAsset } from '../../config/assets.js';
import { PnlCalculator } from './pnlCalculator.js';
import type { Position, PlaceOrderRequest, OrderSide } from '../../types/trading.js';
import { logger } from '../../lib/logger.js';
import { eventService } from '../events/index.js';

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

    // Ensure account exists before calling RPC
    await this.getOrCreateAccount(userId);

    // Apply slippage to entry price (buys slip up, sells slip down)
    const notionalValue = size * currentPrice;
    const slippedPrice = this.pnlCalculator.applySlippage(currentPrice, notionalValue, side);

    // Calculate entry fee (taker fee for market orders)
    const entryFee = this.pnlCalculator.calculateFee(notionalValue, TRADING_CONSTANTS.TAKER_FEE);

    // Calculate margin based on slipped price
    const slippedNotional = size * slippedPrice;
    const marginRequired = slippedNotional / leverage;
    const liquidationPrice = this.pnlCalculator.calculateLiquidationPrice(
      slippedPrice,
      leverage,
      side
    );

    logger.info(`Notional: ${notionalValue}, Slipped price: ${slippedPrice}, Fee: ${entryFee}, Margin: ${marginRequired}`);

    const positionId = uuidv4();
    const supabase = getSupabase();

    // Execute atomically via RPC — balance check, deduction, and position creation
    // all happen in a single database transaction
    const { data, error } = await supabase.rpc('execute_market_order', {
      p_position_id: positionId,
      p_user_id: userId,
      p_asset: asset,
      p_side: side,
      p_entry_price: slippedPrice,
      p_size: size,
      p_leverage: leverage,
      p_margin: marginRequired,
      p_liquidation_price: liquidationPrice,
      p_source: request.source || 'manual',
      p_signal_id: request.signalId || null,
    });

    if (error) {
      // Map database errors to application errors
      if (error.message?.includes('Insufficient margin')) {
        throw new InsufficientFundsError(error.message);
      }
      logger.error(`Transaction failed for order:`, error);
      throw new Error(`Failed to execute order: ${error.message}`);
    }

    logger.info(`Position created atomically: ${positionId}`);

    const position = this.mapDbPosition(data);

    // Emit trade_executed event (post-fee numbers)
    await eventService.emit('trade_executed', {
      positionId,
      asset,
      side,
      size,
      entryPrice: slippedPrice,
      leverage,
      margin: marginRequired,
      entryFee,
      source: request.source || 'manual',
      signalId: request.signalId || null,
    }, userId);

    return position;
  }

  async closePosition(
    userId: string,
    positionId: string,
    currentPrice: number
  ): Promise<Position> {
    const supabase = getSupabase();

    // Get position to calculate PnL
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

    // Apply slippage to exit price
    const exitNotional = position.size * currentPrice;
    const exitSide = position.side === 'long' ? 'short' : 'long'; // Closing reverses direction
    const slippedExitPrice = this.pnlCalculator.applySlippage(currentPrice, exitNotional, exitSide as OrderSide);

    // Calculate fees: entry fee was already "paid" at open, exit fee deducted now
    const entryNotional = position.size * position.entry_price;
    const entryFee = this.pnlCalculator.calculateFee(entryNotional, TRADING_CONSTANTS.TAKER_FEE);
    const exitFee = this.pnlCalculator.calculateFee(exitNotional, TRADING_CONSTANTS.TAKER_FEE);
    const totalFees = entryFee + exitFee;

    // Calculate PnL (net of fees)
    const grossPnl = this.pnlCalculator.calculatePnl(
      position.entry_price,
      slippedExitPrice,
      position.size,
      position.side as OrderSide
    );
    const pnl = grossPnl - totalFees;

    const pnlPercent = this.pnlCalculator.calculatePnlPercent(
      position.entry_price,
      slippedExitPrice,
      position.side as OrderSide,
      position.leverage
    );

    const tradeId = uuidv4();

    // Close atomically via RPC — position update, balance return, and trade recording
    // all happen in a single database transaction
    const { data, error } = await supabase.rpc('close_position_atomic', {
      p_position_id: positionId,
      p_user_id: userId,
      p_current_price: currentPrice,
      p_pnl: pnl,
      p_pnl_percent: pnlPercent,
      p_trade_id: tradeId,
    });

    if (error) {
      logger.error(`Transaction failed for close position:`, error);
      throw new Error(`Failed to close position: ${error.message}`);
    }

    logger.info(`Position closed atomically. PnL: ${pnl}`);

    return this.mapDbPosition(data);
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
      source: (db.source as Position['source']) || 'manual',
      signalId: db.signal_id as string | undefined,
      openedAt: db.opened_at as string,
      closedAt: db.closed_at as string | undefined,
    };
  }
}
