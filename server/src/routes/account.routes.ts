import { Router } from 'express';
import { authMiddleware, AuthenticatedRequest } from '../middleware/auth.middleware.js';
import { AccountManager } from '../services/trading/index.js';
import { logger } from '../lib/logger.js';

export const accountRoutes = Router();

const accountManager = new AccountManager();

// Get account
accountRoutes.get('/', authMiddleware, async (req: AuthenticatedRequest, res) => {
  try {
    const account = await accountManager.getAccount(req.userId!);
    res.json(account);
  } catch (error) {
    logger.error('Get account error:', error);
    res.status(500).json({ error: 'Failed to fetch account' });
  }
});

// Reset account
accountRoutes.post('/reset', authMiddleware, async (req: AuthenticatedRequest, res) => {
  try {
    const account = await accountManager.resetAccount(req.userId!);
    res.json(account);
  } catch (error) {
    logger.error('Reset account error:', error);
    res.status(500).json({ error: 'Failed to reset account' });
  }
});

// Get user stats
accountRoutes.get('/stats', authMiddleware, async (req: AuthenticatedRequest, res) => {
  try {
    const stats = await accountManager.getUserStats(req.userId!);
    res.json(stats);
  } catch (error) {
    logger.error('Get stats error:', error);
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
});
