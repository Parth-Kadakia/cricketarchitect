import pool from '../config/db.js';

export async function calculateFranchiseValuation(franchiseId, seasonId = null, dbClient = pool) {
  const franchiseResult = await dbClient.query(
    `SELECT id, base_value, wins, losses, championships, fan_rating, win_streak, best_win_streak, competition_mode
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

  if (String(franchise.competition_mode || '').toUpperCase() === 'INTERNATIONAL') {
    const strength = await dbClient.query(
      `SELECT ROUND(COALESCE(AVG((batting + bowling + fielding + fitness + temperament) / 5.0), 0), 2) AS strength_rating
       FROM players
       WHERE franchise_id = $1
         AND squad_status IN ('MAIN_SQUAD', 'YOUTH', 'LOANED')`,
      [franchiseId]
    );

    const totalValue = Number(strength.rows[0]?.strength_rating || 0);

    await dbClient.query('UPDATE franchises SET total_valuation = $2 WHERE id = $1', [franchiseId, totalValue]);

    return {
      franchiseId,
      seasonId,
      totalValue,
      breakdown: {
        strength: totalValue
      }
    };
  }

  const playersResult = await dbClient.query(
    `SELECT COALESCE(SUM((batting + bowling + fielding + fitness + temperament) / 5.0), 0) AS player_strength_sum
     FROM players
     WHERE franchise_id = $1
       AND squad_status IN ('MAIN_SQUAD', 'YOUTH', 'LOANED')`,
    [franchiseId]
  );

  const winBonus = Number(franchise.wins) * 12;
  const streakBonus = Number(franchise.best_win_streak) * 6 + Number(franchise.win_streak) * 3;
  const cupBonus = Number(franchise.championships) * 220;
  const fanBonus = Number(franchise.fan_rating) * 0.8;
  const playerBonus = Number(playersResult.rows[0].player_strength_sum || 0) * 0.18;

  const totalValue = Number(franchise.base_value) + winBonus + streakBonus + cupBonus + fanBonus + playerBonus;

  await dbClient.query(
    `INSERT INTO valuations (
      franchise_id,
      season_id,
      base_value,
      win_bonus,
      streak_bonus,
      cup_bonus,
      fan_bonus,
      player_bonus,
      total_value
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      franchiseId,
      seasonId,
      Number(franchise.base_value),
      winBonus,
      streakBonus,
      cupBonus,
      fanBonus,
      playerBonus,
      totalValue
    ]
  );

  await dbClient.query('UPDATE franchises SET total_valuation = $2 WHERE id = $1', [franchiseId, totalValue]);

  return {
    franchiseId,
    seasonId,
    totalValue,
    breakdown: {
      baseValue: Number(franchise.base_value),
      winBonus,
      streakBonus,
      cupBonus,
      fanBonus,
      playerBonus
    }
  };
}

export async function recalculateAllFranchiseValuations(seasonId = null, dbClient = pool, worldId = null) {
  const franchises = worldId
    ? await dbClient.query('SELECT id FROM franchises WHERE world_id = $1', [worldId])
    : await dbClient.query('SELECT id FROM franchises');
  const results = [];

  for (const franchise of franchises.rows) {
    results.push(await calculateFranchiseValuation(franchise.id, seasonId, dbClient));
  }

  return results;
}
