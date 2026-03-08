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

/* ── Admin: aggregate game-wide statistics ── */
router.get(
  '/stats',
  requireAuth,
  requireAdmin,
  asyncHandler(async (req, res) => {
    const [
      userStats,
      franchiseStats,
      seasonStats,
      matchStats,
      playerStats,
      topFranchises,
      recentSignups,
      careerModeBreakdown
    ] = await Promise.all([
      pool.query(`
        SELECT COUNT(*)::int AS total_users,
               COUNT(*) FILTER (WHERE manager_status = 'ACTIVE')::int AS active_managers,
               COUNT(*) FILTER (WHERE manager_status = 'UNEMPLOYED')::int AS unemployed,
               COUNT(*) FILTER (WHERE manager_status = 'RETIRED')::int AS retired,
               SUM(manager_matches_managed)::int AS total_user_matches,
               SUM(manager_wins_managed)::int AS total_user_wins,
               SUM(manager_losses_managed)::int AS total_user_losses,
               SUM(manager_titles)::int AS total_user_titles,
               COUNT(*) FILTER (WHERE last_active_at > NOW() - INTERVAL '24 hours')::int AS active_24h,
               COUNT(*) FILTER (WHERE last_active_at > NOW() - INTERVAL '7 days')::int AS active_7d,
               COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '24 hours')::int AS signups_24h,
               COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '7 days')::int AS signups_7d
        FROM users
      `),
      pool.query(`
        SELECT COUNT(*)::int AS total_franchises,
               COUNT(*) FILTER (WHERE owner_user_id IS NOT NULL)::int AS user_owned,
               COUNT(*) FILTER (WHERE owner_user_id IS NULL AND status != 'AVAILABLE')::int AS cpu_controlled,
               COUNT(*) FILTER (WHERE status = 'AVAILABLE')::int AS available,
               COALESCE(ROUND(AVG(total_valuation)::numeric, 2), 0) AS avg_valuation,
               COALESCE(MAX(total_valuation), 0) AS max_valuation,
               COALESCE(SUM(wins)::int, 0) AS total_franchise_wins,
               COALESCE(SUM(losses)::int, 0) AS total_franchise_losses,
               COALESCE(SUM(championships)::int, 0) AS total_championships
        FROM franchises
      `),
      pool.query(`
        SELECT COUNT(*)::int AS total_seasons,
               COUNT(*) FILTER (WHERE status = 'ACTIVE')::int AS active_seasons,
               COUNT(*) FILTER (WHERE status = 'COMPLETED')::int AS completed_seasons,
               MAX(season_number) AS latest_season_number
        FROM seasons
      `),
      pool.query(`
        SELECT COUNT(*)::int AS total_matches,
               COUNT(*) FILTER (WHERE status = 'COMPLETED')::int AS completed_matches,
               COUNT(*) FILTER (WHERE status = 'SCHEDULED')::int AS scheduled_matches,
               COUNT(*) FILTER (WHERE status = 'LIVE')::int AS live_matches
        FROM matches
      `),
      pool.query(`
        SELECT COUNT(*)::int AS total_players,
               COUNT(*) FILTER (WHERE squad_status = 'MAIN_SQUAD')::int AS main_squad,
               COUNT(*) FILTER (WHERE squad_status = 'YOUTH')::int AS youth,
               COUNT(*) FILTER (WHERE squad_status = 'RETIRED')::int AS retired_players,
               COALESCE(ROUND(AVG(age)::numeric, 1), 0) AS avg_age,
               COALESCE(ROUND(AVG(market_value)::numeric, 2), 0) AS avg_market_value,
               COALESCE(ROUND(AVG(batting)::numeric, 1), 0) AS avg_batting,
               COALESCE(ROUND(AVG(bowling)::numeric, 1), 0) AS avg_bowling,
               COALESCE(ROUND(AVG(fielding)::numeric, 1), 0) AS avg_fielding
        FROM players
      `),
      pool.query(`
        SELECT f.franchise_name, c.name AS city_name, c.country,
               f.total_valuation, f.wins, f.losses, f.championships,
               f.current_league_tier,
               u.display_name AS owner_name
        FROM franchises f
        LEFT JOIN cities c ON c.id = f.city_id
        LEFT JOIN users u ON u.id = f.owner_user_id
        ORDER BY f.total_valuation DESC
        LIMIT 5
      `),
      pool.query(`
        SELECT id, display_name, email, career_mode, manager_status, created_at
        FROM users
        ORDER BY created_at DESC
        LIMIT 10
      `),
      pool.query(`
        SELECT career_mode, COUNT(*)::int AS count
        FROM users
        GROUP BY career_mode
      `)
    ]);

    return res.json({
      users: userStats.rows[0],
      franchises: franchiseStats.rows[0],
      seasons: seasonStats.rows[0],
      matches: matchStats.rows[0],
      players: playerStats.rows[0],
      topFranchises: topFranchises.rows,
      recentSignups: recentSignups.rows,
      careerModes: careerModeBreakdown.rows
    });
  })
);

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
             f.fan_rating, f.financial_balance, f.academy_level,
             c.name AS city_name, c.country,
             COALESCE(sq.squad_size, 0)::int AS squad_size,
             COALESCE(sq.main_xi, 0)::int AS main_xi,
             COALESCE(sq.youth_count, 0)::int AS youth_count,
             COALESCE(sq.avg_ovr, 0) AS avg_ovr
      FROM users u
      LEFT JOIN franchises f ON f.owner_user_id = u.id
      LEFT JOIN cities c ON c.id = f.city_id
      LEFT JOIN LATERAL (
        SELECT COUNT(*)::int AS squad_size,
               COUNT(*) FILTER (WHERE squad_status = 'MAIN_SQUAD')::int AS main_xi,
               COUNT(*) FILTER (WHERE squad_status = 'YOUTH')::int AS youth_count,
               ROUND(AVG((batting + bowling + fielding + fitness + temperament) / 5.0)::numeric, 1) AS avg_ovr
        FROM players WHERE franchise_id = f.id
      ) sq ON TRUE
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
    const season = await bootstrapGameWorld(pool, req.user.active_world_id || null);
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
    const season = await getActiveSeason(pool, req.user.active_world_id || null);

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
      { seasonId: requestedSeasonId, dryRun, worldId: req.user.active_world_id || null },
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
    const season = await getActiveSeason(pool, req.user.active_world_id || null);

    if (!season) {
      return res.status(400).json({ message: 'No active season found.' });
    }

    const retired = await processSeasonRetirements(season.id, pool);

    return res.json({ seasonId: season.id, retiredCount: retired.length, retired });
  })
);

