import { Router } from 'express';
import pool from '../config/db.js';
import { requireAuth } from '../middleware/auth.js';
import asyncHandler from '../utils/asyncHandler.js';
import { getFranchiseByOwner } from '../services/franchiseService.js';

const router = Router();

router.get(
  '/summary',
  requireAuth,
  asyncHandler(async (req, res) => {
    const franchise = await getFranchiseByOwner(req.user.id);

    if (!franchise) {
      return res.status(404).json({ message: 'No active franchise found.' });
    }

    const payroll = await pool.query(
      `SELECT COALESCE(SUM(salary), 0) AS payroll
       FROM players
       WHERE franchise_id = $1
         AND squad_status = 'MAIN_SQUAD'`,
      [franchise.id]
    );

    const playerValue = await pool.query(
      `SELECT COALESCE(SUM(market_value), 0) AS total_market
       FROM players
       WHERE franchise_id = $1
         AND squad_status IN ('MAIN_SQUAD', 'YOUTH', 'LOANED')`,
      [franchise.id]
    );

    return res.json({
      franchise,
      cashBalance: Number(franchise.financial_balance),
      payroll: Number(payroll.rows[0].payroll),
      playerMarketValue: Number(playerValue.rows[0].total_market),
      cashFlowHealth: Number((Number(franchise.financial_balance) - Number(payroll.rows[0].payroll)).toFixed(2))
    });
  })
);

router.get(
  '/transactions',
  requireAuth,
  asyncHandler(async (req, res) => {
    const franchise = await getFranchiseByOwner(req.user.id);

    if (!franchise) {
      return res.status(404).json({ message: 'No active franchise found.' });
    }

    const transactions = await pool.query(
      `SELECT *
       FROM transactions
       WHERE franchise_id = $1
       ORDER BY created_at DESC
       LIMIT 150`,
      [franchise.id]
    );

    return res.json({ transactions: transactions.rows });
  })
);

router.get(
  '/valuations',
  requireAuth,
  asyncHandler(async (req, res) => {
    const franchise = await getFranchiseByOwner(req.user.id);

    if (!franchise) {
      return res.status(404).json({ message: 'No active franchise found.' });
    }

    const valuations = await pool.query(
      `SELECT id, season_id, base_value, win_bonus, streak_bonus, cup_bonus, fan_bonus, player_bonus, total_value, calculated_at
       FROM valuations
       WHERE franchise_id = $1
       ORDER BY calculated_at DESC
       LIMIT 100`,
      [franchise.id]
    );

    return res.json({ valuations: valuations.rows.reverse() });
  })
);

export default router;
