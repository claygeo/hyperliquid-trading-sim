import { Router } from 'express';
import { z } from 'zod';
import { validateQuery } from '../middleware/validation.middleware.js';
import { LeaderboardService } from '../services/leaderboard/index.js';
import { logger } from '../lib/logger.js';

export const leaderboardRoutes = Router();

const leaderboardService = new LeaderboardService();

const leaderboardQuerySchema = z.object({
  period: z.enum(['daily', 'alltime']).optional().default('alltime'),
  limit: z.string().optional().default('20'),
  offset: z.string().optional().default('0'),
});

leaderboardRoutes.get('/', validateQuery(leaderboardQuerySchema), async (req, res) => {
  try {
    const { period, limit, offset } = req.query as {
      period: 'daily' | 'alltime';
      limit: string;
      offset: string;
    };

    const result = await leaderboardService.getLeaderboard(
      period,
      parseInt(limit),
      parseInt(offset)
    );

    res.json(result);
  } catch (error) {
    logger.error('Get leaderboard error:', error);
    res.status(500).json({ error: 'Failed to fetch leaderboard' });
  }
});
