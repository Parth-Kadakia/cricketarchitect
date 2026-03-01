import { Router } from 'express';
import pool from '../config/db.js';
import { requireAuth } from '../middleware/auth.js';
import asyncHandler from '../utils/asyncHandler.js';
import { getFranchiseByOwner } from '../services/franchiseService.js';
import { applyPlayerGrowth, generateProspectsForFranchise, upgradeAcademyWithPoints } from '../services/youthService.js';
import { getActiveSeason } from '../services/leagueService.js';
import { calculateFranchiseValuation } from '../services/valuationService.js';

const router = Router();

router.get(
  '/academy',
  requireAuth,
  asyncHandler(async (req, res) => {
    const franchise = await getFranchiseByOwner(req.user.id);

    if (!franchise) {
      return res.status(404).json({ message: 'No active franchise found.' });
    }

    const regions = await pool.query(
      `SELECT r.*, COUNT(p.id)::int AS youth_count
       FROM regions r
       LEFT JOIN players p ON p.region_id = r.id AND p.squad_status = 'YOUTH'
       WHERE r.franchise_id = $1
       GROUP BY r.id
       ORDER BY r.id`,
      [franchise.id]
    );

    return res.json({ franchise, regions: regions.rows });
  })
);

router.get(
  '/regions',
  requireAuth,
  asyncHandler(async (req, res) => {
    const franchise = await getFranchiseByOwner(req.user.id);
    if (!franchise) {
      return res.status(404).json({ message: 'No active franchise found.' });
    }

    const regions = await pool.query(
      `SELECT r.*, COUNT(p.id)::int AS youth_count, COALESCE(AVG(p.potential), 0) AS avg_potential
       FROM regions r
       LEFT JOIN players p ON p.region_id = r.id AND p.squad_status = 'YOUTH'
       WHERE r.franchise_id = $1
       GROUP BY r.id
       ORDER BY r.id`,
      [franchise.id]
    );

    return res.json({ regions: regions.rows });
  })
);

router.get(
  '/prospects',
  requireAuth,
  asyncHandler(async (req, res) => {
    const franchise = await getFranchiseByOwner(req.user.id);
    if (!franchise) {
      return res.status(404).json({ message: 'No active franchise found.' });
    }

    const prospects = await pool.query(
      `SELECT p.*, r.name AS region_name
       FROM players p
       LEFT JOIN regions r ON r.id = p.region_id
       WHERE p.franchise_id = $1
         AND p.squad_status = 'YOUTH'
       ORDER BY p.potential DESC, p.age ASC`,
      [franchise.id]
    );

    return res.json({ prospects: prospects.rows });
  })
);

router.post(
  '/generate',
  requireAuth,
  asyncHandler(async (req, res) => {
    const franchise = await getFranchiseByOwner(req.user.id);
    if (!franchise) {
      return res.status(404).json({ message: 'No active franchise found.' });
    }

    const season = await getActiveSeason(pool);

    if (!season) {
      return res.status(400).json({ message: 'No active season found.' });
    }

    const generated = await generateProspectsForFranchise(franchise.id, season.id, pool);
    await calculateFranchiseValuation(franchise.id, season.id, pool);

    return res.json({ generated: generated.length, players: generated });
  })
);

router.post(
  '/grow',
  requireAuth,
  asyncHandler(async (req, res) => {
    const franchise = await getFranchiseByOwner(req.user.id);
    if (!franchise) {
      return res.status(404).json({ message: 'No active franchise found.' });
    }

    const season = await getActiveSeason(pool);

    const updated = await applyPlayerGrowth(franchise.id, season?.id || null, pool);
    await calculateFranchiseValuation(franchise.id, season?.id || null, pool);

    return res.json({ updatedCount: updated.length, players: updated });
  })
);

router.post(
  '/upgrade',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { mode } = req.body;

    const franchise = await getFranchiseByOwner(req.user.id);
    if (!franchise) {
      return res.status(404).json({ message: 'No active franchise found.' });
    }

    const updated = await upgradeAcademyWithPoints(franchise.id, mode, pool);
    await calculateFranchiseValuation(franchise.id, null, pool);

    return res.json({ franchise: updated });
  })
);

router.get(
  '/growth-history/:playerId',
  requireAuth,
  asyncHandler(async (req, res) => {
    const history = await pool.query(
      `SELECT pgl.*, s.name AS season_name
       FROM player_growth_logs pgl
       LEFT JOIN seasons s ON s.id = pgl.season_id
       WHERE pgl.player_id = $1
       ORDER BY pgl.recorded_at DESC
       LIMIT 40`,
      [req.params.playerId]
    );

    return res.json({ history: history.rows });
  })
);

export default router;
