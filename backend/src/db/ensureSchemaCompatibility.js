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
  await dbClient.query("ALTER TABLE franchises ADD COLUMN IF NOT EXISTS current_manager_id BIGINT");

  await dbClient.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS career_mode TEXT DEFAULT 'CLUB'");
  await dbClient.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS manager_status TEXT DEFAULT 'UNEMPLOYED'");
  await dbClient.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS manager_points INTEGER DEFAULT 0");
  await dbClient.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS manager_unemployed_since TIMESTAMPTZ");
  await dbClient.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS manager_retired_at TIMESTAMPTZ");
  await dbClient.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS manager_firings INTEGER DEFAULT 0");
  await dbClient.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS manager_titles INTEGER DEFAULT 0");
  await dbClient.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS manager_matches_managed INTEGER DEFAULT 0");
  await dbClient.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS manager_wins_managed INTEGER DEFAULT 0");
  await dbClient.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS manager_losses_managed INTEGER DEFAULT 0");

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
  await dbClient.query("ALTER TABLE players ADD COLUMN IF NOT EXISTS batsman_type TEXT");
  await dbClient.query("ALTER TABLE players ADD COLUMN IF NOT EXISTS batsman_hand TEXT");
  await dbClient.query("ALTER TABLE players ADD COLUMN IF NOT EXISTS bowler_hand TEXT");
  await dbClient.query("ALTER TABLE players ADD COLUMN IF NOT EXISTS bowler_style TEXT");
  await dbClient.query("ALTER TABLE players ADD COLUMN IF NOT EXISTS bowler_mentality TEXT");
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
    `UPDATE players
     SET batsman_hand = COALESCE(
           NULLIF(TRIM(batsman_hand), ''),
           CASE WHEN MOD(id, 4) = 0 THEN 'Left' ELSE 'Right' END
         ),
         bowler_hand = COALESCE(
           NULLIF(TRIM(bowler_hand), ''),
           CASE
             WHEN role IN ('BOWLER', 'ALL_ROUNDER') AND MOD(id, 3) = 0 THEN 'Left'
             WHEN role IN ('BOWLER', 'ALL_ROUNDER') THEN 'Right'
             WHEN MOD(id, 4) = 0 THEN 'Left'
             ELSE 'Right'
           END
         ),
         batsman_type = COALESCE(
           NULLIF(TRIM(batsman_type), ''),
           CASE
             WHEN role = 'BOWLER' AND batting <= 22 THEN 'Tail ender'
             WHEN role = 'BOWLER' THEN 'Defensive'
             WHEN role = 'WICKET_KEEPER' AND batting >= 58 AND temperament >= 54 THEN 'Accumulator'
             WHEN role = 'WICKET_KEEPER' AND batting <= 22 THEN 'Defensive'
             WHEN role = 'WICKET_KEEPER' THEN 'Balanced'
             WHEN role = 'ALL_ROUNDER' AND batting >= 62 AND temperament <= 54 THEN 'Aggressive'
             WHEN role = 'ALL_ROUNDER' AND temperament >= 64 THEN 'Accumulator'
             WHEN role = 'ALL_ROUNDER' AND batting <= 24 THEN 'Defensive'
             WHEN role = 'BATTER' AND batting >= 60 AND temperament <= 52 THEN 'Aggressive'
             WHEN role = 'BATTER' AND temperament >= 64 THEN 'Accumulator'
             WHEN role = 'BATTER' AND batting <= 22 THEN 'Defensive'
             ELSE 'Balanced'
           END
         ),
         bowler_style = COALESCE(
           NULLIF(TRIM(bowler_style), ''),
           CASE
             WHEN role = 'WICKET_KEEPER' THEN 'Off-Spin Bowler'
             WHEN role = 'BATTER' THEN 'Medium Pace Bowler (Seam Bowler)'
             WHEN bowling >= 82 THEN 'Fast Bowler (Express Pace)'
             WHEN bowling >= 74 THEN 'Fast-Medium Bowler'
             WHEN bowling >= 67 THEN 'Swing Bowler'
             WHEN bowling >= 60 AND (
               COALESCE(NULLIF(TRIM(bowler_hand), ''), CASE WHEN MOD(id, 3) = 0 THEN 'Left' ELSE 'Right' END) = 'Left'
             ) THEN 'Slow Left-Arm Orthodox'
             WHEN bowling >= 60 THEN 'Off-Spin Bowler'
             WHEN bowling >= 48 AND (
               COALESCE(NULLIF(TRIM(bowler_hand), ''), CASE WHEN MOD(id, 3) = 0 THEN 'Left' ELSE 'Right' END) = 'Left'
             ) THEN 'Slow Left-Arm Orthodox'
             WHEN bowling >= 48 THEN 'Leg-Spin Bowler (including Chinaman)'
             ELSE 'Medium Pace Bowler (Seam Bowler)'
           END
         ),
         bowler_mentality = COALESCE(
           NULLIF(TRIM(bowler_mentality), ''),
           CASE
             WHEN role IN ('BATTER', 'WICKET_KEEPER') THEN 'Economical'
             WHEN role = 'ALL_ROUNDER' AND bowling >= 70 THEN 'Wicket Taker'
             WHEN role = 'ALL_ROUNDER' THEN 'Economical'
             WHEN bowling >= 80 THEN 'Wicket Taker'
             WHEN fitness >= 72 THEN 'Death Over Specialist'
             WHEN temperament >= 70 THEN 'Economical'
             ELSE 'Powerplay Specialist'
           END
         )`
  );

  await dbClient.query(
    `UPDATE players
     SET batsman_type = CASE
       WHEN role = 'BATTER' THEN
         CASE
           WHEN random() < 0.55 THEN 'Balanced'
           WHEN random() < 0.82 THEN 'Accumulator'
           ELSE 'Aggressive'
         END
       WHEN role = 'WICKET_KEEPER' THEN
         CASE
           WHEN random() < 0.68 THEN 'Balanced'
           ELSE 'Accumulator'
         END
       WHEN role = 'ALL_ROUNDER' THEN
         CASE
           WHEN random() < 0.62 THEN 'Balanced'
           WHEN random() < 0.86 THEN 'Accumulator'
           ELSE 'Aggressive'
         END
       ELSE batsman_type
     END
     WHERE role IN ('BATTER', 'WICKET_KEEPER', 'ALL_ROUNDER')
       AND batsman_type = 'Defensive'
       AND batting >= 30`
  );

  await dbClient.query(
    `CREATE TABLE IF NOT EXISTS managers (
       id BIGSERIAL PRIMARY KEY,
       user_id BIGINT UNIQUE REFERENCES users(id) ON DELETE SET NULL,
       display_name TEXT NOT NULL,
       nationality TEXT,
       competition_mode TEXT NOT NULL DEFAULT 'CLUB' CHECK (competition_mode IN ('CLUB', 'INTERNATIONAL')),
       is_cpu BOOLEAN NOT NULL DEFAULT TRUE,
       level INTEGER NOT NULL DEFAULT 1 CHECK (level BETWEEN 1 AND 100),
       xp INTEGER NOT NULL DEFAULT 0,
       reputation INTEGER NOT NULL DEFAULT 10,
       seasons_managed INTEGER NOT NULL DEFAULT 0,
       matches_managed INTEGER NOT NULL DEFAULT 0,
       wins_managed INTEGER NOT NULL DEFAULT 0,
       losses_managed INTEGER NOT NULL DEFAULT 0,
       titles_won INTEGER NOT NULL DEFAULT 0,
       created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
       updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
     )`
  );
  await dbClient.query(
    `CREATE INDEX IF NOT EXISTS managers_mode_idx
     ON managers(competition_mode, level DESC, reputation DESC)`
  );
  await dbClient.query(
    `CREATE INDEX IF NOT EXISTS managers_cpu_idx
     ON managers(is_cpu, competition_mode)`
  );
  await dbClient.query(
    `CREATE UNIQUE INDEX IF NOT EXISTS managers_cpu_display_name_uidx
     ON managers(display_name) WHERE is_cpu = TRUE`
  );

  await dbClient.query(
    `CREATE TABLE IF NOT EXISTS manager_team_stints (
       id BIGSERIAL PRIMARY KEY,
       manager_id BIGINT NOT NULL REFERENCES managers(id) ON DELETE CASCADE,
       franchise_id BIGINT NOT NULL REFERENCES franchises(id) ON DELETE CASCADE,
       competition_mode TEXT NOT NULL DEFAULT 'CLUB' CHECK (competition_mode IN ('CLUB', 'INTERNATIONAL')),
       season_id BIGINT REFERENCES seasons(id) ON DELETE SET NULL,
       started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
       ended_at TIMESTAMPTZ,
       end_reason TEXT,
       matches_managed INTEGER NOT NULL DEFAULT 0,
       wins INTEGER NOT NULL DEFAULT 0,
       losses INTEGER NOT NULL DEFAULT 0,
       created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
       updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
     )`
  );
  await dbClient.query(
    `CREATE UNIQUE INDEX IF NOT EXISTS manager_team_stints_active_manager_uidx
     ON manager_team_stints(manager_id)
     WHERE ended_at IS NULL`
  );
  await dbClient.query(
    `CREATE UNIQUE INDEX IF NOT EXISTS manager_team_stints_active_franchise_uidx
     ON manager_team_stints(franchise_id)
     WHERE ended_at IS NULL`
  );
  await dbClient.query(
    `CREATE INDEX IF NOT EXISTS manager_team_stints_franchise_idx
     ON manager_team_stints(franchise_id, started_at DESC)`
  );
  await dbClient.query(
    `CREATE INDEX IF NOT EXISTS manager_team_stints_manager_idx
     ON manager_team_stints(manager_id, started_at DESC)`
  );

  await dbClient.query(
    `CREATE TABLE IF NOT EXISTS manager_stints (
       id BIGSERIAL PRIMARY KEY,
       user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
       franchise_id BIGINT REFERENCES franchises(id) ON DELETE SET NULL,
       competition_mode TEXT NOT NULL DEFAULT 'CLUB' CHECK (competition_mode IN ('CLUB', 'INTERNATIONAL')),
       started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
       ended_at TIMESTAMPTZ,
       end_reason TEXT,
       matches_managed INTEGER NOT NULL DEFAULT 0,
       wins INTEGER NOT NULL DEFAULT 0,
       losses INTEGER NOT NULL DEFAULT 0,
       created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
       updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
     )`
  );
  await dbClient.query(
    `CREATE UNIQUE INDEX IF NOT EXISTS manager_stints_active_user_uidx
     ON manager_stints(user_id)
     WHERE ended_at IS NULL`
  );
  await dbClient.query(
    `CREATE INDEX IF NOT EXISTS manager_stints_user_idx
     ON manager_stints(user_id, started_at DESC)`
  );

  await dbClient.query(
    `CREATE TABLE IF NOT EXISTS board_profiles (
       id BIGSERIAL PRIMARY KEY,
       season_id BIGINT NOT NULL REFERENCES seasons(id) ON DELETE CASCADE,
       franchise_id BIGINT NOT NULL REFERENCES franchises(id) ON DELETE CASCADE,
       user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
       confidence INTEGER NOT NULL DEFAULT 62 CHECK (confidence BETWEEN 0 AND 100),
       last_checkpoint_round INTEGER NOT NULL DEFAULT 0,
       consecutive_failed_checkpoints INTEGER NOT NULL DEFAULT 0,
       season_evaluated_at TIMESTAMPTZ,
       is_active BOOLEAN NOT NULL DEFAULT TRUE,
       created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
       updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
       UNIQUE (season_id, franchise_id, user_id)
     )`
  );
  await dbClient.query(
    `CREATE INDEX IF NOT EXISTS board_profiles_user_idx
     ON board_profiles(user_id, season_id DESC)`
  );
  await dbClient.query(
    `CREATE INDEX IF NOT EXISTS board_profiles_active_idx
     ON board_profiles(user_id, is_active)`
  );

  await dbClient.query(
    `CREATE TABLE IF NOT EXISTS board_expectations (
       id BIGSERIAL PRIMARY KEY,
       board_profile_id BIGINT NOT NULL REFERENCES board_profiles(id) ON DELETE CASCADE,
       objective_code TEXT NOT NULL,
       is_major BOOLEAN NOT NULL DEFAULT FALSE,
       target_value NUMERIC(10, 2) NOT NULL DEFAULT 0,
       progress_value NUMERIC(10, 2) NOT NULL DEFAULT 0,
       weight NUMERIC(6, 2) NOT NULL DEFAULT 1,
       status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'IN_PROGRESS', 'COMPLETED', 'FAILED')),
       created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
       updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
       UNIQUE (board_profile_id, objective_code)
     )`
  );
  await dbClient.query(
    `CREATE INDEX IF NOT EXISTS board_expectations_profile_idx
     ON board_expectations(board_profile_id)`
  );

  await dbClient.query(
    `CREATE TABLE IF NOT EXISTS manager_offers (
       id BIGSERIAL PRIMARY KEY,
       user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
       franchise_id BIGINT NOT NULL REFERENCES franchises(id) ON DELETE CASCADE,
       season_id BIGINT REFERENCES seasons(id) ON DELETE SET NULL,
       offer_score NUMERIC(10, 2) NOT NULL DEFAULT 0,
       generated_round INTEGER,
       expires_round INTEGER,
       status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'ACCEPTED', 'DECLINED', 'EXPIRED', 'WITHDRAWN')),
       created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
       updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
     )`
  );
  await dbClient.query(
    `CREATE INDEX IF NOT EXISTS manager_offers_user_idx
     ON manager_offers(user_id, status, created_at DESC)`
  );
  await dbClient.query(
    `CREATE INDEX IF NOT EXISTS manager_offers_team_idx
     ON manager_offers(franchise_id, status)`
  );

  await dbClient.query(
    `DO $$
     BEGIN
       IF NOT EXISTS (
         SELECT 1
         FROM pg_constraint
         WHERE conname = 'franchises_current_manager_fk'
       ) THEN
         ALTER TABLE franchises
         ADD CONSTRAINT franchises_current_manager_fk
         FOREIGN KEY (current_manager_id) REFERENCES managers(id) ON DELETE SET NULL;
       END IF;
     END $$;`
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
         WHERE conname = 'users_manager_status_check'
       ) THEN
         ALTER TABLE users
         ADD CONSTRAINT users_manager_status_check CHECK (manager_status IN ('ACTIVE', 'UNEMPLOYED', 'RETIRED'));
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
    `UPDATE users u
     SET manager_status = CASE
       WHEN COALESCE(NULLIF(u.manager_status, ''), 'UNEMPLOYED') = 'RETIRED' THEN 'RETIRED'
       WHEN EXISTS (
         SELECT 1 FROM franchises f
         WHERE f.owner_user_id = u.id
       ) THEN 'ACTIVE'
       ELSE 'UNEMPLOYED'
     END,
     manager_points = COALESCE(u.manager_points, 0),
     manager_firings = COALESCE(u.manager_firings, 0),
     manager_titles = COALESCE(u.manager_titles, 0),
     manager_matches_managed = COALESCE(u.manager_matches_managed, 0),
     manager_wins_managed = COALESCE(u.manager_wins_managed, 0),
     manager_losses_managed = COALESCE(u.manager_losses_managed, 0),
     manager_unemployed_since = CASE
       WHEN COALESCE(NULLIF(u.manager_status, ''), 'UNEMPLOYED') = 'RETIRED' THEN NULL
       WHEN EXISTS (SELECT 1 FROM franchises f WHERE f.owner_user_id = u.id) THEN NULL
       ELSE COALESCE(u.manager_unemployed_since, NOW())
     END`
  );

  await dbClient.query(
    `INSERT INTO managers (user_id, display_name, nationality, competition_mode, is_cpu, level, xp, reputation)
     SELECT u.id,
            u.display_name,
            NULL,
            COALESCE(NULLIF(u.career_mode, ''), 'CLUB'),
            FALSE,
            1,
            0,
            10
     FROM users u
     LEFT JOIN managers m ON m.user_id = u.id
     WHERE m.id IS NULL
       AND u.role <> 'admin'`
  );

  await dbClient.query(
    `UPDATE franchises f
     SET current_manager_id = m.id
     FROM managers m
     WHERE f.owner_user_id = m.user_id
       AND f.current_manager_id IS NULL`
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

  await dbClient.query(
    `WITH needs_rebuild AS (
       SELECT franchise_id
       FROM players
       GROUP BY franchise_id
       HAVING COUNT(*) FILTER (WHERE starting_xi = TRUE) > 0
          AND COUNT(*) FILTER (WHERE starting_xi = TRUE AND lineup_slot IS NOT NULL) = 0
     ),
     ordered AS (
       SELECT p.id,
              p.franchise_id,
              ROW_NUMBER() OVER (PARTITION BY p.franchise_id ORDER BY p.id ASC) AS slot
       FROM players p
       JOIN needs_rebuild nr ON nr.franchise_id = p.franchise_id
       WHERE p.starting_xi = TRUE
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
    `INSERT INTO manager_stints (user_id, franchise_id, competition_mode, started_at, matches_managed, wins, losses)
     SELECT u.id,
            f.id,
            COALESCE(NULLIF(f.competition_mode, ''), COALESCE(NULLIF(u.career_mode, ''), 'CLUB')),
            COALESCE(f.updated_at, NOW()),
            0,
            0,
            0
     FROM users u
     JOIN franchises f ON f.owner_user_id = u.id
     LEFT JOIN manager_stints ms ON ms.user_id = u.id AND ms.ended_at IS NULL
     WHERE ms.id IS NULL
       AND COALESCE(NULLIF(u.manager_status, ''), 'UNEMPLOYED') = 'ACTIVE'`
  );

  await dbClient.query(
    `INSERT INTO manager_team_stints (manager_id, franchise_id, competition_mode, season_id, started_at, matches_managed, wins, losses)
     SELECT f.current_manager_id,
            f.id,
            COALESCE(NULLIF(f.competition_mode, ''), 'CLUB'),
            s.id,
            COALESCE(f.updated_at, NOW()),
            0,
            0,
            0
     FROM franchises f
     LEFT JOIN seasons s ON s.status = 'ACTIVE'
     LEFT JOIN manager_team_stints mts ON mts.franchise_id = f.id AND mts.ended_at IS NULL
     WHERE f.current_manager_id IS NOT NULL
       AND mts.id IS NULL`
  );

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
