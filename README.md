# Hyperliquid Trading Simulator

[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![React](https://img.shields.io/badge/React-18-61DAFB?logo=react&logoColor=white)](https://react.dev/)
[![Express](https://img.shields.io/badge/Express-4-000000?logo=express&logoColor=white)](https://expressjs.com/)
[![Vite](https://img.shields.io/badge/Vite-8-646CFF?logo=vite&logoColor=white)](https://vite.dev/)
[![CI](https://github.com/claygeo/hyperliquid-trading-sim/actions/workflows/ci.yml/badge.svg)](https://github.com/claygeo/hyperliquid-trading-sim/actions/workflows/ci.yml)
[![License](https://img.shields.io/badge/License-MIT-green)](LICENSE)

A full-stack paper-trading simulator built to exercise backend boundaries: authenticated commands, account-first PostgreSQL transactions, live public market feeds, fail-closed price checks, and a browser that never receives database service credentials.

> **Deployment status:** a fresh production database has been provisioned and the full 11-migration hardened chain applied. Service environment cutover and end-to-end QA are in progress; the public demo link returns after live verification.

## What is verified

- Active Hyperliquid perpetual markets are discovered from metadata, with a smaller curated fallback if metadata is unavailable.
- Live prices use one Hyperliquid `allMids` subscription; L2 orderbooks and public trades use reference-counted on-demand leases. A desired-state reconciler releases abandoned feeds and paces every upstream subscribe/unsubscribe message at 50 ms, or at most 1,200 control messages per minute.
- Historical charts use six REST candle timeframes with bounded caching, CryptoCompare as the primary source, and Hyperliquid `candleSnapshot` as fallback.
- Candle HTTP requests have no durable upstream WebSocket side effects. Live market price is overlaid on the latest displayed bar in the client.
- The simulator accepts market orders only, with integer leverage from 1–50×, a $5 million post-slippage execution-notional ceiling, bounded slippage, taker fees, and isolated-margin loss capping.
- Order placement, manual position close, account reset, account snapshots, and leaderboard updates run through server-only PostgreSQL functions with a consistent account-first lock order.
- Every market order carries the account-reset generation observed by the caller. PostgreSQL validates that generation under the account lock before any mutation, while a caller-supplied, user-scoped UUID idempotency key is retained in a private command ledger. A stale-generation command, materially different replay, or key from an earlier generation is rejected without another debit.
- Execution fails closed when the latest price is missing or older than 15 seconds. Stale orderbooks and price endpoints return `503` rather than fabricating data.
- Account reset clears positions, trade history, and ranking state in one database transaction.
- Browser roles can read their RLS-protected data but cannot directly mutate balances, positions, trades, or leaderboard statistics.
- A best-effort append-only activity stream supports user-scoped replay queries. It is intentionally not described as a transactional audit log.

## System boundary

```text
React client
  ├─ Supabase Auth: sign-up, sign-in, session refresh
  ├─ HTTPS + bearer token ───────────────┐
  └─ public WebSocket subscriptions ───┐ │
                                      │ │
Express + ws server                   │ │
  ├─ validates auth, input, freshness │ │
  ├─ publishes price/L2/trade data ───┘ │
  └─ calls privileged DB functions ◄────┘
                 │
                 ▼
Supabase PostgreSQL
  ├─ account-first row locks
  ├─ atomic order/close/reset functions
  ├─ transaction-consistent account snapshots
  ├─ caller-bound reset fence + durable order-command ledger
  ├─ RLS and role privilege boundaries
  └─ transactional leaderboard statistics

External market data
  ├─ Hyperliquid WebSocket: allMids, L2, public trades
  ├─ CryptoCompare REST: historical candles
  └─ Hyperliquid REST: candle fallback and market metadata
```

The client talks directly to Supabase for authentication and its own RLS-protected profile read. Trading mutations cross the Express authorization boundary and execute with server-held credentials; no private account or position data is sent through the public WebSocket.

## Trading and accounting model

This is a paper-trading model, not an exchange-matching engine.

1. The server validates the asset, finite numeric input, leverage, notional, signal metadata, and price freshness.
2. The database locks the user's account before reading or changing balance-bearing state.
3. Entry price includes a simplified deterministic slippage model capped at 1%.
4. Opening margin is debited once inside the order transaction.
5. A manual close returns isolated margin, applies the entry and exit fee components once to realized PnL, records one trade, and updates all-time leaderboard statistics in the same transaction.
6. Loss cannot exceed isolated margin. A manual close that exhausts margin is recorded as liquidated.

There is **no automatic liquidation worker**, limit-order book, partial-close flow, funding model, or real-money execution path. Liquidation price is displayed as a risk threshold; positions are closed through the authenticated market-close path.

## Security and integrity controls

- Supabase access tokens are validated on authenticated REST routes.
- `anon` and `authenticated` cannot execute privileged trading functions or write balance-bearing tables directly.
- Authenticated users may update only their own profile avatar; username and ownership fields remain server-controlled.
- Signup provisioning creates profile, account, and leaderboard rows from canonical auth identity in one transaction.
- Legacy user repair accepts a requested username only when it matches the canonical local login identity; otherwise it generates a stable non-identifying fallback.
- Database checks reject non-finite values, invalid leverage, oversized notional, and inconsistent stored margin or liquidation math.
- Position-close code revalidates legacy accounting state before crediting funds, preventing a forged historical margin value from minting balance.
- HTTP requests use an IP-keyed in-memory rate limit behind an explicit trusted-proxy boundary.
- WebSockets limit payload size, subscriptions, buffered output, per-IP connections, and total connections; asset-feed leases converge through the paced upstream reconciler on unsubscribe, disconnect, timeout, reconnect, and shutdown.
- Development stress routes are not mounted when `NODE_ENV=production`.

## Market-data behavior

| Surface | Source | Failure behavior |
|---|---|---|
| Prices | Hyperliquid `allMids`, L2, and public trades | Missing/stale executable price returns `503` |
| Orderbook | Hyperliquid L2, 15 displayed levels | Missing/stale book returns `503` and takes only a time-bounded upstream warm lease |
| Recent trades | Hyperliquid public trades | Empty until an upstream trade is observed |
| Historical candles | CryptoCompare REST | Falls back to Hyperliquid REST, then a stale local snapshot if one exists |
| Market list | Hyperliquid metadata | Falls back to a curated list without claiming delisted markets are active |

The candle cache is isolated by asset and timeframe. A historical-candle request never creates a persistent upstream socket. Upstream WebSocket control traffic is serialized through one desired-state reconciler and capped at 1,200 messages per minute, leaving headroom below Hyperliquid's per-IP limit.

## Local development

### Prerequisites

- Node.js `>=22.13.0 <23`
- npm
- Supabase CLI and Docker for the local database stack

### Install

```bash
git clone https://github.com/claygeo/hyperliquid-trading-sim.git
cd hyperliquid-trading-sim
npm run install:all
```

Create `client/.env` from `client/.env.example` and `server/.env` from `server/.env.example`.

Client variables:

```dotenv
VITE_API_URL=http://localhost:3001
VITE_WS_URL=ws://localhost:3001/ws
VITE_SUPABASE_URL=http://127.0.0.1:54321
VITE_SUPABASE_ANON_KEY=<local anon key>
VITE_ENABLE_SYNTHETIC_EMAIL_SIGNUP=true
```

HyperSim maps usernames to synthetic `@hypersim.local` identifiers. Local Supabase is configured with email confirmation disabled, so username signup can create an immediate session. Hosted Supabase projects enable Confirm Email by default; those synthetic addresses cannot receive mail. Keep `VITE_ENABLE_SYNTHETIC_EMAIL_SIGNUP=false` in hosted builds until Confirm Email has been disabled in the Email provider and an authenticated signup has passed end-to-end QA.

Server variables:

```dotenv
PORT=3001
NODE_ENV=development
TRUST_PROXY_HOPS=0
SUPABASE_URL=http://127.0.0.1:54321
SUPABASE_SERVICE_KEY=<local service-role key>
HYPERLIQUID_API_URL=https://api.hyperliquid.xyz
HYPERLIQUID_WS_URL=wss://api.hyperliquid.xyz/ws
```

`SUPABASE_SERVICE_KEY` belongs on the server only. Never expose it through a `VITE_` variable or commit it.

### Database and app

```bash
supabase start
supabase db reset
npm run dev
```

The client starts on `http://localhost:5173`; the API and WebSocket server start on `http://localhost:3001`.

An optional read-only position-tracker bridge can be enabled with `TRACKER_SUPABASE_URL` and `TRACKER_SUPABASE_KEY` on the server. The suggestions endpoints return `enabled: false` when it is not configured.

## REST API

All routes are covered by the process-local HTTP limiter. `Auth` means `Authorization: Bearer <supabase-access-token>` is required.

| Method | Route | Auth | Purpose |
|---|---|---:|---|
| `GET` | `/health` | No | Process health |
| `GET` | `/api/market/assets` | No | Active/fallback market metadata |
| `GET` | `/api/market/candles` | No | Historical candle snapshot by asset, timeframe, and limit |
| `GET` | `/api/market/price` | No | Fresh cached market price |
| `GET` | `/api/market/orderbook` | No | Fresh cached L2 book |
| `GET` | `/api/leaderboard` | No | Paginated all-time ranking by total PnL percentage |
| `POST` | `/api/trading/order` | Yes | Open a market position; requires a UUID `Idempotency-Key` header and the caller's observed `expectedAccountResetCount` |
| `GET` | `/api/trading/positions` | Yes | Open positions with capped unrealized loss and a stale-price flag |
| `POST` | `/api/trading/close/:id` | Yes | Manually close one owned position |
| `GET` | `/api/trading/history` | Yes | Paginated trade history |
| `GET` | `/api/account` | Yes | Authoritative balance, equity, margin, and PnL |
| `GET` | `/api/account/stats` | Yes | User trading statistics |
| `POST` | `/api/account/reset` | Yes | Reset account and dependent trading state atomically |
| `GET` | `/api/replay` | Yes | User-scoped best-effort activity events |
| `GET` | `/api/suggestions` | No | Optional external tracker suggestions |
| `GET` | `/api/suggestions/stats` | No | Optional tracker statistics |

Retry an ambiguous order response with the same `Idempotency-Key` and `expectedAccountResetCount`. Within that account generation, a completed retry returns the original position without a second margin debit or duplicate activity event. The database compares the expected generation only after taking the account lock and before writing balance, position, or ledger state, so even a never-before-seen command that was already in flight when reset won cannot enter the new generation. The durable ledger separately rejects a prior-generation key presented with the current generation. A key is scoped to the authenticated user and cannot be reused for a different asset, side, size, leverage, or source command.

In non-production environments, `/api/stress-test/speed` exposes a public `GET` and authenticated `POST` for the synthetic WebSocket throughput panel.

## Public WebSocket protocol

Connect to `ws://localhost:3001/ws`. The socket is intentionally public and accepts no bearer token in the URL.

```json
{ "type": "subscribe", "channel": "price:BTC" }
{ "type": "subscribe", "channel": "orderbook:BTC" }
{ "type": "subscribe", "channel": "trades:BTC" }
{ "type": "unsubscribe", "channel": "trades:BTC" }
```

Supported market channels:

| Channel | Payload |
|---|---|
| `price:{asset}` | `{ asset, price, timestamp }` |
| `orderbook:{asset}` | `{ bids, asks, timestamp }` |
| `trades:{asset}` | `{ id, price, size, side, timestamp }` |

The server also reserves `tps` and `ping` for the development throughput panel and connection health. Asset channels accept only known case-preserved market symbols. Because prices already use the global `allMids` feed, `price:*` is the only wildcard; L2 and trade wildcards are rejected.

## Verification

At this revision:

- 159/159 Jest tests pass across 14 server suites and exit cleanly.
- 45/45 Vitest tests pass across 6 client test files.
- 83/83 pgTAP assertions pass after replaying the complete migration chain.
- Client and server typechecks pass.
- Client and server ESLint checks pass with zero warnings.
- Client and server production builds pass on Node 22.13.0.

Run the repository gates:

```bash
npm run lint
npm run typecheck
npm test
npm run test:db
npm run build
```

GitHub Actions runs lint, typecheck, client Vitest tests, server Jest coverage, a local Supabase migration/pgTAP replay, and production builds for pushes to `main` and pull requests targeting `main`.

## Known limitations and release gate

- The missing former Supabase environment means the old public demo is not evidence for this revision.
- Before deployment, replay every migration into a fresh or recovered Supabase project, run the database suite, audit or quarantine legacy position rows and invalid account reset counters, verify repaired identities, configure the username-only Auth gate, and complete authenticated browser QA.
- The simulator does not model partial fills, funding, exchange latency, automatic liquidation, limit orders, or real capital.
- Historical candles are cached REST snapshots; the latest chart bar is a client-side display overlay from the live price feed.
- Rate limiting is process-local. A multi-instance deployment needs a shared limiter.
- Activity events are emitted after trading commits on a best-effort basis; they are not an outbox and cannot guarantee deterministic replay.
- Account reset is an explicit, non-idempotent command. The client never retries it automatically; if its HTTP outcome is ambiguous, refresh authoritative account state before choosing whether to reset again.
- Market availability depends on external Hyperliquid and CryptoCompare services.

## Project structure

```text
client/                         React, Vite, Zustand, Supabase Auth UI
server/src/
  middleware/                  auth, validation, rate limit, errors
  routes/                      market, trading, account, ranking, replay
  services/hyperliquid/        live feeds and bounded candle snapshots
  services/trading/            command and account orchestration
  websocket/                   public subscription server and limits
supabase/
  migrations/                  schema, RLS, privileges, transaction functions
  tests/                       pgTAP authority and accounting suite
.github/workflows/ci.yml       lint, typecheck, test, database replay, build
```

## License

[MIT](LICENSE)
