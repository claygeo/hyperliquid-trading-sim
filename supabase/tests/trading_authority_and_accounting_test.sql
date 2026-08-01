BEGIN;
SELECT plan(83);

-- Schema and privilege contract ------------------------------------------------

SELECT ok(
  pg_catalog.to_regprocedure(
    'public.execute_market_order(uuid,uuid,character varying,character varying,numeric,numeric,integer,numeric,numeric)'
  ) IS NULL,
  'the obsolete nine-argument market-order RPC is gone'
);

SELECT ok(
  pg_catalog.to_regprocedure(
    'public.execute_market_order(uuid,uuid,character varying,character varying,numeric,numeric,integer,numeric,numeric,character varying,text)'
  ) IS NULL,
  'the obsolete non-idempotent market-order RPC is gone'
);

SELECT ok(
  pg_catalog.to_regprocedure(
    'public.execute_market_order(uuid,uuid,uuid,bigint,character varying,character varying,numeric,numeric,integer,numeric,numeric,character varying,text)'
  ) IS NOT NULL,
  'the canonical idempotent market-order RPC exists'
);

SELECT ok(
  (
    SELECT a.attnotnull
    FROM pg_catalog.pg_attribute AS a
    WHERE a.attrelid = 'public.positions'::pg_catalog.regclass
      AND a.attname = 'idempotency_key'
      AND NOT a.attisdropped
  ),
  'every position records its idempotency key'
);

SELECT ok(
  EXISTS (
    SELECT 1
    FROM pg_catalog.pg_class AS c
    JOIN pg_catalog.pg_index AS i ON i.indexrelid = c.oid
    WHERE c.oid = pg_catalog.to_regclass('public.idx_positions_user_idempotency_key')
      AND i.indisunique
  ),
  'active-position idempotency is enforced by a user-scoped unique index'
);

SELECT ok(
  EXISTS (
    SELECT 1
    FROM pg_catalog.pg_class AS c
    WHERE c.oid = pg_catalog.to_regclass('public.order_idempotency')
      AND c.relrowsecurity
  ),
  'a private RLS-enabled command ledger persists idempotency across resets'
);

SELECT ok(
  (
    SELECT pg_catalog.format_type(a.atttypid, a.atttypmod)
    FROM pg_catalog.pg_attribute AS a
    WHERE a.attrelid = 'public.accounts'::pg_catalog.regclass
      AND a.attname = 'reset_count'
      AND NOT a.attisdropped
  ) = 'bigint',
  'reset generations have a valid successor for every pre-hardening INTEGER value'
);

SELECT ok(
  NOT pg_catalog.has_table_privilege(
    'anon',
    'public.order_idempotency',
    'SELECT, INSERT, UPDATE, DELETE'
  )
  AND NOT pg_catalog.has_table_privilege(
    'authenticated',
    'public.order_idempotency',
    'SELECT, INSERT, UPDATE, DELETE'
  ),
  'browser roles cannot read or mutate the private idempotency ledger'
);

SELECT is(
  (
    SELECT pg_catalog.count(*)
    FROM pg_catalog.pg_trigger AS t
    WHERE t.tgrelid = 'public.positions'::pg_catalog.regclass
      AND t.tgname = 'on_position_close'
      AND NOT t.tgisinternal
  ),
  0::bigint,
  'the double-credit position-close trigger is gone'
);

SELECT ok(
  pg_catalog.to_regprocedure('public.update_balance_after_trade()') IS NULL,
  'the obsolete trigger function is gone'
);

SELECT ok(
  pg_catalog.to_regprocedure('public.liquidate_position_atomic(uuid)') IS NULL,
  'the incomplete automatic-liquidation RPC is gone'
);

WITH target_functions(function_oid) AS (
  VALUES
    (pg_catalog.to_regprocedure('public.provision_hypersim_user()')),
    (pg_catalog.to_regprocedure('public.repair_hypersim_users()')),
    (pg_catalog.to_regprocedure('public.execute_market_order(uuid,uuid,uuid,bigint,character varying,character varying,numeric,numeric,integer,numeric,numeric,character varying,text)')),
    (pg_catalog.to_regprocedure('public.close_position_atomic(uuid,uuid,numeric,numeric,numeric,uuid)')),
    (pg_catalog.to_regprocedure('public.reset_account_atomic(uuid)')),
    (pg_catalog.to_regprocedure('public.get_account_snapshot(uuid)')),
    (pg_catalog.to_regprocedure('public.get_user_rank(uuid)'))
)
SELECT is(
  (
    SELECT pg_catalog.count(*)
    FROM target_functions AS tf
    JOIN pg_catalog.pg_proc AS p ON p.oid = tf.function_oid
    WHERE coalesce(pg_catalog.array_to_string(p.proconfig, ','), '')
          IN ('search_path=""', 'search_path=')
      AND (
        (p.proname = 'get_user_rank' AND NOT p.prosecdef)
        OR (p.proname <> 'get_user_rank' AND p.prosecdef)
      )
  ),
  7::bigint,
  'provisioning and server RPCs are definer-only, rank is invoker-only, and all paths are empty'
);

SELECT is(
  (
    SELECT pg_catalog.count(*)
    FROM pg_catalog.pg_trigger AS t
    WHERE t.tgrelid = 'auth.users'::pg_catalog.regclass
      AND t.tgname = 'on_hypersim_user_created'
      AND NOT t.tgisinternal
  ),
  1::bigint,
  'auth signup has exactly one durable application-provisioning trigger'
);

