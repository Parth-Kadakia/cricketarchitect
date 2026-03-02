import pool from '../config/db.js';
import { clamp, randomFloat, randomInt } from '../utils/gameMath.js';
import { buildNameKey, pickUniquePlayerName } from './nameService.js';

const PLAYER_ROLES = ['BATTER', 'BOWLER', 'ALL_ROUNDER', 'WICKET_KEEPER'];
const PROSPECT_GENERATION_COST = 50;

function roleAdjustment(role) {
  if (role === 'BATTER') {
    return { batting: 8, bowling: -4, fielding: 1 };
  }

  if (role === 'BOWLER') {
    return { batting: -4, bowling: 8, fielding: 1 };
  }

  if (role === 'WICKET_KEEPER') {
    return { batting: 4, bowling: -8, fielding: 8 };
  }

  return { batting: 4, bowling: 4, fielding: 3 };
}

function computeMarketValue(player) {
  const weighted = player.batting * 0.26 + player.bowling * 0.26 + player.fielding * 0.2 + player.fitness * 0.14 + player.temperament * 0.14;
  return Number((5 + weighted * 0.11 + player.potential * 0.05).toFixed(2));
}

export async function generateSeasonYouthPlayers(franchiseId, seasonId, dbClient = pool) {
  const franchiseResult = await dbClient.query(
    `SELECT id, academy_level, youth_development_rating
     FROM franchises
     WHERE id = $1`,
    [franchiseId]
  );

  if (!franchiseResult.rows.length) {
    const error = new Error('Franchise not found for youth generation.');
    error.status = 404;
    throw error;
  }

  const franchise = franchiseResult.rows[0];

  const regionsResult = await dbClient.query(
    `SELECT id, name, region_country, quality_rating
     FROM regions
     WHERE franchise_id = $1
     ORDER BY id`,
    [franchiseId]
  );

  const generated = [];
  const existingNames = await dbClient.query(
    `SELECT first_name, last_name
     FROM players
     WHERE franchise_id = $1`,
    [franchiseId]
  );
  const usedNameKeys = new Set(existingNames.rows.map((row) => buildNameKey(row.first_name, row.last_name)));
  const usedFirstNames = new Set(existingNames.rows.map((row) => String(row.first_name || '').trim().toLowerCase()).filter(Boolean));

  for (const region of regionsResult.rows) {
    const count = randomInt(2, 5);

    for (let index = 0; index < count; index += 1) {
      const role = PLAYER_ROLES[randomInt(0, PLAYER_ROLES.length - 1)];
      const adjust = roleAdjustment(role);
      const name = pickUniquePlayerName(region.region_country, usedNameKeys, { usedFirstNames });

      const academyFactor = Number(franchise.academy_level) * 1.4;
      const regionFactor = Number(region.quality_rating) * 0.36;
      const base = 18 + academyFactor + regionFactor + randomFloat(-5, 5);

      const player = {
        batting: clamp(Math.round(base + (adjust.batting || 0) + randomFloat(-4, 5)), 18, 82),
        bowling: clamp(Math.round(base + (adjust.bowling || 0) + randomFloat(-4, 5)), 18, 82),
        fielding: clamp(Math.round(base + (adjust.fielding || 0) + randomFloat(-4, 5)), 18, 82),
        fitness: clamp(Math.round(base + randomFloat(-4, 7)), 18, 88),
        temperament: clamp(Math.round(base + randomFloat(-5, 6)), 18, 84),
        potential: clamp(Math.round(35 + Number(franchise.youth_development_rating) * 0.55 + randomFloat(-10, 15)), 30, 95),
        age: randomInt(16, 22)
      };

      const marketValue = computeMarketValue(player);
      const salary = Number((0.5 + marketValue * 0.06).toFixed(2));

      const inserted = await dbClient.query(
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
          squad_status
        ) VALUES (
          $1, $2, $3, $4, $5, $6,
          $7, $8, $9, $10, $11, $12,
          $13, $14, $15, 32, 30, TRUE, 'YOUTH'
        ) RETURNING *`,
        [
          franchiseId,
          region.id,
          name.firstName,
          name.lastName,
          region.region_country,
          role,
          player.batting,
          player.bowling,
          player.fielding,
          player.fitness,
          player.temperament,
          player.potential,
          player.age,
          marketValue,
          salary
        ]
      );

      generated.push(inserted.rows[0]);
    }
  }

  return generated;
}

export async function generateProspectsForFranchise(franchiseId, seasonId, dbClient = pool) {
  const franchiseResult = await dbClient.query(
    `SELECT id, prospect_points
     FROM franchises
     WHERE id = $1`,
    [franchiseId]
  );

  if (!franchiseResult.rows.length) {
    const error = new Error('Franchise not found for prospect generation.');
    error.status = 404;
    throw error;
  }

  const prospectPoints = Number(franchiseResult.rows[0].prospect_points || 0);
  if (prospectPoints < PROSPECT_GENERATION_COST) {
    const error = new Error(`Need ${PROSPECT_GENERATION_COST} prospect points to generate prospects.`);
    error.status = 400;
    throw error;
  }

  await dbClient.query(
    `UPDATE franchises
     SET prospect_points = prospect_points - $2
     WHERE id = $1`,
    [franchiseId, PROSPECT_GENERATION_COST]
  );

  return generateSeasonYouthPlayers(franchiseId, seasonId, dbClient);
}

function calcDelta(power, bias = 1) {
  return clamp(Math.round(power * bias + randomFloat(-2, 2)), 0, 8);
}

export async function applyPlayerGrowth(franchiseId, seasonId, dbClient = pool) {
  const franchiseResult = await dbClient.query(
    `SELECT academy_level, growth_points
     FROM franchises
     WHERE id = $1`,
    [franchiseId]
  );

  if (!franchiseResult.rows.length) {
    const error = new Error('Franchise not found for growth processing.');
    error.status = 404;
    throw error;
  }

  const franchise = franchiseResult.rows[0];

  if (Number(franchise.growth_points) < 5) {
    const error = new Error('You need at least 5 growth points to run player growth.');
    error.status = 400;
    throw error;
  }

  const playersResult = await dbClient.query(
    `SELECT *
     FROM players
     WHERE franchise_id = $1
       AND squad_status IN ('YOUTH', 'MAIN_SQUAD')
     ORDER BY squad_status = 'MAIN_SQUAD' DESC`,
    [franchiseId]
  );

  const updated = [];

  for (const player of playersResult.rows) {
    const basePower = Number(franchise.academy_level) * 0.7 + Number(player.potential) * 0.05 + (player.squad_status === 'MAIN_SQUAD' ? 1.8 : 1.1);

    const battingDelta = calcDelta(basePower, player.role === 'BATTER' || player.role === 'ALL_ROUNDER' || player.role === 'WICKET_KEEPER' ? 1.05 : 0.8);
    const bowlingDelta = calcDelta(basePower, player.role === 'BOWLER' || player.role === 'ALL_ROUNDER' ? 1.05 : 0.8);
    const fieldingDelta = calcDelta(basePower, 0.75);
    const fitnessDelta = calcDelta(basePower, 0.7);
    const temperamentDelta = calcDelta(basePower, 0.6);

    const nextBatting = clamp(Number(player.batting) + battingDelta, 0, 100);
    const nextBowling = clamp(Number(player.bowling) + bowlingDelta, 0, 100);
    const nextFielding = clamp(Number(player.fielding) + fieldingDelta, 0, 100);
    const nextFitness = clamp(Number(player.fitness) + fitnessDelta, 0, 100);
    const nextTemperament = clamp(Number(player.temperament) + temperamentDelta, 0, 100);

    const valueDelta = Number(((battingDelta + bowlingDelta + fieldingDelta + fitnessDelta + temperamentDelta) * 0.7).toFixed(2));

    const updatedPlayer = await dbClient.query(
      `UPDATE players
       SET batting = $2,
           bowling = $3,
           fielding = $4,
           fitness = $5,
           temperament = $6,
           market_value = market_value + $7,
           form = LEAST(100, form + $8),
           morale = LEAST(100, morale + $9)
       WHERE id = $1
       RETURNING *`,
      [player.id, nextBatting, nextBowling, nextFielding, nextFitness, nextTemperament, valueDelta, 2, 1]
    );

    await dbClient.query(
      `INSERT INTO player_growth_logs (
        player_id,
        season_id,
        batting_delta,
        bowling_delta,
        fielding_delta,
        fitness_delta,
        temperament_delta,
        market_value_delta
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [player.id, seasonId, battingDelta, bowlingDelta, fieldingDelta, fitnessDelta, temperamentDelta, valueDelta]
    );

    updated.push(updatedPlayer.rows[0]);
  }

  await dbClient.query(
    `UPDATE franchises
     SET growth_points = GREATEST(0, growth_points - 5)
     WHERE id = $1`,
    [franchiseId]
  );

  return updated;
}

export async function upgradeAcademyWithPoints(franchiseId, mode, dbClient = pool) {
  const franchiseResult = await dbClient.query(
    `SELECT *
     FROM franchises
     WHERE id = $1`,
    [franchiseId]
  );

  if (!franchiseResult.rows.length) {
    const error = new Error('Franchise not found.');
    error.status = 404;
    throw error;
  }

  const franchise = franchiseResult.rows[0];
  const academyLevelCost = 10 + Number(franchise.academy_level) * 5;
  const youthRatingCost = 20 + Math.floor(Number(franchise.youth_development_rating) / 10) * 5;

  if (mode === 'ACADEMY_LEVEL') {
    if (Number(franchise.academy_level) >= 10) {
      const error = new Error('Academy level is already maxed.');
      error.status = 400;
      throw error;
    }

    if (Number(franchise.prospect_points) < academyLevelCost) {
      const error = new Error(`Need ${academyLevelCost} prospect points to upgrade academy level.`);
      error.status = 400;
      throw error;
    }

    const updated = await dbClient.query(
      `UPDATE franchises
       SET academy_level = LEAST(10, academy_level + 1),
           prospect_points = prospect_points - $2
       WHERE id = $1
       RETURNING *`,
      [franchiseId, academyLevelCost]
    );

    return updated.rows[0];
  }

  if (mode === 'YOUTH_RATING') {
    if (Number(franchise.youth_development_rating) >= 100) {
      const error = new Error('Youth development rating is already maxed.');
      error.status = 400;
      throw error;
    }

    if (Number(franchise.growth_points) < youthRatingCost) {
      const error = new Error(`Need ${youthRatingCost} growth points to improve youth development rating.`);
      error.status = 400;
      throw error;
    }

    const updated = await dbClient.query(
      `UPDATE franchises
       SET youth_development_rating = LEAST(100, youth_development_rating + 6),
           growth_points = growth_points - $2
       WHERE id = $1
       RETURNING *`,
      [franchiseId, youthRatingCost]
    );

    return updated.rows[0];
  }

  const error = new Error('Invalid academy upgrade mode.');
  error.status = 400;
  throw error;
}

export async function promoteYouthPlayer(franchiseId, playerId, dbClient = pool) {
  const squadCount = await dbClient.query(
    `SELECT COUNT(*)::int AS count
     FROM players
     WHERE franchise_id = $1
       AND squad_status = 'MAIN_SQUAD'`,
    [franchiseId]
  );

  if (Number(squadCount.rows[0].count) >= 15) {
    const error = new Error('Main squad already has 15 players.');
    error.status = 400;
    throw error;
  }

  const updated = await dbClient.query(
    `UPDATE players
     SET squad_status = 'MAIN_SQUAD',
         is_youth = FALSE,
         morale = LEAST(100, morale + 6)
     WHERE id = $1
       AND franchise_id = $2
       AND squad_status = 'YOUTH'
     RETURNING *`,
    [playerId, franchiseId]
  );

  if (!updated.rows.length) {
    const error = new Error('Player is not eligible for promotion.');
    error.status = 400;
    throw error;
  }

  return updated.rows[0];
}

export async function loanPlayer(franchiseId, playerId, targetFranchiseId, dbClient = pool) {
  const updated = await dbClient.query(
    `UPDATE players
     SET squad_status = 'LOANED',
         starting_xi = FALSE,
         lineup_slot = NULL,
         on_loan_to_franchise_id = $3,
         morale = GREATEST(20, morale - 2)
     WHERE id = $1
       AND franchise_id = $2
       AND squad_status IN ('MAIN_SQUAD', 'YOUTH')
     RETURNING *`,
    [playerId, franchiseId, targetFranchiseId]
  );

  if (!updated.rows.length) {
    const error = new Error('Unable to loan this player.');
    error.status = 400;
    throw error;
  }

  await dbClient.query(
    `INSERT INTO transfer_feed (action_type, source_franchise_id, target_franchise_id, player_id, message)
     VALUES ('LOAN_REQUEST', $1, $2, $3, $4)`,
    [franchiseId, targetFranchiseId, playerId, 'Loan agreement completed.']
  );

  return updated.rows[0];
}

export async function releasePlayer(franchiseId, playerId, dbClient = pool) {
  const updated = await dbClient.query(
    `UPDATE players
     SET franchise_id = NULL,
         squad_status = 'AUCTION',
         starting_xi = FALSE,
         lineup_slot = NULL,
         on_loan_to_franchise_id = NULL,
         morale = 28
     WHERE id = $1
       AND franchise_id = $2
     RETURNING *`,
    [playerId, franchiseId]
  );

  if (!updated.rows.length) {
    const error = new Error('Unable to release this player.');
    error.status = 400;
    throw error;
  }

  await dbClient.query(
    `INSERT INTO transfer_feed (action_type, source_franchise_id, player_id, message)
     VALUES ('CPU_SELL', $1, $2, $3)`,
    [franchiseId, playerId, 'Player moved to auction pool.']
  );

  return updated.rows[0];
}

export async function demoteMainSquadPlayer(franchiseId, playerId, dbClient = pool) {
  const updated = await dbClient.query(
    `UPDATE players
     SET squad_status = 'YOUTH',
         is_youth = TRUE,
         starting_xi = FALSE,
         lineup_slot = NULL,
         morale = GREATEST(20, morale - 2)
     WHERE id = $1
       AND franchise_id = $2
       AND squad_status = 'MAIN_SQUAD'
     RETURNING *`,
    [playerId, franchiseId]
  );

  if (!updated.rows.length) {
    const error = new Error('Player is not eligible for demotion.');
    error.status = 400;
    throw error;
  }

  return updated.rows[0];
}
