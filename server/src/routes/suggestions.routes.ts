// ============================================
// Suggested Trades Routes
//
// Public endpoints (no auth required) that expose
// signals from the position tracker as trade suggestions.
// ============================================

import { Router } from 'express';
import { trackerBridge } from '../services/tracker-bridge/index.js';
import { ExternalServiceError } from '../lib/errors.js';
import { logger } from '../lib/logger.js';

export const suggestionsRoutes = Router();

// Get active suggested trades from the position tracker
suggestionsRoutes.get('/', async (req, res) => {
  try {
    if (!trackerBridge.isEnabled()) {
      return res.json({
        enabled: false,
        suggestions: [],
        message: 'Position tracker bridge not configured',
      });
    }

    const suggestions = await trackerBridge.getSuggestedTrades();
    const stats = await trackerBridge.getTrackerStats();

    res.json({
      enabled: true,
      suggestions,
      stats,
      updatedAt: new Date().toISOString(),
    });
  } catch (error) {
    if (error instanceof ExternalServiceError) {
      logger.error(`Tracker bridge error: ${error.message}`);
      return res.status(502).json({
        error: 'Tracker offline',
        details: error.message,
      });
    }
    logger.error('Suggestions route error:', error);
    res.status(500).json({ error: 'Failed to fetch suggestions' });
  }
});

// Get tracker stats only (lightweight)
suggestionsRoutes.get('/stats', async (req, res) => {
  try {
    if (!trackerBridge.isEnabled()) {
      return res.json({ enabled: false, stats: null });
    }

    const stats = await trackerBridge.getTrackerStats();
    res.json({ enabled: true, stats });
  } catch (error) {
    if (error instanceof ExternalServiceError) {
      logger.error(`Tracker bridge stats error: ${error.message}`);
      return res.status(502).json({
        error: 'Tracker offline',
        details: error.message,
      });
    }
    logger.error('Suggestions stats error:', error);
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
});
