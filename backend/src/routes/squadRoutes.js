import { Router } from 'express';
import pool from '../config/db.js';
import { requireAuth } from '../middleware/auth.js';
import asyncHandler from '../utils/asyncHandler.js';
import { getFranchiseByOwner } from '../services/franchiseService.js';
import { demoteMainSquadPlayer, loanPlayer, promoteYouthPlayer, releasePlayer } from '../services/youthService.js';
import { ensureFranchiseLineup, setFranchiseLineup } from '../services/lineupService.js';

const router = Router();
const SALARY_CAP = 120;

router.get(
  '/',
  requireAuth,
  asyncHandler(async (req, res) => {
    const franchise = await getFranchiseByOwner(req.user.id);
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
  '/player/:playerId',
  requireAuth,
  asyncHandler(async (req, res) => {
    const franchise = await getFranchiseByOwner(req.user.id);
    if (!franchise) {
      return res.status(404).json({ message: 'No active franchise found.' });
    }

    await ensureFranchiseLineup(franchise.id, pool, { mode: 'smart' });

    const playerResult = await pool.query(
      `SELECT *, ROUND((batting + bowling + fielding + fitness + temperament) / 5.0, 1) AS overall
       FROM players
       WHERE id = $1
         AND (franchise_id = $2 OR squad_status = 'RETIRED')`,
      [req.params.playerId, franchise.id]
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
       LIMIT 15`,
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
      growthHistory: growthHistory.rows.reverse()
    });
  })
);

router.get(
  '/lineup',
  requireAuth,
  asyncHandler(async (req, res) => {
    const franchise = await getFranchiseByOwner(req.user.id);
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

    const franchise = await getFranchiseByOwner(req.user.id);
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
    const franchise = await getFranchiseByOwner(req.user.id);
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
    const franchise = await getFranchiseByOwner(req.user.id);
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

    const franchise = await getFranchiseByOwner(req.user.id);
    if (!franchise) {
      return res.status(404).json({ message: 'No active franchise found.' });
    }

    const player = await loanPlayer(franchise.id, req.params.playerId, targetFranchiseId, pool);
    return res.json({ player });
  })
);

router.post(
  '/release/:playerId',
  requireAuth,
  asyncHandler(async (req, res) => {
    const franchise = await getFranchiseByOwner(req.user.id);
    if (!franchise) {
      return res.status(404).json({ message: 'No active franchise found.' });
    }

    const player = await releasePlayer(franchise.id, req.params.playerId, pool);
    return res.json({ player });
  })
);

export default router;
