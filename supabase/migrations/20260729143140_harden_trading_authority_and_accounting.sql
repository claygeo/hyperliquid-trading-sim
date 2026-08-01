-- Make the Express service the only authority allowed to mutate trading state.
-- This migration is intentionally transactional: if any function or privilege
-- change fails, PostgreSQL rolls the entire migration back.

SET lock_timeout = '5s';
SET statement_timeout = '30s';

-- Keep future public-schema objects from silently reintroducing this exposure.
-- The existing direct-read model is unchanged; browser writes and RPC execution
-- must be granted explicitly in the migration that creates them.
-- PUBLIC's built-in function EXECUTE default is global. PostgreSQL explicitly
-- documents that a schema-scoped REVOKE cannot remove a global default, so this
-- first statement must omit IN SCHEMA.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

-- Supabase's Data API roles can also receive explicit public-schema defaults.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM anon, authenticated;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE INSERT, UPDATE, DELETE ON TABLES FROM anon, authenticated;

-- The original leaderboard stored max drawdown with only two decimal places.
-- That rounded legitimate sub-0.01% drawdowns to zero, so preserve the same
-- four-decimal precision already used by total_pnl_percent.
ALTER TABLE public.leaderboard_stats
  ALTER COLUMN max_drawdown TYPE numeric(10, 4);

-- Provision every application user in the same transaction as auth.users.
-- The browser supplies only username metadata; it never writes balance-bearing
-- rows directly. A duplicate or malformed username aborts the signup instead of
-- leaving an auth user with a fabricated client-side account.
CREATE OR REPLACE FUNCTION public.provision_hypersim_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_username text := pg_catalog.lower(
    pg_catalog.btrim(coalesce(NEW.raw_user_meta_data ->> 'username', ''))
  );
BEGIN
  IF v_username !~ '^[a-z0-9_]{3,20}$' THEN
    RAISE EXCEPTION 'Invalid username';
  END IF;

  IF pg_catalog.lower(coalesce(NEW.email, ''))
      <> v_username || '@hypersim.local' THEN
    RAISE EXCEPTION 'Username and login identity do not match';
  END IF;

  INSERT INTO public.profiles (user_id, username)
  VALUES (NEW.id, v_username);

  INSERT INTO public.accounts (user_id, balance, initial_balance, reset_count)
  VALUES (NEW.id, 100000, 100000, 0);

  INSERT INTO public.leaderboard_stats (
    user_id,
    total_pnl,
    total_pnl_percent,
    win_rate,
    max_drawdown,
    trade_count
  ) VALUES (NEW.id, 0, 0, 0, 0, 0);

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_hypersim_user_created ON auth.users;
CREATE TRIGGER on_hypersim_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.provision_hypersim_user();

REVOKE EXECUTE ON FUNCTION public.provision_hypersim_user()
  FROM PUBLIC, anon, authenticated;

-- Recover users created by the old fail-open registration path. Prefer their
-- valid, unique metadata username; otherwise assign a stable non-identifying
-- username derived from the user UUID. Re-running this repair is harmless.
CREATE OR REPLACE FUNCTION public.repair_hypersim_users()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  WITH profile_candidates AS (
    SELECT
      u.id AS user_id,
      pg_catalog.lower(coalesce(u.email, '')) AS canonical_email,
      pg_catalog.lower(
        pg_catalog.btrim(
          coalesce(
            u.raw_user_meta_data ->> 'username',
            pg_catalog.split_part(coalesce(u.email, ''), '@', 1),
            ''
          )
        )
      ) AS requested_username
    FROM auth.users AS u
    LEFT JOIN public.profiles AS p ON p.user_id = u.id
    WHERE p.user_id IS NULL
  ), ranked_candidates AS (
    SELECT
      pc.*,
      pg_catalog.count(*) OVER (
        PARTITION BY pc.requested_username
      ) AS requested_username_count
    FROM profile_candidates AS pc
  )
  INSERT INTO public.profiles (user_id, username)
  SELECT
    rc.user_id,
    CASE
      WHEN rc.requested_username ~ '^[a-z0-9_]{3,20}$'
        AND rc.canonical_email = rc.requested_username || '@hypersim.local'
        AND rc.requested_username_count = 1
        AND NOT EXISTS (
          SELECT 1
          FROM public.profiles AS existing_profile
          WHERE existing_profile.username = rc.requested_username
        )
      THEN rc.requested_username
      ELSE 'user_' || pg_catalog.left(
        pg_catalog.replace(rc.user_id::text, '-', ''),
        15
      )
    END
  FROM ranked_candidates AS rc
  ON CONFLICT DO NOTHING;

  INSERT INTO public.accounts (user_id, balance, initial_balance, reset_count)
  SELECT u.id, 100000, 100000, 0
  FROM auth.users AS u
  ON CONFLICT (user_id) DO NOTHING;

  INSERT INTO public.leaderboard_stats (
    user_id,
    total_pnl,
    total_pnl_percent,
    win_rate,
    max_drawdown,
    trade_count
  )
  SELECT u.id, 0, 0, 0, 0, 0
  FROM auth.users AS u
  ON CONFLICT (user_id) DO NOTHING;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.repair_hypersim_users()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.repair_hypersim_users()
  TO service_role;

