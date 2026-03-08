import { Router } from 'express';
import pool from '../config/db.js';
import { requireAdmin, requireAuth } from '../middleware/auth.js';
import asyncHandler from '../utils/asyncHandler.js';
import { releaseInactiveFranchises } from '../services/inactivityService.js';
import { bootstrapGameWorld } from '../services/bootstrapService.js';
import { getActiveSeason, getLeagueTable } from '../services/leagueService.js';
import { runCpuMarketCycle } from '../services/cpuManagerService.js';
import { transitionManagerToUnemployed } from '../services/managerCareerService.js';
import { processSeasonRetirements } from '../services/retirementService.js';
import { rebalanceSeasonPlayers } from '../services/rebalanceService.js';
import { broadcast } from '../ws/realtime.js';

const router = Router();

/* ── Admin: list all users + their franchise/manager stats ── */
router.get(
  '/users',
  requireAuth,
  requireAdmin,
  asyncHandler(async (req, res) => {
    const { rows } = await pool.query(`
      SELECT u.id, u.email, u.display_name, u.role, u.career_mode,
             u.manager_status, u.manager_points, u.manager_firings, u.manager_titles,
             u.manager_matches_managed, u.manager_wins_managed, u.manager_losses_managed,
             u.last_active_at, u.created_at,
             f.id AS franchise_id, f.franchise_name, f.status AS franchise_status,
             f.competition_mode, f.current_league_tier, f.wins AS f_wins, f.losses AS f_losses,
             f.championships, f.total_valuation, f.prospect_points, f.growth_points,
             c.name AS city_name, c.country
      FROM users u
      LEFT JOIN franchises f ON f.owner_user_id = u.id
      LEFT JOIN cities c ON c.id = f.city_id
      ORDER BY u.created_at DESC
    `);
    return res.json({ users: rows });
  })
);

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

/* ── Reset Career (resets ONLY the requesting user's career) ── */
router.post(
  '/reset-game',
  requireAuth,
  asyncHandler(async (req, res) => {
    const confirmText = String(req.body?.confirm || '').trim();
    if (confirmText !== 'RESET') {
      return res.status(400).json({ message: 'You must send { confirm: "RESET" } to proceed.' });
    }

    const userId = req.user.id;

    /* Find the user's current franchise (if any) */
    const franchiseRow = (await pool.query(
      `SELECT id FROM franchises WHERE owner_user_id = $1 LIMIT 1`,
      [userId]
    )).rows[0];

    const franchiseId = franchiseRow?.id || null;

    /* Release franchise ownership back to CPU (closes stints, board profiles, assigns CPU manager) */
    if (franchiseId) {
      await transitionManagerToUnemployed({
        userId,
        franchiseId,
        endReason: 'RESET',
        incrementFirings: false,
        generateOffers: false,
        releaseTeam: true,
      });
    }

    /* Clean up user-specific data */
    await pool.query(`DELETE FROM manager_offers WHERE user_id = $1`, [userId]);
    await pool.query(`DELETE FROM manager_stints WHERE user_id = $1`, [userId]);
    await pool.query(`DELETE FROM board_profiles WHERE user_id = $1`, [userId]);
    if (franchiseId) {
      await pool.query(`DELETE FROM trophy_cabinet WHERE franchise_id = $1`, [franchiseId]);
      await pool.query(`DELETE FROM franchise_sales WHERE seller_user_id = $1 OR buyer_user_id = $1`, [userId]);
    }

    /* Reset user stats to fresh state */
    await pool.query(
      `UPDATE users
       SET manager_status = 'UNEMPLOYED',
           manager_points = 0,
           manager_unemployed_since = NOW(),
           manager_retired_at = NULL,
           manager_firings = 0,
           manager_titles = 0,
           manager_matches_managed = 0,
           manager_wins_managed = 0,
           manager_losses_managed = 0,
           updated_at = NOW()
       WHERE id = $1`,
      [userId]
    );

    return res.json({ message: 'Career reset successfully. Pick a city or country to start fresh.' });
  })
);

export default router;
