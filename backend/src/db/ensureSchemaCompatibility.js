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
  await dbClient.query("ALTER TABLE franchises ADD COLUMN IF NOT EXISTS competition_mode TEXT DEFAULT 'CLUB'");

  await dbClient.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS career_mode TEXT DEFAULT 'CLUB'");

  await dbClient.query("ALTER TABLE seasons ADD COLUMN IF NOT EXISTS league_count INTEGER DEFAULT 4");
  await dbClient.query("ALTER TABLE seasons ADD COLUMN IF NOT EXISTS teams_per_league INTEGER DEFAULT 13");
  await dbClient.query("ALTER TABLE seasons ADD COLUMN IF NOT EXISTS competition_mode TEXT DEFAULT 'CLUB'");

  await dbClient.query("ALTER TABLE season_teams ADD COLUMN IF NOT EXISTS league_tier INTEGER DEFAULT 1");
  await dbClient.query("ALTER TABLE season_teams ADD COLUMN IF NOT EXISTS previous_league_tier INTEGER");
  await dbClient.query("ALTER TABLE season_teams ADD COLUMN IF NOT EXISTS movement TEXT DEFAULT 'NEW'");
  await dbClient.query("ALTER TABLE season_teams ADD COLUMN IF NOT EXISTS league_position INTEGER");

  await dbClient.query("ALTER TABLE matches ADD COLUMN IF NOT EXISTS league_tier INTEGER");
  await dbClient.query("ALTER TABLE matches ADD COLUMN IF NOT EXISTS ai_match_analysis TEXT");
  await dbClient.query("ALTER TABLE players ADD COLUMN IF NOT EXISTS lineup_slot INTEGER");
  await dbClient.query("ALTER TABLE players ADD COLUMN IF NOT EXISTS career_fifties INTEGER DEFAULT 0");
  await dbClient.query("ALTER TABLE players ADD COLUMN IF NOT EXISTS career_hundreds INTEGER DEFAULT 0");
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
    `CREATE TABLE IF NOT EXISTS match_innings_stats (
       id BIGSERIAL PRIMARY KEY,
       match_id BIGINT NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
       innings INTEGER NOT NULL CHECK (innings IN (1, 2)),
       batting_franchise_id BIGINT NOT NULL REFERENCES franchises(id) ON DELETE CASCADE,
       bowling_franchise_id BIGINT NOT NULL REFERENCES franchises(id) ON DELETE CASCADE,
       total_runs INTEGER NOT NULL DEFAULT 0,
       wickets INTEGER NOT NULL DEFAULT 0,
       balls INTEGER NOT NULL DEFAULT 0,
       run_rate NUMERIC(7, 2) NOT NULL DEFAULT 0,
       target_runs INTEGER,
       required_rate NUMERIC(7, 2),
       summary_text TEXT,
       created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
       UNIQUE (match_id, innings)
     )`
  );
  await dbClient.query(
    `CREATE INDEX IF NOT EXISTS match_innings_stats_match_idx
     ON match_innings_stats(match_id, innings)`
  );

  await dbClient.query(
    `CREATE TABLE IF NOT EXISTS match_over_stats (
       id BIGSERIAL PRIMARY KEY,
       match_id BIGINT NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
       innings INTEGER NOT NULL CHECK (innings IN (1, 2)),
       over_number INTEGER NOT NULL CHECK (over_number BETWEEN 1 AND 50),
       runs_in_over INTEGER NOT NULL DEFAULT 0,
       wickets_in_over INTEGER NOT NULL DEFAULT 0,
       cumulative_runs INTEGER NOT NULL DEFAULT 0,
       cumulative_wickets INTEGER NOT NULL DEFAULT 0,
       required_runs INTEGER,
       balls_remaining INTEGER,
       required_rate NUMERIC(7, 2),
       summary_text TEXT,
       created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
       UNIQUE (match_id, innings, over_number)
     )`
  );
  await dbClient.query(
    `CREATE INDEX IF NOT EXISTS match_over_stats_match_idx
     ON match_over_stats(match_id, innings, over_number)`
  );

  await dbClient.query(
    `CREATE TABLE IF NOT EXISTS match_fall_of_wickets (
       id BIGSERIAL PRIMARY KEY,
       match_id BIGINT NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
       innings INTEGER NOT NULL CHECK (innings IN (1, 2)),
       wicket_no INTEGER NOT NULL CHECK (wicket_no BETWEEN 1 AND 10),
       score_at_fall INTEGER NOT NULL DEFAULT 0,
       ball_number INTEGER,
       over_label TEXT,
       batter_player_id BIGINT REFERENCES players(id) ON DELETE SET NULL,
       batter_name TEXT,
       dismissal_text TEXT,
       created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
       UNIQUE (match_id, innings, wicket_no)
     )`
  );
  await dbClient.query(
    `CREATE INDEX IF NOT EXISTS match_fow_match_idx
     ON match_fall_of_wickets(match_id, innings, wicket_no)`
  );

  await dbClient.query(
    `CREATE TABLE IF NOT EXISTS match_partnerships (
       id BIGSERIAL PRIMARY KEY,
       match_id BIGINT NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
       innings INTEGER NOT NULL CHECK (innings IN (1, 2)),
       partnership_no INTEGER NOT NULL CHECK (partnership_no BETWEEN 1 AND 10),
       runs INTEGER NOT NULL DEFAULT 0,
       balls INTEGER NOT NULL DEFAULT 0,
       batter_one_player_id BIGINT REFERENCES players(id) ON DELETE SET NULL,
       batter_one_name TEXT,
       batter_one_runs INTEGER NOT NULL DEFAULT 0,
       batter_two_player_id BIGINT REFERENCES players(id) ON DELETE SET NULL,
       batter_two_name TEXT,
       batter_two_runs INTEGER NOT NULL DEFAULT 0,
       created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
       UNIQUE (match_id, innings, partnership_no)
     )`
  );
  await dbClient.query(
    `CREATE INDEX IF NOT EXISTS match_partnerships_match_idx
     ON match_partnerships(match_id, innings, partnership_no)`
  );

  await dbClient.query("ALTER TABLE franchises DROP CONSTRAINT IF EXISTS franchises_current_league_tier_check");
  await dbClient.query("ALTER TABLE season_teams DROP CONSTRAINT IF EXISTS season_teams_league_tier_check");
  await dbClient.query("ALTER TABLE season_teams DROP CONSTRAINT IF EXISTS season_teams_previous_league_tier_check");
  await dbClient.query("ALTER TABLE matches DROP CONSTRAINT IF EXISTS matches_league_tier_check");

  await dbClient.query(
    `DO $$
     BEGIN
       IF NOT EXISTS (
         SELECT 1
         FROM pg_constraint
         WHERE conname = 'franchises_current_league_tier_check'
       ) THEN
         ALTER TABLE franchises
         ADD CONSTRAINT franchises_current_league_tier_check CHECK (current_league_tier BETWEEN 1 AND 20);
       END IF;
     END $$;`
  );

  await dbClient.query(
    `DO $$
     BEGIN
       IF NOT EXISTS (
         SELECT 1
         FROM pg_constraint
         WHERE conname = 'season_teams_league_tier_check'
       ) THEN
         ALTER TABLE season_teams
         ADD CONSTRAINT season_teams_league_tier_check CHECK (league_tier BETWEEN 1 AND 20);
       END IF;
     END $$;`
  );

  await dbClient.query(
    `DO $$
     BEGIN
       IF NOT EXISTS (
         SELECT 1
         FROM pg_constraint
         WHERE conname = 'season_teams_previous_league_tier_check'
       ) THEN
         ALTER TABLE season_teams
         ADD CONSTRAINT season_teams_previous_league_tier_check CHECK (
           previous_league_tier IS NULL OR previous_league_tier BETWEEN 1 AND 20
         );
       END IF;
     END $$;`
  );

  await dbClient.query(
    `DO $$
     BEGIN
       IF NOT EXISTS (
         SELECT 1
         FROM pg_constraint
         WHERE conname = 'matches_league_tier_check'
       ) THEN
         ALTER TABLE matches
         ADD CONSTRAINT matches_league_tier_check CHECK (league_tier IS NULL OR league_tier BETWEEN 1 AND 20);
       END IF;
     END $$;`
  );

  await dbClient.query(
    `DO $$
     BEGIN
       IF NOT EXISTS (
         SELECT 1
         FROM pg_constraint
         WHERE conname = 'franchises_competition_mode_check'
       ) THEN
         ALTER TABLE franchises
         ADD CONSTRAINT franchises_competition_mode_check CHECK (competition_mode IN ('CLUB', 'INTERNATIONAL'));
       END IF;
     END $$;`
  );

  await dbClient.query(
    `DO $$
     BEGIN
       IF NOT EXISTS (
         SELECT 1
         FROM pg_constraint
         WHERE conname = 'seasons_competition_mode_check'
       ) THEN
         ALTER TABLE seasons
         ADD CONSTRAINT seasons_competition_mode_check CHECK (competition_mode IN ('CLUB', 'INTERNATIONAL'));
       END IF;
     END $$;`
  );

  await dbClient.query(
    `DO $$
     BEGIN
       IF NOT EXISTS (
         SELECT 1
         FROM pg_constraint
         WHERE conname = 'users_career_mode_check'
       ) THEN
         ALTER TABLE users
         ADD CONSTRAINT users_career_mode_check CHECK (career_mode IN ('CLUB', 'INTERNATIONAL'));
       END IF;
     END $$;`
  );

  await dbClient.query(
    `UPDATE franchises
     SET current_league_tier = COALESCE(current_league_tier, 4),
         promotions = COALESCE(promotions, 0),
         relegations = COALESCE(relegations, 0),
         competition_mode = COALESCE(NULLIF(competition_mode, ''), 'CLUB')`
  );

  await dbClient.query(
    `UPDATE users
     SET career_mode = COALESCE(NULLIF(career_mode, ''), 'CLUB')`
  );

  await dbClient.query(
    `UPDATE seasons
     SET competition_mode = COALESCE(NULLIF(competition_mode, ''), 'CLUB'),
         league_count = COALESCE(league_count, CASE WHEN COALESCE(NULLIF(competition_mode, ''), 'CLUB') = 'INTERNATIONAL' THEN 10 ELSE 4 END),
         teams_per_league = COALESCE(teams_per_league, GREATEST(1, CEIL(team_count::numeric / GREATEST(1, COALESCE(league_count, CASE WHEN COALESCE(NULLIF(competition_mode, ''), 'CLUB') = 'INTERNATIONAL' THEN 10 ELSE 4 END))::numeric)::int))`
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

  await dbClient.query(
    `UPDATE players
     SET career_fifties = COALESCE(career_fifties, 0),
         career_hundreds = COALESCE(career_hundreds, 0)`
  );

  const playerMatchStatsTable = await dbClient.query(
    `SELECT to_regclass('player_match_stats') AS table_name`
  );
  if (playerMatchStatsTable.rows[0]?.table_name) {
    await dbClient.query(
      `WITH milestones AS (
         SELECT player_id,
                COALESCE(SUM(CASE WHEN batting_runs BETWEEN 50 AND 99 THEN 1 ELSE 0 END), 0)::int AS fifties,
                COALESCE(SUM(CASE WHEN batting_runs >= 100 THEN 1 ELSE 0 END), 0)::int AS hundreds
         FROM player_match_stats
         GROUP BY player_id
       )
       UPDATE players p
       SET career_fifties = COALESCE(m.fifties, 0),
           career_hundreds = COALESCE(m.hundreds, 0)
       FROM milestones m
       WHERE p.id = m.player_id`
    );
  }

  await dbClient.query(
    `UPDATE franchises f
     SET franchise_name = c.country
     FROM cities c
     WHERE c.id = f.city_id
       AND COALESCE(f.competition_mode, 'CLUB') = 'INTERNATIONAL'
       AND (
         f.franchise_name IS NULL
         OR BTRIM(f.franchise_name) = ''
         OR f.franchise_name ~* ' National Team$'
       )`
  );
}
