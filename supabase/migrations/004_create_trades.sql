-- Create trades table (closed position history)
CREATE TABLE IF NOT EXISTS trades (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  asset VARCHAR(10) NOT NULL,
  side VARCHAR(10) NOT NULL CHECK (side IN ('long', 'short')),
  entry_price DECIMAL(20, 8) NOT NULL,
  exit_price DECIMAL(20, 8) NOT NULL,
  size DECIMAL(20, 8) NOT NULL,
  pnl DECIMAL(20, 8) NOT NULL,
  pnl_percent DECIMAL(10, 4) NOT NULL,
  opened_at TIMESTAMPTZ NOT NULL,
  closed_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_trades_user_id ON trades(user_id);
CREATE INDEX IF NOT EXISTS idx_trades_closed_at ON trades(closed_at DESC);
CREATE INDEX IF NOT EXISTS idx_trades_user_closed ON trades(user_id, closed_at DESC);

-- Enable RLS
ALTER TABLE trades ENABLE ROW LEVEL SECURITY;

-- Policies
CREATE POLICY "Users can view own trades"
  ON trades FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own trades"
  ON trades FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);
