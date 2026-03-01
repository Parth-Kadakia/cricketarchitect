import { Router } from 'express';
import pool from '../config/db.js';
import asyncHandler from '../utils/asyncHandler.js';

const router = Router();

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const availableOnly = req.query.available === 'true';
    const q = String(req.query.q || '').trim().toLowerCase();
    const limit = Math.max(20, Math.min(2000, Number(req.query.limit || 600)));
    const franchiseCount = Number((await pool.query('SELECT COUNT(*)::int AS count FROM franchises')).rows[0].count);

    let query;
    let params;

    if (franchiseCount === 0) {
      query = `SELECT c.*,
                      NULL::bigint AS franchise_id,
                      'UNASSIGNED'::text AS franchise_status,
                      NULL::bigint AS owner_user_id
               FROM cities c
               WHERE ($1 = '' OR LOWER(c.name) LIKE '%' || $1 || '%' OR LOWER(c.country) LIKE '%' || $1 || '%')
               ORDER BY c.country, c.name
               LIMIT $2`;
      params = [q, limit];
    } else if (availableOnly) {
      query = `SELECT c.*, f.id AS franchise_id, f.status AS franchise_status, f.owner_user_id
               FROM cities c
               JOIN franchises f ON f.city_id = c.id
               WHERE f.owner_user_id IS NULL
                 AND f.status = 'AVAILABLE'
                 AND ($1 = '' OR LOWER(c.name) LIKE '%' || $1 || '%' OR LOWER(c.country) LIKE '%' || $1 || '%')
               ORDER BY c.country, c.name
               LIMIT $2`;
      params = [q, limit];
    } else {
      query = `SELECT c.*, f.id AS franchise_id, f.status AS franchise_status, f.owner_user_id
               FROM cities c
               JOIN franchises f ON f.city_id = c.id
               WHERE ($1 = '' OR LOWER(c.name) LIKE '%' || $1 || '%' OR LOWER(c.country) LIKE '%' || $1 || '%')
               ORDER BY c.country, c.name
               LIMIT $2`;
      params = [q, limit];
    }

    const cities = await pool.query(query, params);

    return res.json({ cities: cities.rows });
  })
);

export default router;
