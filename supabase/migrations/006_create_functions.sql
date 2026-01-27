-- Function to increment reset count
CREATE OR REPLACE FUNCTION increment_reset_count(user_id_param UUID)
RETURNS void AS $$
BEGIN
  UPDATE accounts 
  SET reset_count = reset_count + 1,
      updated_at = NOW()
  WHERE user_id = user_id_param;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to get user rank
CREATE OR REPLACE FUNCTION get_user_rank(user_id_param UUID)
RETURNS INTEGER AS $$
DECLARE
  user_rank INTEGER;
BEGIN
  SELECT rank INTO user_rank
  FROM (
    SELECT user_id, ROW_NUMBER() OVER (ORDER BY total_pnl_percent DESC) as rank
    FROM leaderboard_stats
    WHERE trade_count > 0
  ) ranked
  WHERE user_id = user_id_param;
  
  RETURN COALESCE(user_rank, 0);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to update account balance after trade
CREATE OR REPLACE FUNCTION update_balance_after_trade()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status = 'closed' AND OLD.status = 'open' THEN
    UPDATE accounts 
    SET balance = balance + NEW.realized_pnl,
        updated_at = NOW()
    WHERE user_id = NEW.user_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger to update balance when position closes
CREATE TRIGGER on_position_close
  AFTER UPDATE ON positions
  FOR EACH ROW
  WHEN (NEW.status = 'closed' AND OLD.status = 'open')
  EXECUTE FUNCTION update_balance_after_trade();

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION increment_reset_count TO authenticated;
GRANT EXECUTE ON FUNCTION get_user_rank TO authenticated;
