-- Atomic market order execution: deducts margin and creates position in a single transaction
CREATE OR REPLACE FUNCTION execute_market_order(
  p_position_id UUID,
  p_user_id UUID,
  p_asset VARCHAR,
  p_side VARCHAR,
  p_entry_price DECIMAL,
  p_size DECIMAL,
  p_leverage INTEGER,
  p_margin DECIMAL,
  p_liquidation_price DECIMAL
)
RETURNS JSON AS $$
DECLARE
  v_account RECORD;
  v_new_balance DECIMAL;
  v_position RECORD;
BEGIN
  -- Lock the account row to prevent concurrent modifications
  SELECT * INTO v_account
  FROM accounts
  WHERE user_id = p_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Account not found for user %', p_user_id;
  END IF;

  -- Check sufficient balance
  IF v_account.balance < p_margin THEN
    RAISE EXCEPTION 'Insufficient margin. Required: %, Available: %', p_margin, v_account.balance;
  END IF;

  -- Deduct margin from balance
  v_new_balance := v_account.balance - p_margin;
  UPDATE accounts SET balance = v_new_balance, updated_at = NOW()
  WHERE user_id = p_user_id;

  -- Create position
  INSERT INTO positions (
    id, user_id, asset, side, entry_price, current_price,
    size, leverage, margin, liquidation_price,
    unrealized_pnl, unrealized_pnl_percent, realized_pnl,
    status, opened_at
  ) VALUES (
    p_position_id, p_user_id, p_asset, p_side, p_entry_price, p_entry_price,
    p_size, p_leverage, p_margin, p_liquidation_price,
    0, 0, 0,
    'open', NOW()
  )
  RETURNING * INTO v_position;

  -- Return position data as JSON
  RETURN row_to_json(v_position);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Atomic position close: updates position, returns margin + PnL, and records trade
CREATE OR REPLACE FUNCTION close_position_atomic(
  p_position_id UUID,
  p_user_id UUID,
  p_current_price DECIMAL,
  p_pnl DECIMAL,
  p_pnl_percent DECIMAL,
  p_trade_id UUID
)
RETURNS JSON AS $$
DECLARE
  v_position RECORD;
  v_account RECORD;
  v_new_balance DECIMAL;
  v_closed_position RECORD;
  v_closed_at TIMESTAMPTZ := NOW();
BEGIN
  -- Lock and fetch position
  SELECT * INTO v_position
  FROM positions
  WHERE id = p_position_id AND user_id = p_user_id AND status = 'open'
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Position not found or already closed';
  END IF;

  -- Close position
  UPDATE positions SET
    current_price = p_current_price,
    unrealized_pnl = 0,
    unrealized_pnl_percent = 0,
    realized_pnl = p_pnl,
    status = 'closed',
    closed_at = v_closed_at,
    updated_at = NOW()
  WHERE id = p_position_id
  RETURNING * INTO v_closed_position;

  -- Lock and update account balance (return margin + PnL)
  SELECT * INTO v_account
  FROM accounts
  WHERE user_id = p_user_id
  FOR UPDATE;

  v_new_balance := v_account.balance + v_position.margin + p_pnl;
  UPDATE accounts SET balance = v_new_balance, updated_at = NOW()
  WHERE user_id = p_user_id;

  -- Record trade history
  INSERT INTO trades (id, user_id, asset, side, entry_price, exit_price, size, pnl, pnl_percent, opened_at, closed_at)
  VALUES (
    p_trade_id, p_user_id, v_position.asset, v_position.side,
    v_position.entry_price, p_current_price, v_position.size,
    p_pnl, p_pnl_percent, v_position.opened_at, v_closed_at
  );

  -- Return closed position data
  RETURN row_to_json(v_closed_position);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Atomic liquidation: closes position and zeroes margin
CREATE OR REPLACE FUNCTION liquidate_position_atomic(
  p_position_id UUID
)
RETURNS VOID AS $$
DECLARE
  v_position RECORD;
BEGIN
  -- Lock and fetch position
  SELECT * INTO v_position
  FROM positions
  WHERE id = p_position_id AND status = 'open'
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  -- Close with liquidation (margin is already deducted from balance, so no balance update needed)
  UPDATE positions SET
    status = 'liquidated',
    realized_pnl = -v_position.margin,
    unrealized_pnl = 0,
    unrealized_pnl_percent = 0,
    closed_at = NOW(),
    updated_at = NOW()
  WHERE id = p_position_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION execute_market_order TO authenticated;
GRANT EXECUTE ON FUNCTION close_position_atomic TO authenticated;
GRANT EXECUTE ON FUNCTION liquidate_position_atomic TO authenticated;
