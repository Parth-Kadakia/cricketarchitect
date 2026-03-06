import pool from '../config/db.js';
import { clamp, randomFloat, randomInt } from '../utils/gameMath.js';
import { buildNameKey, pickUniquePlayerName } from './nameService.js';

const ROLES = ['BATTER', 'BOWLER', 'ALL_ROUNDER', 'WICKET_KEEPER'];

function retirementProbability(player) {
  const ageFactor = Math.max(0, Number(player.age) - 33) * 0.18;
  const fitnessFactor = (100 - Number(player.fitness)) * 0.003;
  return clamp(0.06 + ageFactor + fitnessFactor + randomFloat(-0.04, 0.05), 0.03, 0.9);
}

function randomRole() {
  return ROLES[randomInt(0, ROLES.length - 1)];
}

function generateProspectAttributes(role) {
  const battingBase =
    role === 'BATTER'
      ? [28, 46]
      : role === 'WICKET_KEEPER'
        ? [24, 42]
        : role === 'ALL_ROUNDER'
          ? [20, 38]
          : [6, 24];
  const bowlingBase =
    role === 'BOWLER'
      ? [30, 48]
      : role === 'ALL_ROUNDER'
        ? [20, 38]
        : role === 'WICKET_KEEPER'
          ? [0, 2]
          : [0, 12];

  const batting = randomInt(battingBase[0], battingBase[1]);
  const bowling = randomInt(bowlingBase[0], bowlingBase[1]);
  const fielding = role === 'WICKET_KEEPER' ? randomInt(32, 52) : randomInt(20, 45);
  const fitness = randomInt(22, 48);
  const temperament = randomInt(20, 45);
  const potential = randomInt(40, 70);
  const marketValue = Number((6 + (batting + bowling + fielding + potential) * 0.09).toFixed(2));
  const salary = Number((0.6 + marketValue * 0.06).toFixed(2));

  return {
    batting,
    bowling,
    fielding,
    fitness,
    temperament,
    potential,
    marketValue,
    salary
  };
}

async function ensureMinimumSquadSize(franchiseId, dbClient = pool) {
  const countResult = await dbClient.query(
    `SELECT COUNT(*)::int AS count
     FROM players
     WHERE franchise_id = $1
       AND squad_status IN ('MAIN_SQUAD', 'YOUTH', 'LOANED')`,
    [franchiseId]
  );

  const currentCount = Number(countResult.rows[0].count);
  if (currentCount >= 18) {
    return;
  }

  const franchiseResult = await dbClient.query(
    `SELECT c.country
     FROM franchises f
     JOIN cities c ON c.id = f.city_id
     WHERE f.id = $1`,
    [franchiseId]
  );

  if (!franchiseResult.rows.length) {
    return;
  }

  const country = franchiseResult.rows[0].country;

  const regions = await dbClient.query(
    `SELECT id
     FROM regions
     WHERE franchise_id = $1
     ORDER BY id`,
    [franchiseId]
  );

  const regionIds = regions.rows.map((row) => row.id);

  const missing = 18 - currentCount;
  const existingNames = await dbClient.query(
    `SELECT first_name, last_name
     FROM players
     WHERE franchise_id = $1`,
    [franchiseId]
  );
  const usedNameKeys = new Set(existingNames.rows.map((row) => buildNameKey(row.first_name, row.last_name)));
  const usedFirstNames = new Set(existingNames.rows.map((row) => String(row.first_name || '').trim().toLowerCase()).filter(Boolean));

  for (let index = 0; index < missing; index += 1) {
    const role = randomRole();
    const attrs = generateProspectAttributes(role);
    const name = pickUniquePlayerName(country, usedNameKeys, { usedFirstNames });

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
        squad_status
      ) VALUES (
        $1, $2, $3, $4, $5, $6,
        $7, $8, $9, $10, $11, $12,
        $13, $14, $15, 30, 30, TRUE, 'YOUTH'
      )`,
      [
        franchiseId,
        regionIds[index % Math.max(1, regionIds.length)] || null,
        name.firstName,
        name.lastName,
        country,
        role,
        attrs.batting,
        attrs.bowling,
        attrs.fielding,
        attrs.fitness,
        attrs.temperament,
        attrs.potential,
        randomInt(16, 20),
        attrs.marketValue,
        attrs.salary
      ]
    );
  }
}

export async function processSeasonRetirements(seasonId, dbClient = pool) {
  const candidates = await dbClient.query(
    `SELECT p.*, f.id AS franchise_id
     FROM players p
     LEFT JOIN franchises f ON f.id = p.franchise_id
     WHERE p.squad_status IN ('MAIN_SQUAD', 'YOUTH', 'LOANED')
       AND p.age >= 34`
  );

  const retired = [];
  const impacted = new Set();

  for (const player of candidates.rows) {
    if (Math.random() > retirementProbability(player)) {
      continue;
    }

    await dbClient.query(
      `UPDATE players
       SET squad_status = 'RETIRED',
           retired_at = NOW(),
           starting_xi = FALSE,
           on_loan_to_franchise_id = NULL
       WHERE id = $1`,
      [player.id]
    );

    retired.push(player);

    if (player.franchise_id) {
      impacted.add(Number(player.franchise_id));
      await dbClient.query(
        `INSERT INTO transfer_feed (season_id, action_type, source_franchise_id, player_id, message)
         VALUES ($1, 'RETIREMENT', $2, $3, $4)`,
        [seasonId, player.franchise_id, player.id, `${player.first_name} ${player.last_name} announced retirement.`]
      );
    }
  }

  await dbClient.query(
    `UPDATE players
     SET age = LEAST(45, age + 1)
     WHERE squad_status <> 'RETIRED'`
  );

  for (const franchiseId of impacted) {
    await ensureMinimumSquadSize(franchiseId, dbClient);
  }

  return retired;
}
