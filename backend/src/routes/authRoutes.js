import { Router } from 'express';
import bcrypt from 'bcryptjs';
import pool from '../config/db.js';
import asyncHandler from '../utils/asyncHandler.js';
import { signToken } from '../utils/jwt.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

router.post(
  '/register',
  asyncHandler(async (req, res) => {
    const { email, password, displayName } = req.body;

    if (!email || !password || !displayName) {
      return res.status(400).json({ message: 'email, password and displayName are required.' });
    }

    const normalizedEmail = String(email).trim().toLowerCase();
    const existing = await pool.query('SELECT id FROM users WHERE email = $1', [normalizedEmail]);

    if (existing.rows.length) {
      return res.status(409).json({ message: 'Email is already registered.' });
    }

    const passwordHash = await bcrypt.hash(password, 10);

    const inserted = await pool.query(
      `INSERT INTO users (email, password_hash, display_name, role)
       VALUES ($1, $2, $3, 'user')
       RETURNING id, email, display_name, role, career_mode, last_active_at,
                 manager_status, manager_points, manager_unemployed_since, manager_retired_at,
                 manager_firings, manager_titles, manager_matches_managed, manager_wins_managed, manager_losses_managed`,
      [normalizedEmail, passwordHash, String(displayName).trim()]
    );

    const user = inserted.rows[0];
    const token = signToken(user);

    return res.status(201).json({ user, token });
  })
);

router.post(
  '/login',
  asyncHandler(async (req, res) => {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ message: 'email and password are required.' });
    }

    const normalizedEmail = String(email).trim().toLowerCase();

    const userResult = await pool.query(
      `SELECT id, email, password_hash, display_name, role, career_mode, last_active_at,
              manager_status, manager_points, manager_unemployed_since, manager_retired_at,
              manager_firings, manager_titles, manager_matches_managed, manager_wins_managed, manager_losses_managed
       FROM users
       WHERE email = $1`,
      [normalizedEmail]
    );

    if (!userResult.rows.length) {
      return res.status(401).json({ message: 'Invalid credentials.' });
    }

    const userRow = userResult.rows[0];
    const validPassword = await bcrypt.compare(password, userRow.password_hash);

    if (!validPassword) {
      return res.status(401).json({ message: 'Invalid credentials.' });
    }

    await pool.query('UPDATE users SET last_active_at = NOW() WHERE id = $1', [userRow.id]);

    const user = {
      id: userRow.id,
      email: userRow.email,
      display_name: userRow.display_name,
      role: userRow.role,
      career_mode: userRow.career_mode,
      last_active_at: new Date().toISOString(),
      manager_status: userRow.manager_status,
      manager_points: userRow.manager_points,
      manager_unemployed_since: userRow.manager_unemployed_since,
      manager_retired_at: userRow.manager_retired_at,
      manager_firings: userRow.manager_firings,
      manager_titles: userRow.manager_titles,
      manager_matches_managed: userRow.manager_matches_managed,
      manager_wins_managed: userRow.manager_wins_managed,
      manager_losses_managed: userRow.manager_losses_managed
    };

    const token = signToken(user);

    return res.json({ user, token });
  })
);

router.get(
  '/me',
  requireAuth,
  asyncHandler(async (req, res) => {
    const franchiseResult = await pool.query(
      `SELECT f.id, f.franchise_name, f.status, f.total_valuation, f.competition_mode, f.prospect_points, f.growth_points, f.academy_name,
              f.wins, f.losses, f.win_streak, f.best_win_streak, f.current_league_tier, f.promotions, f.relegations,
              ROUND(COALESCE((
                SELECT AVG((p.batting + p.bowling + p.fielding + p.fitness + p.temperament) / 5.0)
                FROM players p
                WHERE p.franchise_id = f.id
                  AND p.squad_status = 'MAIN_SQUAD'
              ), 0), 1) AS strength_rating,
              c.name AS city_name, c.country,
              st.league_position,
              st.movement AS season_movement
       FROM franchises f
       JOIN cities c ON c.id = f.city_id
       LEFT JOIN seasons s ON s.status = 'ACTIVE'
       LEFT JOIN season_teams st ON st.season_id = s.id AND st.franchise_id = f.id
       WHERE f.owner_user_id = $1
       ORDER BY s.season_number DESC NULLS LAST
       LIMIT 1`,
      [req.user.id]
    );

    return res.json({
      user: req.user,
      franchise: franchiseResult.rows[0] || null
    });
  })
);

router.patch(
  '/profile',
  requireAuth,
  asyncHandler(async (req, res) => {
    const nextDisplayName = String(req.body?.displayName || '').trim();
    if (!nextDisplayName) {
      return res.status(400).json({ message: 'displayName is required.' });
    }

    if (nextDisplayName.length > 60) {
      return res.status(400).json({ message: 'displayName must be 60 characters or fewer.' });
    }

    const updated = await pool.query(
      `UPDATE users
       SET display_name = $2,
           updated_at = NOW()
       WHERE id = $1
       RETURNING id, email, display_name, role, career_mode, last_active_at,
                 manager_status, manager_points, manager_unemployed_since, manager_retired_at,
                 manager_firings, manager_titles, manager_matches_managed, manager_wins_managed, manager_losses_managed`,
      [req.user.id, nextDisplayName]
    );

    return res.json({ user: updated.rows[0] });
  })
);

export default router;
