CREATE EXTENSION IF NOT EXISTS pgcrypto;

DROP TABLE IF EXISTS transfer_feed CASCADE;
DROP TABLE IF EXISTS franchise_sales CASCADE;
DROP TABLE IF EXISTS trophy_cabinet CASCADE;
DROP TABLE IF EXISTS valuations CASCADE;
DROP TABLE IF EXISTS transactions CASCADE;
DROP TABLE IF EXISTS player_growth_logs CASCADE;
DROP TABLE IF EXISTS player_match_stats CASCADE;
DROP TABLE IF EXISTS match_events CASCADE;
DROP TABLE IF EXISTS matches CASCADE;
DROP TABLE IF EXISTS season_teams CASCADE;
DROP TABLE IF EXISTS seasons CASCADE;
DROP TABLE IF EXISTS players CASCADE;
DROP TABLE IF EXISTS regions CASCADE;
DROP TABLE IF EXISTS franchises CASCADE;
DROP TABLE IF EXISTS cities CASCADE;
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
  last_active_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

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
  city_id BIGINT NOT NULL UNIQUE REFERENCES cities(id) ON DELETE CASCADE,
  owner_user_id BIGINT UNIQUE REFERENCES users(id) ON DELETE SET NULL,
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
  current_league_tier INTEGER NOT NULL DEFAULT 4 CHECK (current_league_tier BETWEEN 1 AND 4),
  promotions INTEGER NOT NULL DEFAULT 0,
  relegations INTEGER NOT NULL DEFAULT 0,
  total_valuation NUMERIC(12, 2) NOT NULL DEFAULT 100,
  listed_for_sale_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

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
  season_number INTEGER NOT NULL,
  name TEXT NOT NULL UNIQUE,
  year INTEGER NOT NULL,
  format TEXT NOT NULL DEFAULT 'T20',
  team_count INTEGER NOT NULL,
  league_count INTEGER NOT NULL DEFAULT 4,
  teams_per_league INTEGER NOT NULL DEFAULT 13,
  status TEXT NOT NULL DEFAULT 'PLANNED' CHECK (status IN ('PLANNED', 'ACTIVE', 'COMPLETED')),
  start_date DATE,
  end_date DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE season_teams (
  id BIGSERIAL PRIMARY KEY,
  season_id BIGINT NOT NULL REFERENCES seasons(id) ON DELETE CASCADE,
  franchise_id BIGINT NOT NULL REFERENCES franchises(id) ON DELETE CASCADE,
  is_ai BOOLEAN NOT NULL DEFAULT TRUE,
  league_tier INTEGER NOT NULL DEFAULT 1 CHECK (league_tier BETWEEN 1 AND 4),
  previous_league_tier INTEGER CHECK (previous_league_tier BETWEEN 1 AND 4),
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

CREATE TABLE players (
  id BIGSERIAL PRIMARY KEY,
  franchise_id BIGINT REFERENCES franchises(id) ON DELETE SET NULL,
  region_id BIGINT REFERENCES regions(id) ON DELETE SET NULL,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  country_origin TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('BATTER', 'BOWLER', 'ALL_ROUNDER', 'WICKET_KEEPER')),
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
  squad_status TEXT NOT NULL DEFAULT 'YOUTH' CHECK (squad_status IN ('YOUTH', 'MAIN_SQUAD', 'LOANED', 'AUCTION', 'RELEASED', 'RETIRED')),
  on_loan_to_franchise_id BIGINT REFERENCES franchises(id) ON DELETE SET NULL,
  retired_at TIMESTAMPTZ,
  career_matches INTEGER NOT NULL DEFAULT 0,
  career_runs INTEGER NOT NULL DEFAULT 0,
  career_balls INTEGER NOT NULL DEFAULT 0,
  career_fours INTEGER NOT NULL DEFAULT 0,
  career_sixes INTEGER NOT NULL DEFAULT 0,
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

CREATE TABLE matches (
  id BIGSERIAL PRIMARY KEY,
  season_id BIGINT NOT NULL REFERENCES seasons(id) ON DELETE CASCADE,
  home_franchise_id BIGINT NOT NULL REFERENCES franchises(id) ON DELETE CASCADE,
  away_franchise_id BIGINT NOT NULL REFERENCES franchises(id) ON DELETE CASCADE,
  stage TEXT NOT NULL DEFAULT 'REGULAR' CHECK (stage IN ('REGULAR', 'PLAYOFF', 'FINAL')),
  league_tier INTEGER CHECK (league_tier BETWEEN 1 AND 4),
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
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX matches_season_idx ON matches(season_id, round_no);
CREATE INDEX matches_status_idx ON matches(status);

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
