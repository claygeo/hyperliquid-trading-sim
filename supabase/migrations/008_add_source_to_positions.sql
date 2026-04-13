-- Add source attribution to positions
-- Tracks whether a position was opened manually or from a tracker signal
ALTER TABLE positions ADD COLUMN IF NOT EXISTS source VARCHAR(20) DEFAULT 'manual';
ALTER TABLE positions ADD COLUMN IF NOT EXISTS signal_id UUID;

-- Update the execute_market_order function to accept source and signal_id
CREATE OR REPLACE FUNCTION execute_market_order(
  p_position_id UUID,
  p_user_id UUID,
  p_asset VARCHAR,
  p_side VARCHAR,
  p_entry_price DECIMAL,
  p_size DECIMAL,
  p_leverage INTEGER,
  p_margin DECIMAL,
  p_liquidation_price DECIMAL,
  p_source VARCHAR DEFAULT 'manual',
  p_signal_id UUID DEFAULT NULL
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

  -- Create position with source attribution
  INSERT INTO positions (
    id, user_id, asset, side, entry_price, current_price,
    size, leverage, margin, liquidation_price,
    unrealized_pnl, unrealized_pnl_percent, realized_pnl,
    status, opened_at, source, signal_id
  ) VALUES (
    p_position_id, p_user_id, p_asset, p_side, p_entry_price, p_entry_price,
    p_size, p_leverage, p_margin, p_liquidation_price,
    0, 0, 0,
    'open', NOW(), p_source, p_signal_id
  )
  RETURNING * INTO v_position;

  -- Return position data as JSON
  RETURN row_to_json(v_position);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Re-grant execute permissions
GRANT EXECUTE ON FUNCTION execute_market_order TO authenticated;
