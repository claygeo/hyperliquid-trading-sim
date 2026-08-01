import { Router } from 'express';
import { z } from 'zod';
import { authMiddleware, AuthenticatedRequest } from '../middleware/auth.middleware.js';
import { validateQuery } from '../middleware/validation.middleware.js';
import { eventService, EventType } from '../services/events/index.js';
import { logger } from '../lib/logger.js';

export const replayRoutes = Router();

const replayQuerySchema = z.object({
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
  type: z.enum(['trade_executed', 'position_closed', 'signal_received', 'price_tick', 'pnl_update']).optional(),
  limit: z.coerce.number().int().min(1).max(1000).optional().default(100),
}).strict().superRefine((query, context) => {
  if (query.from && query.to && Date.parse(query.from) > Date.parse(query.to)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['to'],
      message: 'to must be at or after from',
    });
  }
});

// GET /api/replay?from=&to=&type=&limit=
// Returns events for the authenticated user within a time range
replayRoutes.get('/', authMiddleware, validateQuery(replayQuerySchema), async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.userId!;
    const { from, to, type, limit } = req.query as unknown as z.infer<typeof replayQuerySchema>;

    const events = await eventService.getEvents(userId, {
      from,
      to,
      type: type as EventType | undefined,
      limit,
    });

    res.json({ events, count: events.length });
  } catch (error) {
    logger.error('Replay query error:', error);
    res.status(500).json({ error: 'Failed to fetch replay events' });
  }
});
