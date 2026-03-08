import pool from '../config/db.js';
import { initializeAllFranchises } from './franchiseService.js';
import { ensureActiveSeason, generateDoubleRoundRobinFixtures, getActiveSeason } from './leagueService.js';
import { ensureFranchiseManagers } from './managerCareerService.js';

export async function bootstrapGameWorld(dbClient = pool, worldId = null) {
  const franchiseCount = Number((await dbClient.query(
    'SELECT COUNT(*)::int AS count FROM franchises WHERE ($1::bigint IS NULL OR world_id = $1)',
    [worldId]
  )).rows[0].count);
  if (franchiseCount === 0) {
    return null;
  }

  await initializeAllFranchises(dbClient, worldId);
  await ensureFranchiseManagers(dbClient, worldId);

  const season = await ensureActiveSeason(dbClient, worldId);
  if (!season) {
    return null;
  }

  await dbClient.query(
    `INSERT INTO season_teams (season_id, franchise_id, is_ai, league_tier, previous_league_tier, movement)
     SELECT $1, f.id, f.owner_user_id IS NULL, f.current_league_tier, f.current_league_tier, 'STAY'
     FROM franchises f
     WHERE ($2::bigint IS NULL OR f.world_id = $2)
     ON CONFLICT (season_id, franchise_id) DO UPDATE
       SET is_ai = EXCLUDED.is_ai`,
    [season.id, worldId]
  );

  await generateDoubleRoundRobinFixtures(season.id, dbClient);

  return season;
}

export async function getGameBootstrapStatus(dbClient = pool, worldId = null) {
  const season = await getActiveSeason(dbClient, worldId);
  const franchiseCount = Number((await dbClient.query(
    'SELECT COUNT(*)::int AS count FROM franchises WHERE ($1::bigint IS NULL OR world_id = $1)',
    [worldId]
  )).rows[0].count);

  return {
    activeSeason: season,
    franchiseCount
  };
}
