import { Router } from 'express';
import pool from '../config/db.js';
import { requireAuth } from '../middleware/auth.js';
import asyncHandler from '../utils/asyncHandler.js';
import { getFranchiseByOwner } from '../services/franchiseService.js';
import { demoteMainSquadPlayer, loanPlayer, promoteYouthPlayer, releasePlayer } from '../services/youthService.js';
import { ensureFranchiseLineup, setFranchiseLineup } from '../services/lineupService.js';
import { CAREER_MODES, normalizeCareerMode } from '../constants/gameModes.js';

const router = Router();
const SALARY_CAP = 120;

router.get(
  '/',
  requireAuth,
  asyncHandler(async (req, res) => {
    const franchise = await getFranchiseByOwner(req.user.id, undefined, req.user.active_world_id || null);
    if (!franchise) {
      return res.status(404).json({ message: 'No active franchise found.' });
    }

    await ensureFranchiseLineup(franchise.id, pool, { mode: 'smart' });

    const players = await pool.query(
      `SELECT *, ROUND((batting + bowling + fielding + fitness + temperament) / 5.0, 1) AS overall
       FROM players
       WHERE franchise_id = $1
       ORDER BY squad_status, starting_xi DESC, lineup_slot ASC NULLS LAST, overall DESC, potential DESC`,
      [franchise.id]
    );

    const payroll = await pool.query(
      `SELECT COALESCE(SUM(salary), 0) AS payroll
       FROM players
       WHERE franchise_id = $1
         AND squad_status = 'MAIN_SQUAD'`,
      [franchise.id]
    );

    return res.json({
      salaryCap: SALARY_CAP,
      payroll: Number(payroll.rows[0].payroll),
      remainingCap: Number((SALARY_CAP - Number(payroll.rows[0].payroll)).toFixed(2)),
      players: players.rows
    });
  })
);

router.get(
  '/franchise/:franchiseId',
  requireAuth,
  asyncHandler(async (req, res) => {
    const franchiseId = Number(req.params.franchiseId || 0);
    if (!franchiseId) {
      return res.status(400).json({ message: 'Invalid franchise id.' });
    }

    const franchiseResult = await pool.query(
      `SELECT f.id,
              f.franchise_name,
              f.status,
              f.wins,
              f.losses,
              f.championships,
              f.win_streak,
              f.best_win_streak,
              f.fan_rating,
              f.academy_level,
              f.youth_development_rating,
              f.prospect_points,
              f.growth_points,
              f.total_valuation,
              f.current_league_tier,
              f.promotions,
              f.relegations,
              c.name AS city_name,
              c.country,
              c.latitude,
              c.longitude,
              st.played,
              st.won,
              st.lost,
              st.tied,
              st.points,
              st.net_run_rate,
              st.league_position,
              COALESCE(
                NULLIF(to_jsonb(u)->>'display_name', ''),
                NULLIF(to_jsonb(u)->>'username', ''),
                split_part(COALESCE(to_jsonb(u)->>'email', ''), '@', 1)
              ) AS owner_name
       FROM franchises f
       JOIN cities c ON c.id = f.city_id
       LEFT JOIN users u ON u.id = f.owner_user_id
       LEFT JOIN seasons s ON s.status = 'ACTIVE' AND ($2::bigint IS NULL OR s.world_id = $2)
       LEFT JOIN season_teams st ON st.season_id = s.id AND st.franchise_id = f.id
       WHERE f.id = $1
       LIMIT 1`,
      [franchiseId, req.user.active_world_id || null]
    );

    if (!franchiseResult.rows.length) {
      return res.status(404).json({ message: 'Franchise not found.' });
    }

    const playersResult = await pool.query(
      `SELECT p.id,
              p.first_name,
              p.last_name,
              p.country_origin,
              p.role,
              p.batsman_type,
              p.batsman_hand,
              p.bowler_hand,
              p.bowler_style,
              p.bowler_mentality,
              p.age,
              p.batting,
              p.bowling,
              p.fielding,
              p.fitness,
              p.temperament,
              p.potential,
              p.market_value,
              p.salary,
              p.morale,
              p.form,
              p.squad_status,
              p.starting_xi,
              p.lineup_slot,
              p.on_loan_to_franchise_id,
              lf.franchise_name AS on_loan_to_franchise_name,
              ROUND((p.batting + p.bowling + p.fielding + p.fitness + p.temperament) / 5.0, 1) AS overall
       FROM players p
       LEFT JOIN franchises lf ON lf.id = p.on_loan_to_franchise_id
       WHERE p.franchise_id = $1
         AND p.squad_status IN ('MAIN_SQUAD', 'YOUTH', 'LOANED', 'RETIRED')
       ORDER BY
         CASE
           WHEN p.starting_xi = TRUE THEN 0
           WHEN p.squad_status = 'MAIN_SQUAD' THEN 1
           WHEN p.squad_status = 'YOUTH' THEN 2
           WHEN p.squad_status = 'LOANED' THEN 3
           ELSE 4
         END,
         p.lineup_slot ASC NULLS LAST,
         ROUND((p.batting + p.bowling + p.fielding + p.fitness + p.temperament) / 5.0, 1) DESC,
         p.potential DESC,
         p.age ASC`,
      [franchiseId]
    );

    const players = playersResult.rows;
    const lineup = players
      .filter((player) => Boolean(player.starting_xi))
      .sort((a, b) => Number(a.lineup_slot || 99) - Number(b.lineup_slot || 99));
    const mainSquad = players.filter((player) => player.squad_status === 'MAIN_SQUAD');
    const youth = players.filter((player) => player.squad_status === 'YOUTH');
    const loanedOut = players.filter((player) => player.squad_status === 'LOANED');

    const roleCounts = players.reduce(
      (acc, player) => {
        const role = String(player.role || '').toUpperCase();
        if (acc[role] != null) {
          acc[role] += 1;
        }
        return acc;
      },
      { BATTER: 0, BOWLER: 0, ALL_ROUNDER: 0, WICKET_KEEPER: 0 }
    );

    const averageOverall = players.length
      ? Number((players.reduce((sum, player) => sum + Number(player.overall || 0), 0) / players.length).toFixed(1))
      : 0;

    return res.json({
      franchise: franchiseResult.rows[0],
      squad: {
        players,
        lineup,
        mainSquad,
        youth,
        loanedOut,
        totalPlayers: players.length,
        averageOverall,
        roleCounts
      }
    });
  })
);

