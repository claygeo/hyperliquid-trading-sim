import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { errorMiddleware } from './middleware/error.middleware.js';
import { rateLimitMiddleware } from './middleware/rateLimit.middleware.js';
import { authRoutes } from './routes/auth.routes.js';
import { tradingRoutes } from './routes/trading.routes.js';
import { marketRoutes } from './routes/market.routes.js';
import { leaderboardRoutes } from './routes/leaderboard.routes.js';
import { accountRoutes } from './routes/account.routes.js';
import { stressTestRoutes } from './routes/stressTest.routes.js';
import { suggestionsRoutes } from './routes/suggestions.routes.js';

export const app = express();

// Security middleware
app.use(helmet());
app.use(cors({
  origin: [
    'http://localhost:5173',
    'http://localhost:3000',
    'https://trading-sim-hl.netlify.app',
    'https://tradeterm.app',
    'https://www.tradeterm.app'
  ],
  credentials: true,
}));

// Body parsing
app.use(express.json());

// Rate limiting
app.use(rateLimitMiddleware);

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: Date.now() });
});

// API routes
app.use('/api/auth', authRoutes);
app.use('/api/trading', tradingRoutes);
app.use('/api/market', marketRoutes);
app.use('/api/leaderboard', leaderboardRoutes);
app.use('/api/account', accountRoutes);
app.use('/api/stress-test', stressTestRoutes);
app.use('/api/suggestions', suggestionsRoutes);

// Error handling
app.use(errorMiddleware);

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});