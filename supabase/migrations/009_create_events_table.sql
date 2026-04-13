-- Event sourcing foundation: append-only audit log for replay engine
-- This is an audit log with time-range queries, not deterministic event sourcing
-- with full replay guarantees. Events capture post-fee PnL numbers.
CREATE TABLE IF NOT EXISTS events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type VARCHAR(50) NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}',
  user_id UUID,
  session_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for replay queries: fetch events for a user within a time range
CREATE INDEX IF NOT EXISTS idx_events_user_created ON events (user_id, created_at);

-- Index for event type filtering
CREATE INDEX IF NOT EXISTS idx_events_type ON events (type);

-- RLS: users can only read their own events
ALTER TABLE events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own events" ON events
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Service role can insert events" ON events
  FOR INSERT WITH CHECK (true);

-- Grant access
GRANT SELECT ON events TO authenticated;
GRANT INSERT ON events TO authenticated;