router.get(
  '/player/:playerId',
  requireAuth,
  asyncHandler(async (req, res) => {
    const playerResult = await pool.query(
      `SELECT p.*, ROUND((p.batting + p.bowling + p.fielding + p.fitness + p.temperament) / 5.0, 1) AS overall,
              f.franchise_name
       FROM players p
       LEFT JOIN franchises f ON f.id = p.franchise_id
       WHERE p.id = $1`,
      [req.params.playerId]
    );

    if (!playerResult.rows.length) {
      return res.status(404).json({ message: 'Player not found.' });
    }

    const player = playerResult.rows[0];

    const recentMatches = await pool.query(
      `SELECT pms.*, m.season_id, m.round_no, m.stage, m.result_summary,
              hf.franchise_name AS home_franchise_name,
              af.franchise_name AS away_franchise_name
       FROM player_match_stats pms
       JOIN matches m ON m.id = pms.match_id
       JOIN franchises hf ON hf.id = m.home_franchise_id
       JOIN franchises af ON af.id = m.away_franchise_id
       WHERE pms.player_id = $1
       ORDER BY pms.created_at DESC
       LIMIT 100`,
      [player.id]
    );

    /* Per-season aggregated stats */
    const seasonStats = await pool.query(
      `SELECT m.season_id,
              COUNT(*)::int                        AS matches,
              COALESCE(SUM(pms.batting_runs), 0)::int   AS runs,
              COALESCE(SUM(pms.batting_balls), 0)::int  AS balls,
              COALESCE(SUM(pms.fours), 0)::int          AS fours,
              COALESCE(SUM(pms.sixes), 0)::int          AS sixes,
              COALESCE(SUM(CASE WHEN pms.batting_runs BETWEEN 50 AND 99 THEN 1 ELSE 0 END), 0)::int AS fifties,
              COALESCE(SUM(CASE WHEN pms.batting_runs >= 100 THEN 1 ELSE 0 END), 0)::int AS hundreds,
              COALESCE(SUM(pms.bowling_wickets), 0)::int AS wickets,
              COALESCE(SUM(pms.bowling_balls), 0)::int  AS bowling_balls,
              COALESCE(SUM(pms.bowling_runs), 0)::int   AS runs_conceded,
              COALESCE(SUM(pms.maiden_overs), 0)::int   AS maidens,
              COALESCE(SUM(pms.catches), 0)::int        AS catches,
              COALESCE(SUM(pms.run_outs), 0)::int       AS run_outs,
              ROUND(AVG(pms.player_rating), 2)          AS avg_rating,
              MAX(pms.batting_runs)::int                 AS highest_score,
              MAX(pms.bowling_wickets)::int              AS best_wickets,
              SUM(CASE WHEN pms.not_out THEN 1 ELSE 0 END)::int AS not_outs
       FROM player_match_stats pms
       JOIN matches m ON m.id = pms.match_id
       WHERE pms.player_id = $1
       GROUP BY m.season_id
       ORDER BY m.season_id`,
      [player.id]
    );

    const growthHistory = await pool.query(
      `SELECT *
       FROM player_growth_logs
       WHERE player_id = $1
       ORDER BY recorded_at DESC
       LIMIT 20`,
      [player.id]
    );

    return res.json({
      player,
      recentMatches: recentMatches.rows,
      seasonStats: seasonStats.rows,
      growthHistory: growthHistory.rows.reverse()
    });
  })
);

