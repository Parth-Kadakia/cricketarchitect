import { Router } from 'express';
import pool from '../config/db.js';
import { requireAuth } from '../middleware/auth.js';
import asyncHandler from '../utils/asyncHandler.js';
import {
  claimFranchise,
  getFranchiseByOwner,
  listFranchiseForSale,
  purchaseFranchise,
  sellFranchiseToMarketplace
} from '../services/franchiseService.js';
import { calculateFranchiseValuation } from '../services/valuationService.js';
import { upgradeAcademyWithPoints } from '../services/youthService.js';
import { CAREER_MODES, normalizeCareerMode } from '../constants/gameModes.js';

const router = Router();

router.get(
  '/me',
  requireAuth,
  asyncHandler(async (req, res) => {
    const franchise = await getFranchiseByOwner(req.user.id, undefined, req.user.active_world_id || null);

    if (!franchise) {
      return res.json({ franchise: null });
    }

    const squadSummary = await pool.query(
      `SELECT
         COUNT(*) FILTER (WHERE squad_status = 'MAIN_SQUAD')::int AS main_squad_count,
         COUNT(*) FILTER (WHERE squad_status = 'YOUTH')::int AS youth_count,
         COUNT(*) FILTER (WHERE squad_status = 'LOANED')::int AS loaned_count,
         COUNT(*) FILTER (WHERE squad_status = 'AUCTION')::int AS auction_count,
         COUNT(*) FILTER (WHERE squad_status = 'RETIRED')::int AS retired_count,
         ROUND(COALESCE(AVG((batting + bowling + fielding + fitness + temperament) / 5.0), 0), 2) AS avg_team_rating
       FROM players
       WHERE franchise_id = $1`,
      [franchise.id]
    );

    const recentResults = await pool.query(
      `SELECT id, stage, round_no, home_franchise_id, away_franchise_id, winner_franchise_id, result_summary, created_at
       FROM matches
       WHERE (home_franchise_id = $1 OR away_franchise_id = $1)
         AND status = 'COMPLETED'
       ORDER BY id DESC
       LIMIT 10`,
      [franchise.id]
    );

    const valuations = await pool.query(
      `SELECT total_value, calculated_at
       FROM valuations
       WHERE franchise_id = $1
       ORDER BY calculated_at DESC
       LIMIT 30`,
      [franchise.id]
    );

    return res.json({
      franchise,
      squadSummary: squadSummary.rows[0],
      recentResults: recentResults.rows,
      valuationHistory: valuations.rows.reverse()
    });
  })
);

router.post(
  '/claim',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { cityId, franchiseName, mode, country } = req.body;
    const careerMode = normalizeCareerMode(mode || CAREER_MODES.CLUB);

    if (careerMode === CAREER_MODES.INTERNATIONAL) {
      if (!country) {
        return res.status(400).json({ message: 'country is required for international mode.' });
      }
    } else if (!cityId) {
      return res.status(400).json({ message: 'cityId is required for club mode.' });
    }

    const franchise = await claimFranchise({ userId: req.user.id, cityId, franchiseName, mode: careerMode, country });

    return res.status(201).json({ franchise });
  })
);

router.post(
  '/:franchiseId/list-for-sale',
  requireAuth,
  asyncHandler(async (req, res) => {
    const franchise = await listFranchiseForSale({
      userId: req.user.id,
      franchiseId: req.params.franchiseId
    });

    return res.json({ franchise });
  })
);

router.post(
  '/:franchiseId/sell-now',
  requireAuth,
  asyncHandler(async (req, res) => {
    const franchise = await sellFranchiseToMarketplace({
      userId: req.user.id,
      franchiseId: req.params.franchiseId
    });

    return res.json({ franchise });
  })
);

router.post(
  '/:franchiseId/purchase',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { franchiseName } = req.body;

    const franchise = await purchaseFranchise({
      buyerUserId: req.user.id,
      franchiseId: req.params.franchiseId,
      newFranchiseName: franchiseName
    });

    return res.json({ franchise });
  })
);

router.post(
  '/:franchiseId/academy-upgrade',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { mode } = req.body;

    if (!['ACADEMY_LEVEL', 'YOUTH_RATING'].includes(mode)) {
      return res.status(400).json({ message: "mode must be 'ACADEMY_LEVEL' or 'YOUTH_RATING'." });
    }

    const ownerFranchise = await getFranchiseByOwner(req.user.id, undefined, req.user.active_world_id || null);

    if (!ownerFranchise || Number(ownerFranchise.id) !== Number(req.params.franchiseId)) {
      return res.status(403).json({ message: 'You can only upgrade your own academy.' });
    }

    const updated = await upgradeAcademyWithPoints(ownerFranchise.id, mode, pool);
    await calculateFranchiseValuation(ownerFranchise.id, null, pool);

    await pool.query(
      `INSERT INTO transactions (franchise_id, transaction_type, amount, description)
       VALUES ($1, 'ACADEMY_UPGRADE', 0, $2)`,
      [ownerFranchise.id, `Academy upgraded via points: ${mode}`]
    );

    return res.json({ franchise: updated });
  })
);

router.get(
  '/:franchiseId/trophies',
  asyncHandler(async (req, res) => {
    const trophies = await pool.query(
      `SELECT tc.id, tc.title, tc.won_at, s.name AS season_name
       FROM trophy_cabinet tc
       LEFT JOIN seasons s ON s.id = tc.season_id
       WHERE tc.franchise_id = $1
       ORDER BY tc.won_at DESC`,
      [req.params.franchiseId]
    );

    return res.json({ trophies: trophies.rows });
  })
);

export default router;