WITH target_functions(signature) AS (
  VALUES
    ('public.provision_hypersim_user()'),
    ('public.repair_hypersim_users()'),
    ('public.execute_market_order(uuid,uuid,uuid,bigint,character varying,character varying,numeric,numeric,integer,numeric,numeric,character varying,text)'),
    ('public.close_position_atomic(uuid,uuid,numeric,numeric,numeric,uuid)'),
    ('public.reset_account_atomic(uuid)'),
    ('public.get_account_snapshot(uuid)')
)
SELECT ok(
  NOT EXISTS (
    SELECT 1
    FROM target_functions AS tf
    WHERE pg_catalog.has_function_privilege('authenticated', tf.signature, 'EXECUTE')
  )
  AND pg_catalog.has_function_privilege(
    'authenticated',
    'public.get_user_rank(uuid)',
    'EXECUTE'
  ),
  'authenticated cannot execute privileged RPCs but retains the invoker-only rank read'
);

WITH target_functions(signature) AS (
  VALUES
    ('public.provision_hypersim_user()'),
    ('public.repair_hypersim_users()'),
    ('public.execute_market_order(uuid,uuid,uuid,bigint,character varying,character varying,numeric,numeric,integer,numeric,numeric,character varying,text)'),
    ('public.close_position_atomic(uuid,uuid,numeric,numeric,numeric,uuid)'),
    ('public.reset_account_atomic(uuid)'),
    ('public.get_account_snapshot(uuid)'),
    ('public.get_user_rank(uuid)')
)
SELECT ok(
  NOT EXISTS (
    SELECT 1
    FROM target_functions AS tf
    WHERE pg_catalog.has_function_privilege('anon', tf.signature, 'EXECUTE')
  ),
  'anon cannot execute any privileged RPC'
);

WITH target_functions(signature) AS (
  VALUES
    ('public.repair_hypersim_users()'),
    ('public.execute_market_order(uuid,uuid,uuid,bigint,character varying,character varying,numeric,numeric,integer,numeric,numeric,character varying,text)'),
    ('public.close_position_atomic(uuid,uuid,numeric,numeric,numeric,uuid)'),
    ('public.reset_account_atomic(uuid)'),
    ('public.get_account_snapshot(uuid)'),
    ('public.get_user_rank(uuid)')
)
SELECT ok(
  NOT EXISTS (
    SELECT 1
    FROM target_functions AS tf
    WHERE NOT pg_catalog.has_function_privilege('service_role', tf.signature, 'EXECUTE')
  ),
  'service_role can execute every privileged RPC'
);

WITH readable_tables(table_name) AS (
  VALUES
    ('public.profiles'),
    ('public.accounts'),
    ('public.positions'),
    ('public.trades'),
    ('public.leaderboard_stats'),
    ('public.events')
)
SELECT ok(
  NOT EXISTS (
    SELECT 1
    FROM readable_tables AS rt
    WHERE NOT pg_catalog.has_table_privilege(
      'authenticated',
      rt.table_name,
      'SELECT'
    )
  ),
  'authenticated can reach every intended RLS-protected read table'
);

SELECT ok(
  pg_catalog.has_table_privilege('service_role', 'public.profiles', 'SELECT')
  AND pg_catalog.has_table_privilege('service_role', 'public.events', 'SELECT')
  AND pg_catalog.has_table_privilege('service_role', 'public.events', 'INSERT')
  AND NOT pg_catalog.has_table_privilege('service_role', 'public.events', 'UPDATE')
  AND NOT pg_catalog.has_table_privilege('service_role', 'public.events', 'DELETE'),
  'service_role can append/read activity events but cannot rewrite or delete them'
);

SELECT ok(
  pg_catalog.has_column_privilege(
    'authenticated',
    'public.profiles',
    'avatar_url',
    'UPDATE'
  )
  AND NOT pg_catalog.has_column_privilege(
    'authenticated',
    'public.profiles',
    'username',
    'UPDATE'
  )
  AND NOT pg_catalog.has_column_privilege(
    'authenticated',
    'public.profiles',
    'user_id',
    'UPDATE'
  )
  AND NOT pg_catalog.has_table_privilege(
    'authenticated',
    'public.profiles',
    'INSERT'
  )
  AND NOT pg_catalog.has_table_privilege(
    'authenticated',
    'public.profiles',
    'DELETE'
  ),
  'authenticated can edit avatar only but cannot rename, create, delete, or transfer profiles'
);

WITH target_tables(table_name) AS (
  VALUES
    ('public.accounts'),
    ('public.positions'),
    ('public.trades'),
    ('public.leaderboard_stats')
), write_privileges(privilege_name) AS (
  VALUES ('INSERT'), ('UPDATE'), ('DELETE')
)
SELECT ok(
  NOT EXISTS (
    SELECT 1
    FROM target_tables AS tt
    CROSS JOIN write_privileges AS wp
    WHERE pg_catalog.has_table_privilege('authenticated', tt.table_name, wp.privilege_name)
  ),
  'authenticated has no direct write privilege on trading state'
);

WITH target_tables(table_name) AS (
  VALUES
    ('public.accounts'),
    ('public.positions'),
    ('public.trades'),
    ('public.leaderboard_stats')
), write_privileges(privilege_name) AS (
  VALUES ('INSERT'), ('UPDATE'), ('DELETE')
)
SELECT ok(
  NOT EXISTS (
    SELECT 1
    FROM target_tables AS tt
    CROSS JOIN write_privileges AS wp
    WHERE pg_catalog.has_table_privilege('anon', tt.table_name, wp.privilege_name)
  ),
  'anon has no direct write privilege on trading state'
);

WITH target_tables(table_name) AS (
  VALUES
    ('public.accounts'),
    ('public.positions'),
    ('public.trades'),
    ('public.leaderboard_stats')
), write_privileges(privilege_name) AS (
  VALUES ('INSERT'), ('UPDATE'), ('DELETE')
)
SELECT ok(
  NOT EXISTS (
    SELECT 1
    FROM target_tables AS tt
    CROSS JOIN write_privileges AS wp
    WHERE NOT pg_catalog.has_table_privilege('service_role', tt.table_name, wp.privilege_name)
  ),
  'service_role retains direct write privilege on trading state'
);

