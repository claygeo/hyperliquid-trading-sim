-- Create accounts table
CREATE TABLE IF NOT EXISTS accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID UNIQUE NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  balance DECIMAL(20, 8) NOT NULL DEFAULT 100000,
  initial_balance DECIMAL(20, 8) NOT NULL DEFAULT 100000,
  reset_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create index on user_id
CREATE INDEX IF NOT EXISTS idx_accounts_user_id ON accounts(user_id);

-- Enable RLS
ALTER TABLE accounts ENABLE ROW LEVEL SECURITY;

-- Policies
CREATE POLICY "Users can view own account"
  ON accounts FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can update own account"
  ON accounts FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id);

-- Trigger to update updated_at
CREATE TRIGGER update_accounts_updated_at
  BEFORE UPDATE ON accounts
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
