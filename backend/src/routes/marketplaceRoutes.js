import { Router } from 'express';
import pool, { withTransaction } from '../config/db.js';
import asyncHandler from '../utils/asyncHandler.js';
import { requireAuth, optionalAuth } from '../middleware/auth.js';
import { getMarketplaceData, getFranchiseByOwner } from '../services/franchiseService.js';
import { getTransferFeed } from '../services/cpuManagerService.js';
import { calculateFranchiseValuation } from '../services/valuationService.js';
import { CAREER_MODES, normalizeCareerMode } from '../constants/gameModes.js';

const router = Router();

router.get(
  '/',
  optionalAuth,
  asyncHandler(async (req, res) => {
    const worldId = req.user?.active_world_id || null;
    if (!worldId) return res.json({ availableCities: [], franchisesForSale: [], allFranchises: [], recentSales: [] });
    const data = await getMarketplaceData(worldId);
    return res.json(data);
  })
);

router.get(
  '/cities',
  optionalAuth,
  asyncHandler(async (req, res) => {
    const q = String(req.query.q || '').trim().toLowerCase();
    const limit = Math.max(20, Math.min(2000, Number(req.query.limit || 600)));
    const worldId = req.user?.active_world_id || null;
    /* New user (no world) → franchise count is 0 so they see all cities */
    const franchiseCount = worldId
      ? Number((await pool.query('SELECT COUNT(*)::int AS count FROM franchises WHERE world_id = $1', [worldId])).rows[0].count)
      : 0;

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
           AND f.status IN ('AVAILABLE', 'AI_CONTROLLED')
           AND f.world_id = $3
           AND ($1 = '' OR LOWER(c.name) LIKE '%' || $1 || '%' OR LOWER(c.country) LIKE '%' || $1 || '%')
         ORDER BY c.country, c.name
         LIMIT $2`,
        [q, limit, worldId]
      );

    return res.json({ cities: cities.rows });
  })
);

router.get(
  '/franchises',
  optionalAuth,
  asyncHandler(async (req, res) => {
    const worldId = req.user?.active_world_id || null;
    if (!worldId) return res.json({ franchises: [] });
    const franchises = await pool.query(
        `SELECT
         f.id,
         f.franchise_name,
         f.status,
         f.competition_mode,
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
       WHERE ($1::bigint IS NULL OR f.world_id = $1)
       ORDER BY f.total_valuation DESC, c.name ASC`,
      [worldId]
    );

    return res.json({ franchises: franchises.rows });
  })
);

router.get(
  '/auction-pool',
  optionalAuth,
  asyncHandler(async (req, res) => {
    const worldId = req.user?.active_world_id || null;
    if (!worldId) return res.json({ players: [] });
    const activeSeason = await pool.query(
      `SELECT competition_mode
       FROM seasons
       WHERE status = 'ACTIVE'
         AND ($1::bigint IS NULL OR world_id = $1)
       ORDER BY id DESC
       LIMIT 1`,
      [worldId]
    );
    const mode = normalizeCareerMode(activeSeason.rows[0]?.competition_mode || CAREER_MODES.CLUB);
    if (mode !== CAREER_MODES.CLUB) {
      return res.json({ players: [] });
    }

    const players = worldId
      ? await pool.query(
          `SELECT p.id, p.first_name, p.last_name, p.country_origin, p.role, p.age, p.batting, p.bowling, p.fielding, p.fitness, p.temperament, p.potential, p.market_value
           FROM players p
           WHERE p.squad_status = 'AUCTION'
             AND EXISTS (
               SELECT 1 FROM transfer_feed tf
               JOIN seasons s ON s.id = tf.season_id
               WHERE tf.player_id = p.id AND s.world_id = $1
             )
           ORDER BY p.potential DESC, p.market_value DESC
           LIMIT 250`,
          [worldId]
        )
      : await pool.query(
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
    const result = await withTransaction(async (client) => {
      const franchise = await getFranchiseByOwner(req.user.id, client);
      if (!franchise) {
        const error = new Error('No active franchise found.');
        error.status = 404;
        throw error;
      }

      if (normalizeCareerMode(franchise.competition_mode || CAREER_MODES.CLUB) !== CAREER_MODES.CLUB) {
        const error = new Error('Transfers are disabled in international mode.');
        error.status = 403;
        throw error;
      }

      const player = await client.query(
        `SELECT id, first_name, last_name, market_value
         FROM players
         WHERE id = $1
           AND squad_status = 'AUCTION'
         FOR UPDATE`,
        [req.params.playerId]
      );

      if (!player.rows.length) {
        const error = new Error('Player is no longer in the auction pool.');
        error.status = 404;
        throw error;
      }

      const price = Number(player.rows[0].market_value || 0);
      const currentBalance = Number(franchise.financial_balance || 0);
      if (currentBalance < price) {
        const error = new Error(
          `Insufficient balance. Need $${price.toFixed(2)}, available cash $${currentBalance.toFixed(2)}. Franchise value $${Number(franchise.total_valuation || 0).toFixed(2)} is not spendable cash.`
        );
        error.status = 400;
        throw error;
      }

      const squadCount = await client.query(
        `SELECT COUNT(*)::int AS count
         FROM players
         WHERE franchise_id = $1
           AND squad_status = 'MAIN_SQUAD'`,
        [franchise.id]
      );

      const targetStatus = Number(squadCount.rows[0].count) < 15 ? 'MAIN_SQUAD' : 'YOUTH';

      const updated = await client.query(
        `UPDATE players
         SET franchise_id = $2,
             squad_status = $3,
             is_youth = CASE WHEN $3 = 'YOUTH' THEN TRUE ELSE FALSE END,
             starting_xi = FALSE,
             lineup_slot = NULL,
             morale = LEAST(100, morale + 5),
             form = LEAST(100, form + 4)
         WHERE id = $1
         RETURNING *`,
        [req.params.playerId, franchise.id, targetStatus]
      );

      await client.query(
        `UPDATE franchises
         SET financial_balance = financial_balance - $2
         WHERE id = $1`,
        [franchise.id, price]
      );

      await client.query(
        `INSERT INTO transactions (franchise_id, transaction_type, amount, description, related_player_id)
         VALUES ($1, 'PURCHASE', $2, $3, $4)`,
        [franchise.id, -price, `Auction purchase: ${player.rows[0].first_name} ${player.rows[0].last_name}`, req.params.playerId]
      );

      await client.query(
        `INSERT INTO transfer_feed (action_type, source_franchise_id, player_id, message)
         VALUES ('TRANSFER', $1, $2, $3)`,
        [franchise.id, req.params.playerId, `${player.rows[0].first_name} ${player.rows[0].last_name} joined your squad from auction.`]
      );

      await calculateFranchiseValuation(franchise.id, null, client);

      return { player: updated.rows[0], price };
    });

    return res.json(result);
  })
);

router.get(
  '/transfer-feed',
  optionalAuth,
  asyncHandler(async (req, res) => {
    const worldId = req.user?.active_world_id || null;
    if (!worldId) return res.json({ feed: [] });
    const activeSeason = await pool.query(
      `SELECT competition_mode
       FROM seasons
       WHERE status = 'ACTIVE'
         AND ($1::bigint IS NULL OR world_id = $1)
       ORDER BY id DESC
       LIMIT 1`,
      [worldId]
    );
    const mode = normalizeCareerMode(activeSeason.rows[0]?.competition_mode || CAREER_MODES.CLUB);
    if (mode !== CAREER_MODES.CLUB) {
      return res.json({ feed: [] });
    }

    const limit = Math.max(20, Math.min(250, Number(req.query.limit || 100)));
    const feed = await getTransferFeed(limit, undefined, worldId);
    return res.json({ feed });
  })
);

export default router;
