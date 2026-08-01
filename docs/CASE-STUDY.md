# Case study: hardening the accounting boundary of a trading simulator

This repository started as a working paper-trading demo. A full backend audit then found that the demo trusted its own TypeScript layer with money-shaped state: accounting math lived in application code, retries could double-spend, and a stale price could execute an order. The hardening pass moved every balance-bearing decision into PostgreSQL, made retries provably safe, and put the invariants under an automated database test suite that CI replays against real Postgres.

This document is the readable version of that work: what was wrong, what changed, and what the live deployment measures today. The full diff exists as a pull request, but at +11k/-6k lines it is an archaeology site, not documentation.

## The defect classes the audit found

**1. Split accounting authority.** Position close logic computed PnL, fees, and margin return in TypeScript, then wrote several rows. Two concurrent closes, or a close racing an account reset, could disagree about the same dollars.

*Fix:* one `close_position_atomic` PostgreSQL function is now the only path that can turn a position into a balance change. It locks the account first, recomputes PnL and fees inside the transaction, returns isolated margin exactly once, records the trade, and updates leaderboard statistics in the same commit. Realized loss is clamped to isolated margin, and a close that exhausts margin is recorded as liquidated. Application code cannot mint or lose money on its own.

**2. Unordered locking.** Different flows locked rows in different orders, which is a deadlock and lost-update factory.

*Fix:* every privileged function follows account-first lock order: lock the account row, then touch positions, trades, and rankings. The pgTAP suite asserts the privilege boundary that forces all mutations through these functions.

**3. Retry and replay hazards.** A client that resent an order after an ambiguous HTTP outcome could be debited twice. A command issued before an account reset could land after it and corrupt the fresh account.

*Fix:* every order carries a caller-supplied UUID idempotency key, retained in a private command ledger, plus the account-reset generation the caller observed. PostgreSQL validates the generation under the account lock before any mutation. A stale-generation command, a materially different replay, or a key from an earlier generation is rejected without another debit.

**4. Stale-price execution.** The old path would execute against the last price it had seen, however old.

*Fix:* execution fails closed. If the latest price is missing or older than 15 seconds, the order returns `503`. Stale orderbook and price endpoints also return `503` rather than fabricating data.

**5. Forged legacy state.** A historical position row with an implausible stored margin could have credited fabricated balance on close.

*Fix:* the close path revalidates stored margin and liquidation math against entry data before crediting anything.

## How the invariants are enforced

- Database checks reject non-finite values, invalid leverage, oversized notional, and inconsistent stored margin.
- `anon` and `authenticated` roles cannot execute privileged trading functions or write balance-bearing tables; the browser holds no service credentials.
- Signup provisioning creates profile, account, and leaderboard rows in one transaction from canonical auth identity.
- 83 pgTAP assertions replay the complete 11-migration chain against a real PostgreSQL instance in CI and attack the privilege boundary, the reset fence, the idempotency ledger, and the accounting math directly in SQL.
- 159 Jest server tests and 45 Vitest client tests run alongside lint, typecheck, and production builds on every push.

## Measured performance of the live deployment

Measured 2026-08-01 against the production deployment (`tradeterm.claygeo.dev` frontend, Express API on Render free tier, Supabase-hosted PostgreSQL) from a consumer Windows machine on residential internet in the US Southeast. These are honest end-to-end numbers: they include client TLS, public internet round trips, Render ingress, and the full database transaction. They are not co-located microbenchmarks.

Method: one warmup request, then 15 order/close round trips (0.01 BTC, 1x leverage, unique idempotency key per order) and 5 samples per read endpoint, spaced to stay inside the public 100 req/min rate limit. Wall-clock timing via `time.perf_counter()` around each HTTPS request.

| Operation | n | p50 | p95 |
|---|---|---|---|
| Place market order (full atomic accounting transaction) | 15 | 571 ms | 874 ms |
| Close position (PnL + fees + leaderboard in one commit) | 15 | 654 ms | 1,101 ms |
| Account signup via Supabase Auth (trigger provisions profile, account, leaderboard row) | 1 | 367 ms | - |
| Market assets list | 5 | 141 ms | 310 ms |
| Open positions | 5 | 358 ms | 387 ms |
| Leaderboard | 5 | 379 ms | 557 ms |

Market data ingest, sampled the same day: one Hyperliquid `allMids` subscription delivered snapshots covering 943 markets, roughly 200+ individual price updates ingested per second, fanned out to browser clients through the server's bounded WebSocket layer.

Two caveats, stated plainly: the API sits on a free Render instance, so a cold start adds several seconds to the first request after idle (the warmup request absorbs this and is excluded); and n=15 is a smoke-level sample intended to characterize the path, not a load test.

## Reviving the demo

The original hosted database disappeared with its Supabase project, which meant the old public demo was no evidence for the hardened revision. Restoring it required creating a fresh PostgreSQL project, replaying all 11 migrations in order, running the pgTAP suite against the result, cutting the client and server over to the new credentials, and re-verifying the browser flows against the live stack. The demo now running at [tradeterm.claygeo.dev](https://tradeterm.claygeo.dev) is the hardened revision on a database whose entire schema history is reproducible from this repository.

## What this generalizes to

Nothing above is crypto-specific. The same boundary discipline applies to any system where a server mediates contested state: inventory, credits, bookings, billing. The transferable pattern is: one privileged mutation path per invariant, locks acquired in one documented order, idempotency enforced where the data lives, freshness enforced before execution, and the whole thing regression-tested in the database's own language.
