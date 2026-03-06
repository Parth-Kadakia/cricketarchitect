import pool from '../config/db.js';
import { clamp, randomFloat, randomInt } from '../utils/gameMath.js';
import { buildNameKey, pickUniquePlayerName } from './nameService.js';

const PLAYER_ROLES = ['BATTER', 'BOWLER', 'ALL_ROUNDER', 'WICKET_KEEPER'];
const PROSPECT_GENERATION_COST = 50;

function roleAdjustment(role) {
  if (role === 'BATTER') {
    return { batting: 12, bowling: -16, fielding: 1 };
  }

  if (role === 'BOWLER') {
    return { batting: -16, bowling: 12, fielding: 2 };
  }

  if (role === 'WICKET_KEEPER') {
    return { batting: 8, bowling: -24, fielding: 14 };
  }

  return { batting: 6, bowling: 6, fielding: 5 };
}

function roleSkillRange(role, skill) {
  const normalized = String(role || '').toUpperCase();
  const ranges = {
    BATTER: {
      batting: [30, 82],
      bowling: [0, 16],
      fielding: [24, 76],
      fitness: [24, 82],
      temperament: [22, 82]
    },
    BOWLER: {
      batting: [4, 30],
      bowling: [38, 88],
      fielding: [22, 76],
      fitness: [24, 86],
      temperament: [22, 82]
    },
    ALL_ROUNDER: {
      batting: [24, 76],
      bowling: [24, 76],
      fielding: [22, 78],
      fitness: [24, 86],
      temperament: [22, 84]
    },
    WICKET_KEEPER: {
      batting: [24, 76],
      bowling: [0, 4],
      fielding: [36, 90],
      fitness: [24, 86],
      temperament: [24, 86]
    }
  };

  return ranges[normalized]?.[skill] || [18, 80];
}

function roleSkillCap(role, skill) {
  const normalized = String(role || '').toUpperCase();
  const caps = {
    BATTER: { batting: 96, bowling: 24, fielding: 84, fitness: 90, temperament: 90 },
    BOWLER: { batting: 36, bowling: 96, fielding: 86, fitness: 92, temperament: 90 },
    ALL_ROUNDER: { batting: 90, bowling: 90, fielding: 88, fitness: 92, temperament: 92 },
    WICKET_KEEPER: { batting: 90, bowling: 4, fielding: 97, fitness: 90, temperament: 93 }
  };
  return caps[normalized]?.[skill] || 90;
}

function roleSkillFloor(role, skill) {
  const normalized = String(role || '').toUpperCase();
  const floors = {
    BATTER: { batting: 24, bowling: 0, fielding: 20, fitness: 24, temperament: 20 },
    BOWLER: { batting: 0, bowling: 24, fielding: 20, fitness: 24, temperament: 20 },
    ALL_ROUNDER: { batting: 20, bowling: 20, fielding: 20, fitness: 24, temperament: 20 },
    WICKET_KEEPER: { batting: 20, bowling: 0, fielding: 30, fitness: 24, temperament: 22 }
  };
  return floors[normalized]?.[skill] || 18;
}

