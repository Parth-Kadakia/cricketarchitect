import { Router } from 'express';
import pool from '../config/db.js';
import { requireAdmin, requireAuth } from '../middleware/auth.js';
import asyncHandler from '../utils/asyncHandler.js';
import { releaseInactiveFranchises } from '../services/inactivityService.js';
import { bootstrapGameWorld } from '../services/bootstrapService.js';
import { getActiveSeason, getLeagueTable } from '../services/leagueService.js';
import { runCpuMarketCycle } from '../services/cpuManagerService.js';
import { processSeasonRetirements } from '../services/retirementService.js';
import { rebalanceSeasonPlayers } from '../services/rebalanceService.js';
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
  '/rebalance-season',
  requireAuth,
  requireAdmin,
  asyncHandler(async (req, res) => {
    const requestedSeasonId = Number(req.body?.seasonId || 0) || null;
    const dryRun = Boolean(req.body?.dryRun);

    const result = await rebalanceSeasonPlayers(
      { seasonId: requestedSeasonId, dryRun },
      pool
    );

    if (!dryRun && result.seasonId) {
      const table = await getLeagueTable(result.seasonId, pool);
      broadcast('league:update', { seasonId: result.seasonId, table }, 'league');
      broadcast('market:update', { reason: 'season_rebalance', seasonId: result.seasonId }, 'marketplace');
    }

    return res.json(result);
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

/* ── Reset Game (available to any authenticated user) ── */
router.post(
  '/reset-game',
  requireAuth,
  asyncHandler(async (req, res) => {
    const confirmText = String(req.body?.confirm || '').trim();
    if (confirmText !== 'RESET') {
      return res.status(400).json({ message: 'You must send { confirm: "RESET" } to proceed.' });
    }

    /* Wipe all game data but keep users and the world-city catalog */
    await pool.query(`
      TRUNCATE TABLE
        transfer_feed,
        franchise_sales,
        trophy_cabinet,
        valuations,
        transactions,
        player_growth_logs,
        player_match_stats,
        match_events,
        matches,
        season_teams,
        seasons,
        players,
        regions,
        franchises
      RESTART IDENTITY CASCADE
    `);

    /* Re-seed the welcome note */
    await pool.query(
      `INSERT INTO transfer_feed (season_id, action_type, message)
       VALUES (NULL, 'SEASON_NOTE', 'Game world has been reset. Claim any city to start a fresh career.')`
    );

    return res.json({ message: 'Game world reset successfully. Pick a new city to begin.' });
  })
);

export default router;
