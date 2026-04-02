# Hyperliquid Trading Simulator

[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![React](https://img.shields.io/badge/React-18-61DAFB?logo=react&logoColor=white)](https://reactjs.org/)
[![Express](https://img.shields.io/badge/Express-4-000000?logo=express&logoColor=white)](https://expressjs.com/)
[![Vite](https://img.shields.io/badge/Vite-5-646CFF?logo=vite&logoColor=white)](https://vitejs.dev/)
[![CI](https://github.com/claygeo/hyperliquid-trading-sim/actions/workflows/ci.yml/badge.svg)](https://github.com/claygeo/hyperliquid-trading-sim/actions/workflows/ci.yml)
[![License](https://img.shields.io/badge/License-MIT-green)](LICENSE)

A full-stack paper trading platform powered by real-time Hyperliquid and Binance market data. Trade 70+ crypto perpetual futures with $100k virtual USDC, track PnL with proper margin and liquidation math, and compete on a global leaderboard, all backed by Supabase with atomic database transactions and live WebSocket streaming.

**[Trade Now &rarr; tradeterm.app](https://tradeterm.app/)**

---

## Table of Contents

- [Features](#features)
- [Tech Stack](#tech-stack)
- [Architecture](#architecture)
- [Prerequisites](#prerequisites)
- [Setup](#setup)
- [Environment Configuration](#environment-configuration)
- [Database Setup](#database-setup)
- [Trading Engine](#trading-engine)
- [Market Data Pipeline](#market-data-pipeline)
- [WebSocket Protocol](#websocket-protocol)
- [API Reference](#api-reference)
- [Stress Testing](#stress-testing)
- [Development](#development)
- [Testing](#testing)
- [Quality](#quality)
- [Deployment](#deployment)
- [Project Structure](#project-structure)

## Features

- **Real-Time Market Data**: Live prices via Hyperliquid `allMids` WebSocket, L2 orderbook depth (15 levels), and trade feeds for 70+ assets
- **Dual Candle Sources**: Historical candles from CryptoCompare REST API with real-time 1m candle streaming from Binance US WebSocket, merged seamlessly with cache invalidation and fallback generation
- **Paper Trading Engine**: Market orders with configurable leverage (1–50×), proper margin accounting, PnL calculation, and automatic liquidation detection
- **Atomic Transactions**: All order execution and position closing runs through PostgreSQL stored procedures (`execute_market_order`, `close_position_atomic`) with row-level locking to prevent race conditions
- **TradingView Charts**: Lightweight Charts integration with 6 timeframes (1m, 5m, 15m, 1h, 4h, 1d), crosshair tooltips, and live candle updates
- **Live Orderbook**: 15-level bid/ask depth with spread calculation, streamed directly from Hyperliquid L2 data
- **Whale Tracking**: Follow positions of known Hyperliquid whale addresses with labeled identities
- **Leaderboard**: Global rankings by PnL %, win rate, and trade count with user rank calculation via PostgreSQL window functions
- **Account Management**: $100k starting balance, account reset with trade history wipe, and persistent stats tracking
- **Stress Testing**: Built-in TPS simulator (10–1,000 TPS) that generates synthetic trades to demonstrate WebSocket throughput
- **Supabase Auth**: JWT-based authentication with Bearer token middleware, Row Level Security policies on all tables, and optional WebSocket token validation
- **Rate Limiting**: In-memory IP-based rate limiter (100 req/min) with `X-RateLimit-*` response headers
- **CI/CD Pipeline**: GitHub Actions workflow with lint, typecheck, test, and build stages
- **Docker Support**: Multi-stage Dockerfile with non-root user, healthcheck, and optimized layer caching

## Tech Stack

| Layer | Technology |
|-------|------------|
| Frontend | React 18 + TypeScript + Vite |
| Styling | Tailwind CSS |
| Charts | TradingView Lightweight Charts |
| State | Zustand |
| Routing | React Router v6 |
| Backend | Node.js + Express + TypeScript |
| WebSocket | ws (server) + native WebSocket (client) |
| Database | Supabase (PostgreSQL) with RLS |
| Auth | Supabase Auth (JWT) |
| Validation | Zod |
| Security | Helmet + CORS + rate limiting |
| Market Data | Hyperliquid WebSocket + CryptoCompare REST + Binance US WebSocket |
| Testing | Jest + ts-jest |
| CI/CD | GitHub Actions |
| Deployment | Netlify (client) + Render (server) + Docker |

## Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│                          Client (React)                          │
│  TradingView Charts · Orderbook · Order Form · Leaderboard      │
│  WebSocket Client · Zustand Store · Supabase Auth                │
└──────────────┬──────────────────────────────────┬────────────────┘
               │ REST (Express)                   │ WebSocket (ws)
┌──────────────▼──────────────────────────────────▼────────────────┐
│                          Server (Node.js)                        │
│  Auth Middleware · Rate Limiter · Zod Validation · Error Handler │
│                                                                  │
│  ┌─────────────────┐  ┌──────────────────┐  ┌────────────────┐  │
│  │  Trading Engine  │  │  Market Service   │  │  Stress Test   │  │
│  │  OrderExecutor   │  │  HyperliquidSvc   │  │  TPS Generator │  │
│  │  PositionManager │  │  BinanceKlineSvc  │  │  Stats Tracker │  │
│  │  PnlCalculator   │  │  Candle Cache     │  │                │  │
│  │  AccountManager  │  │  Orderbook Cache  │  │                │  │
│  └────────┬────────┘  └────────┬─────────┘  └────────────────┘  │
│           │                    │                                  │
└───────────┼────────────────────┼─────────────────────────────────┘
            │                    │
┌───────────▼──────┐  ┌─────────▼──────────────────────────────────┐
│    Supabase       │  │            External APIs                   │
│  PostgreSQL + RLS │  │  Hyperliquid WS (allMids, l2Book, trades) │
│  Auth (JWT)       │  │  CryptoCompare REST (historical candles)  │
│  Stored Procs     │  │  Binance US WS (real-time klines)         │
└──────────────────┘  └────────────────────────────────────────────┘
```

## Prerequisites

- **Node.js 18+** and npm
- **Supabase account** with a project created
- **Git** for cloning the repository

## Setup

### 1. Clone and Install

```bash
git clone https://github.com/claygeo/hyperliquid-trading-sim.git
cd hyperliquid-trading-sim

# Install all dependencies (root, client, server)
npm run install:all
```

### 2. Configure Environment Variables

```bash
cp client/.env.example client/.env
cp server/.env.example server/.env
```

Edit both files with your Supabase credentials (see [Environment Configuration](#environment-configuration)).

### 3. Run Database Migrations

Apply the SQL migrations in `supabase/migrations/` to your Supabase project, either through the Supabase dashboard SQL editor or the CLI:

```bash
npx supabase db push
```

### 4. Start Development

```bash
# Both client and server concurrently
npm run dev

# Or separately:
npm run dev:client   # http://localhost:5173
npm run dev:server   # http://localhost:3001
```

## Environment Configuration

### Client (`client/.env`)

```env
VITE_API_URL=http://localhost:3001
VITE_WS_URL=ws://localhost:3001
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
```

### Server (`server/.env`)

```env
PORT=3001
NODE_ENV=development
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_KEY=your-service-role-key
```

## Database Setup

The application uses 5 tables and 3 atomic stored procedures. Migrations are in `supabase/migrations/` and should be run in order:

### Tables

| Table | Purpose | RLS |
|-------|---------|-----|
| `profiles` | Username, avatar | Users can view all, update own |
| `accounts` | Balance, reset count | Users can view/update own |
| `positions` | Open/closed trades with margin, PnL, liquidation price | Users can view/insert/update own |
| `trades` | Closed position history (entry, exit, PnL) | Users can view/insert own |
| `leaderboard_stats` | Aggregated PnL, win rate, drawdown | Anyone can view, users update own |

### Stored Procedures

| Function | Purpose |
|----------|---------|
| `execute_market_order` | Locks account row, checks balance, deducts margin, creates position, all atomically |
| `close_position_atomic` | Locks position, updates status, returns margin + PnL to balance, records trade |
| `liquidate_position_atomic` | Closes position with liquidation status, zeroes margin |

All procedures use `FOR UPDATE` row locking and `SECURITY DEFINER` to prevent concurrent modification.

## Trading Engine

### Order Execution Flow

1. Client submits market order (asset, side, size, leverage)
2. Server validates inputs with Zod schemas and checks asset support
3. `OrderExecutor` calculates notional value, required margin, and liquidation price
4. PostgreSQL `execute_market_order` atomically: locks account → checks balance → deducts margin → creates position
5. Position returned to client with WebSocket broadcast

### PnL Calculation

The `PnlCalculator` handles all trade math:

| Metric | Formula |
|--------|---------|
| PnL (Long) | `(currentPrice - entryPrice) × size` |
| PnL (Short) | `(entryPrice - currentPrice) × size` |
| PnL % | `((priceDiff / entryPrice) × 100) × leverage` |
| Liquidation (Long) | `entryPrice × (1 - (1 - maintenanceMargin) / leverage)` |
| Liquidation (Short) | `entryPrice × (1 + (1 - maintenanceMargin) / leverage)` |
| Win Rate | `winningTrades / totalTrades × 100` |
| Profit Factor | `grossProfit / grossLoss` |
| Max Drawdown | Peak-to-trough analysis on cumulative PnL |

### Trading Constants

| Parameter | Value |
|-----------|-------|
| Initial Balance | $100,000 USDC |
| Min Order Size | 0.001 |
| Max Leverage | 50× |
| Default Leverage | 10× |
| Maintenance Margin | 5% |
| Maker Fee | 0.02% |
| Taker Fee | 0.05% |

## Market Data Pipeline

The server aggregates data from three sources with intelligent caching and fallback:

### Price Feed
- **Source**: Hyperliquid `allMids` WebSocket (single subscription for all assets)
- **Delivery**: Broadcast to all subscribed clients on every tick

### Orderbook
- **Source**: Hyperliquid `l2Book` WebSocket (subscribed on-demand per asset)
- **Depth**: 15 levels bid/ask with cumulative totals and spread calculation
- **Subscription Queue**: Assets are subscribed with 1-second delays to avoid rate limiting

### Candles
- **Historical**: CryptoCompare REST API with per-timeframe cache TTLs (30s for 1m up to 1hr for 1d)
- **Live Updates**: Binance US WebSocket klines merged into cached historical data
- **Fallback**: If both APIs fail, generates synthetic candles based on the last known WebSocket price
- **Cache Validation**: Invalidates if cached price drifts >30% from current WebSocket price
- **Deduplication**: Pending fetch promises tracked to prevent duplicate API calls for the same asset/timeframe

### Supported Assets

70+ perpetual futures including BTC, ETH, SOL, XRP, DOGE, AVAX, LINK, ARB, OP, SUI, PEPE, WIF, TRUMP, HYPE, TAO, and more. The asset list is fetched from Hyperliquid on startup with a hardcoded fallback.

## WebSocket Protocol

### Client → Server

```json
{ "type": "subscribe", "channel": "orderbook:BTC" }
{ "type": "unsubscribe", "channel": "candles:ETH" }
```

### Server → Client

| Channel Pattern | Data |
|----------------|------|
| `price:{asset}` | `{ asset, price, timestamp }` |
| `orderbook:{asset}` | `{ bids, asks, timestamp }`, each level as `[price, size]` |
| `candles:{asset}` | `{ time, open, high, low, close, volume }` |
| `trades:{asset}` | `{ id, price, size, side, timestamp }` |
| `positions` | Position updates for authenticated users |
| `stress_test` | TPS stats when stress test is active |

Connections support wildcard subscriptions (e.g., `price:*`), heartbeat pings every 30 seconds, and optional JWT authentication via query parameter.

## API Reference

### Auth

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/api/auth/register` | No | Create account (email + password) |
| POST | `/api/auth/login` | No | Login, returns JWT |

### Account

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/api/account` | Yes | Get balance, equity, margin usage |
| POST | `/api/account/reset` | Yes | Reset to $100k, close positions, clear history |

### Trading

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/api/trading/order` | Yes | Place market order `{ asset, side, size, leverage }` |
| GET | `/api/trading/positions` | Yes | Get open positions |
| POST | `/api/trading/close/:id` | Yes | Close position at current market price |

### Market

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/api/market/candles` | No | Historical candles `?asset=BTC&timeframe=1h&limit=500` |

### Leaderboard

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/api/leaderboard` | No | Global rankings by PnL %, win rate, or trade count |

### Stress Test

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/api/stress-test` | No | Set speed: `off`, `slow` (10 TPS), `medium` (100), `fast` (500), `max` (1000) |

## Stress Testing

The built-in stress test generates synthetic trade messages to demonstrate WebSocket throughput:

| Speed | TPS | Description |
|-------|-----|-------------|
| Slow | 10 | Baseline performance |
| Medium | 100 | Moderate load |
| Fast | 500 | High throughput |
| Max | 1,000 | Maximum stress |

Stats broadcast every second: current TPS, peak TPS, total messages, average latency, and connected client count.

## Development

### Scripts

```bash
npm run dev            # Start client + server concurrently
npm run dev:client     # Vite dev server (port 5173)
npm run dev:server     # tsx watch (port 3001)
npm run build          # Build client + server
npm run lint           # Lint client + server
npm run typecheck      # TypeScript check client + server
npm test               # Jest tests (server)
npm run test:coverage  # Jest with coverage report
```

---

## Testing

69 tests across 3 test suites covering the trading engine core.

| Test Suite | File | Coverage |
|-----------|------|----------|
| Trade Math | `calculations.test.ts` | PnL, margin, liquidation price, fee calculations |
| Order Execution | `orderExecutor.test.ts` | Validation, execution flow, error handling |
| PnL Calculator | `pnlCalculator.test.ts` | Win rate, profit factor, max drawdown |

```bash
npm test              # run all tests
npm run test:coverage # with coverage report
```

**CI pipeline** runs on every push and PR via GitHub Actions: lint → typecheck → test with coverage → build. Coverage reports are uploaded as artifacts.

---

## Quality

| Check | Result |
|-------|--------|
| ESLint | 0 warnings, 0 errors |
| TypeScript | Strict mode, no errors (client + server) |
| Tests | 69/69 passing |
| Build | Client + server build successfully |
| Code Splitting | 4 manual chunks (react-vendor, supabase, charts, state) |
| Security | Helmet, CORS, rate limiting, RLS, JWT auth |

---

## Performance

Build benchmarked April 2026. All budgets passing.

| Chunk | Raw | Gzip |
|-------|-----|------|
| react-vendor | 162 KB | 53 KB |
| supabase | 171 KB | 44 KB |
| charts | 162 KB | 52 KB |
| app code | 114 KB | 28 KB |
| zustand | 3.6 KB | 1.6 KB |
| CSS | 38 KB | 7.6 KB |

| Budget | Threshold | Actual | Status |
|--------|-----------|--------|--------|
| Total JS (gzip) | < 200 KB | 179 KB | PASS |
| Largest chunk | < 500 KB | 171 KB | PASS |
| App code (gzip) | < 50 KB | 28 KB | PASS |
| CSS (gzip) | < 20 KB | 7.6 KB | PASS |
| Build time | < 10s | 3.9s | PASS |

Total gzip transfer: **187 KB** (JS + CSS). 142 modules transformed in 3.9s. Code-split into 4 vendor chunks for optimal caching.

## Deployment

### Frontend → Netlify

A `netlify.toml` is included in `client/`. Connect your repo and set build command to `npm run build` with publish directory `dist`.

### Backend → Render

A `render.yaml` blueprint is included. Set `SUPABASE_URL` and `SUPABASE_SERVICE_KEY` as environment variables.

### Docker

```bash
docker build \
  --build-arg VITE_API_URL=https://your-api.com \
  --build-arg VITE_WS_URL=wss://your-api.com/ws \
  --build-arg VITE_SUPABASE_URL=https://your-project.supabase.co \
  --build-arg VITE_SUPABASE_ANON_KEY=your-key \
  -t hyperliquid-trading-sim .

docker run -p 3001:3001 \
  -e SUPABASE_URL=https://your-project.supabase.co \
  -e SUPABASE_SERVICE_KEY=your-key \
  hyperliquid-trading-sim
```

The image runs as non-root, includes a healthcheck against `/health`, and uses multi-stage builds to minimize final image size.

## Project Structure

```
hyperliquid-trading-sim/
├── client/                          # React frontend (Vite)
│   ├── src/
│   │   ├── components/
│   │   │   ├── auth/                # LoginForm, RegisterForm, AuthGuard
│   │   │   ├── chart/               # PriceChart, CandleTooltip, ChartControls
│   │   │   ├── layout/              # Header, Sidebar, MainLayout, MobileNav
│   │   │   ├── leaderboard/         # Leaderboard, LeaderboardRow, LeaderboardTabs
│   │   │   ├── orderbook/           # Orderbook, OrderbookRow, OrderbookSpread
│   │   │   ├── participants/        # ParticipantsTable, FollowButton (whale tracking)
│   │   │   ├── stress-test/         # StressTestPanel, TPSDisplay, StressTestStats
│   │   │   ├── trades/              # RecentTrades, TradeRow
│   │   │   ├── trading/             # OrderForm, PositionPanel, OpenOrders, AccountStats
│   │   │   └── ui/                  # Button, Input, Modal, Toast, Tooltip, Tabs, etc.
│   │   ├── config/                  # Asset definitions, constants, timeframes
│   │   ├── context/                 # Auth, Market, Trading, WebSocket, Toast providers
│   │   ├── hooks/                   # useAuth, useMarketData, usePositions, useWebSocket, etc.
│   │   ├── lib/                     # API client, Supabase client, WebSocket manager, utils
│   │   ├── pages/                   # Home, Trading, Leaderboard, Profile, Login, Register
│   │   ├── styles/                  # Global CSS + Tailwind
│   │   └── types/                   # Market, trading, user, WebSocket type definitions
│   ├── netlify.toml
│   └── vite.config.ts
├── server/                          # Node.js backend (Express)
│   ├── src/
│   │   ├── __tests__/               # Jest tests for trading engine
│   │   ├── config/                  # Assets, constants, whale addresses
│   │   ├── lib/                     # Supabase client, logger, custom errors
│   │   ├── middleware/              # Auth (JWT), rate limiting, validation, error handler
│   │   ├── routes/                  # Auth, trading, market, leaderboard, account, stress test
│   │   ├── services/
│   │   │   ├── binance/             # Binance US WebSocket kline streaming
│   │   │   ├── hyperliquid/         # Hyperliquid WS + CryptoCompare REST + candle caching
│   │   │   ├── leaderboard/         # Ranking queries and stat aggregation
│   │   │   ├── stress-test/         # Synthetic trade generator with TPS tracking
│   │   │   └── trading/             # OrderExecutor, PositionManager, PnlCalculator, AccountManager
│   │   ├── types/                   # Server-side type definitions
│   │   ├── utils/                   # Calculation helpers
│   │   └── websocket/               # WebSocket server with pub/sub, heartbeat, auth
│   └── tsconfig.json
├── shared/                          # Shared TypeScript types (client + server)
├── supabase/
│   ├── migrations/                  # 7 SQL migrations (tables, RLS, stored procedures)
│   └── seed/                        # Seed data
├── .github/workflows/ci.yml        # GitHub Actions CI pipeline
├── Dockerfile                       # Multi-stage production Docker build
└── render.yaml                      # Render deployment blueprint
```

## License

MIT