SELECT ok(
  NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_policies AS p
    WHERE p.schemaname = 'public'
      AND p.tablename IN ('accounts', 'positions', 'trades', 'leaderboard_stats')
      AND p.cmd IN ('ALL', 'INSERT', 'UPDATE', 'DELETE')
      AND p.roles && ARRAY['public', 'anon', 'authenticated']::name[]
  ),
  'no browser-role write policy remains on trading state'
);

-- Create throwaway objects after the hardening migration to prove that future
-- defaults cannot recreate the same exposure. The enclosing test transaction
-- rolls both objects back.
CREATE FUNCTION public._test_future_server_rpc()
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN;
END;
$$;

CREATE TABLE public._test_future_server_state (
  id integer PRIMARY KEY
);

SELECT ok(
  NOT pg_catalog.has_function_privilege(
    'anon',
    'public._test_future_server_rpc()',
    'EXECUTE'
  )
  AND NOT pg_catalog.has_function_privilege(
    'authenticated',
    'public._test_future_server_rpc()',
    'EXECUTE'
  ),
  'future public functions do not default to browser-role execution'
);

WITH browser_roles(role_name) AS (
  VALUES ('anon'), ('authenticated')
), write_privileges(privilege_name) AS (
  VALUES ('INSERT'), ('UPDATE'), ('DELETE')
)
SELECT ok(
  NOT EXISTS (
    SELECT 1
    FROM browser_roles AS br
    CROSS JOIN write_privileges AS wp
    WHERE pg_catalog.has_table_privilege(
      br.role_name,
      'public._test_future_server_state',
      wp.privilege_name
    )
  ),
  'future public tables do not default to browser-role writes'
);

-- Simulate one user created by the old client while durable inserts were being
-- swallowed. The migration's callable repair must safely restore all rows.
SET LOCAL session_replication_role = replica;
INSERT INTO auth.users (
  instance_id,
  id,
  aud,
  role,
  email,
  encrypted_password,
  email_confirmed_at,
  created_at,
  updated_at,
  raw_app_meta_data,
  raw_user_meta_data
) VALUES (
  '00000000-0000-0000-0000-000000000000',
  '10000000-0000-0000-0000-000000000099',
  'authenticated',
  'authenticated',
  'legacy.invalid+name@example.invalid',
  '',
  pg_catalog.now(),
  pg_catalog.now(),
  pg_catalog.now(),
  '{}',
  '{}'
), (
  '00000000-0000-0000-0000-000000000000',
  '20000000-0000-0000-0000-000000000098',
  'authenticated',
  'authenticated',
  'legacy-attacker@example.invalid',
  '',
  pg_catalog.now(),
  pg_catalog.now(),
  pg_catalog.now(),
  '{}',
  '{"username":"claimed_name"}'
);
SET LOCAL session_replication_role = origin;

SET LOCAL ROLE service_role;
SELECT lives_ok(
  $$ SELECT public.repair_hypersim_users() $$,
  'service_role can idempotently repair legacy users'
);
RESET ROLE;

SELECT ok(
  EXISTS (
    SELECT 1
    FROM public.profiles AS p
    WHERE p.user_id = '10000000-0000-0000-0000-000000000099'
      AND p.username = 'user_100000000000000'
  )
  AND EXISTS (
    SELECT 1
    FROM public.accounts AS a
    WHERE a.user_id = '10000000-0000-0000-0000-000000000099'
      AND a.balance = 100000::numeric
  )
  AND EXISTS (
    SELECT 1
    FROM public.leaderboard_stats AS ls
    WHERE ls.user_id = '10000000-0000-0000-0000-000000000099'
      AND ls.trade_count = 0
  ),
  'legacy repair creates a safe fallback profile plus initialized account and stats'
);

SELECT ok(
  EXISTS (
    SELECT 1
    FROM public.profiles AS p
    WHERE p.user_id = '20000000-0000-0000-0000-000000000098'
      AND p.username = 'user_200000000000000'
  )
  AND NOT EXISTS (
    SELECT 1
    FROM public.profiles AS p
    WHERE p.username = 'claimed_name'
  ),
  'legacy repair cannot assign metadata usernames that do not match the canonical login identity'
);

-- Real accounting integration -------------------------------------------------

SELECT throws_ok(
  $$
    INSERT INTO auth.users (
      instance_id,
      id,
      aud,
      role,
      email,
      encrypted_password,
      email_confirmed_at,
      created_at,
      updated_at,
      raw_app_meta_data,
      raw_user_meta_data
    ) VALUES (
      '00000000-0000-0000-0000-000000000000',
      '10000000-0000-0000-0000-000000000009',
      'authenticated',
      'authenticated',
      'db-invalid-test@example.invalid',
      '',
      pg_catalog.now(),
      pg_catalog.now(),
      pg_catalog.now(),
      '{}',
      '{}'
    )
  $$,
  'P0001',
  'Invalid username',
  'signup rejects malformed or missing username metadata atomically'
);

SELECT throws_ok(
  $$
    INSERT INTO auth.users (
      instance_id,
      id,
      aud,
      role,
      email,
      encrypted_password,
      email_confirmed_at,
      created_at,
      updated_at,
      raw_app_meta_data,
      raw_user_meta_data
    ) VALUES (
      '00000000-0000-0000-0000-000000000000',
      '10000000-0000-0000-0000-000000000008',
      'authenticated',
      'authenticated',
      'attacker@example.invalid',
      '',
      pg_catalog.now(),
      pg_catalog.now(),
      pg_catalog.now(),
      '{}',
      '{"username":"claimed_name"}'
    )
  $$,
  'P0001',
  'Username and login identity do not match',
  'direct signup cannot squat a username with a different login email'
);

