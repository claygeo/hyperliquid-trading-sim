# Hyperliquid Trading Simulator

A high-performance paper trading simulator powered by real-time Hyperliquid market data. Practice trading BTC, ETH, and SOL with $100k virtual USDC while competing on the global leaderboard.

## Features

- **Real-time Market Data**: Live prices, candles, and orderbook from Hyperliquid
- **Paper Trading**: Start with $100k virtual USDC, place market orders
- **TradingView Charts**: Professional charting with Lightweight Charts library
- **Live Orderbook**: 10-level depth with real-time updates
- **Whale Tracking**: Follow positions of top Hyperliquid traders
- **Leaderboard**: Compete for top spots based on PnL and win rate
- **Stress Testing**: Demonstrate system performance with high TPS simulation

## Tech Stack

| Layer | Technology |
|-------|------------|
| Frontend | React 18 + TypeScript + Vite |
| Charts | TradingView Lightweight Charts |
| Backend | Node.js + Express + WebSocket |
| Database | Supabase (PostgreSQL) |
| Real-time | Native WebSockets |
| Market Data | Hyperliquid API |

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        Frontend                              │
│  React + TradingView Charts + WebSocket Client              │
└─────────────────────┬───────────────────────────────────────┘
                      │ WebSocket + REST
┌─────────────────────▼───────────────────────────────────────┐
│                        Backend                               │
│  Express + WebSocket Server + Order Execution               │
└──────────┬──────────────────────────────────┬───────────────┘
           │                                  │
┌──────────▼──────────┐          ┌───────────▼───────────────┐
│     Supabase        │          │      Hyperliquid API      │
│  Auth + Database    │          │   Prices + Orderbook      │
└─────────────────────┘          └───────────────────────────┘
```

## Getting Started

### Prerequisites

- Node.js 18+
- npm or yarn
- Supabase account

### Environment Variables

**Client (`client/.env`)**:
```env
VITE_API_URL=http://localhost:3001
VITE_WS_URL=ws://localhost:3001
VITE_SUPABASE_URL=your_supabase_url
VITE_SUPABASE_ANON_KEY=your_anon_key
```

**Server (`server/.env`)**:
```env
PORT=3001
SUPABASE_URL=your_supabase_url
SUPABASE_SERVICE_KEY=your_service_key
NODE_ENV=development
```

### Installation

```bash
# Install client dependencies
cd client && npm install

# Install server dependencies
cd ../server && npm install

# Run database migrations
cd ../supabase && npx supabase db push
```

### Development

```bash
# Terminal 1: Start backend
cd server && npm run dev

# Terminal 2: Start frontend
cd client && npm run dev
```

### Production Deployment

**Frontend (Netlify)**:
```bash
cd client && npm run build
# Deploy dist/ folder to Netlify
```

**Backend (Render)**:
```bash
cd server && npm run build
# Deploy with start command: npm start
```

## Project Structure

```
hyperliquid-trading-sim/
├── client/          # React frontend
├── server/          # Node.js backend
├── shared/          # Shared types
└── supabase/        # Database migrations
```

## API Documentation

### REST Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | /api/auth/register | Create account |
| POST | /api/auth/login | Login |
| GET | /api/account | Get account balance |
| POST | /api/account/reset | Reset to $100k |
| POST | /api/trading/order | Place market order |
| GET | /api/trading/positions | Get open positions |
| POST | /api/trading/close/:id | Close position |
| GET | /api/leaderboard | Get leaderboard |
| GET | /api/market/candles | Get historical candles |

### WebSocket Channels

| Channel | Description |
|---------|-------------|
| `candles:{asset}` | Live candle updates |
| `orderbook:{asset}` | Orderbook depth |
| `trades:{asset}` | Recent trades |
| `positions` | User position updates |
| `participants` | Whale position updates |

## License

MIT
