import { Router } from 'express';
import pool, { withTransaction } from '../config/db.js';
import env from '../config/env.js';
import { requireAuth, optionalAuth } from '../middleware/auth.js';
import asyncHandler from '../utils/asyncHandler.js';
import { ensureProminentCricketCities } from '../db/seedWorldCities.js';
import { INTERNATIONAL_COUNTRIES } from '../constants/gameModes.js';
import { ensureInternationalCountryCities } from '../services/franchiseService.js';

const router = Router();

function normalizeText(value) {
  return String(value || '').trim().replace(/\s+/g, ' ');
}

function parseCoordinate(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function isValidCoordinate(lat, lon) {
  return Number.isFinite(lat) && Number.isFinite(lon) && lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180;
}

async function verifyCityViaGeocoding(name, country) {
  const baseUrl = String(env.cityVerificationBaseUrl || '').replace(/\/$/, '');
  const requestUrl = new URL(`${baseUrl}/search`);
  requestUrl.searchParams.set('city', name);
  requestUrl.searchParams.set('country', country);
  requestUrl.searchParams.set('format', 'json');
  requestUrl.searchParams.set('limit', '5');
  requestUrl.searchParams.set('addressdetails', '1');

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Number(env.cityVerificationTimeoutMs || 4000));

  try {
    const response = await fetch(requestUrl, {
      method: 'GET',
      signal: controller.signal,
      headers: {
        'User-Agent': env.cityVerificationUserAgent,
        Accept: 'application/json'
      }
    });

    if (!response.ok) {
      const error = new Error(`City verification failed (${response.status}).`);
      error.status = 502;
      throw error;
    }

    const payload = await response.json();
    const candidates = Array.isArray(payload) ? payload : [];

    for (const candidate of candidates) {
      const address = candidate?.address || {};
      const candidateCountry = normalizeText(address.country || country);
      const resolvedName = normalizeText(address.city || address.town || address.village || address.municipality || name);
      const latitude = parseCoordinate(candidate?.lat);
      const longitude = parseCoordinate(candidate?.lon);

      if (!resolvedName || !candidateCountry || !isValidCoordinate(latitude, longitude)) {
        continue;
      }

      return {
        name: resolvedName,
        country: candidateCountry,
        latitude,
        longitude,
        provider: 'nominatim'
      };
    }

    return null;
  } catch (error) {
    if (error.name === 'AbortError') {
      const timeoutError = new Error('City verification timed out. Please try again.');
      timeoutError.status = 504;
      throw timeoutError;
    }

    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

router.get(
  '/international-countries',
  asyncHandler(async (req, res) => {
    await ensureInternationalCountryCities(pool);

    const rows = await pool.query(
      `WITH country_cities AS (
         SELECT DISTINCT ON (country)
                id,
                name,
                country
         FROM cities
         WHERE country = ANY($1::text[])
         ORDER BY country,
                  CASE
                    WHEN LOWER(name) = LOWER(country) THEN 0
                    WHEN LOWER(name) = LOWER(country || ' National Cricket Ground') THEN 1
                    ELSE 2
                  END,
                  name ASC
       )
       SELECT cc.country,
              cc.id AS city_id,
              cc.name AS city_name,
              f.id AS franchise_id,
              f.status,
              f.owner_user_id
       FROM country_cities cc
       LEFT JOIN LATERAL (
         SELECT id, status, owner_user_id
         FROM franchises
         WHERE city_id = cc.id
         ORDER BY created_at DESC
         LIMIT 1
       ) f ON TRUE
       ORDER BY cc.country ASC`,
      [INTERNATIONAL_COUNTRIES]
    );

    const countries = rows.rows.map((row) => ({
      country: row.country,
      cityId: row.city_id,
      cityName: row.city_name,
      franchiseId: row.franchise_id ? Number(row.franchise_id) : null,
      available: !row.franchise_id || row.owner_user_id == null
    }));

    return res.json({ countries });
  })
);

router.get(
  '/',
  optionalAuth,
  asyncHandler(async (req, res) => {
    const availableOnly = req.query.available === 'true';
    const q = String(req.query.q || '').trim().toLowerCase();
    const limit = Math.max(20, Math.min(2000, Number(req.query.limit || 600)));
    const worldId = req.user?.active_world_id || null;
    const franchiseCount = Number(
      (await pool.query(
        'SELECT COUNT(*)::int AS count FROM franchises WHERE ($1::bigint IS NULL OR world_id = $1)',
        [worldId]
      )).rows[0].count
    );

    if (franchiseCount === 0) {
      await ensureProminentCricketCities(pool);
    }

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
                 AND f.status IN ('AVAILABLE', 'AI_CONTROLLED')
                 AND ($3::bigint IS NULL OR f.world_id = $3)
                 AND ($1 = '' OR LOWER(c.name) LIKE '%' || $1 || '%' OR LOWER(c.country) LIKE '%' || $1 || '%')
               ORDER BY c.country, c.name
               LIMIT $2`;
      params = [q, limit, worldId];
    } else {
      query = `SELECT c.*, f.id AS franchise_id, f.status AS franchise_status, f.owner_user_id
               FROM cities c
               JOIN franchises f ON f.city_id = c.id
               WHERE ($3::bigint IS NULL OR f.world_id = $3)
                 AND ($1 = '' OR LOWER(c.name) LIKE '%' || $1 || '%' OR LOWER(c.country) LIKE '%' || $1 || '%')
               ORDER BY c.country, c.name
               LIMIT $2`;
      params = [q, limit, worldId];
    }

    const cities = await pool.query(query, params);

    return res.json({ cities: cities.rows });
  })
);

router.post(
  '/',
  requireAuth,
  asyncHandler(async (req, res) => {
    const inputName = normalizeText(req.body?.name);
    const inputCountry = normalizeText(req.body?.country);
    const verifyRequested = req.body?.verify !== false;

    if (!inputName || !inputCountry) {
      return res.status(400).json({ message: 'name and country are required.' });
    }

    if (inputName.length > 120 || inputCountry.length > 120) {
      return res.status(400).json({ message: 'name and country must be 120 characters or less.' });
    }

    const worldId = req.user?.active_world_id || null;
    const franchiseCount = Number(
      (await pool.query(
        'SELECT COUNT(*)::int AS count FROM franchises WHERE ($1::bigint IS NULL OR world_id = $1)',
        [worldId]
      )).rows[0].count
    );
    if (franchiseCount > 0) {
      return res.status(409).json({
        message: 'Custom city add is available before career kickoff only. Start a new save to add cities, then select one.'
      });
    }

    let cityData = {
      name: inputName,
      country: inputCountry,
      latitude: parseCoordinate(req.body?.latitude),
      longitude: parseCoordinate(req.body?.longitude),
      provider: 'manual'
    };

    if (verifyRequested) {
      if (!env.cityVerificationEnabled) {
        return res.status(400).json({ message: 'City verification is currently disabled by the server.' });
      }

      const verified = await verifyCityViaGeocoding(inputName, inputCountry);
      if (!verified) {
        return res.status(400).json({ message: 'We could not verify this city. Please check spelling or add coordinates manually.' });
      }

      cityData = verified;
    } else if (!isValidCoordinate(cityData.latitude, cityData.longitude)) {
      return res.status(400).json({ message: 'Manual city add requires valid latitude and longitude.' });
    }

    const result = await withTransaction(async (client) => {
      const existing = await client.query(
        `SELECT id, name, country, latitude, longitude
         FROM cities
         WHERE LOWER(name) = LOWER($1)
           AND LOWER(country) = LOWER($2)
         LIMIT 1`,
        [cityData.name, cityData.country]
      );

      if (existing.rows.length) {
        return {
          city: existing.rows[0],
          created: false,
          verified: verifyRequested,
          provider: cityData.provider,
          franchiseCreated: false
        };
      }

      const inserted = await client.query(
        `INSERT INTO cities (name, country, latitude, longitude)
         VALUES ($1, $2, $3, $4)
         RETURNING id, name, country, latitude, longitude`,
        [cityData.name, cityData.country, cityData.latitude, cityData.longitude]
      );

      return {
        city: inserted.rows[0],
        created: true,
        verified: verifyRequested,
        provider: cityData.provider,
        franchiseCreated: false
      };
    });

    return res.status(result.created ? 201 : 200).json(result);
  })
);

export default router;