/* ── Global Wipe: delete ALL game data, reset every user to fresh state ── */
router.post(
  '/wipe-all',
  requireAuth,
  requireAdmin,
  asyncHandler(async (req, res) => {
    const confirmText = String(req.body?.confirm || '').trim();
    if (confirmText !== 'WIPE_ALL') {
      return res.status(400).json({ message: 'You must send { confirm: "WIPE_ALL" } to proceed.' });
    }

    /* Delete all worlds — cascades to franchises, seasons, matches, players, etc. */
    await pool.query('DELETE FROM transfer_feed');
    await pool.query('DELETE FROM manager_offers');
    await pool.query('DELETE FROM board_expectations');
    await pool.query('DELETE FROM board_profiles');
    await pool.query('DELETE FROM manager_stints');
    await pool.query('DELETE FROM franchise_sales');
    await pool.query('DELETE FROM trophy_cabinet');
    await pool.query('DELETE FROM valuations');
    await pool.query('DELETE FROM transactions');
    await pool.query('DELETE FROM player_growth_logs');
    await pool.query('DELETE FROM player_match_stats');
    await pool.query('DELETE FROM match_partnerships');
    await pool.query('DELETE FROM match_fall_of_wickets');
    await pool.query('DELETE FROM match_over_stats');
    await pool.query('DELETE FROM match_innings_stats');
    await pool.query('DELETE FROM match_events');
    await pool.query('DELETE FROM matches');
    await pool.query('DELETE FROM season_teams');
    await pool.query('DELETE FROM seasons');
    await pool.query('DELETE FROM players');
    await pool.query('DELETE FROM regions');
    await pool.query('DELETE FROM manager_team_stints');
    await pool.query('DELETE FROM managers');
    await pool.query('DELETE FROM franchises');
    await pool.query('DELETE FROM worlds');

    /* Reset every user to fresh unemployed state (keep accounts) */
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
           active_world_id = NULL,
           updated_at = NOW()`
    );

    return res.json({ message: 'All game data wiped. Every user is now fresh.' });
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
    const worldId = req.user.active_world_id || null;
    const franchiseRow = (await pool.query(
      `SELECT id FROM franchises WHERE owner_user_id = $1 AND ($2::bigint IS NULL OR world_id = $2) LIMIT 1`,
      [userId, worldId]
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
