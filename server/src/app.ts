import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { errorMiddleware } from './middleware/error.middleware.js';
import { rateLimitMiddleware } from './middleware/rateLimit.middleware.js';
import { tradingRoutes } from './routes/trading.routes.js';
import { marketRoutes } from './routes/market.routes.js';
import { leaderboardRoutes } from './routes/leaderboard.routes.js';
import { accountRoutes } from './routes/account.routes.js';
import { stressTestRoutes } from './routes/stressTest.routes.js';
import { suggestionsRoutes } from './routes/suggestions.routes.js';
import { replayRoutes } from './routes/replay.routes.js';
import { config } from './config/index.js';

export const app = express();

// Proxy trust is deployment-specific. Direct/local traffic defaults to false,
// while the Render blueprint explicitly opts into its single trusted hop.
app.set('trust proxy', config.trustProxyHops || false);

// Security middleware
app.use(helmet());
app.use(cors({
  origin: [
    'http://localhost:5173',
    'http://localhost:3000',
    'https://trading-sim-hl.netlify.app',
    'https://tradeterm.claygeo.dev'
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
app.use('/api/trading', tradingRoutes);
app.use('/api/market', marketRoutes);
app.use('/api/leaderboard', leaderboardRoutes);
app.use('/api/account', accountRoutes);
if (config.nodeEnv !== 'production') {
  app.use('/api/stress-test', stressTestRoutes);
}
app.use('/api/suggestions', suggestionsRoutes);
app.use('/api/replay', replayRoutes);

// Error handling
app.use(errorMiddleware);

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});
