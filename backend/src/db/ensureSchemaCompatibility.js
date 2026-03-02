import pool from '../config/db.js';

export async function ensureSchemaCompatibility(dbClient = pool) {
  const baseTables = await dbClient.query(
    `SELECT to_regclass('franchises') AS franchises_table,
            to_regclass('seasons') AS seasons_table,
            to_regclass('season_teams') AS season_teams_table,
            to_regclass('matches') AS matches_table`
  );

  const tablesReady =
    baseTables.rows[0]?.franchises_table &&
    baseTables.rows[0]?.seasons_table &&
    baseTables.rows[0]?.season_teams_table &&
    baseTables.rows[0]?.matches_table;

  if (!tablesReady) {
    return;
  }

  await dbClient.query("ALTER TABLE franchises ADD COLUMN IF NOT EXISTS current_league_tier INTEGER DEFAULT 4");
  await dbClient.query("ALTER TABLE franchises ADD COLUMN IF NOT EXISTS promotions INTEGER DEFAULT 0");
  await dbClient.query("ALTER TABLE franchises ADD COLUMN IF NOT EXISTS relegations INTEGER DEFAULT 0");

  await dbClient.query("ALTER TABLE seasons ADD COLUMN IF NOT EXISTS league_count INTEGER DEFAULT 4");
  await dbClient.query("ALTER TABLE seasons ADD COLUMN IF NOT EXISTS teams_per_league INTEGER DEFAULT 13");

  await dbClient.query("ALTER TABLE season_teams ADD COLUMN IF NOT EXISTS league_tier INTEGER DEFAULT 1");
  await dbClient.query("ALTER TABLE season_teams ADD COLUMN IF NOT EXISTS previous_league_tier INTEGER");
  await dbClient.query("ALTER TABLE season_teams ADD COLUMN IF NOT EXISTS movement TEXT DEFAULT 'NEW'");
  await dbClient.query("ALTER TABLE season_teams ADD COLUMN IF NOT EXISTS league_position INTEGER");

  await dbClient.query("ALTER TABLE matches ADD COLUMN IF NOT EXISTS league_tier INTEGER");
  await dbClient.query("ALTER TABLE players ADD COLUMN IF NOT EXISTS lineup_slot INTEGER");
  await dbClient.query(
    `DO $$
     BEGIN
       IF NOT EXISTS (
         SELECT 1
         FROM pg_constraint
         WHERE conname = 'players_lineup_slot_check'
       ) THEN
         ALTER TABLE players
         ADD CONSTRAINT players_lineup_slot_check CHECK (lineup_slot BETWEEN 1 AND 11);
       END IF;
     END $$;`
  );
  await dbClient.query(
    `CREATE UNIQUE INDEX IF NOT EXISTS players_franchise_lineup_slot_uidx
     ON players(franchise_id, lineup_slot)
     WHERE lineup_slot IS NOT NULL`
  );

  await dbClient.query(
    `UPDATE franchises
     SET current_league_tier = COALESCE(current_league_tier, 4),
         promotions = COALESCE(promotions, 0),
         relegations = COALESCE(relegations, 0)`
  );

  await dbClient.query(
    `UPDATE seasons
     SET league_count = COALESCE(league_count, 4),
         teams_per_league = COALESCE(teams_per_league, GREATEST(1, CEIL(team_count::numeric / 4.0)::int))`
  );

  await dbClient.query(
    `UPDATE season_teams st
     SET league_tier = COALESCE(st.league_tier, f.current_league_tier, 1),
         previous_league_tier = COALESCE(st.previous_league_tier, st.league_tier, f.current_league_tier, 1),
         movement = COALESCE(st.movement, 'NEW'),
         league_position = COALESCE(st.league_position, st.position)
     FROM franchises f
     WHERE f.id = st.franchise_id`
  );

  await dbClient.query(
    `UPDATE matches m
     SET league_tier = st.league_tier
     FROM season_teams st
     WHERE m.stage = 'REGULAR'
       AND m.league_tier IS NULL
       AND st.season_id = m.season_id
       AND st.franchise_id = m.home_franchise_id`
  );

  // Clear all lineup slots first to avoid unique-constraint conflicts during reassignment
  await dbClient.query(
    `UPDATE players SET lineup_slot = NULL WHERE lineup_slot IS NOT NULL`
  );

  await dbClient.query(
    `WITH ordered AS (
       SELECT id,
              franchise_id,
              ROW_NUMBER() OVER (PARTITION BY franchise_id ORDER BY id ASC) AS slot
       FROM players
       WHERE starting_xi = TRUE
     )
     UPDATE players p
     SET lineup_slot = o.slot::int
     FROM ordered o
     WHERE p.id = o.id
       AND o.slot <= 11`
  );

  await dbClient.query(
    `UPDATE players
     SET starting_xi = FALSE
     WHERE starting_xi = TRUE
       AND lineup_slot IS NULL`
  );
}
