import pool, { withTransaction } from '../config/db.js';
import { randomInt } from '../utils/gameMath.js';
import { buildAcademyName, buildNameKey, getDefaultRegionLabels, pickUniquePlayerName } from './nameService.js';
import { ensureActiveSeason, generateDoubleRoundRobinFixtures } from './leagueService.js';
import { calculateFranchiseValuation } from './valuationService.js';

const ROLE_TEMPLATE = [
  'BATTER',
  'BATTER',
  'BATTER',
  'BATTER',
  'BOWLER',
  'BOWLER',
  'BOWLER',
  'ALL_ROUNDER',
  'ALL_ROUNDER',
  'WICKET_KEEPER',
  'ALL_ROUNDER',
  'BOWLER',
  'BATTER',
  'ALL_ROUNDER',
  'BOWLER',
  'BATTER',
  'ALL_ROUNDER',
  'BATTER'
];

const LEAGUE_TEAM_TARGET = 52;

function getBaseSkill(role) {
  if (role === 'BATTER') {
    return { batting: [20, 38], bowling: [10, 26] };
  }

  if (role === 'BOWLER') {
    return { batting: [10, 26], bowling: [20, 38] };
  }

  if (role === 'WICKET_KEEPER') {
    return { batting: [18, 34], bowling: [8, 20] };
  }

  return { batting: [16, 32], bowling: [16, 32] };
}

function randomBetween(range) {
  return randomInt(range[0], range[1]);
}

export async function createDefaultRegions(franchiseId, cityName, country, dbClient = pool) {
  const existingResult = await dbClient.query('SELECT COUNT(*)::int AS count FROM regions WHERE franchise_id = $1', [franchiseId]);
  if (Number(existingResult.rows[0].count) > 0) {
    return;
  }

  const regionNames = getDefaultRegionLabels(cityName);

  for (const regionName of regionNames) {
    await dbClient.query(
      `INSERT INTO regions (franchise_id, name, region_country, quality_rating, coaching_investment)
       VALUES ($1, $2, $3, 20, 0)
       ON CONFLICT (franchise_id, name) DO NOTHING`,
      [franchiseId, regionName, country]
    );
  }
}

export async function ensureStarterSquad(franchiseId, country, dbClient = pool) {
  const minimumSquadSize = 15;
  const existingPlayersResult = await dbClient.query('SELECT COUNT(*)::int AS count FROM players WHERE franchise_id = $1', [franchiseId]);
  const existingCount = Number(existingPlayersResult.rows[0].count || 0);
  if (existingCount >= minimumSquadSize) {
    return;
  }

  const regionsResult = await dbClient.query('SELECT id FROM regions WHERE franchise_id = $1 ORDER BY id', [franchiseId]);
  const regionIds = regionsResult.rows.map((row) => row.id);
  const existingNames = await dbClient.query(
    `SELECT first_name, last_name
     FROM players
     WHERE franchise_id = $1`,
    [franchiseId]
  );
  const usedNameKeys = new Set(existingNames.rows.map((row) => buildNameKey(row.first_name, row.last_name)));
  const usedFirstNames = new Set(existingNames.rows.map((row) => String(row.first_name || '').trim().toLowerCase()).filter(Boolean));

  const deficit = Math.max(0, minimumSquadSize - existingCount);
  const seedFreshLineup = existingCount === 0;

  for (let offset = 0; offset < deficit; offset += 1) {
    const templateIndex = (existingCount + offset) % ROLE_TEMPLATE.length;
    const role = ROLE_TEMPLATE[templateIndex];
    const base = getBaseSkill(role);
    const name = pickUniquePlayerName(country, usedNameKeys, { usedFirstNames });

    const batting = randomBetween(base.batting);
    const bowling = randomBetween(base.bowling);
    const fielding = randomInt(20, 42);
    const fitness = randomInt(22, 45);
    const temperament = randomInt(20, 40);
    const potential = randomInt(30, 58);
    const age = randomInt(16, 24);

    const marketValue = Number((5 + (batting + bowling + fielding + potential) * 0.08).toFixed(2));
    const salary = Number((0.5 + marketValue * 0.06).toFixed(2));

    await dbClient.query(
      `INSERT INTO players (
        franchise_id,
        region_id,
        first_name,
        last_name,
        country_origin,
        role,
        batting,
        bowling,
        fielding,
        fitness,
        temperament,
        potential,
        age,
        market_value,
        salary,
        morale,
        form,
        is_youth,
        starting_xi,
        lineup_slot,
        squad_status
      ) VALUES (
        $1, $2, $3, $4, $5, $6,
        $7, $8, $9, $10, $11, $12,
        $13, $14, $15, 30, 30, $16, $17, $18, $19
      )`,
      [
        franchiseId,
        regionIds[(existingCount + offset) % Math.max(1, regionIds.length)] || null,
        name.firstName,
        name.lastName,
        country,
        role,
        batting,
        bowling,
        fielding,
        fitness,
        temperament,
        potential,
        age,
        marketValue,
        salary,
        seedFreshLineup ? offset >= 11 : true,
        seedFreshLineup ? offset < 11 : false,
        seedFreshLineup && offset < 11 ? offset + 1 : null,
        seedFreshLineup && offset < 11 ? 'MAIN_SQUAD' : 'YOUTH'
      ]
    );
  }
}