INSERT INTO auth.users (
  instance_id,
  id,
  aud,
  role,
  email,
  encrypted_password,
  email_confirmed_at,
  created_at,
  updated_at,
  raw_app_meta_data,
  raw_user_meta_data
) VALUES
  (
    '00000000-0000-0000-0000-000000000000',
    '10000000-0000-0000-0000-000000000001',
    'authenticated',
    'authenticated',
    'db_win@hypersim.local',
    '',
    pg_catalog.now(),
    pg_catalog.now(),
    pg_catalog.now(),
    '{}',
    '{"username":"db_win"}'
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '10000000-0000-0000-0000-000000000002',
    'authenticated',
    'authenticated',
    'db_loss@hypersim.local',
    '',
    pg_catalog.now(),
    pg_catalog.now(),
    pg_catalog.now(),
    '{}',
    '{"username":"db_loss"}'
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '10000000-0000-0000-0000-000000000003',
    'authenticated',
    'authenticated',
    'db_precision@hypersim.local',
    '',
    pg_catalog.now(),
    pg_catalog.now(),
    pg_catalog.now(),
    '{}',
    '{"username":"db_precision"}'
  );

SELECT is(
  (
    SELECT pg_catalog.count(*)
    FROM public.profiles AS p
    WHERE p.user_id IN (
      '10000000-0000-0000-0000-000000000001',
      '10000000-0000-0000-0000-000000000002'
    )
      AND p.username IN ('db_win', 'db_loss')
  ),
  2::bigint,
  'signup transaction persists normalized profiles'
);

SELECT is(
  (
    SELECT pg_catalog.count(*)
    FROM public.accounts AS a
    WHERE a.user_id IN (
      '10000000-0000-0000-0000-000000000001',
      '10000000-0000-0000-0000-000000000002'
    )
      AND a.balance = 100000::numeric
      AND a.initial_balance = 100000::numeric
      AND a.reset_count = 0
  ),
  2::bigint,
  'signup transaction persists initialized accounts'
);

SELECT is(
  (
    SELECT pg_catalog.count(*)
    FROM public.leaderboard_stats AS ls
    WHERE ls.user_id IN (
      '10000000-0000-0000-0000-000000000001',
      '10000000-0000-0000-0000-000000000002'
    )
      AND ls.total_pnl = 0
      AND ls.trade_count = 0
  ),
  2::bigint,
  'signup transaction persists initialized leaderboard state'
);

UPDATE public.accounts AS a
SET balance = 1000,
    initial_balance = 1000
WHERE a.user_id IN (
  '10000000-0000-0000-0000-000000000001',
  '10000000-0000-0000-0000-000000000002',
  '10000000-0000-0000-0000-000000000003'
);

SET LOCAL ROLE service_role;

SELECT lives_ok(
  $$
    SELECT public.execute_market_order(
      '30000000-0000-0000-0000-000000000003'::uuid,
      '10000000-0000-0000-0000-000000000003'::uuid,
      '50000000-0000-4000-8000-000000000003'::uuid,
      0::bigint,
      'ETH'::character varying,
      'long'::character varying,
      3000::numeric,
      0.1666666666666667::numeric,
      10,
      50.000001::numeric,
      2715::numeric,
      'signal'::character varying,
      'signal-precision'::text
    )
  $$,
  'high-precision signal sizing survives the numeric(20,8) storage boundary'
);

SELECT ok(
  (
    SELECT p.size = 0.16666667::numeric
      AND p.margin = 50.000001::numeric
      AND a.balance = 949.999999::numeric
    FROM public.positions AS p
    JOIN public.accounts AS a ON a.user_id = p.user_id
    WHERE p.id = '30000000-0000-0000-0000-000000000003'
  ),
  'the stored position and account debit use one canonical eight-decimal command'
);

WITH precision_replay AS (
  SELECT public.execute_market_order(
    '30000000-0000-0000-0000-000000000099'::uuid,
    '10000000-0000-0000-0000-000000000003'::uuid,
    '50000000-0000-4000-8000-000000000003'::uuid,
    0::bigint,
    'ETH'::character varying,
    'long'::character varying,
    3000::numeric,
    0.1666666666666667::numeric,
    10,
    50.000001::numeric,
    2715::numeric,
    'signal'::character varying,
    'signal-precision'::text
  ) AS result
)
SELECT ok(
  (
    SELECT pr.result ->> 'id' = '30000000-0000-0000-0000-000000000003'
      AND (pr.result ->> '_created')::boolean = false
    FROM precision_replay AS pr
  )
  AND (
    SELECT a.balance = 949.999999::numeric
    FROM public.accounts AS a
    WHERE a.user_id = '10000000-0000-0000-0000-000000000003'
  ),
  'high-precision replay returns the original position without a second debit'
);

SELECT throws_ok(
  $$
    SELECT public.execute_market_order(
      '30000000-0000-0000-0000-000000000090'::uuid,
      '10000000-0000-0000-0000-000000000001'::uuid,
      '50000000-0000-4000-8000-000000000090'::uuid,
      0::bigint,
      'BTC'::character varying,
      'short'::character varying,
      100::numeric,
      1::numeric,
      10,
      -100::numeric,
      110::numeric,
      'manual'::character varying,
      NULL::text
    )
  $$,
  'P0001',
  'Invalid order parameters',
  'negative margin is rejected at the database authority boundary'
);

SELECT throws_ok(
  $$
    SELECT public.execute_market_order(
      '30000000-0000-0000-0000-000000000092'::uuid,
      '10000000-0000-0000-0000-000000000001'::uuid,
      '50000000-0000-4000-8000-000000000092'::uuid,
      0::bigint,
      'BTC'::character varying,
      'long'::character varying,
      100::numeric,
      1::numeric,
      10,
      100::numeric,
      90.5::numeric,
      'manual'::character varying,
      NULL::text
    )
  $$,
  'P0001',
  'Order accounting values do not match authoritative calculations',
  'the database rejects positive but forged margin calculations'
);

