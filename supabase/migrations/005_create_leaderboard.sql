-- Create leaderboard_stats table
CREATE TABLE IF NOT EXISTS leaderboard_stats (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID UNIQUE NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  total_pnl DECIMAL(20, 8) NOT NULL DEFAULT 0,
  total_pnl_percent DECIMAL(10, 4) NOT NULL DEFAULT 0,
  win_rate DECIMAL(5, 2) NOT NULL DEFAULT 0,
  max_drawdown DECIMAL(5, 2) NOT NULL DEFAULT 0,
  trade_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_leaderboard_user_id ON leaderboard_stats(user_id);
CREATE INDEX IF NOT EXISTS idx_leaderboard_pnl_percent ON leaderboard_stats(total_pnl_percent DESC);
CREATE INDEX IF NOT EXISTS idx_leaderboard_updated ON leaderboard_stats(updated_at DESC);

-- Enable RLS
ALTER TABLE leaderboard_stats ENABLE ROW LEVEL SECURITY;

-- Policies
CREATE POLICY "Anyone can view leaderboard"
  ON leaderboard_stats FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Users can update own stats"
  ON leaderboard_stats FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own stats"
  ON leaderboard_stats FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- Trigger to update updated_at
CREATE TRIGGER update_leaderboard_stats_updated_at
  BEFORE UPDATE ON leaderboard_stats
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