export async function ensureFranchiseInfrastructure(franchiseId, dbClient = pool) {
  const franchiseResult = await dbClient.query(
    `SELECT f.id, c.name AS city_name, c.country
     FROM franchises f
     JOIN cities c ON c.id = f.city_id
     WHERE f.id = $1`,
    [franchiseId]
  );

  if (!franchiseResult.rows.length) {
    return;
  }

  const franchise = franchiseResult.rows[0];
  await createDefaultRegions(franchise.id, franchise.city_name, franchise.country, dbClient);
  await ensureStarterSquad(franchise.id, franchise.country, dbClient);
}

export async function initializeAllFranchises(dbClient = pool) {
  const franchises = await dbClient.query('SELECT id FROM franchises ORDER BY id ASC');

  for (const franchise of franchises.rows) {
    await ensureFranchiseInfrastructure(franchise.id, dbClient);
    await calculateFranchiseValuation(franchise.id, null, dbClient);
  }
}

async function getOwnedFranchise(userId, dbClient = pool) {
  const result = await dbClient.query(
    `SELECT f.*, c.name AS city_name, c.country, c.latitude, c.longitude,
            st.league_tier,
            st.league_position,
            st.movement AS season_movement
     FROM franchises f
     JOIN cities c ON c.id = f.city_id
     LEFT JOIN seasons s ON s.status = 'ACTIVE'
     LEFT JOIN season_teams st ON st.season_id = s.id AND st.franchise_id = f.id
     WHERE f.owner_user_id = $1
     ORDER BY s.season_number DESC NULLS LAST
     LIMIT 1`,
    [userId]
  );

  return result.rows[0] || null;
}

export async function getFranchiseByOwner(userId, dbClient = pool) {
  return getOwnedFranchise(userId, dbClient);
}

async function markCpuAndHumanOwnership(selectedFranchiseId, dbClient) {
  await dbClient.query(
    `UPDATE franchises
     SET status = CASE
       WHEN id = $1 THEN 'ACTIVE'
       WHEN owner_user_id IS NULL THEN 'AI_CONTROLLED'
       ELSE status
     END`,
    [selectedFranchiseId]
  );

  const season = await dbClient.query(
    `SELECT id
     FROM seasons
     WHERE status = 'ACTIVE'
     ORDER BY id DESC
     LIMIT 1`
  );

  if (season.rows.length) {
    await dbClient.query(
      `UPDATE season_teams
       SET is_ai = CASE WHEN franchise_id = $2 THEN FALSE ELSE TRUE END
       WHERE season_id = $1`,
      [season.rows[0].id, selectedFranchiseId]
    );
  }
}

async function createFranchiseRecord(
  { cityId, cityName, ownerUserId = null, status = 'AI_CONTROLLED', franchiseName = null, academyName = null },
  dbClient
) {
  const inserted = await dbClient.query(
    `INSERT INTO franchises (
      city_id,
      owner_user_id,
      franchise_name,
      status,
      academy_name,
      base_value,
      wins,
      losses,
      championships,
      win_streak,
      best_win_streak,
      fan_rating,
      financial_balance,
      academy_level,
      youth_development_rating,
      prospect_points,
      growth_points,
      total_valuation
    ) VALUES (
      $1, $2, $3, $4, $5,
      100, 0, 0, 0, 0, 0,
      20, 100, 1, 20, 0, 0, 100
    )
    RETURNING *`,
    [cityId, ownerUserId, franchiseName || `${cityName} Cricket Club`, status, academyName || buildAcademyName(cityName)]
  );

  return inserted.rows[0];
}