SELECT throws_ok(
  $$
    SELECT public.execute_market_order(
      '30000000-0000-0000-0000-000000000091'::uuid,
      '10000000-0000-0000-0000-000000000001'::uuid,
      '50000000-0000-4000-8000-000000000091'::uuid,
      0::bigint,
      'BTC'::character varying,
      'long'::character varying,
      5000001::numeric,
      1::numeric,
      10,
      100::numeric,
      4500000::numeric,
      'manual'::character varying,
      NULL::text
    )
  $$,
  'P0001',
  'Invalid order parameters',
  'orders above the notional limit are rejected by PostgreSQL'
);

SELECT lives_ok(
  $$
    SELECT public.execute_market_order(
      '30000000-0000-0000-0000-000000000001'::uuid,
      '10000000-0000-0000-0000-000000000001'::uuid,
      '50000000-0000-4000-8000-000000000001'::uuid,
      0::bigint,
      'BTC'::character varying,
      'long'::character varying,
      100::numeric,
      1::numeric,
      10,
      10::numeric,
      90.5::numeric,
      'manual'::character varying,
      NULL::text
    )
  $$,
  'service_role can open the winning test position'
);

SELECT ok(
  (
    SELECT a.balance = 990::numeric
    FROM public.accounts AS a
    WHERE a.user_id = '10000000-0000-0000-0000-000000000001'
  ),
  'opening the winning position deducts margin once'
);

WITH replay AS (
  SELECT public.execute_market_order(
    '30000000-0000-0000-0000-000000000007'::uuid,
    '10000000-0000-0000-0000-000000000001'::uuid,
    '50000000-0000-4000-8000-000000000001'::uuid,
    0::bigint,
    'BTC'::character varying,
    'long'::character varying,
    101::numeric,
    1::numeric,
    10,
    10.1::numeric,
    91.405::numeric,
    'manual'::character varying,
    NULL::text
  ) AS result
)
SELECT ok(
  (
    SELECT r.result ->> 'id' = '30000000-0000-0000-0000-000000000001'
      AND (r.result ->> '_created')::boolean = false
    FROM replay AS r
  )
  AND (
    SELECT a.balance = 990::numeric
    FROM public.accounts AS a
    WHERE a.user_id = '10000000-0000-0000-0000-000000000001'
  )
  AND (
    SELECT pg_catalog.count(*) = 1
    FROM public.positions AS p
    WHERE p.user_id = '10000000-0000-0000-0000-000000000001'
      AND p.idempotency_key = '50000000-0000-4000-8000-000000000001'
  ),
  'a retry returns the original position without a second debit even when market-derived values changed'
);

SELECT throws_ok(
  $$
    SELECT public.execute_market_order(
      '30000000-0000-0000-0000-000000000008'::uuid,
      '10000000-0000-0000-0000-000000000001'::uuid,
      '50000000-0000-4000-8000-000000000001'::uuid,
      0::bigint,
      'BTC'::character varying,
      'short'::character varying,
      100::numeric,
      1::numeric,
      10,
      10::numeric,
      109.5::numeric,
      'manual'::character varying,
      NULL::text
    )
  $$,
  'P0001',
  'Idempotency key reused with different order parameters',
  'reusing an idempotency key for a different canonical command is rejected'
);

SELECT throws_ok(
  $$
    SELECT public.close_position_atomic(
      '30000000-0000-0000-0000-000000000001'::uuid,
      '10000000-0000-0000-0000-000000000001'::uuid,
      150::numeric,
      'Infinity'::numeric,
      0::numeric,
      '40000000-0000-0000-0000-000000000090'::uuid
    )
  $$,
  'P0001',
  'Invalid close parameters',
  'non-finite close PnL is rejected before it can alter accounting'
);

SELECT lives_ok(
  $$
    SELECT public.execute_market_order(
      '30000000-0000-0000-0000-000000000002'::uuid,
      '10000000-0000-0000-0000-000000000002'::uuid,
      '50000000-0000-4000-8000-000000000001'::uuid,
      0::bigint,
      'ETH'::character varying,
      'long'::character varying,
      100::numeric,
      1::numeric,
      10,
      10::numeric,
      90.5::numeric,
      'manual'::character varying,
      NULL::text
    )
  $$,
  'service_role can open the losing test position'
);

SELECT ok(
  (
    SELECT a.balance = 990::numeric
    FROM public.accounts AS a
    WHERE a.user_id = '10000000-0000-0000-0000-000000000002'
  ),
  'opening the losing position deducts margin once'
);

SELECT is(
  (
    SELECT pg_catalog.count(*)
    FROM public.positions AS p
    WHERE p.idempotency_key = '50000000-0000-4000-8000-000000000001'
      AND p.user_id IN (
        '10000000-0000-0000-0000-000000000001',
        '10000000-0000-0000-0000-000000000002'
      )
  ),
  2::bigint,
  'the same idempotency UUID is independent across user boundaries'
);

WITH snapshot AS (
  SELECT public.get_account_snapshot(
    '10000000-0000-0000-0000-000000000002'::uuid
  ) AS result
)
SELECT ok(
  (
    SELECT (s.result -> 'account' ->> 'balance')::numeric = 990::numeric
      AND pg_catalog.json_array_length(s.result -> 'positions') = 1
    FROM snapshot AS s
  ),
  'the locked account snapshot returns matching balance and open positions together'
);

SELECT lives_ok(
  $$
    SELECT public.close_position_atomic(
      '30000000-0000-0000-0000-000000000001'::uuid,
      '10000000-0000-0000-0000-000000000001'::uuid,
      150::numeric,
      50::numeric,
      50::numeric,
      '40000000-0000-0000-0000-000000000001'::uuid
    )
  $$,
  'service_role can close the winning test position'
);

SELECT ok(
  (
    SELECT a.balance = 1050::numeric
    FROM public.accounts AS a
    WHERE a.user_id = '10000000-0000-0000-0000-000000000001'
  ),
  'a win returns margin and credits realized PnL exactly once'
);

SELECT is(
  (
    SELECT pg_catalog.count(*)
    FROM public.trades AS t
    WHERE t.user_id = '10000000-0000-0000-0000-000000000001'
      AND t.pnl = 50::numeric
  ),
  1::bigint,
  'a winning close records exactly one trade'
);

