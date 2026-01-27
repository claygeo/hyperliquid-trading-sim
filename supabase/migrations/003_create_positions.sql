-- Create positions table
CREATE TABLE IF NOT EXISTS positions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  asset VARCHAR(10) NOT NULL,
  side VARCHAR(10) NOT NULL CHECK (side IN ('long', 'short')),
  entry_price DECIMAL(20, 8) NOT NULL,
  current_price DECIMAL(20, 8) NOT NULL,
  size DECIMAL(20, 8) NOT NULL,
  leverage INTEGER NOT NULL DEFAULT 10,
  margin DECIMAL(20, 8) NOT NULL,
  liquidation_price DECIMAL(20, 8) NOT NULL,
  unrealized_pnl DECIMAL(20, 8) NOT NULL DEFAULT 0,
  unrealized_pnl_percent DECIMAL(10, 4) NOT NULL DEFAULT 0,
  realized_pnl DECIMAL(20, 8) NOT NULL DEFAULT 0,
  status VARCHAR(20) NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed', 'liquidated')),
  opened_at TIMESTAMPTZ DEFAULT NOW(),
  closed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_positions_user_id ON positions(user_id);
CREATE INDEX IF NOT EXISTS idx_positions_status ON positions(status);
CREATE INDEX IF NOT EXISTS idx_positions_user_status ON positions(user_id, status);
CREATE INDEX IF NOT EXISTS idx_positions_asset ON positions(asset);

-- Enable RLS
ALTER TABLE positions ENABLE ROW LEVEL SECURITY;

-- Policies
CREATE POLICY "Users can view own positions"
  ON positions FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own positions"
  ON positions FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own positions"
  ON positions FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id);

-- Trigger to update updated_at
CREATE TRIGGER update_positions_updated_at
  BEFORE UPDATE ON positions
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
