import { Router } from 'express';
import { authMiddleware, AuthenticatedRequest } from '../middleware/auth.middleware.js';
import { eventService, EventType } from '../services/events/index.js';
import { logger } from '../lib/logger.js';

export const replayRoutes = Router();

// GET /api/replay?from=&to=&type=&limit=
// Returns events for the authenticated user within a time range
replayRoutes.get('/', authMiddleware, async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.userId!;
    const from = req.query.from as string | undefined;
    const to = req.query.to as string | undefined;
    const type = req.query.type as string | undefined;
    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : undefined;

    const events = await eventService.getEvents(userId, {
      from,
      to,
      type: type as EventType | undefined,
      limit: limit && !isNaN(limit) ? limit : undefined,
    });

    res.json({ events, count: events.length });
  } catch (error) {
    logger.error('Replay query error:', error);
    res.status(500).json({ error: 'Failed to fetch replay events' });
  }
});