SELECT public.repair_hypersim_users();

-- The old position-close trigger credits realized PnL after every open -> closed
-- transition. close_position_atomic() also credits margin + realized PnL, so the
-- trigger causes wins and losses to be applied twice. Keep the RPC as the single
-- accounting path and remove the trigger path.
DROP TRIGGER IF EXISTS on_position_close ON public.positions;
DROP FUNCTION IF EXISTS public.update_balance_after_trade();

-- Migration 008 added a new execute_market_order signature rather than replacing
-- the original signature from migration 007. Drop the obsolete overload so nine-
-- argument calls cannot resolve to stale behavior.
DROP FUNCTION IF EXISTS public.execute_market_order(
  uuid,
  uuid,
  character varying,
  character varying,
  numeric,
  numeric,
  integer,
  numeric,
  numeric
);

-- Tracker identifiers are external IDs such as "signal-123", not necessarily
-- UUIDs. Migration 008 used UUID and made the actual suggested-trade flow fail.
DROP FUNCTION IF EXISTS public.execute_market_order(
  uuid,
  uuid,
  character varying,
  character varying,
  numeric,
  numeric,
  integer,
  numeric,
  numeric,
  character varying,
  uuid
);

-- The hardened order path adds a caller-supplied idempotency key. Drop the
-- prior text-signal signature so there is no non-idempotent overload left
-- callable after this migration.
DROP FUNCTION IF EXISTS public.execute_market_order(
  uuid,
  uuid,
  character varying,
  character varying,
  numeric,
  numeric,
  integer,
  numeric,
  numeric,
  character varying,
  text
);

ALTER TABLE public.positions
  ALTER COLUMN signal_id TYPE text
  USING signal_id::text;

ALTER TABLE public.positions
  ADD COLUMN IF NOT EXISTS idempotency_key uuid;

-- Existing position IDs are already unique, so they are safe deterministic
-- backfill keys. New requests use a separate user-scoped key supplied by the
-- API caller, allowing the same UUID to be used independently by two users.
UPDATE public.positions AS p
SET idempotency_key = p.id
WHERE p.idempotency_key IS NULL;

ALTER TABLE public.positions
  ALTER COLUMN idempotency_key SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_positions_user_idempotency_key
  ON public.positions (user_id, idempotency_key);

-- Browser writes in the pre-hardening schema could legally drive the INTEGER
-- reset counter to 2147483647, where the next legitimate reset overflowed.
-- Widen before capturing account generations so every legacy INTEGER value has
-- a valid successor and the ledger compares like-for-like values.
ALTER TABLE public.accounts
  ALTER COLUMN reset_count TYPE bigint
  USING reset_count::bigint;

-- Positions are resettable trading state, so they cannot also be the durable
-- record that prevents a delayed request from executing again after a reset.
-- Keep the canonical command and the account generation in a private ledger.
-- The position ID is intentionally not a foreign key: reset deletes the result
-- row while this fence must survive for the lifetime of the user account.
CREATE TABLE IF NOT EXISTS public.order_idempotency (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  idempotency_key uuid NOT NULL,
  position_id uuid NOT NULL,
  account_reset_count bigint NOT NULL,
  asset character varying NOT NULL,
  side character varying NOT NULL,
  size numeric(20, 8) NOT NULL,
  leverage integer NOT NULL,
  source character varying NOT NULL,
  signal_id text,
  created_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  PRIMARY KEY (user_id, idempotency_key)
);

ALTER TABLE public.order_idempotency ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE public.order_idempotency
  FROM PUBLIC, anon, authenticated;

-- Backfill the ledger without trusting pre-hardening reset counts. Existing
-- positions may contain quarantined accounting data, but their command identity
-- still prevents the same request UUID from being charged a second time.
INSERT INTO public.order_idempotency (
  user_id,
  idempotency_key,
  position_id,
  account_reset_count,
  asset,
  side,
  size,
  leverage,
  source,
  signal_id,
  created_at
)
SELECT
  p.user_id,
  p.idempotency_key,
  p.id,
  greatest(coalesce(a.reset_count, 0), 0),
  p.asset,
  p.side,
  p.size,
  p.leverage,
  coalesce(
    p.source,
    CASE WHEN p.signal_id IS NULL THEN 'manual' ELSE 'signal' END
  ),
  p.signal_id,
  coalesce(p.opened_at, p.created_at, pg_catalog.now())
