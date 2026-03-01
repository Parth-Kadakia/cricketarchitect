import { Router } from 'express';
import pool from '../config/db.js';
import asyncHandler from '../utils/asyncHandler.js';
import { requireAuth } from '../middleware/auth.js';
import { getMarketplaceData, getFranchiseByOwner } from '../services/franchiseService.js';
import { getTransferFeed } from '../services/cpuManagerService.js';

const router = Router();

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const data = await getMarketplaceData();
    return res.json(data);
  })
);

router.get(
  '/cities',
  asyncHandler(async (req, res) => {
    const q = String(req.query.q || '').trim().toLowerCase();
    const limit = Math.max(20, Math.min(2000, Number(req.query.limit || 600)));
    const franchiseCount = Number((await pool.query('SELECT COUNT(*)::int AS count FROM franchises')).rows[0].count);

    const cities = franchiseCount === 0
      ? await pool.query(
        `SELECT c.*
         FROM cities c
         WHERE ($1 = '' OR LOWER(c.name) LIKE '%' || $1 || '%' OR LOWER(c.country) LIKE '%' || $1 || '%')
         ORDER BY c.country, c.name
         LIMIT $2`,
        [q, limit]
      )
      : await pool.query(
        `SELECT c.*
         FROM cities c
         JOIN franchises f ON f.city_id = c.id
         WHERE f.owner_user_id IS NULL
           AND f.status = 'AVAILABLE'
           AND ($1 = '' OR LOWER(c.name) LIKE '%' || $1 || '%' OR LOWER(c.country) LIKE '%' || $1 || '%')
         ORDER BY c.country, c.name
         LIMIT $2`,
        [q, limit]
      );

    return res.json({ cities: cities.rows });
  })
);

router.get(
  '/franchises',
  asyncHandler(async (req, res) => {
    const franchises = await pool.query(
      `SELECT
         f.id,
         f.franchise_name,
         f.status,
         f.total_valuation,
         f.wins,
         f.losses,
         f.championships,
         f.win_streak,
         f.prospect_points,
         f.growth_points,
         f.academy_level,
         f.youth_development_rating,
         f.current_league_tier,
         f.promotions,
         f.relegations,
         c.name AS city_name,
         c.country,
         COALESCE(
           NULLIF(to_jsonb(u)->>'display_name', ''),
           NULLIF(to_jsonb(u)->>'username', ''),
           split_part(COALESCE(to_jsonb(u)->>'email', ''), '@', 1)
         ) AS owner_username,
         CASE
           WHEN f.owner_user_id IS NOT NULL THEN 'USER'
           WHEN f.status = 'AI_CONTROLLED' THEN 'CPU'
           WHEN f.status = 'FOR_SALE' THEN 'FOR_SALE'
           ELSE 'AVAILABLE'
         END AS control_type
       FROM franchises f
       JOIN cities c ON c.id = f.city_id
       LEFT JOIN users u ON u.id = f.owner_user_id
       ORDER BY f.total_valuation DESC, c.name ASC`
    );

    return res.json({ franchises: franchises.rows });
  })
);

router.get(
  '/auction-pool',
  asyncHandler(async (req, res) => {
    const players = await pool.query(
      `SELECT id, first_name, last_name, country_origin, role, age, batting, bowling, fielding, fitness, temperament, potential, market_value
       FROM players
       WHERE squad_status = 'AUCTION'
       ORDER BY potential DESC, market_value DESC
       LIMIT 250`
    );

    return res.json({ players: players.rows });
  })
);

router.post(
  '/auction-pool/:playerId/buy',
  requireAuth,
  asyncHandler(async (req, res) => {
    const franchise = await getFranchiseByOwner(req.user.id);
    if (!franchise) {
      return res.status(404).json({ message: 'No active franchise found.' });
    }

    const player = await pool.query(
      `SELECT id, first_name, last_name, market_value
       FROM players
       WHERE id = $1
         AND squad_status = 'AUCTION'`,
      [req.params.playerId]
    );

    if (!player.rows.length) {
      return res.status(404).json({ message: 'Player is no longer in the auction pool.' });
    }

    const squadCount = await pool.query(
      `SELECT COUNT(*)::int AS count
       FROM players
       WHERE franchise_id = $1
         AND squad_status = 'MAIN_SQUAD'`,
      [franchise.id]
    );

    const targetStatus = Number(squadCount.rows[0].count) < 15 ? 'MAIN_SQUAD' : 'YOUTH';

    const updated = await pool.query(
      `UPDATE players
       SET franchise_id = $2,
           squad_status = $3,
           is_youth = CASE WHEN $3 = 'YOUTH' THEN TRUE ELSE FALSE END,
           morale = LEAST(100, morale + 5),
           form = LEAST(100, form + 4)
       WHERE id = $1
       RETURNING *`,
      [req.params.playerId, franchise.id, targetStatus]
    );

    await pool.query(
      `INSERT INTO transfer_feed (action_type, source_franchise_id, player_id, message)
       VALUES ('TRANSFER', $1, $2, $3)`,
      [franchise.id, req.params.playerId, `${player.rows[0].first_name} ${player.rows[0].last_name} joined your squad from auction.`]
    );

    return res.json({ player: updated.rows[0] });
  })
);

router.get(
  '/transfer-feed',
  asyncHandler(async (req, res) => {
    const limit = Math.max(20, Math.min(250, Number(req.query.limit || 100)));
    const feed = await getTransferFeed(limit);
    return res.json({ feed });
  })
);

export default router;
