import { Router } from 'express';
import { z } from 'zod';
import { validateBody } from '../middleware/validation.middleware.js';
import { authMiddleware } from '../middleware/auth.middleware.js';
import { logger } from '../lib/logger.js';
import type { StressTestService } from '../services/stress-test/index.js';

export const stressTestRoutes = Router();

let stressTestService: StressTestService | null = null;

export function setStressTestService(service: StressTestService) {
  stressTestService = service;
  logger.info('StressTestService injected into routes');
}

const speedSchema = z.object({
  speed: z.enum(['off', 'slow', 'medium', 'fast']),
});

stressTestRoutes.post('/speed', authMiddleware, validateBody(speedSchema), async (req, res) => {
  try {
    const { speed } = req.body;

    if (!stressTestService) {
      return res.status(500).json({ error: 'Stress test service not initialized' });
    }

    stressTestService.setSpeed(speed);
    res.json({ success: true, speed });
  } catch (error) {
    logger.error('Set stress test speed error:', error);
    res.status(500).json({ error: 'Failed to set stress test speed' });
  }
});

stressTestRoutes.get('/speed', async (req, res) => {
  try {
    const speed = stressTestService?.getSpeed() || 'off';
    res.json({ speed });
  } catch (error) {
    logger.error('Get stress test speed error:', error);
    res.status(500).json({ error: 'Failed to get stress test speed' });
  }
});
