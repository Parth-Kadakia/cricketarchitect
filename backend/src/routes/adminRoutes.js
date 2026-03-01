import { Router } from 'express';
import pool from '../config/db.js';
import { requireAdmin, requireAuth } from '../middleware/auth.js';
import asyncHandler from '../utils/asyncHandler.js';
import { releaseInactiveFranchises } from '../services/inactivityService.js';
import { bootstrapGameWorld } from '../services/bootstrapService.js';
import { getActiveSeason } from '../services/leagueService.js';
import { runCpuMarketCycle } from '../services/cpuManagerService.js';
import { processSeasonRetirements } from '../services/retirementService.js';
import { broadcast } from '../ws/realtime.js';

const router = Router();

router.post(
  '/bootstrap',
  requireAuth,
  requireAdmin,
  asyncHandler(async (req, res) => {
    const season = await bootstrapGameWorld(pool);
    return res.json({ season });
  })
);

router.post(
  '/inactivity/run',
  requireAuth,
  requireAdmin,
  asyncHandler(async (req, res) => {
    const released = await releaseInactiveFranchises(pool);

    if (released.length) {
      broadcast('market:update', { released }, 'marketplace');
    }

    return res.json({ releasedCount: released.length, released });
  })
);

router.post(
  '/cpu-cycle',
  requireAuth,
  requireAdmin,
  asyncHandler(async (req, res) => {
    const season = await getActiveSeason(pool);

    if (!season) {
      return res.status(400).json({ message: 'No active season found.' });
    }

    const actions = await runCpuMarketCycle(season.id, pool);
    broadcast('market:update', { actions }, 'marketplace');

    return res.json({ seasonId: season.id, actions });
  })
);

router.post(
  '/retirements/run',
  requireAuth,
  requireAdmin,
  asyncHandler(async (req, res) => {
    const season = await getActiveSeason(pool);

    if (!season) {
      return res.status(400).json({ message: 'No active season found.' });
    }

    const retired = await processSeasonRetirements(season.id, pool);

    return res.json({ seasonId: season.id, retiredCount: retired.length, retired });
  })
);

export default router;