function roleGrowthMultiplier(role, skill) {
  const normalized = String(role || '').toUpperCase();
  if (skill === 'batting') {
    if (normalized === 'BATTER') return 1.08;
    if (normalized === 'WICKET_KEEPER') return 0.88;
    if (normalized === 'ALL_ROUNDER') return 0.9;
    return 0.04;
  }

  if (skill === 'bowling') {
    if (normalized === 'BOWLER') return 1.08;
    if (normalized === 'ALL_ROUNDER') return 0.88;
    if (normalized === 'BATTER') return 0;
    return 0;
  }

  if (skill === 'fielding') {
    if (normalized === 'WICKET_KEEPER') return 1.06;
    if (normalized === 'ALL_ROUNDER') return 0.78;
    if (normalized === 'BOWLER') return 0.68;
    return 0.62;
  }

  if (skill === 'fitness') {
    if (normalized === 'ALL_ROUNDER') return 0.72;
    if (normalized === 'BOWLER') return 0.68;
    if (normalized === 'WICKET_KEEPER') return 0.6;
    return 0.58;
  }

  return 0.5;
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
      const name = pickUniquePlayerName(region.region_country, usedNameKeys, { usedFirstNames, strictCountry: true });

      const academyFactor = Number(franchise.academy_level) * 1.4;
      const regionFactor = Number(region.quality_rating) * 0.36;
      const base = 18 + academyFactor + regionFactor + randomFloat(-5, 5);
      const quality = clamp((base - 18) / 52, 0, 1);
      const skill = (key, adjustValue = 0, jitter = 4) => {
        const [minValue, maxValue] = roleSkillRange(role, key);
        const projected = minValue + quality * (maxValue - minValue) + adjustValue + randomFloat(-jitter, jitter);
        return clamp(Math.round(projected), minValue, maxValue);
      };

      const player = {
        batting: skill('batting', (adjust.batting || 0) * 0.35),
        bowling: skill('bowling', (adjust.bowling || 0) * 0.4, 3.5),
        fielding: skill('fielding', (adjust.fielding || 0) * 0.35),
        fitness: skill('fitness', 0, 3.5),
        temperament: skill('temperament', 0, 3.5),
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

function calcDelta(power, bias = 1, maxDelta = 2) {
  return clamp(Math.round(power * bias + randomFloat(-0.45, 0.65)), 0, maxDelta);
}

function computeSkillCap(player, academyLevel, skill) {
  const normalizedRole = String(player.role || '').toUpperCase();
  const potential = Number(player.potential || 0);
  const academy = Number(academyLevel || 1);
  const base = clamp(Math.round(30 + potential * 0.52 + academy * 0.95), 40, 93);

  let bonus = 0;
  if (skill === 'batting' && normalizedRole === 'BATTER') {
    bonus = 5;
  } else if (skill === 'batting' && normalizedRole === 'WICKET_KEEPER') {
    bonus = 3;
  } else if (skill === 'bowling' && normalizedRole === 'BOWLER') {
    bonus = 5;
  } else if (skill === 'bowling' && normalizedRole === 'ALL_ROUNDER') {
    bonus = 4;
  } else if (skill === 'fielding' && normalizedRole === 'WICKET_KEEPER') {
    bonus = 7;
  } else if (normalizedRole === 'ALL_ROUNDER') {
    bonus = 2;
  }

  const roleFloor = roleSkillFloor(normalizedRole, skill);
  const roleCap = roleSkillCap(normalizedRole, skill);
  return clamp(Math.min(base + bonus, roleCap), roleFloor, roleCap);
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
    const isMainSquad = player.squad_status === 'MAIN_SQUAD';
    const ageBonus = Number(player.age || 0) <= 21 ? 0.12 : 0;
    const growthPower =
      Number(franchise.academy_level) * 0.08 +
      Number(player.potential) * 0.012 +
      (isMainSquad ? 0.32 : 0.2) +
      ageBonus;

    const normalizedRole = String(player.role || '').toUpperCase();

    const battingDelta = calcDelta(
      growthPower,
      roleGrowthMultiplier(normalizedRole, 'batting'),
      normalizedRole === 'BATTER' || normalizedRole === 'WICKET_KEEPER' || normalizedRole === 'ALL_ROUNDER' ? 2 : 0
    );
    const bowlingDelta = calcDelta(
      growthPower,
      roleGrowthMultiplier(normalizedRole, 'bowling'),
      normalizedRole === 'BOWLER' ? 2 : normalizedRole === 'ALL_ROUNDER' ? 1 : 0
    );
    const fieldingDelta = calcDelta(growthPower, roleGrowthMultiplier(normalizedRole, 'fielding'), normalizedRole === 'WICKET_KEEPER' ? 2 : 1);
    const fitnessDelta = calcDelta(growthPower, roleGrowthMultiplier(normalizedRole, 'fitness'), 1);
    const temperamentDelta = calcDelta(growthPower, roleGrowthMultiplier(normalizedRole, 'temperament'), 1);

    const battingCap = computeSkillCap(player, franchise.academy_level, 'batting');
    const bowlingCap = computeSkillCap(player, franchise.academy_level, 'bowling');
    const fieldingCap = computeSkillCap(player, franchise.academy_level, 'fielding');
    const fitnessCap = computeSkillCap(player, franchise.academy_level, 'fitness');
    const temperamentCap = computeSkillCap(player, franchise.academy_level, 'temperament');

    const nextBatting = clamp(
      Number(player.batting) + battingDelta,
      roleSkillFloor(normalizedRole, 'batting'),
      battingCap
    );
    const nextBowling = clamp(
      Number(player.bowling) + bowlingDelta,
      roleSkillFloor(normalizedRole, 'bowling'),
      bowlingCap
    );
    const nextFielding = clamp(
      Number(player.fielding) + fieldingDelta,
      roleSkillFloor(normalizedRole, 'fielding'),
      fieldingCap
    );
    const nextFitness = clamp(
      Number(player.fitness) + fitnessDelta,
      roleSkillFloor(normalizedRole, 'fitness'),
      fitnessCap
    );
    const nextTemperament = clamp(
      Number(player.temperament) + temperamentDelta,
      roleSkillFloor(normalizedRole, 'temperament'),
      temperamentCap
    );

    const totalDelta = battingDelta + bowlingDelta + fieldingDelta + fitnessDelta + temperamentDelta;
    const valueDelta = Number((totalDelta * 0.18).toFixed(2));

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
      [player.id, nextBatting, nextBowling, nextFielding, nextFitness, nextTemperament, valueDelta, isMainSquad ? 1 : 0, 1]
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
