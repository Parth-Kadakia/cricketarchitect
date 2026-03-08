CREATE EXTENSION IF NOT EXISTS pgcrypto;

DROP TABLE IF EXISTS transfer_feed CASCADE;
DROP TABLE IF EXISTS manager_team_stints CASCADE;
DROP TABLE IF EXISTS managers CASCADE;
DROP TABLE IF EXISTS manager_offers CASCADE;
DROP TABLE IF EXISTS board_expectations CASCADE;
DROP TABLE IF EXISTS board_profiles CASCADE;
DROP TABLE IF EXISTS manager_stints CASCADE;
DROP TABLE IF EXISTS franchise_sales CASCADE;
DROP TABLE IF EXISTS trophy_cabinet CASCADE;
DROP TABLE IF EXISTS valuations CASCADE;
DROP TABLE IF EXISTS transactions CASCADE;
DROP TABLE IF EXISTS player_growth_logs CASCADE;
DROP TABLE IF EXISTS player_match_stats CASCADE;
DROP TABLE IF EXISTS match_partnerships CASCADE;
DROP TABLE IF EXISTS match_fall_of_wickets CASCADE;
DROP TABLE IF EXISTS match_over_stats CASCADE;
DROP TABLE IF EXISTS match_innings_stats CASCADE;
DROP TABLE IF EXISTS match_events CASCADE;
DROP TABLE IF EXISTS matches CASCADE;
DROP TABLE IF EXISTS season_teams CASCADE;
DROP TABLE IF EXISTS seasons CASCADE;
DROP TABLE IF EXISTS players CASCADE;
DROP TABLE IF EXISTS regions CASCADE;
DROP TABLE IF EXISTS franchises CASCADE;
DROP TABLE IF EXISTS cities CASCADE;
DROP TABLE IF EXISTS worlds CASCADE;
DROP TABLE IF EXISTS users CASCADE;
DROP FUNCTION IF EXISTS set_updated_at() CASCADE;

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TABLE users (
  id BIGSERIAL PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  display_name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
  career_mode TEXT NOT NULL DEFAULT 'CLUB' CHECK (career_mode IN ('CLUB', 'INTERNATIONAL')),
  manager_status TEXT NOT NULL DEFAULT 'UNEMPLOYED' CHECK (manager_status IN ('ACTIVE', 'UNEMPLOYED', 'RETIRED')),
  manager_points INTEGER NOT NULL DEFAULT 0,
  manager_unemployed_since TIMESTAMPTZ,
  manager_retired_at TIMESTAMPTZ,
  manager_firings INTEGER NOT NULL DEFAULT 0,
  manager_titles INTEGER NOT NULL DEFAULT 0,
  manager_matches_managed INTEGER NOT NULL DEFAULT 0,
  manager_wins_managed INTEGER NOT NULL DEFAULT 0,
  manager_losses_managed INTEGER NOT NULL DEFAULT 0,
  active_world_id BIGINT REFERENCES worlds(id) ON DELETE SET NULL,
  last_active_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE worlds (
  id BIGSERIAL PRIMARY KEY,
  creator_user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  competition_mode TEXT NOT NULL DEFAULT 'CLUB' CHECK (competition_mode IN ('CLUB', 'INTERNATIONAL')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX worlds_creator_idx ON worlds(creator_user_id);

CREATE TABLE managers (
  id BIGSERIAL PRIMARY KEY,
  world_id BIGINT REFERENCES worlds(id) ON DELETE CASCADE,
  user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
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
);

CREATE INDEX managers_mode_idx ON managers(competition_mode, level DESC, reputation DESC);
CREATE INDEX managers_cpu_idx ON managers(is_cpu, competition_mode);
CREATE UNIQUE INDEX managers_cpu_display_name_uidx ON managers(world_id, display_name) WHERE is_cpu = TRUE;
CREATE UNIQUE INDEX managers_user_world_uidx ON managers(user_id, world_id) WHERE user_id IS NOT NULL;
CREATE INDEX managers_world_idx ON managers(world_id);

CREATE TABLE cities (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  country TEXT NOT NULL,
  latitude NUMERIC(9, 6) NOT NULL,
  longitude NUMERIC(9, 6) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (name, country)
);

CREATE TABLE franchises (
  id BIGSERIAL PRIMARY KEY,
  world_id BIGINT NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
  city_id BIGINT NOT NULL REFERENCES cities(id) ON DELETE CASCADE,
  owner_user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
  franchise_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'AVAILABLE' CHECK (status IN ('AVAILABLE', 'ACTIVE', 'AI_CONTROLLED', 'FOR_SALE')),
  academy_name TEXT NOT NULL,
  base_value NUMERIC(12, 2) NOT NULL DEFAULT 100,
  wins INTEGER NOT NULL DEFAULT 0,
  losses INTEGER NOT NULL DEFAULT 0,
  championships INTEGER NOT NULL DEFAULT 0,
  win_streak INTEGER NOT NULL DEFAULT 0,
  best_win_streak INTEGER NOT NULL DEFAULT 0,
  fan_rating NUMERIC(5, 2) NOT NULL DEFAULT 20,
  financial_balance NUMERIC(12, 2) NOT NULL DEFAULT 100,
  academy_level INTEGER NOT NULL DEFAULT 1 CHECK (academy_level BETWEEN 1 AND 10),
  youth_development_rating NUMERIC(5, 2) NOT NULL DEFAULT 20,
  prospect_points INTEGER NOT NULL DEFAULT 0,
  growth_points INTEGER NOT NULL DEFAULT 0,
  current_manager_id BIGINT REFERENCES managers(id) ON DELETE SET NULL,
  current_league_tier INTEGER NOT NULL DEFAULT 4 CHECK (current_league_tier BETWEEN 1 AND 20),
  competition_mode TEXT NOT NULL DEFAULT 'CLUB' CHECK (competition_mode IN ('CLUB', 'INTERNATIONAL')),
  promotions INTEGER NOT NULL DEFAULT 0,
  relegations INTEGER NOT NULL DEFAULT 0,
  total_valuation NUMERIC(12, 2) NOT NULL DEFAULT 100,
  listed_for_sale_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX franchises_world_city_uidx ON franchises(world_id, city_id);
CREATE UNIQUE INDEX franchises_owner_uidx ON franchises(owner_user_id) WHERE owner_user_id IS NOT NULL;
CREATE INDEX franchises_world_idx ON franchises(world_id);

CREATE TABLE regions (
  id BIGSERIAL PRIMARY KEY,
  franchise_id BIGINT NOT NULL REFERENCES franchises(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  region_country TEXT NOT NULL,
  quality_rating NUMERIC(5, 2) NOT NULL DEFAULT 20,
  coaching_investment NUMERIC(12, 2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (franchise_id, name)
);

CREATE TABLE seasons (
  id BIGSERIAL PRIMARY KEY,
  world_id BIGINT NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
  season_number INTEGER NOT NULL,
  name TEXT NOT NULL,
  year INTEGER NOT NULL,
  format TEXT NOT NULL DEFAULT 'T20',
  competition_mode TEXT NOT NULL DEFAULT 'CLUB' CHECK (competition_mode IN ('CLUB', 'INTERNATIONAL')),
  team_count INTEGER NOT NULL,
  league_count INTEGER NOT NULL DEFAULT 4,
  teams_per_league INTEGER NOT NULL DEFAULT 13,
  status TEXT NOT NULL DEFAULT 'PLANNED' CHECK (status IN ('PLANNED', 'ACTIVE', 'COMPLETED')),
  start_date DATE,
  end_date DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX seasons_world_name_uidx ON seasons(world_id, name);
CREATE INDEX seasons_world_idx ON seasons(world_id, status);

CREATE TABLE season_teams (
  id BIGSERIAL PRIMARY KEY,
  season_id BIGINT NOT NULL REFERENCES seasons(id) ON DELETE CASCADE,
  franchise_id BIGINT NOT NULL REFERENCES franchises(id) ON DELETE CASCADE,
  is_ai BOOLEAN NOT NULL DEFAULT TRUE,
  league_tier INTEGER NOT NULL DEFAULT 1 CHECK (league_tier BETWEEN 1 AND 20),
  previous_league_tier INTEGER CHECK (previous_league_tier BETWEEN 1 AND 20),
  movement TEXT NOT NULL DEFAULT 'NEW' CHECK (movement IN ('NEW', 'STAY', 'PROMOTED', 'RELEGATED')),
  played INTEGER NOT NULL DEFAULT 0,
  won INTEGER NOT NULL DEFAULT 0,
  lost INTEGER NOT NULL DEFAULT 0,
  tied INTEGER NOT NULL DEFAULT 0,
  points INTEGER NOT NULL DEFAULT 0,
  runs_for INTEGER NOT NULL DEFAULT 0,
  balls_faced INTEGER NOT NULL DEFAULT 0,
  runs_against INTEGER NOT NULL DEFAULT 0,
  balls_bowled INTEGER NOT NULL DEFAULT 0,
  net_run_rate NUMERIC(7, 3) NOT NULL DEFAULT 0,
  league_position INTEGER,
  position INTEGER,
  UNIQUE (season_id, franchise_id)
);

CREATE TABLE manager_team_stints (
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
);

CREATE UNIQUE INDEX manager_team_stints_active_manager_uidx
ON manager_team_stints(manager_id)
WHERE ended_at IS NULL;

CREATE UNIQUE INDEX manager_team_stints_active_franchise_uidx
ON manager_team_stints(franchise_id)
WHERE ended_at IS NULL;

CREATE INDEX manager_team_stints_franchise_idx ON manager_team_stints(franchise_id, started_at DESC);
CREATE INDEX manager_team_stints_manager_idx ON manager_team_stints(manager_id, started_at DESC);

CREATE TABLE manager_stints (
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
);

CREATE UNIQUE INDEX manager_stints_active_user_uidx
ON manager_stints(user_id)
WHERE ended_at IS NULL;

CREATE INDEX manager_stints_user_idx ON manager_stints(user_id, started_at DESC);

CREATE TABLE board_profiles (
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
);

CREATE INDEX board_profiles_user_idx ON board_profiles(user_id, season_id DESC);
CREATE INDEX board_profiles_active_idx ON board_profiles(user_id, is_active);

CREATE TABLE board_expectations (
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
);

CREATE INDEX board_expectations_profile_idx ON board_expectations(board_profile_id);

CREATE TABLE manager_offers (
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
);

CREATE INDEX manager_offers_user_idx ON manager_offers(user_id, status, created_at DESC);
CREATE INDEX manager_offers_team_idx ON manager_offers(franchise_id, status);

CREATE TABLE players (
  id BIGSERIAL PRIMARY KEY,
  franchise_id BIGINT REFERENCES franchises(id) ON DELETE SET NULL,
  region_id BIGINT REFERENCES regions(id) ON DELETE SET NULL,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  country_origin TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('BATTER', 'BOWLER', 'ALL_ROUNDER', 'WICKET_KEEPER')),
  batsman_type TEXT,
  batsman_hand TEXT,
  bowler_hand TEXT,
  bowler_style TEXT,
  bowler_mentality TEXT,
  batting INTEGER NOT NULL CHECK (batting BETWEEN 0 AND 100),
  bowling INTEGER NOT NULL CHECK (bowling BETWEEN 0 AND 100),
  fielding INTEGER NOT NULL CHECK (fielding BETWEEN 0 AND 100),
  fitness INTEGER NOT NULL CHECK (fitness BETWEEN 0 AND 100),
  temperament INTEGER NOT NULL CHECK (temperament BETWEEN 0 AND 100),
  potential INTEGER NOT NULL CHECK (potential BETWEEN 0 AND 100),
  age INTEGER NOT NULL CHECK (age BETWEEN 15 AND 45),
  market_value NUMERIC(12, 2) NOT NULL DEFAULT 10,
  salary NUMERIC(12, 2) NOT NULL DEFAULT 2,
  morale NUMERIC(5, 2) NOT NULL DEFAULT 30,
  form NUMERIC(5, 2) NOT NULL DEFAULT 30,
  is_youth BOOLEAN NOT NULL DEFAULT TRUE,
  starting_xi BOOLEAN NOT NULL DEFAULT FALSE,
  lineup_slot INTEGER CHECK (lineup_slot BETWEEN 1 AND 11),
  squad_status TEXT NOT NULL DEFAULT 'YOUTH' CHECK (squad_status IN ('YOUTH', 'MAIN_SQUAD', 'LOANED', 'AUCTION', 'RELEASED', 'RETIRED')),
  on_loan_to_franchise_id BIGINT REFERENCES franchises(id) ON DELETE SET NULL,
  retired_at TIMESTAMPTZ,
  career_matches INTEGER NOT NULL DEFAULT 0,
  career_runs INTEGER NOT NULL DEFAULT 0,
  career_balls INTEGER NOT NULL DEFAULT 0,
  career_fours INTEGER NOT NULL DEFAULT 0,
  career_sixes INTEGER NOT NULL DEFAULT 0,
  career_fifties INTEGER NOT NULL DEFAULT 0,
  career_hundreds INTEGER NOT NULL DEFAULT 0,
  career_wickets INTEGER NOT NULL DEFAULT 0,
  career_overs NUMERIC(8, 1) NOT NULL DEFAULT 0,
  career_runs_conceded INTEGER NOT NULL DEFAULT 0,
  career_catches INTEGER NOT NULL DEFAULT 0,
  career_player_of_match INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX players_franchise_idx ON players(franchise_id);
CREATE INDEX players_status_idx ON players(squad_status);
CREATE UNIQUE INDEX players_franchise_lineup_slot_uidx ON players(franchise_id, lineup_slot) WHERE lineup_slot IS NOT NULL;

CREATE TABLE matches (
  id BIGSERIAL PRIMARY KEY,
  season_id BIGINT NOT NULL REFERENCES seasons(id) ON DELETE CASCADE,
  home_franchise_id BIGINT NOT NULL REFERENCES franchises(id) ON DELETE CASCADE,
  away_franchise_id BIGINT NOT NULL REFERENCES franchises(id) ON DELETE CASCADE,
  stage TEXT NOT NULL DEFAULT 'REGULAR' CHECK (stage IN ('REGULAR', 'PLAYOFF', 'FINAL')),
  league_tier INTEGER CHECK (league_tier BETWEEN 1 AND 20),
  round_no INTEGER NOT NULL,
  matchday_label TEXT,
  scheduled_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'SCHEDULED' CHECK (status IN ('SCHEDULED', 'LIVE', 'COMPLETED')),
  toss_winner_franchise_id BIGINT REFERENCES franchises(id) ON DELETE SET NULL,
  toss_decision TEXT CHECK (toss_decision IN ('BAT', 'BOWL')),
  winner_franchise_id BIGINT REFERENCES franchises(id) ON DELETE SET NULL,
  player_of_match_id BIGINT REFERENCES players(id) ON DELETE SET NULL,
  home_score INTEGER,
  home_wickets INTEGER,
  home_balls INTEGER,
  away_score INTEGER,
  away_wickets INTEGER,
  away_balls INTEGER,
  result_summary TEXT,
  ai_match_analysis TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX matches_season_idx ON matches(season_id, round_no);
CREATE INDEX matches_status_idx ON matches(status);

CREATE TABLE match_innings_stats (
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
);

CREATE INDEX match_innings_stats_match_idx ON match_innings_stats(match_id, innings);

CREATE TABLE match_over_stats (
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
);

CREATE INDEX match_over_stats_match_idx ON match_over_stats(match_id, innings, over_number);

CREATE TABLE match_fall_of_wickets (
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
);

CREATE INDEX match_fow_match_idx ON match_fall_of_wickets(match_id, innings, wicket_no);

CREATE TABLE match_partnerships (
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
);

CREATE INDEX match_partnerships_match_idx ON match_partnerships(match_id, innings, partnership_no);

CREATE TABLE match_events (
  id BIGSERIAL PRIMARY KEY,
  match_id BIGINT NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  innings INTEGER NOT NULL CHECK (innings IN (1, 2)),
  over_number INTEGER NOT NULL,
  ball_number INTEGER NOT NULL,
  batting_franchise_id BIGINT NOT NULL REFERENCES franchises(id) ON DELETE CASCADE,
  bowling_franchise_id BIGINT NOT NULL REFERENCES franchises(id) ON DELETE CASCADE,
  striker_player_id BIGINT REFERENCES players(id) ON DELETE SET NULL,
  non_striker_player_id BIGINT REFERENCES players(id) ON DELETE SET NULL,
  bowler_player_id BIGINT REFERENCES players(id) ON DELETE SET NULL,
  runs INTEGER NOT NULL,
  extras INTEGER NOT NULL DEFAULT 0,
  event_type TEXT NOT NULL CHECK (event_type IN ('RUN', 'WICKET', 'EXTRA')),
  is_boundary BOOLEAN NOT NULL DEFAULT FALSE,
  is_six BOOLEAN NOT NULL DEFAULT FALSE,
  is_wicket BOOLEAN NOT NULL DEFAULT FALSE,
  commentary TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX match_events_lookup_idx ON match_events(match_id, innings, over_number, ball_number, id);

CREATE TABLE player_match_stats (
  id BIGSERIAL PRIMARY KEY,
  match_id BIGINT NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  player_id BIGINT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  franchise_id BIGINT NOT NULL REFERENCES franchises(id) ON DELETE CASCADE,
  innings INTEGER,
  batting_order INTEGER,
  batting_runs INTEGER NOT NULL DEFAULT 0,
  batting_balls INTEGER NOT NULL DEFAULT 0,
  fours INTEGER NOT NULL DEFAULT 0,
  sixes INTEGER NOT NULL DEFAULT 0,
  dismissal_text TEXT,
  not_out BOOLEAN NOT NULL DEFAULT TRUE,
  bowling_balls INTEGER NOT NULL DEFAULT 0,
  bowling_runs INTEGER NOT NULL DEFAULT 0,
  bowling_wickets INTEGER NOT NULL DEFAULT 0,
  maiden_overs INTEGER NOT NULL DEFAULT 0,
  catches INTEGER NOT NULL DEFAULT 0,
  run_outs INTEGER NOT NULL DEFAULT 0,
  player_rating NUMERIC(6, 2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (match_id, player_id)
);

CREATE INDEX player_match_stats_match_idx ON player_match_stats(match_id, franchise_id);
CREATE INDEX player_match_stats_player_idx ON player_match_stats(player_id, created_at DESC);

CREATE TABLE player_growth_logs (
  id BIGSERIAL PRIMARY KEY,
  player_id BIGINT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  season_id BIGINT REFERENCES seasons(id) ON DELETE SET NULL,
  batting_delta INTEGER NOT NULL,
  bowling_delta INTEGER NOT NULL,
  fielding_delta INTEGER NOT NULL,
  fitness_delta INTEGER NOT NULL,
  temperament_delta INTEGER NOT NULL,
  market_value_delta NUMERIC(12, 2) NOT NULL,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE transactions (
  id BIGSERIAL PRIMARY KEY,
  franchise_id BIGINT NOT NULL REFERENCES franchises(id) ON DELETE CASCADE,
  transaction_type TEXT NOT NULL CHECK (
    transaction_type IN ('SALARY', 'TRANSFER_IN', 'TRANSFER_OUT', 'LOAN', 'SPONSORSHIP', 'PRIZE_MONEY', 'SALE', 'PURCHASE', 'ACADEMY_UPGRADE', 'POINT_REWARD')
  ),
  amount NUMERIC(12, 2) NOT NULL,
  description TEXT,
  related_player_id BIGINT REFERENCES players(id) ON DELETE SET NULL,
  related_franchise_id BIGINT REFERENCES franchises(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX transactions_franchise_idx ON transactions(franchise_id, created_at DESC);

CREATE TABLE valuations (
  id BIGSERIAL PRIMARY KEY,
  franchise_id BIGINT NOT NULL REFERENCES franchises(id) ON DELETE CASCADE,
  season_id BIGINT REFERENCES seasons(id) ON DELETE SET NULL,
  base_value NUMERIC(12, 2) NOT NULL,
  win_bonus NUMERIC(12, 2) NOT NULL,
  streak_bonus NUMERIC(12, 2) NOT NULL,
  cup_bonus NUMERIC(12, 2) NOT NULL,
  fan_bonus NUMERIC(12, 2) NOT NULL,
  player_bonus NUMERIC(12, 2) NOT NULL,
  total_value NUMERIC(12, 2) NOT NULL,
  calculated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX valuations_franchise_idx ON valuations(franchise_id, calculated_at DESC);

CREATE TABLE trophy_cabinet (
  id BIGSERIAL PRIMARY KEY,
  franchise_id BIGINT NOT NULL REFERENCES franchises(id) ON DELETE CASCADE,
  season_id BIGINT REFERENCES seasons(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  won_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE franchise_sales (
  id BIGSERIAL PRIMARY KEY,
  franchise_id BIGINT NOT NULL REFERENCES franchises(id) ON DELETE CASCADE,
  seller_user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
  buyer_user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
  sale_value NUMERIC(12, 2) NOT NULL,
  sold_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE transfer_feed (
  id BIGSERIAL PRIMARY KEY,
  season_id BIGINT REFERENCES seasons(id) ON DELETE SET NULL,
  action_type TEXT NOT NULL CHECK (action_type IN ('CPU_SELL', 'CPU_BUY', 'LOAN_REQUEST', 'RETIREMENT', 'TRANSFER', 'SEASON_NOTE')),
  source_franchise_id BIGINT REFERENCES franchises(id) ON DELETE SET NULL,
  target_franchise_id BIGINT REFERENCES franchises(id) ON DELETE SET NULL,
  player_id BIGINT REFERENCES players(id) ON DELETE SET NULL,
  message TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX transfer_feed_created_idx ON transfer_feed(created_at DESC);

CREATE TRIGGER users_set_updated_at
BEFORE UPDATE ON users
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER franchises_set_updated_at
BEFORE UPDATE ON franchises
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER players_set_updated_at
BEFORE UPDATE ON players
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER matches_set_updated_at
BEFORE UPDATE ON matches
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER manager_stints_set_updated_at
BEFORE UPDATE ON manager_stints
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER board_profiles_set_updated_at
BEFORE UPDATE ON board_profiles
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER board_expectations_set_updated_at
BEFORE UPDATE ON board_expectations
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER manager_offers_set_updated_at
BEFORE UPDATE ON manager_offers
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER managers_set_updated_at
BEFORE UPDATE ON managers
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER manager_team_stints_set_updated_at
BEFORE UPDATE ON manager_team_stints
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();