FROM public.positions AS p
JOIN public.accounts AS a ON a.user_id = p.user_id
ON CONFLICT (user_id, idempotency_key) DO NOTHING;

ALTER TABLE public.positions
  DROP CONSTRAINT IF EXISTS positions_source_signal_id_check;
ALTER TABLE public.positions
  ADD CONSTRAINT positions_source_signal_id_check
  CHECK (
    (source = 'manual' AND signal_id IS NULL)
    OR (source = 'signal' AND signal_id IS NOT NULL)
  ) NOT VALID;

ALTER TABLE public.positions
  DROP CONSTRAINT IF EXISTS positions_valid_execution_values_check;
ALTER TABLE public.positions
  ADD CONSTRAINT positions_valid_execution_values_check
  CHECK (
    entry_price > 0
    AND entry_price NOT IN ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric)
    AND current_price > 0
    AND current_price NOT IN ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric)
    AND size > 0
    AND size NOT IN ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric)
    AND leverage BETWEEN 1 AND 50
    AND margin > 0
    AND margin NOT IN ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric)
    AND pg_catalog.abs(margin - ((entry_price * size) / leverage))
        <= greatest(0.00000001, ((entry_price * size) / leverage) * 0.000000001)
    AND liquidation_price > 0
    AND liquidation_price NOT IN ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric)
    AND pg_catalog.abs(
          liquidation_price - CASE
            WHEN side = 'long' THEN entry_price * (1 - (0.95 / leverage))
            ELSE entry_price * (1 + (0.95 / leverage))
          END
        ) <= greatest(0.00000001, entry_price * 0.000000001)
    AND entry_price * size <= 5000000
  ) NOT VALID;

-- A NOT VALID constraint protects new writes but does not repair malformed
-- rows that predate this migration. Normalize the generation before installing
-- it so reset_account_atomic() remains a recovery path for every legacy user.
UPDATE public.accounts AS a
SET reset_count = 0
WHERE a.reset_count IS NULL OR a.reset_count < 0;

ALTER TABLE public.accounts
  DROP CONSTRAINT IF EXISTS accounts_valid_balance_state_check;
ALTER TABLE public.accounts
  ADD CONSTRAINT accounts_valid_balance_state_check
  CHECK (
    balance >= 0
    AND balance NOT IN ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric)
    AND initial_balance > 0
    AND initial_balance NOT IN ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric)
    AND reset_count >= 0
  ) NOT VALID;