SELECT ok(
  (
    SELECT p.status = 'closed' AND p.realized_pnl = 50::numeric
    FROM public.positions AS p
    WHERE p.id = '30000000-0000-0000-0000-000000000001'
  ),
  'the winning position stores one realized-PnL result'
);

SELECT lives_ok(
  $$
    SELECT public.close_position_atomic(
      '30000000-0000-0000-0000-000000000002'::uuid,
      '10000000-0000-0000-0000-000000000002'::uuid,
      96::numeric,
      -4::numeric,
      -40::numeric,
      '40000000-0000-0000-0000-000000000002'::uuid
    )
  $$,
  'service_role can close the losing test position'
);

SELECT ok(
  (
    SELECT a.balance = 996::numeric
    FROM public.accounts AS a
    WHERE a.user_id = '10000000-0000-0000-0000-000000000002'
  ),
  'a loss returns margin and debits realized PnL exactly once'
);

SELECT is(
  (
    SELECT pg_catalog.count(*)
    FROM public.trades AS t
    WHERE t.user_id = '10000000-0000-0000-0000-000000000002'
      AND t.pnl = -4::numeric
  ),
  1::bigint,
  'a losing close records exactly one trade'
);

SELECT ok(
  (
    SELECT p.status = 'closed' AND p.realized_pnl = -4::numeric
    FROM public.positions AS p
    WHERE p.id = '30000000-0000-0000-0000-000000000002'
  ),
  'the losing position stores one realized-PnL result'
);

SELECT ok(
  (
    SELECT ls.total_pnl = 50::numeric
      AND ls.total_pnl_percent = 0.05::numeric
      AND ls.win_rate = 100::numeric
      AND ls.max_drawdown = 0::numeric
      AND ls.trade_count = 1
    FROM public.leaderboard_stats AS ls
    WHERE ls.user_id = '10000000-0000-0000-0000-000000000001'
  )
  AND (
    SELECT ls.total_pnl = -4::numeric
      AND ls.total_pnl_percent = -0.004::numeric
      AND ls.win_rate = 0::numeric
      AND ls.max_drawdown = 0.004::numeric
      AND ls.trade_count = 1
    FROM public.leaderboard_stats AS ls
    WHERE ls.user_id = '10000000-0000-0000-0000-000000000002'
  ),
  'position close updates leaderboard stats inside the same account-locked transaction'
);

SELECT throws_ok(
  $$
    SELECT public.close_position_atomic(
      '30000000-0000-0000-0000-000000000001'::uuid,
      '10000000-0000-0000-0000-000000000001'::uuid,
      150::numeric,
      50::numeric,
      50::numeric,
      '40000000-0000-0000-0000-000000000003'::uuid
    )
  $$,
  'P0001',
  'Position not found or already closed',
  'a closed position cannot be credited a second time'
);

SELECT ok(
  (
    SELECT a.balance = 1050::numeric
    FROM public.accounts AS a
    WHERE a.user_id = '10000000-0000-0000-0000-000000000001'
  ),
  'a rejected second close leaves the winning balance unchanged'
);

SELECT public.execute_market_order(
  '30000000-0000-0000-0000-000000000005'::uuid,
  '10000000-0000-0000-0000-000000000002'::uuid,
  '50000000-0000-4000-8000-000000000005'::uuid,
  0::bigint,
  'ETH'::character varying,
  'short'::character varying,
  100::numeric,
  1::numeric,
  10,
  10::numeric,
  109.5::numeric,
  'manual'::character varying,
  NULL::text
);

SELECT lives_ok(
  $$
    SELECT public.close_position_atomic(
      '30000000-0000-0000-0000-000000000005'::uuid,
      '10000000-0000-0000-0000-000000000002'::uuid,
      1000::numeric,
      -1000::numeric,
      -1000::numeric,
      '40000000-0000-0000-0000-000000000005'::uuid
    )
  $$,
  'a gap loss closes inside the isolated-margin accounting boundary'
);

SELECT ok(
  (
    SELECT a.balance = 986::numeric
    FROM public.accounts AS a
    WHERE a.user_id = '10000000-0000-0000-0000-000000000002'
  )
  AND (
    SELECT p.status = 'liquidated'
      AND p.realized_pnl = -10::numeric
    FROM public.positions AS p
    WHERE p.id = '30000000-0000-0000-0000-000000000005'
  )
  AND EXISTS (
    SELECT 1
    FROM public.trades AS t
    WHERE t.id = '40000000-0000-0000-0000-000000000005'
      AND t.pnl = -10::numeric
      AND t.pnl_percent = -100::numeric
  ),
  'gap loss cannot debit more than isolated margin or make balance negative'
);

RESET ROLE;
-- CHECK constraints still apply to new rows even when they are marked NOT VALID.
-- Temporarily remove and restore the hardened constraint to model a forged row
-- that existed before this migration was installed.
ALTER TABLE public.positions
  DROP CONSTRAINT positions_valid_execution_values_check;
INSERT INTO public.positions (
  id, user_id, idempotency_key, asset, side, entry_price, current_price, size, leverage,
  margin, liquidation_price, unrealized_pnl, unrealized_pnl_percent,
  realized_pnl, status, source, opened_at
) VALUES (
  '30000000-0000-0000-0000-000000000006',
  '10000000-0000-0000-0000-000000000002',
  '50000000-0000-4000-8000-000000000006',
  'BTC', 'long', 100, 100, 1, 10,
  500000000, 90.5, 0, 0,
  0, 'open', 'manual', pg_catalog.now()
);
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
SET LOCAL ROLE service_role;