async function initializeCareerLeagueWithCity({ userId, city, franchiseName }, dbClient) {
  const managerFranchise = await createFranchiseRecord(
    {
      cityId: city.id,
      cityName: city.name,
      ownerUserId: userId,
      status: 'ACTIVE',
      franchiseName: franchiseName?.trim() || `${city.name} Cricket Club`,
      academyName: buildAcademyName(city.name)
    },
    dbClient
  );

  const cpuCities = await dbClient.query(
    `SELECT id, name
     FROM cities
     WHERE id <> $1
     ORDER BY random()
     LIMIT $2`,
    [city.id, LEAGUE_TEAM_TARGET - 1]
  );

  if (cpuCities.rows.length < LEAGUE_TEAM_TARGET - 1) {
    const error = new Error(`Need at least ${LEAGUE_TEAM_TARGET} cities to start a career.`);
    error.status = 500;
    throw error;
  }

  const allFranchiseIds = [Number(managerFranchise.id)];

  for (const cpuCity of cpuCities.rows) {
    const cpuFranchise = await createFranchiseRecord(
      {
        cityId: cpuCity.id,
        cityName: cpuCity.name,
        ownerUserId: null,
        status: 'AI_CONTROLLED'
      },
      dbClient
    );
    allFranchiseIds.push(Number(cpuFranchise.id));
  }

  for (const franchiseId of allFranchiseIds) {
    await ensureFranchiseInfrastructure(franchiseId, dbClient);
    await calculateFranchiseValuation(franchiseId, null, dbClient);
  }

  const season = await ensureActiveSeason(dbClient);
  if (season) {
    await dbClient.query(
      `INSERT INTO season_teams (season_id, franchise_id, is_ai, league_tier, previous_league_tier, movement)
       SELECT $1, f.id, f.owner_user_id IS NULL, f.current_league_tier, f.current_league_tier, 'STAY'
       FROM franchises f
       WHERE f.id = ANY($2::bigint[])
       ON CONFLICT (season_id, franchise_id) DO UPDATE
       SET is_ai = EXCLUDED.is_ai`,
      [season.id, allFranchiseIds]
    );

    await markCpuAndHumanOwnership(managerFranchise.id, dbClient);
    await generateDoubleRoundRobinFixtures(season.id, dbClient);
  }

  return managerFranchise;
}

export async function claimFranchise({ userId, cityId, franchiseName }) {
  return withTransaction(async (client) => {
    const owned = await getOwnedFranchise(userId, client);
    if (owned) {
      const error = new Error('You already manage a franchise in this save.');
      error.status = 400;
      throw error;
    }

    const cityResult = await client.query('SELECT id, name, country FROM cities WHERE id = $1', [cityId]);
    if (!cityResult.rows.length) {
      const error = new Error('City not found.');
      error.status = 404;
      throw error;
    }

    const city = cityResult.rows[0];
    const franchiseCount = Number((await client.query('SELECT COUNT(*)::int AS count FROM franchises')).rows[0].count);

    if (franchiseCount === 0) {
      const created = await initializeCareerLeagueWithCity({ userId, city, franchiseName }, client);

      const refreshed = await client.query(
        `SELECT f.*, c.name AS city_name, c.country, c.latitude, c.longitude
         FROM franchises f
         JOIN cities c ON c.id = f.city_id
         WHERE f.id = $1`,
        [created.id]
      );

      return refreshed.rows[0];
    }

    const franchiseResult = await client.query(
      `SELECT *
       FROM franchises
       WHERE city_id = $1
       FOR UPDATE`,
      [cityId]
    );

    if (!franchiseResult.rows.length) {
      const error = new Error('This city is not in the current league pool.');
      error.status = 409;
      throw error;
    }

    const franchise = franchiseResult.rows[0];

    if (franchise.owner_user_id && Number(franchise.owner_user_id) !== Number(userId)) {
      const error = new Error('This city is already claimed by another manager.');
      error.status = 409;
      throw error;
    }

    await client.query(
      `UPDATE franchises
       SET owner_user_id = $2,
           status = 'ACTIVE',
           franchise_name = COALESCE($3, franchise_name),
           academy_name = $4,
           listed_for_sale_at = NULL
       WHERE id = $1`,
      [
        franchise.id,
        userId,
        franchiseName?.trim() || `${city.name} Cricket Club`,
        buildAcademyName(city.name)
      ]
    );

    await ensureFranchiseInfrastructure(franchise.id, client);
    await markCpuAndHumanOwnership(franchise.id, client);

    await calculateFranchiseValuation(franchise.id, null, client);

    const refreshed = await client.query(
      `SELECT f.*, c.name AS city_name, c.country, c.latitude, c.longitude
       FROM franchises f
       JOIN cities c ON c.id = f.city_id
       WHERE f.id = $1`,
      [franchise.id]
    );

    return refreshed.rows[0];
  });
}

