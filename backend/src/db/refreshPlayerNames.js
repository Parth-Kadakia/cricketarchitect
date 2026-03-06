import pool, { withTransaction } from '../config/db.js';
import { buildNameKey, pickUniquePlayerName } from '../services/nameService.js';

async function refreshPlayerNames(dbClient) {
  const playersResult = await dbClient.query(
    `SELECT id, franchise_id, country_origin
     FROM players
     ORDER BY franchise_id, id`
  );

  const usedByFranchise = new Map();
  const usedFirstByFranchise = new Map();
  let updated = 0;

  for (const player of playersResult.rows) {
    const franchiseId = Number(player.franchise_id || 0);
    if (!franchiseId) {
      continue;
    }

    if (!usedByFranchise.has(franchiseId)) {
      usedByFranchise.set(franchiseId, new Set());
    }
    if (!usedFirstByFranchise.has(franchiseId)) {
      usedFirstByFranchise.set(franchiseId, new Set());
    }

    const used = usedByFranchise.get(franchiseId);
    const usedFirst = usedFirstByFranchise.get(franchiseId);
    const country = player.country_origin || 'Global';
    const next = pickUniquePlayerName(country, used, { usedFirstNames: usedFirst, strictCountry: true });
    used.add(buildNameKey(next.firstName, next.lastName));

    await dbClient.query(
      `UPDATE players
       SET first_name = $2,
           last_name = $3,
           updated_at = NOW()
       WHERE id = $1`,
      [player.id, next.firstName, next.lastName]
    );

    updated += 1;
  }

  return {
    updated,
    franchises: usedByFranchise.size
  };
}

async function run() {
  const summary = await withTransaction((dbClient) => refreshPlayerNames(dbClient));
  console.log(`Refreshed names for ${summary.updated} players across ${summary.franchises} franchises.`);
  await pool.end();
}

run().catch(async (error) => {
  console.error('Failed to refresh player names:', error);
  await pool.end();
  process.exit(1);
});