SELECT throws_ok(
  $$
    SELECT public.close_position_atomic(
      '30000000-0000-0000-0000-000000000006'::uuid,
      '10000000-0000-0000-0000-000000000002'::uuid,
      110::numeric,
      10::numeric,
      100::numeric,
      '40000000-0000-0000-0000-000000000006'::uuid
    )
  $$,
  'P0001',
  'Position accounting state invalid; reset required',
  'legacy forged margin is quarantined at the close boundary'
);

SELECT ok(
  (
    SELECT a.balance = 986::numeric
    FROM public.accounts AS a
    WHERE a.user_id = '10000000-0000-0000-0000-000000000002'
  )
  AND NOT EXISTS (
    SELECT 1
    FROM public.trades AS t
    WHERE t.id = '40000000-0000-0000-0000-000000000006'
  ),
  'rejected legacy state cannot mint balance or record a fake close'
);

SELECT lives_ok(
  $test$
    DO $body$
    BEGIN
      PERFORM public.reset_account_atomic(
        '10000000-0000-0000-0000-000000000002'::uuid
      );

      IF EXISTS (
        SELECT 1
        FROM public.positions AS p
        WHERE p.user_id = '10000000-0000-0000-0000-000000000002'
      ) OR NOT EXISTS (
        SELECT 1
        FROM public.accounts AS a
        WHERE a.user_id = '10000000-0000-0000-0000-000000000002'
          AND a.balance = 100000::numeric
          AND a.reset_count = 1
      ) THEN
        RAISE EXCEPTION 'legacy reset recovery was incomplete';
      END IF;
    END;
    $body$
  $test$,
  'reset deletes malformed legacy positions and restores the account atomically'
);

-- Reset is a single account-first transaction. Seed one open position plus
-- non-zero history/stats, then prove every user-visible surface resets together.
SELECT public.execute_market_order(
  '30000000-0000-0000-0000-000000000004'::uuid,
  '10000000-0000-0000-0000-000000000001'::uuid,
  '50000000-0000-4000-8000-000000000004'::uuid,
  0::bigint,
  'SOL'::character varying,
  'long'::character varying,
  100::numeric,
  1::numeric,
  10,
  10::numeric,
  90.5::numeric,
  'manual'::character varying,
  NULL::text
);

UPDATE public.leaderboard_stats AS ls
SET total_pnl = 50,
    total_pnl_percent = 5,
    win_rate = 100,
    max_drawdown = 1,
    trade_count = 1
WHERE ls.user_id = '10000000-0000-0000-0000-000000000001';

SELECT lives_ok(
  $$
    SELECT public.reset_account_atomic(
      '10000000-0000-0000-0000-000000000001'::uuid
    )
  $$,
  'service_role can reset the complete account state atomically'
);

SELECT ok(
  (
    SELECT a.balance = 100000::numeric
      AND a.initial_balance = 100000::numeric
      AND a.reset_count = 1
    FROM public.accounts AS a
    WHERE a.user_id = '10000000-0000-0000-0000-000000000001'
  ),
  'reset restores starting balance and increments exactly once'
);

SELECT ok(
  NOT EXISTS (
    SELECT 1
    FROM public.positions AS p
    WHERE p.user_id = '10000000-0000-0000-0000-000000000001'
  )
  AND NOT EXISTS (
    SELECT 1
    FROM public.trades AS t
    WHERE t.user_id = '10000000-0000-0000-0000-000000000001'
  ),
  'reset clears positions and trade history in the same transaction'
);

SELECT ok(
  (
    SELECT ls.total_pnl = 0
      AND ls.total_pnl_percent = 0
      AND ls.win_rate = 0
      AND ls.max_drawdown = 0
      AND ls.trade_count = 0
    FROM public.leaderboard_stats AS ls
    WHERE ls.user_id = '10000000-0000-0000-0000-000000000001'
  ),
  'reset clears leaderboard statistics in the same transaction'
);

SELECT throws_ok(
  $$
    SELECT public.execute_market_order(
      '30000000-0000-0000-0000-000000000095'::uuid,
      '10000000-0000-0000-0000-000000000001'::uuid,
      '50000000-0000-4000-8000-000000000095'::uuid,
      0::bigint,
      'BTC'::character varying,
      'long'::character varying,
      100::numeric,
      1::numeric,
      10,
      10::numeric,
      90.5::numeric,
      'manual'::character varying,
      NULL::text
    )
  $$,
  'P0001',
  'Account reset generation changed. Expected: 0, Current: 1',
  'an order that was already in flight when reset won cannot enter the new generation'
);

-- The command ledger is intentionally inaccessible even to service_role outside
-- the SECURITY DEFINER RPC. Inspect it as the migration owner for this invariant.
RESET ROLE;
SELECT ok(
  (
    SELECT a.balance = 100000::numeric
      AND a.reset_count = 1
    FROM public.accounts AS a
    WHERE a.user_id = '10000000-0000-0000-0000-000000000001'
  )
  AND NOT EXISTS (
    SELECT 1
    FROM public.positions AS p
    WHERE p.id = '30000000-0000-0000-0000-000000000095'
  )
  AND NOT EXISTS (
    SELECT 1
    FROM public.order_idempotency AS oi
    WHERE oi.user_id = '10000000-0000-0000-0000-000000000001'
      AND oi.idempotency_key = '50000000-0000-4000-8000-000000000095'
  ),
  'the stale-generation rejection happens before balance, position, or ledger mutation'
);

SET LOCAL ROLE service_role;
SELECT throws_ok(
  $$
    SELECT public.execute_market_order(
      '30000000-0000-0000-0000-000000000094'::uuid,
      '10000000-0000-0000-0000-000000000001'::uuid,
      '50000000-0000-4000-8000-000000000004'::uuid,
      1::bigint,
      'SOL'::character varying,
      'long'::character varying,
      100::numeric,
      1::numeric,
      10,
      10::numeric,
      90.5::numeric,
      'manual'::character varying,
      NULL::text
    )
  $$,
  'P0001',
  'Idempotency key belongs to a prior account reset',
  'a delayed pre-reset replay key cannot become a new post-reset order'
);

