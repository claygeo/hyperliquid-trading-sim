import { randomUUID } from 'node:crypto';
import { getSupabase } from '../../lib/supabase.js';
import { ConflictError, ValidationError, InsufficientFundsError } from '../../lib/errors.js';
import { TRADING_CONSTANTS } from '../../config/constants.js';
import { isValidAsset } from '../../config/assets.js';
import { PnlCalculator } from './pnlCalculator.js';
import type { Position, PlaceOrderRequest, OrderSide } from '../../types/trading.js';
import { logger } from '../../lib/logger.js';
import { eventService } from '../events/index.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const toStoragePrecision = (value: number): number => Number(value.toFixed(8));

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

    if (accountError && accountError.code !== 'PGRST116') {
      throw new ValidationError(`Failed to fetch account: ${accountError.message}`);
    }

    if (!account) {
      logger.info(`Creating account for user ${userId}`);
      
      const { data: newAccount, error: createError } = await supabase
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

      if (createError?.code === '23505') {
        const { data: concurrentAccount, error: concurrentError } = await supabase
          .from('accounts')
          .select('*')
          .eq('user_id', userId)
          .single();

        if (!concurrentError && concurrentAccount) {
          return concurrentAccount;
        }
      }

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
    currentPrice: number,
    idempotencyKey: string = randomUUID()
  ): Promise<Position> {
    const { asset, side, size, leverage, expectedAccountResetCount } = request;

    logger.info(`Executing order: ${side} ${size} ${asset} @ ${currentPrice} with ${leverage}x for user ${userId}`);

    // Validate inputs
    if (!isValidAsset(asset)) {
      throw new ValidationError(`Invalid asset: ${asset}`);
    }

    if (!Number.isFinite(size) || size < TRADING_CONSTANTS.MIN_ORDER_SIZE) {
      throw new ValidationError(`Size must be at least ${TRADING_CONSTANTS.MIN_ORDER_SIZE}`);
    }

    if (!Number.isInteger(leverage) || leverage < 1 || leverage > TRADING_CONSTANTS.MAX_LEVERAGE) {
      throw new ValidationError(`Leverage must be a whole number between 1 and ${TRADING_CONSTANTS.MAX_LEVERAGE}`);
    }

    if (!Number.isFinite(currentPrice) || currentPrice <= 0) {
      throw new ValidationError('Invalid price');
    }

    if (!UUID_PATTERN.test(idempotencyKey)) {
      throw new ValidationError('Invalid idempotency key');
    }

    if (!Number.isSafeInteger(expectedAccountResetCount) || expectedAccountResetCount < 0) {
      throw new ValidationError('Invalid expected account reset generation');
    }

    const isSignalOrder = request.source === 'signal';
    if (isSignalOrder !== Boolean(request.signalId)) {
      throw new ValidationError('signalId is required exactly when source is signal');
    }

    if (request.signalId && !/^[A-Za-z0-9:_-]{1,100}$/.test(request.signalId)) {
      throw new ValidationError('Invalid signalId');
    }

    // Apply slippage to entry price (buys slip up, sells slip down)
    const canonicalSize = toStoragePrecision(size);
    const notionalValue = canonicalSize * currentPrice;
    if (!Number.isFinite(notionalValue) || notionalValue > TRADING_CONSTANTS.MAX_ORDER_NOTIONAL) {
      throw new ValidationError('Order notional exceeds the $5,000,000 limit');
    }
    const slippedPrice = toStoragePrecision(
      this.pnlCalculator.applySlippage(currentPrice, notionalValue, side)
    );

    // Calculate margin based on slipped price
    const slippedNotional = canonicalSize * slippedPrice;
    if (
      !Number.isFinite(slippedNotional)
      || slippedNotional <= 0
      || slippedNotional > TRADING_CONSTANTS.MAX_ORDER_NOTIONAL
    ) {
      throw new ValidationError('Order notional exceeds the $5,000,000 limit after slippage');
    }

    // The persisted entry price is already slippage-adjusted, so both the
    // opening audit event and close-time accounting derive the entry fee from
    // this same execution notional.
    const entryFee = this.pnlCalculator.calculateFee(
      slippedNotional,
      TRADING_CONSTANTS.TAKER_FEE
    );

    const marginRequired = toStoragePrecision(slippedNotional / leverage);
    const liquidationPrice = toStoragePrecision(
      this.pnlCalculator.calculateLiquidationPrice(slippedPrice, leverage, side)
    );

    if (
      !Number.isFinite(slippedPrice)
      || slippedPrice <= 0
      || !Number.isFinite(marginRequired)
      || marginRequired <= 0
      || !Number.isFinite(liquidationPrice)
      || liquidationPrice <= 0
    ) {
      throw new ValidationError('Order produced invalid execution values');
    }

    // Ensure account exists only after all untrusted numerical inputs are bounded.
    await this.getOrCreateAccount(userId);

    logger.info(`Notional: ${notionalValue}, Slipped price: ${slippedPrice}, Fee: ${entryFee}, Margin: ${marginRequired}`);

    const positionId = randomUUID();
    const supabase = getSupabase();

    // Execute atomically via RPC — balance check, deduction, and position creation
    // all happen in a single database transaction
    const { data, error } = await supabase.rpc('execute_market_order', {
      p_position_id: positionId,
      p_user_id: userId,
      p_idempotency_key: idempotencyKey,
      p_expected_account_reset_count: expectedAccountResetCount,
      p_asset: asset,
      p_side: side,
      p_entry_price: slippedPrice,
      p_size: canonicalSize,
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
      if (
        error.message?.includes('Idempotency key reused')
        || error.message?.includes('Idempotency key belongs to a prior account reset')
        || error.message?.includes('Account reset generation changed')
        || error.message?.includes('Idempotent order result is unavailable')
      ) {
        throw new ConflictError(error.message);
      }
      logger.error(`Transaction failed for order:`, error);
      throw new Error(`Failed to execute order: ${error.message}`);
    }

    const wasCreated = data?._created !== false;
    const position = this.mapDbPosition(data);
    logger.info(
      wasCreated
        ? `Position created atomically: ${position.id}`
        : `Order replay returned existing position: ${position.id}`
    );

    // An idempotent replay must not duplicate downstream activity. Events are
    // still best-effort for the first committed order (not an outbox).
    if (wasCreated) {
      await eventService.emit('trade_executed', {
        positionId: position.id,
        asset,
        side,
        size: canonicalSize,
        entryPrice: slippedPrice,
        leverage,
        margin: marginRequired,
        entryFee,
        source: request.source || 'manual',
        signalId: request.signalId || null,
      }, userId);
    }

    return position;
  }

  async closePosition(
    userId: string,
    positionId: string,
    currentPrice: number
  ): Promise<Position> {
    if (!Number.isFinite(currentPrice) || currentPrice <= 0) {
      throw new ValidationError('Invalid price');
    }

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

    const entryPrice = Number(position.entry_price);
    const positionSize = Number(position.size);
    const positionMargin = Number(position.margin);
    if (
      !Number.isFinite(entryPrice)
      || entryPrice <= 0
      || !Number.isFinite(positionSize)
      || positionSize <= 0
      || !Number.isFinite(positionMargin)
      || positionMargin <= 0
      || !['long', 'short'].includes(position.side)
    ) {
      throw new ValidationError('Position contains invalid execution values');
    }

    // Apply slippage to exit price
    const exitMarketNotional = positionSize * currentPrice;
    if (!Number.isFinite(exitMarketNotional) || exitMarketNotional <= 0) {
      throw new ValidationError('Position produced an invalid exit notional');
    }
    const exitSide = position.side === 'long' ? 'short' : 'long'; // Closing reverses direction
    const slippedExitPrice = this.pnlCalculator.applySlippage(
      currentPrice,
      exitMarketNotional,
      exitSide as OrderSide
    );
    if (!Number.isFinite(slippedExitPrice) || slippedExitPrice <= 0) {
      throw new ValidationError('Position produced an invalid exit price');
    }

    // Fee model: both entry and exit fees are deducted from PnL at close time.
    // Entry fee is NOT deducted from balance at open (only margin is). This matches
    // how most perp exchanges work: fees come from realized PnL, not upfront balance.
    // This is not double-counting. The entry fee is calculated once here, not at open.
    const entryNotional = positionSize * entryPrice;
    const exitExecutionNotional = positionSize * slippedExitPrice;
    const entryFee = this.pnlCalculator.calculateFee(entryNotional, TRADING_CONSTANTS.TAKER_FEE);
    const exitFee = this.pnlCalculator.calculateFee(exitExecutionNotional, TRADING_CONSTANTS.TAKER_FEE);
    const totalFees = entryFee + exitFee;

    // Calculate PnL (net of fees)
    const grossPnl = this.pnlCalculator.calculatePnl(
      entryPrice,
      slippedExitPrice,
      positionSize,
      position.side as OrderSide
    );
    const rawPnl = grossPnl - totalFees;

    // Paper positions use isolated margin: one position can lose at most the
    // margin locked when it was opened. The RPC enforces the same boundary so
    // application logs, returned data, and persisted accounting agree.
    const pnl = Math.max(rawPnl, -positionMargin);
    const pnlPercent = (pnl / positionMargin) * 100;

    const tradeId = randomUUID();

    // Close atomically via RPC — position update, balance return, and trade recording
    // all happen in a single database transaction
    const { data, error } = await supabase.rpc('close_position_atomic', {
      p_position_id: positionId,
      p_user_id: userId,
      p_current_price: slippedExitPrice,
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