router.get(
  '/lineup',
  requireAuth,
  asyncHandler(async (req, res) => {
    const franchise = await getFranchiseByOwner(req.user.id, undefined, req.user.active_world_id || null);
    if (!franchise) {
      return res.status(404).json({ message: 'No active franchise found.' });
    }

    await ensureFranchiseLineup(franchise.id, pool, { mode: 'smart' });

    const lineup = await pool.query(
      `SELECT id, first_name, last_name, role, batting, bowling, fielding, form, morale, lineup_slot
       FROM players
       WHERE franchise_id = $1
         AND starting_xi = TRUE
       ORDER BY lineup_slot ASC NULLS LAST, id ASC`,
      [franchise.id]
    );

    return res.json({ lineup: lineup.rows });
  })
);

router.put(
  '/lineup',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { playerIds } = req.body;

    if (!Array.isArray(playerIds) || playerIds.length !== 11) {
      return res.status(400).json({ message: 'Starting XI must include exactly 11 players.' });
    }

    const uniqueIds = new Set(playerIds.map((id) => Number(id)));
    if (uniqueIds.size !== 11) {
      return res.status(400).json({ message: 'Starting XI cannot include duplicate players.' });
    }

    const franchise = await getFranchiseByOwner(req.user.id, undefined, req.user.active_world_id || null);
    if (!franchise) {
      return res.status(404).json({ message: 'No active franchise found.' });
    }

    const eligible = await pool.query(
      `SELECT id
       FROM players
       WHERE franchise_id = $1
         AND squad_status IN ('MAIN_SQUAD', 'YOUTH')`,
      [franchise.id]
    );

    const eligibleIds = new Set(eligible.rows.map((row) => Number(row.id)));
    const hasInvalid = playerIds.some((id) => !eligibleIds.has(Number(id)));

    if (hasInvalid) {
      return res.status(400).json({ message: 'One or more lineup players are not eligible.' });
    }

    const lineup = await setFranchiseLineup(franchise.id, playerIds.map((id) => Number(id)), pool, {
      normalizeOrder: true
    });

    return res.json({ lineup });
  })
);

router.post(
  '/demote/:playerId',
  requireAuth,
  asyncHandler(async (req, res) => {
    const franchise = await getFranchiseByOwner(req.user.id, undefined, req.user.active_world_id || null);
    if (!franchise) {
      return res.status(404).json({ message: 'No active franchise found.' });
    }

    const player = await demoteMainSquadPlayer(franchise.id, req.params.playerId, pool);
    return res.json({ player });
  })
);

router.post(
  '/promote/:playerId',
  requireAuth,
  asyncHandler(async (req, res) => {
    const franchise = await getFranchiseByOwner(req.user.id, undefined, req.user.active_world_id || null);
    if (!franchise) {
      return res.status(404).json({ message: 'No active franchise found.' });
    }

    const player = await promoteYouthPlayer(franchise.id, req.params.playerId, pool);
    return res.json({ player });
  })
);

router.post(
  '/loan/:playerId',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { targetFranchiseId } = req.body;

    if (!targetFranchiseId) {
      return res.status(400).json({ message: 'targetFranchiseId is required.' });
    }

    const franchise = await getFranchiseByOwner(req.user.id, undefined, req.user.active_world_id || null);
    if (!franchise) {
      return res.status(404).json({ message: 'No active franchise found.' });
    }

    if (normalizeCareerMode(franchise.competition_mode || CAREER_MODES.CLUB) !== CAREER_MODES.CLUB) {
      return res.status(403).json({ message: 'Loans are disabled in international mode.' });
    }

    const player = await loanPlayer(franchise.id, req.params.playerId, targetFranchiseId, pool);
    return res.json({ player });
  })
);

router.post(
  '/release/:playerId',
  requireAuth,
  asyncHandler(async (req, res) => {
    const franchise = await getFranchiseByOwner(req.user.id, undefined, req.user.active_world_id || null);
    if (!franchise) {
      return res.status(404).json({ message: 'No active franchise found.' });
    }

    if (normalizeCareerMode(franchise.competition_mode || CAREER_MODES.CLUB) !== CAREER_MODES.CLUB) {
      return res.status(403).json({ message: 'Releasing players is disabled in international mode.' });
    }

    const player = await releasePlayer(franchise.id, req.params.playerId, pool);
    return res.json({ player });
  })
);

export default router;