-- Recreate every privileged trading RPC with a non-writable search_path. All
-- relations are schema-qualified because SECURITY DEFINER bypasses RLS.
CREATE OR REPLACE FUNCTION public.execute_market_order(
  p_position_id uuid,
  p_user_id uuid,
  p_idempotency_key uuid,
  p_expected_account_reset_count bigint,
  p_asset character varying,
  p_side character varying,
  p_entry_price numeric,
  p_size numeric,
  p_leverage integer,
  p_margin numeric,
  p_liquidation_price numeric,
  p_source character varying DEFAULT 'manual',
  p_signal_id text DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_account record;
  v_idempotency record;
  v_position record;
  v_entry_price numeric;
  v_size numeric;
  v_expected_margin numeric;
  v_expected_liquidation_price numeric;
BEGIN
  IF p_position_id IS NULL
    OR p_idempotency_key IS NULL
    OR p_expected_account_reset_count IS NULL
    OR p_expected_account_reset_count < 0
    OR p_entry_price IS NULL
    OR p_entry_price <= 0
    OR p_entry_price IN ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric)
    OR p_size IS NULL
    OR p_size <= 0
    OR p_size IN ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric)
    OR p_leverage IS NULL
    OR p_leverage < 1
    OR p_leverage > 50
    OR p_margin IS NULL
    OR p_margin <= 0
    OR p_margin IN ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric)
    OR p_liquidation_price IS NULL
    OR p_liquidation_price <= 0
    OR p_liquidation_price IN ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric)
    OR p_entry_price * p_size > 5000000
  THEN
    RAISE EXCEPTION 'Invalid order parameters';
  END IF;

  -- Canonicalize the command to the positions table's numeric(20, 8)
  -- storage boundary before deriving or comparing any accounting value. This
  -- keeps first execution, integrity checks, and idempotent replay identical
  -- for ordinary inputs with more than eight decimal places.
  v_entry_price := pg_catalog.round(p_entry_price, 8);
  v_size := pg_catalog.round(p_size, 8);

  IF v_entry_price <= 0
    OR v_size <= 0
    OR v_entry_price * v_size > 5000000
  THEN
    RAISE EXCEPTION 'Invalid order parameters';
  END IF;

  v_expected_margin := pg_catalog.round(
    (v_entry_price * v_size) / p_leverage,
    8
  );
  v_expected_liquidation_price := pg_catalog.round(CASE
    WHEN p_side = 'long' THEN v_entry_price * (1 - (0.95 / p_leverage))
    WHEN p_side = 'short' THEN v_entry_price * (1 + (0.95 / p_leverage))
    ELSE NULL
  END, 8);

  IF v_expected_liquidation_price IS NULL
    OR v_expected_margin <= 0
    OR pg_catalog.abs(pg_catalog.round(p_margin, 8) - v_expected_margin)
       > greatest(0.00000001, v_expected_margin * 0.000000001)
    OR pg_catalog.abs(
         pg_catalog.round(p_liquidation_price, 8) - v_expected_liquidation_price
       ) > greatest(0.00000001, v_entry_price * 0.000000001)
  THEN
    RAISE EXCEPTION 'Order accounting values do not match authoritative calculations';
  END IF;

  IF p_source IS NULL
    OR p_source NOT IN ('manual', 'signal')
    OR (p_source = 'signal') <> (p_signal_id IS NOT NULL)
    OR pg_catalog.char_length(coalesce(p_signal_id, '')) > 100
    OR (p_signal_id IS NOT NULL AND p_signal_id !~ '^[A-Za-z0-9:_-]+$')
  THEN
    RAISE EXCEPTION 'Invalid signal attribution';
  END IF;

  SELECT *
  INTO v_account
  FROM public.accounts AS a
  WHERE a.user_id = p_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Account not found for user %', p_user_id;
  END IF;

  -- The client binds every command to the account generation it observed.
  -- Because this comparison happens after the account-first lock and before
  -- any balance, position, or ledger mutation, an order already in flight when
  -- reset wins the lock cannot silently execute in the new account generation.
  IF p_expected_account_reset_count IS DISTINCT FROM
     greatest(coalesce(v_account.reset_count, 0), 0)
  THEN
    RAISE EXCEPTION 'Account reset generation changed. Expected: %, Current: %',
      p_expected_account_reset_count,
      greatest(coalesce(v_account.reset_count, 0), 0);
  END IF;

  -- The account row is the per-user serialization point for order, close, and
  -- reset operations. The private command ledger survives position deletion,
  -- so a delayed pre-reset retry can never become a new post-reset debit.
  SELECT *
  INTO v_idempotency
  FROM public.order_idempotency AS oi
  WHERE oi.user_id = p_user_id
    AND oi.idempotency_key = p_idempotency_key;

  IF FOUND THEN
    -- Fresh market data may legitimately change between attempts, so compare
    -- only the canonical caller command. Reusing a key for another command is
    -- rejected instead of returning an unrelated position.
    IF v_idempotency.asset IS DISTINCT FROM p_asset
      OR v_idempotency.side IS DISTINCT FROM p_side
      OR v_idempotency.size IS DISTINCT FROM v_size
      OR v_idempotency.leverage IS DISTINCT FROM p_leverage
      OR v_idempotency.source IS DISTINCT FROM p_source
      OR v_idempotency.signal_id IS DISTINCT FROM p_signal_id
    THEN
      RAISE EXCEPTION 'Idempotency key reused with different order parameters';
    END IF;

    IF v_idempotency.account_reset_count IS DISTINCT FROM
       greatest(coalesce(v_account.reset_count, 0), 0)
    THEN
      RAISE EXCEPTION 'Idempotency key belongs to a prior account reset';
    END IF;

    SELECT *
    INTO v_position
    FROM public.positions AS p
    WHERE p.user_id = p_user_id
      AND p.id = v_idempotency.position_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Idempotent order result is unavailable';
    END IF;

    RETURN (
      pg_catalog.to_jsonb(v_position)
      || pg_catalog.jsonb_build_object('_created', false)
    )::json;
  END IF;

  IF v_account.balance < 0
    OR v_account.balance IN ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric)
  THEN
    RAISE EXCEPTION 'Account has invalid balance state';
  END IF;

  IF v_account.balance < v_expected_margin THEN
    RAISE EXCEPTION 'Insufficient margin. Required: %, Available: %',
      v_expected_margin,
      v_account.balance;
  END IF;

  UPDATE public.accounts AS a
  SET balance = v_account.balance - v_expected_margin,
      updated_at = pg_catalog.now()
  WHERE a.user_id = p_user_id;

  INSERT INTO public.positions (
    id,
    user_id,
    idempotency_key,
    asset,
    side,
    entry_price,
    current_price,
    size,
    leverage,
    margin,
    liquidation_price,
    unrealized_pnl,
    unrealized_pnl_percent,
    realized_pnl,
    status,
    opened_at,
    source,
    signal_id
  ) VALUES (
    p_position_id,
    p_user_id,
    p_idempotency_key,
    p_asset,
    p_side,
    v_entry_price,
    v_entry_price,
    v_size,
    p_leverage,
    v_expected_margin,
    v_expected_liquidation_price,
    0,
    0,
    0,
    'open',
    pg_catalog.now(),
    p_source,
    p_signal_id
  )
  RETURNING * INTO v_position;

  INSERT INTO public.order_idempotency (
    user_id,
    idempotency_key,
    position_id,
    account_reset_count,
    asset,
    side,
    size,
    leverage,
    source,
    signal_id
  ) VALUES (
    p_user_id,
    p_idempotency_key,
    v_position.id,
    greatest(coalesce(v_account.reset_count, 0), 0),
    p_asset,
    p_side,
    v_size,
    p_leverage,
    p_source,
    p_signal_id
  );

  RETURN (
    pg_catalog.to_jsonb(v_position)
    || pg_catalog.jsonb_build_object('_created', true)
  )::json;
