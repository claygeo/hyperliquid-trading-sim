import { Router } from 'express';
import { z } from 'zod';
import { validateQuery } from '../middleware/validation.middleware.js';
import { LeaderboardService } from '../services/leaderboard/index.js';
import { logger } from '../lib/logger.js';

export const leaderboardRoutes = Router();

const leaderboardService = new LeaderboardService();

const leaderboardQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional().default(20),
  offset: z.coerce.number().int().min(0).max(10000).optional().default(0),
}).strict();

leaderboardRoutes.get('/', validateQuery(leaderboardQuerySchema), async (req, res) => {
  try {
    const { limit, offset } = req.query as unknown as {
      limit: number;
      offset: number;
    };

    const result = await leaderboardService.getLeaderboard(limit, offset);

    res.json(result);
  } catch (error) {
    logger.error('Get leaderboard error:', error);
    res.status(500).json({ error: 'Failed to fetch leaderboard' });
  }
});