export async function listFranchiseForSale({ userId, franchiseId }) {
  const franchise = await getOwnedFranchise(userId);
  if (!franchise || Number(franchise.id) !== Number(franchiseId)) {
    const error = new Error('You can only list your own franchise.');
    error.status = 403;
    throw error;
  }

  await pool.query(
    `UPDATE franchises
     SET status = 'FOR_SALE',
         listed_for_sale_at = NOW()
     WHERE id = $1`,
    [franchiseId]
  );

  return (await pool.query('SELECT * FROM franchises WHERE id = $1', [franchiseId])).rows[0];
}

export async function sellFranchiseToMarketplace({ userId, franchiseId }) {
  const franchise = await getOwnedFranchise(userId);
  if (!franchise || Number(franchise.id) !== Number(franchiseId)) {
    const error = new Error('You can only sell your own franchise.');
    error.status = 403;
    throw error;
  }

  await pool.query(
    `UPDATE franchises
     SET owner_user_id = NULL,
         status = 'AI_CONTROLLED',
         listed_for_sale_at = NULL,
         win_streak = 0
     WHERE id = $1`,
    [franchiseId]
  );

  await pool.query(
    `INSERT INTO transfer_feed (action_type, source_franchise_id, message)
     VALUES ('SEASON_NOTE', $1, 'Franchise returned to CPU control.')`,
    [franchiseId]
  );

  return (await pool.query('SELECT * FROM franchises WHERE id = $1', [franchiseId])).rows[0];
}

export async function purchaseFranchise({ buyerUserId, franchiseId, newFranchiseName }) {
  return withTransaction(async (client) => {
    const owned = await getOwnedFranchise(buyerUserId, client);
    if (owned) {
      const error = new Error('Single-player mode allows one franchise per save.');
      error.status = 400;
      throw error;
    }

    const franchiseResult = await client.query(
      `SELECT f.*, c.name AS city_name
       FROM franchises f
       JOIN cities c ON c.id = f.city_id
       WHERE f.id = $1
       FOR UPDATE`,
      [franchiseId]
    );

    if (!franchiseResult.rows.length) {
      const error = new Error('Franchise not found.');
      error.status = 404;
      throw error;
    }

    const franchise = franchiseResult.rows[0];

    await client.query(
      `UPDATE franchises
       SET owner_user_id = $2,
           status = 'ACTIVE',
           listed_for_sale_at = NULL,
           franchise_name = COALESCE($3, franchise_name)
       WHERE id = $1`,
      [franchiseId, buyerUserId, newFranchiseName?.trim() || null]
    );

    await markCpuAndHumanOwnership(franchiseId, client);

    await client.query(
      `INSERT INTO franchise_sales (franchise_id, seller_user_id, buyer_user_id, sale_value)
       VALUES ($1, $2, $3, $4)`,
      [franchiseId, franchise.owner_user_id, buyerUserId, franchise.total_valuation]
    );

    await calculateFranchiseValuation(franchiseId, null, client);

    return (await client.query('SELECT * FROM franchises WHERE id = $1', [franchiseId])).rows[0];
  });
}

export async function getMarketplaceData() {
  const franchiseCount = Number((await pool.query('SELECT COUNT(*)::int AS count FROM franchises')).rows[0].count);
  const availableCities = await pool.query(
    franchiseCount === 0
      ? `SELECT c.*
         FROM cities c
         ORDER BY c.country, c.name`
      : `SELECT c.*
         FROM cities c
         JOIN franchises f ON f.city_id = c.id
         WHERE f.owner_user_id IS NULL
           AND f.status = 'AVAILABLE'
         ORDER BY c.country, c.name`
  );

  const allFranchises = await pool.query(
    `SELECT f.id, f.franchise_name, f.status, f.total_valuation, f.wins, f.losses, f.championships,
            f.win_streak, f.prospect_points, f.growth_points, f.academy_level, f.youth_development_rating,
            f.current_league_tier, f.promotions, f.relegations,
            c.name AS city_name, c.country, c.latitude, c.longitude,
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

  const franchisesForSale = allFranchises.rows.filter((row) => row.status === 'FOR_SALE' || row.status === 'AVAILABLE');

  const recentSales = await pool.query(
    `SELECT fs.id, fs.franchise_id, fs.sale_value, fs.sold_at, f.franchise_name
     FROM franchise_sales fs
     JOIN franchises f ON f.id = fs.franchise_id
     ORDER BY fs.sold_at DESC
     LIMIT 20`
  );

  return {
    availableCities: availableCities.rows,
    franchisesForSale,
    allFranchises: allFranchises.rows,
    recentSales: recentSales.rows
  };
}