END;
$$;

CREATE OR REPLACE FUNCTION public.close_position_atomic(
  p_position_id uuid,
  p_user_id uuid,
  p_current_price numeric,
  p_pnl numeric,
  p_pnl_percent numeric,
  p_trade_id uuid
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_position record;
  v_account record;
  v_closed_position record;
  v_effective_pnl numeric;
  v_effective_pnl_percent numeric;
  v_close_status character varying;
  v_closed_at timestamptz := pg_catalog.now();
  v_total_pnl numeric;
  v_trade_count integer;
  v_winning_trades integer;
  v_win_rate numeric;
  v_max_drawdown numeric;
  v_expected_margin numeric;
  v_expected_liquidation_price numeric;
BEGIN
  -- Every balance-bearing RPC locks account first. One global lock order keeps
  -- order, close, and reset operations serialized without close/reset deadlocks.
  SELECT *
  INTO v_account
  FROM public.accounts AS a
  WHERE a.user_id = p_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Account not found for user %', p_user_id;
  END IF;

  SELECT *
  INTO v_position
  FROM public.positions AS p
  WHERE p.id = p_position_id
    AND p.user_id = p_user_id
    AND p.status = 'open'
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Position not found or already closed';
  END IF;

  IF p_current_price IS NULL
    OR p_current_price <= 0
    OR p_current_price IN ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric)
    OR p_pnl IS NULL
    OR p_pnl IN ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric)
    OR v_position.margin IS NULL
    OR v_position.margin <= 0
    OR v_position.margin IN ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric)
    OR v_position.entry_price IS NULL
    OR v_position.entry_price <= 0
    OR v_position.size IS NULL
    OR v_position.size <= 0
    OR v_position.leverage IS NULL
    OR v_position.leverage < 1
    OR v_position.leverage > 50
    OR v_position.entry_price * v_position.size > 5000000
    OR v_account.balance < 0
    OR v_account.balance IN ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric)
  THEN
    RAISE EXCEPTION 'Invalid close parameters';
  END IF;

  v_expected_margin := (v_position.entry_price * v_position.size) / v_position.leverage;
  v_expected_liquidation_price := CASE
    WHEN v_position.side = 'long'
      THEN v_position.entry_price * (1 - (0.95 / v_position.leverage))
    WHEN v_position.side = 'short'
      THEN v_position.entry_price * (1 + (0.95 / v_position.leverage))
    ELSE NULL
  END;

  IF v_expected_liquidation_price IS NULL
    OR pg_catalog.abs(v_position.margin - v_expected_margin)
       > greatest(0.00000001, v_expected_margin * 0.000000001)
    OR pg_catalog.abs(v_position.liquidation_price - v_expected_liquidation_price)
       > greatest(0.00000001, v_position.entry_price * 0.000000001)
  THEN
    RAISE EXCEPTION 'Position accounting state invalid; reset required';
  END IF;

  -- Isolated margin is the loss boundary. A gap or the simplified slippage
  -- model can never debit more than the amount locked for this position.
  v_effective_pnl := greatest(p_pnl, -v_position.margin);
  v_effective_pnl_percent := (v_effective_pnl / v_position.margin) * 100;
  v_close_status := CASE
    WHEN p_pnl <= -v_position.margin THEN 'liquidated'
    ELSE 'closed'
  END;

  UPDATE public.positions AS p
  SET current_price = p_current_price,
      unrealized_pnl = 0,
      unrealized_pnl_percent = 0,
      realized_pnl = v_effective_pnl,
      status = v_close_status,
      closed_at = v_closed_at,
      updated_at = pg_catalog.now()
  WHERE p.id = p_position_id
  RETURNING * INTO v_closed_position;

  -- The sole close-accounting write: return locked margin exactly once and apply
  -- realized PnL exactly once.
  UPDATE public.accounts AS a
  SET balance = greatest(
        0,
        v_account.balance + v_position.margin + v_effective_pnl
      ),
      updated_at = pg_catalog.now()
  WHERE a.user_id = p_user_id;

  INSERT INTO public.trades (
    id,
    user_id,
    asset,
    side,
    entry_price,
    exit_price,
    size,
    pnl,
    pnl_percent,
    opened_at,
    closed_at
  ) VALUES (
    p_trade_id,
    p_user_id,
    v_position.asset,
    v_position.side,
    v_position.entry_price,
    p_current_price,
    v_position.size,
    v_effective_pnl,
    v_effective_pnl_percent,
    v_position.opened_at,
    v_closed_at
  );

  -- Keep the public leaderboard projection in the same account-locked
  -- transaction as the balance, position, and trade writes. This prevents a
  -- close/reset race from publishing pre-reset stats or reporting failure after
  -- the close has already committed.
  SELECT
    coalesce(pg_catalog.sum(t.pnl), 0),
    pg_catalog.count(*)::integer,
    pg_catalog.count(*) FILTER (WHERE t.pnl > 0)::integer
  INTO v_total_pnl, v_trade_count, v_winning_trades
  FROM public.trades AS t
  WHERE t.user_id = p_user_id;

  v_win_rate := CASE
    WHEN v_trade_count = 0 THEN 0
    ELSE (v_winning_trades::numeric / v_trade_count::numeric) * 100
  END;

  WITH cumulative_equity AS (
    SELECT
      t.closed_at,
      t.id,
      greatest(
        0,
        100000 + pg_catalog.sum(t.pnl) OVER (
          ORDER BY t.closed_at, t.id
          ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
        )
      ) AS equity
    FROM public.trades AS t
    WHERE t.user_id = p_user_id
  ), equity_with_peak AS (
    SELECT
      ce.closed_at,
      ce.id,
      ce.equity,
      greatest(
        100000,
        pg_catalog.max(ce.equity) OVER (
          ORDER BY ce.closed_at, ce.id
          ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
        )
      ) AS peak_equity
    FROM cumulative_equity AS ce
  )
  SELECT coalesce(
    pg_catalog.max(
      CASE
        WHEN ewp.peak_equity > 0
        THEN ((ewp.peak_equity - ewp.equity) / ewp.peak_equity) * 100
        ELSE 0
      END
    ),
    0
  )
  INTO v_max_drawdown
  FROM equity_with_peak AS ewp;

  INSERT INTO public.leaderboard_stats (
    user_id,
    total_pnl,
    total_pnl_percent,
    win_rate,
    max_drawdown,
    trade_count,
    updated_at
  ) VALUES (
    p_user_id,
    v_total_pnl,
    (v_total_pnl / 100000) * 100,
    v_win_rate,
    v_max_drawdown,
    v_trade_count,
    v_closed_at
  )
  ON CONFLICT (user_id) DO UPDATE
  SET total_pnl = EXCLUDED.total_pnl,
      total_pnl_percent = EXCLUDED.total_pnl_percent,
      win_rate = EXCLUDED.win_rate,
      max_drawdown = EXCLUDED.max_drawdown,
      trade_count = EXCLUDED.trade_count,
      updated_at = EXCLUDED.updated_at;

  RETURN pg_catalog.row_to_json(v_closed_position);