SELECT ok(
  (
    SELECT a.balance = 100000::numeric
      AND a.reset_count = 1
    FROM public.accounts AS a
    WHERE a.user_id = '10000000-0000-0000-0000-000000000001'
  )
  AND NOT EXISTS (
    SELECT 1
    FROM public.positions AS p
    WHERE p.user_id = '10000000-0000-0000-0000-000000000001'
  ),
  'the rejected delayed request leaves the reset account untouched'
);

SELECT lives_ok(
  $$
    SELECT public.execute_market_order(
      '30000000-0000-0000-0000-000000000096'::uuid,
      '10000000-0000-0000-0000-000000000001'::uuid,
      '50000000-0000-4000-8000-000000000096'::uuid,
      1::bigint,
      'BTC'::character varying,
      'long'::character varying,
      100::numeric,
      1::numeric,
      10,
      10::numeric,
      90.5::numeric,
      'manual'::character varying,
      NULL::text
    )
  $$,
  'a command bound to the current post-reset generation still succeeds'
);

RESET ROLE;
SELECT ok(
  (
    SELECT a.balance = 99990::numeric
      AND a.reset_count = 1
    FROM public.accounts AS a
    WHERE a.user_id = '10000000-0000-0000-0000-000000000001'
  )
  AND EXISTS (
    SELECT 1
    FROM public.positions AS p
    JOIN public.order_idempotency AS oi
      ON oi.user_id = p.user_id
     AND oi.position_id = p.id
    WHERE p.id = '30000000-0000-0000-0000-000000000096'
      AND oi.account_reset_count = 1
  ),
  'same-generation execution debits once and records the generation in the durable ledger'
);

RESET ROLE;
-- Model a malformed reset counter that existed before the NOT VALID constraint.
ALTER TABLE public.accounts
  DROP CONSTRAINT accounts_valid_balance_state_check;
UPDATE public.accounts AS a
SET reset_count = -2
WHERE a.user_id = '10000000-0000-0000-0000-000000000003';
ALTER TABLE public.accounts
  ADD CONSTRAINT accounts_valid_balance_state_check
  CHECK (
    balance >= 0
    AND balance NOT IN ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric)
    AND initial_balance > 0
    AND initial_balance NOT IN ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric)
    AND reset_count >= 0
  ) NOT VALID;
SET LOCAL ROLE service_role;

SELECT lives_ok(
  $$
    SELECT public.reset_account_atomic(
      '10000000-0000-0000-0000-000000000003'::uuid
    )
  $$,
  'reset self-recovers a malformed legacy reset generation'
);

SELECT ok(
  (
    SELECT a.balance = 100000::numeric
      AND a.initial_balance = 100000::numeric
      AND a.reset_count = 1
    FROM public.accounts AS a
    WHERE a.user_id = '10000000-0000-0000-0000-000000000003'
  )
  AND NOT EXISTS (
    SELECT 1
    FROM public.positions AS p
    WHERE p.user_id = '10000000-0000-0000-0000-000000000003'
  ),
  'legacy reset recovery restores a valid generation and clears positions'
);

RESET ROLE;
UPDATE public.accounts AS a
SET reset_count = 2147483647
WHERE a.user_id = '10000000-0000-0000-0000-000000000003';
SET LOCAL ROLE service_role;

SELECT ok(
  pg_catalog.to_regprocedure('public.increment_reset_count(uuid)') IS NULL,
  'the non-atomic reset-generation helper is removed'
);

SELECT lives_ok(
  $$
    SELECT public.reset_account_atomic(
      '10000000-0000-0000-0000-000000000003'::uuid
    )
  $$,
  'atomic reset advances beyond the former INTEGER ceiling'
);

SELECT is(
  (
    SELECT a.reset_count
    FROM public.accounts AS a
    WHERE a.user_id = '10000000-0000-0000-0000-000000000003'
  ),
  2147483648::bigint,
  'atomic reset stores the first post-INTEGER generation'
);

SELECT lives_ok(
  $test$
    DO $body$
    BEGIN
      PERFORM public.reset_account_atomic(
        '10000000-0000-0000-0000-000000000003'::uuid
      );

      IF NOT EXISTS (
        SELECT 1
        FROM public.accounts AS a
        WHERE a.user_id = '10000000-0000-0000-0000-000000000003'
          AND a.reset_count = 2147483649::bigint
      ) THEN
        RAISE EXCEPTION 'post-INTEGER reset generation did not advance';
      END IF;
    END;
    $body$
  $test$,
  'subsequent atomic reset remains monotonic beyond the former ceiling'
);

RESET ROLE;
SET LOCAL ROLE authenticated;

SELECT throws_ok(
  $$
    SELECT public.execute_market_order(
      '30000000-0000-0000-0000-000000000003'::uuid,
      '10000000-0000-0000-0000-000000000001'::uuid,
      '50000000-0000-4000-8000-000000000003'::uuid,
      0::bigint,
      'BTC'::character varying,
      'long'::character varying,
      100::numeric,
      1::numeric,
      10,
      100::numeric,
      90::numeric,
      'manual'::character varying,
      NULL::text
    )
  $$,
  '42501',
  'permission denied for function execute_market_order',
  'authenticated is denied at the privileged RPC boundary'
);

SELECT throws_ok(
  $$
    UPDATE public.accounts
    SET balance = 999999
    WHERE user_id = '10000000-0000-0000-0000-000000000001'::uuid
  $$,
  '42501',
  'permission denied for table accounts',
  'authenticated is denied at the direct table-write boundary'
);

SELECT throws_ok(
  $$
    UPDATE public.profiles
    SET username = 'renamed_user'
    WHERE user_id = '10000000-0000-0000-0000-000000000001'::uuid
  $$,
  '42501',
  'permission denied for table profiles',
  'authenticated cannot split displayed username from login identity'
);

RESET ROLE;
SELECT * FROM finish();
ROLLBACK;
