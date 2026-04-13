-- Hardening: fix events RLS and add source CHECK constraint
-- Addresses adversarial review findings #3 and #7

-- #3: Events INSERT policy was WITH CHECK (true), allowing any authenticated
-- user to insert events with any user_id. The server uses service role
-- (bypasses RLS), so remove the authenticated INSERT grant entirely.
REVOKE INSERT ON events FROM authenticated;

DROP POLICY IF EXISTS "Service role can insert events" ON events;

-- Service role bypasses RLS, no explicit policy needed for server-side inserts.
-- If we ever need client-side event insertion, add:
--   CREATE POLICY "Users can insert own events" ON events
--     FOR INSERT WITH CHECK (auth.uid() = user_id);

-- #7: Add CHECK constraint on positions.source column
-- Backfill any NULL values from before migration 008 added the column
UPDATE positions SET source = 'manual' WHERE source IS NULL;

ALTER TABLE positions ADD CONSTRAINT positions_source_check
  CHECK (source IN ('manual', 'signal'));