END;
$$;

-- The old automatic-liquidation RPC changed position state without returning
-- margin, recording a trade, or updating leaderboard stats. There is no runtime
-- liquidation worker, so remove the deceptive partial primitive. Manual market
-- closes remain loss-capped and are marked liquidated when isolated margin is
-- exhausted.
DROP FUNCTION IF EXISTS public.liquidate_position_atomic(uuid);

-- The old standalone counter helper could advance the account generation
-- without clearing positions or history, invalidating otherwise-current
-- idempotency keys. Atomic reset is the only valid generation transition.
DROP FUNCTION IF EXISTS public.increment_reset_count(uuid);

CREATE OR REPLACE FUNCTION public.reset_account_atomic(p_user_id uuid)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_account record;
  v_reset_account record;
  v_reset_at timestamptz := pg_catalog.now();
BEGIN
  -- Match execute_market_order() and close_position_atomic(): account first,
  -- then any position rows. A concurrent order or close waits and observes the
  -- completed reset instead of having its margin overwritten.
  SELECT *
  INTO v_account
  FROM public.accounts AS a
  WHERE a.user_id = p_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Account not found for user %', p_user_id;
  END IF;

  PERFORM 1
  FROM public.positions AS p
  WHERE p.user_id = p_user_id
    AND p.status = 'open'
  ORDER BY p.id
  FOR UPDATE;

  DELETE FROM public.trades AS t
  WHERE t.user_id = p_user_id;

  -- Reset means a new paper-trading history, not a synthetic close. Deleting
  -- the user's positions also guarantees recovery when an old row violates a
  -- newly-added NOT VALID constraint and therefore cannot be updated safely.
  DELETE FROM public.positions AS p
  WHERE p.user_id = p_user_id;

  UPDATE public.accounts AS a
  SET balance = 100000,
      initial_balance = 100000,
      reset_count = greatest(coalesce(v_account.reset_count, 0), 0) + 1,
      updated_at = v_reset_at
  WHERE a.user_id = p_user_id
  RETURNING * INTO v_reset_account;

  INSERT INTO public.leaderboard_stats (
    user_id,
    total_pnl,
    total_pnl_percent,
    win_rate,
    max_drawdown,
    trade_count,
    updated_at
  ) VALUES (p_user_id, 0, 0, 0, 0, 0, v_reset_at)
  ON CONFLICT (user_id) DO UPDATE
  SET total_pnl = 0,
      total_pnl_percent = 0,
      win_rate = 0,
      max_drawdown = 0,
      trade_count = 0,
      updated_at = v_reset_at;

  RETURN pg_catalog.row_to_json(v_reset_account);
END;
$$;

-- Read the account row and its open positions behind the same account lock
-- used by every accounting mutation. This prevents the server from combining
-- a pre-order account balance with a post-order position list (or vice versa).
CREATE OR REPLACE FUNCTION public.get_account_snapshot(p_user_id uuid)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_account record;
  v_positions json;
BEGIN
  SELECT *
  INTO v_account
  FROM public.accounts AS a
  WHERE a.user_id = p_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  SELECT COALESCE(
    pg_catalog.json_agg(p ORDER BY p.id),
    '[]'::json
  )
  INTO v_positions
  FROM public.positions AS p
  WHERE p.user_id = p_user_id
    AND p.status = 'open';

  RETURN pg_catalog.json_build_object(
    'account', pg_catalog.row_to_json(v_account),
    'positions', v_positions
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.get_user_rank(user_id_param uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_user_rank integer;
BEGIN
  SELECT ranked.user_rank::integer
  INTO v_user_rank
  FROM (
    SELECT
      ls.user_id,
      pg_catalog.row_number() OVER (ORDER BY ls.total_pnl_percent DESC) AS user_rank
    FROM public.leaderboard_stats AS ls
    WHERE ls.trade_count > 0
  ) AS ranked
  WHERE ranked.user_id = user_id_param;

  RETURN coalesce(v_user_rank, 0);
END;
$$;

-- Rebuild existing projections once during migration using the same chronological
-- equity curve as close_position_atomic(). Future close/reset operations maintain
-- these rows transactionally.
WITH cumulative_equity AS (
  SELECT
    t.user_id,
    t.closed_at,
    t.id,
    t.pnl,
    greatest(
      0,
      100000 + pg_catalog.sum(t.pnl) OVER (
        PARTITION BY t.user_id
        ORDER BY t.closed_at, t.id
        ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
      )
    ) AS equity
  FROM public.trades AS t
), equity_with_peak AS (
  SELECT
    ce.*,
    greatest(
      100000,
      pg_catalog.max(ce.equity) OVER (
        PARTITION BY ce.user_id
        ORDER BY ce.closed_at, ce.id
        ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
      )
    ) AS peak_equity
  FROM cumulative_equity AS ce
), rebuilt_stats AS (
  SELECT
    ewp.user_id,
    pg_catalog.sum(ewp.pnl) AS total_pnl,
    (pg_catalog.sum(ewp.pnl) / 100000) * 100 AS total_pnl_percent,
    (pg_catalog.count(*) FILTER (WHERE ewp.pnl > 0)::numeric / pg_catalog.count(*)::numeric) * 100 AS win_rate,
    pg_catalog.max(
      CASE
        WHEN ewp.peak_equity > 0
        THEN ((ewp.peak_equity - ewp.equity) / ewp.peak_equity) * 100
        ELSE 0
      END
    ) AS max_drawdown,
    pg_catalog.count(*)::integer AS trade_count
  FROM equity_with_peak AS ewp
  GROUP BY ewp.user_id
)
INSERT INTO public.leaderboard_stats (
  user_id,
  total_pnl,
  total_pnl_percent,
  win_rate,
  max_drawdown,
  trade_count,
  updated_at
)
SELECT
  rs.user_id,
  rs.total_pnl,
  rs.total_pnl_percent,
  rs.win_rate,
  rs.max_drawdown,
  rs.trade_count,
  pg_catalog.now()
FROM rebuilt_stats AS rs
ON CONFLICT (user_id) DO UPDATE
SET total_pnl = EXCLUDED.total_pnl,
    total_pnl_percent = EXCLUDED.total_pnl_percent,
    win_rate = EXCLUDED.win_rate,
    max_drawdown = EXCLUDED.max_drawdown,
    trade_count = EXCLUDED.trade_count,
    updated_at = EXCLUDED.updated_at;

UPDATE public.leaderboard_stats AS ls
SET total_pnl = 0,
    total_pnl_percent = 0,
    win_rate = 0,
    max_drawdown = 0,
    trade_count = 0,
    updated_at = pg_catalog.now()
WHERE NOT EXISTS (
  SELECT 1
  FROM public.trades AS t
  WHERE t.user_id = ls.user_id
);

-- PostgreSQL grants EXECUTE to PUBLIC on new functions by default. Revoke both
-- that inherited path and any direct grants left by earlier migrations, then
-- grant only the role used by the server-side Supabase client.
REVOKE EXECUTE ON FUNCTION public.execute_market_order(
  uuid,
  uuid,
  uuid,
  bigint,
  character varying,
  character varying,
  numeric,
  numeric,
  integer,
  numeric,
  numeric,
  character varying,
  text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.execute_market_order(
  uuid,
  uuid,
  uuid,
  bigint,
  character varying,
  character varying,
  numeric,
  numeric,
  integer,
  numeric,
  numeric,
  character varying,
  text
) TO service_role;

REVOKE EXECUTE ON FUNCTION public.close_position_atomic(
  uuid,
  uuid,
  numeric,
  numeric,
  numeric,
  uuid
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.close_position_atomic(
  uuid,
  uuid,
  numeric,
  numeric,
  numeric,
  uuid
) TO service_role;

REVOKE EXECUTE ON FUNCTION public.reset_account_atomic(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reset_account_atomic(uuid)
  TO service_role;

REVOKE EXECUTE ON FUNCTION public.get_account_snapshot(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_account_snapshot(uuid)
  TO service_role;

REVOKE EXECUTE ON FUNCTION public.get_user_rank(uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_user_rank(uuid)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_user_rank(uuid)
  TO service_role;

-- RLS ownership checks are not sufficient for accounting invariants: a signed-
-- in user must not set their own balance, PnL, trade history, or leaderboard
-- values. Preserve authenticated SELECT policies, but remove all browser writes.
DROP POLICY IF EXISTS "Users can update own account" ON public.accounts;
DROP POLICY IF EXISTS "Users can insert own positions" ON public.positions;
DROP POLICY IF EXISTS "Users can update own positions" ON public.positions;
DROP POLICY IF EXISTS "Users can insert own trades" ON public.trades;
DROP POLICY IF EXISTS "Users can update own stats" ON public.leaderboard_stats;
DROP POLICY IF EXISTS "Users can insert own stats" ON public.leaderboard_stats;

REVOKE INSERT, UPDATE, DELETE
  ON TABLE public.accounts,
           public.positions,
           public.trades,
           public.leaderboard_stats
  FROM anon, authenticated;

REVOKE INSERT, UPDATE, DELETE ON TABLE public.profiles
  FROM anon, authenticated;

-- Fresh Supabase projects no longer auto-expose new tables. State the read API
-- explicitly so RLS policies are reachable after a clean migration replay.
GRANT SELECT
  ON TABLE public.profiles,
           public.accounts,
           public.positions,
           public.trades,
           public.leaderboard_stats
  TO authenticated;

GRANT UPDATE (avatar_url)
  ON TABLE public.profiles
  TO authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE
  ON TABLE public.accounts,
           public.positions,
           public.trades,
           public.leaderboard_stats
  TO service_role;

GRANT SELECT ON TABLE public.profiles TO service_role;

-- The activity stream is append-only at the database privilege boundary. Its
-- delivery remains best-effort because it is written after trading commits,
-- rather than through a transactional outbox.
REVOKE ALL PRIVILEGES ON TABLE public.events
  FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.events TO authenticated;
GRANT SELECT, INSERT ON TABLE public.events TO service_role;
