import pool from '../config/db.js';
import { processSeasonRetirements } from './retirementService.js';
import { CAREER_MODES, normalizeCareerMode } from '../constants/gameModes.js';
import { ensureManagerBoardProfilesForSeason } from './managerCareerService.js';

const DEFAULT_LEAGUE_TEAM_COUNT = 52;
const DEFAULT_INTERNATIONAL_TEAM_COUNT = 100;
const DEFAULT_CLUB_LEAGUE_COUNT = 4;
const DEFAULT_INTERNATIONAL_LEAGUE_COUNT = 10;
const PROMOTION_SPOTS = 2;

function resolveLeagueCount(competitionMode, requestedLeagueCount = null) {
  const mode = normalizeCareerMode(competitionMode || CAREER_MODES.CLUB);
  const fallback = mode === CAREER_MODES.INTERNATIONAL ? DEFAULT_INTERNATIONAL_LEAGUE_COUNT : DEFAULT_CLUB_LEAGUE_COUNT;
  const parsed = Number(requestedLeagueCount || 0);
  return parsed > 0 ? parsed : fallback;
}

function shouldUseDoubleRoundRobin(competitionMode) {
  return normalizeCareerMode(competitionMode || CAREER_MODES.CLUB) === CAREER_MODES.CLUB;
}

function generateRoundRobin(teamIds) {
  const teams = [...teamIds];
  if (teams.length % 2 === 1) {
    teams.push(null);
  }

  const rounds = [];
  const roundCount = teams.length - 1;

  for (let round = 0; round < roundCount; round += 1) {
    const pairings = [];

    for (let i = 0; i < teams.length / 2; i += 1) {
      const home = teams[i];
      const away = teams[teams.length - 1 - i];

      if (home && away) {
        pairings.push([home, away]);
      }
    }

    rounds.push(pairings);

    const pivot = teams[0];
    const rotating = teams.slice(1);
    rotating.unshift(rotating.pop());
    teams.splice(0, teams.length, pivot, ...rotating);
  }

  return rounds;
}

function shuffleRows(rows) {
  const copy = [...rows];

  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }

  return copy;
}

function compareStandingsRows(a, b) {
  if (Number(b.points || 0) !== Number(a.points || 0)) {
    return Number(b.points || 0) - Number(a.points || 0);
  }

  if (Number(b.net_run_rate || 0) !== Number(a.net_run_rate || 0)) {
    return Number(b.net_run_rate || 0) - Number(a.net_run_rate || 0);
  }

  if (Number(b.won || 0) !== Number(a.won || 0)) {
    return Number(b.won || 0) - Number(a.won || 0);
  }

  if (Number(b.runs_for || 0) !== Number(a.runs_for || 0)) {
    return Number(b.runs_for || 0) - Number(a.runs_for || 0);
  }

  return Number(a.franchise_id || 0) - Number(b.franchise_id || 0);
}

async function refreshPositions(seasonId, dbClient = pool) {
  const sorted = await dbClient.query(
    `SELECT id, league_tier, points, net_run_rate, won, runs_for, franchise_id
     FROM season_teams
     WHERE season_id = $1
     ORDER BY league_tier ASC, points DESC, net_run_rate DESC, won DESC, runs_for DESC, franchise_id ASC`,
    [seasonId]
  );

  const leaguePositionByTier = new Map();

  for (let index = 0; index < sorted.rows.length; index += 1) {
    const row = sorted.rows[index];
    const tier = Number(row.league_tier || 1);
    const leaguePosition = (leaguePositionByTier.get(tier) || 0) + 1;
    leaguePositionByTier.set(tier, leaguePosition);

    await dbClient.query(
      `UPDATE season_teams
       SET position = $2,
           league_position = $3
       WHERE id = $1`,
      [row.id, index + 1, leaguePosition]
    );
  }
}

async function buildRandomTierAssignments(teamCount, leagueCount, dbClient = pool) {
  const franchises = await dbClient.query(
    `SELECT id, owner_user_id
     FROM franchises
     ORDER BY random()
     LIMIT $1`,
    [teamCount]
  );

  const shuffled = shuffleRows(franchises.rows);

  return shuffled.map((row, index) => ({
    franchiseId: Number(row.id),
    isAi: !row.owner_user_id,
    leagueTier: (index % leagueCount) + 1,
    previousLeagueTier: null,
    movement: 'NEW'
  }));
}

async function buildTierAssignmentsFromPreviousSeason(previousSeasonId, teamCount, leagueCount, dbClient = pool) {
  const previousRows = await dbClient.query(
    `SELECT st.franchise_id,
            st.league_tier,
            st.points,
            st.net_run_rate,
            st.won,
            st.runs_for,
            f.owner_user_id
     FROM season_teams st
     JOIN franchises f ON f.id = st.franchise_id
     WHERE st.season_id = $1
     ORDER BY st.franchise_id ASC`,
    [previousSeasonId]
  );

  if (!previousRows.rows.length) {
    return buildRandomTierAssignments(teamCount, dbClient);
  }

  let selectedRows = previousRows.rows.slice(0, teamCount);
  if (selectedRows.length < teamCount) {
    const selectedIds = selectedRows.map((row) => Number(row.franchise_id));
    const extras = await dbClient.query(
      `SELECT id AS franchise_id,
              $2::int AS league_tier,
              0::int AS points,
              0::numeric AS net_run_rate,
              0::int AS won,
              0::int AS runs_for,
              owner_user_id
       FROM franchises
       WHERE ($1::bigint[] IS NULL OR id <> ALL($1::bigint[]))
       ORDER BY random()
       LIMIT $3`,
      [selectedIds.length ? selectedIds : null, leagueCount, teamCount - selectedRows.length]
    );

    selectedRows = [...selectedRows, ...extras.rows];
  }
  const byTier = new Map();

  for (const row of selectedRows) {
    const tier = Number(row.league_tier || leagueCount);
    if (!byTier.has(tier)) {
      byTier.set(tier, []);
    }
    byTier.get(tier).push(row);
  }

  const promoted = new Set();
  const relegated = new Set();

  for (let tier = 2; tier <= leagueCount; tier += 1) {
    const standings = [...(byTier.get(tier) || [])].sort(compareStandingsRows);
    standings.slice(0, PROMOTION_SPOTS).forEach((row) => promoted.add(Number(row.franchise_id)));
  }

  for (let tier = 1; tier < leagueCount; tier += 1) {
    const standings = [...(byTier.get(tier) || [])].sort(compareStandingsRows);
    standings.slice(Math.max(0, standings.length - PROMOTION_SPOTS)).forEach((row) => relegated.add(Number(row.franchise_id)));
  }

  const assignments = selectedRows.map((row) => {
    const previousTier = Number(row.league_tier || leagueCount);
    const franchiseId = Number(row.franchise_id);

    let nextTier = previousTier;
    let movement = 'STAY';

    if (promoted.has(franchiseId)) {
      nextTier = Math.max(1, previousTier - 1);
      movement = nextTier < previousTier ? 'PROMOTED' : 'STAY';
    } else if (relegated.has(franchiseId)) {
      nextTier = Math.min(leagueCount, previousTier + 1);
      movement = nextTier > previousTier ? 'RELEGATED' : 'STAY';
    }

    return {
      franchiseId,
      isAi: !row.owner_user_id,
      leagueTier: nextTier,
      previousLeagueTier: previousTier,
      movement
    };
  });

  // Keep tier sizes balanced if the source season had uneven distribution.
  const tierCounts = new Map();
  for (const assignment of assignments) {
    tierCounts.set(assignment.leagueTier, (tierCounts.get(assignment.leagueTier) || 0) + 1);
  }

  const targetPerTier = Math.ceil(teamCount / leagueCount);
  for (let tier = 1; tier <= leagueCount; tier += 1) {
    while ((tierCounts.get(tier) || 0) > targetPerTier) {
      const movable = assignments.find((assignment) => assignment.leagueTier === tier && assignment.movement === 'STAY');
      if (!movable) {
        break;
      }

      const destination = tier < leagueCount ? tier + 1 : tier - 1;
      if (destination < 1 || destination > leagueCount) {
        break;
      }

      tierCounts.set(tier, (tierCounts.get(tier) || 0) - 1);
      tierCounts.set(destination, (tierCounts.get(destination) || 0) + 1);
      movable.previousLeagueTier = movable.previousLeagueTier || tier;
      movable.leagueTier = destination;
      movable.movement = destination < tier ? 'PROMOTED' : destination > tier ? 'RELEGATED' : 'STAY';
    }
  }

  return assignments;
}

async function applyFranchiseTierUpdates(assignments, dbClient = pool) {
  for (const assignment of assignments) {
    const promotionDelta = assignment.movement === 'PROMOTED' ? 1 : 0;
    const relegationDelta = assignment.movement === 'RELEGATED' ? 1 : 0;

    await dbClient.query(
      `UPDATE franchises
       SET current_league_tier = $2,
           promotions = promotions + $3,
           relegations = relegations + $4
       WHERE id = $1`,
      [assignment.franchiseId, assignment.leagueTier, promotionDelta, relegationDelta]
    );
  }
}

export async function listSeasons(limit = 12, dbClient = pool) {
  const seasons = await dbClient.query(
    `SELECT id,
            season_number,
            name,
            year,
            competition_mode,
            team_count,
            league_count,
            teams_per_league,
            status,
            start_date,
            end_date
     FROM seasons
     ORDER BY season_number DESC
     LIMIT $1`,
    [limit]
  );

  return seasons.rows;
}

export async function getActiveSeason(dbClient = pool) {
  const active = await dbClient.query(
    `SELECT *
     FROM seasons
     WHERE status = 'ACTIVE'
     ORDER BY season_number DESC
     LIMIT 1`
  );

  return active.rows[0] || null;
}

export async function createSeason({
  name,
  year,
  teamCount,
  format = 'T20',
  competitionMode = CAREER_MODES.CLUB,
  leagueCount = null,
  seasonNumber = null,
  previousSeasonId = null
}, dbClient = pool) {
  const resolvedMode = normalizeCareerMode(competitionMode || CAREER_MODES.CLUB);
  const resolvedLeagueCount = resolveLeagueCount(resolvedMode, leagueCount);
  const requestedTeamCount = Number(teamCount || 0);
  if (requestedTeamCount < 2) {
    const error = new Error('A season requires at least 2 teams.');
    error.status = 400;
    throw error;
  }

  const availableTeamCount = Number((await dbClient.query('SELECT COUNT(*)::int AS count FROM franchises')).rows[0].count);
  const resolvedTeamCount = Math.min(requestedTeamCount, availableTeamCount);

  if (resolvedTeamCount < 2) {
    const error = new Error('Not enough franchises are available to create a season.');
    error.status = 400;
    throw error;
  }

  const nextSeasonNumber =
    seasonNumber ||
    Number((await dbClient.query('SELECT COALESCE(MAX(season_number), 0) AS season_number FROM seasons')).rows[0].season_number) + 1;

  let seasonName = name || (resolvedMode === CAREER_MODES.INTERNATIONAL
    ? `International T20 Season ${nextSeasonNumber}`
    : `Global T20 Season ${nextSeasonNumber}`);

  // Ensure the name is unique — if a season with this name already exists, append a suffix
  const nameCheck = await dbClient.query('SELECT id FROM seasons WHERE name = $1', [seasonName]);
  if (nameCheck.rows.length) {
    const maxNum = Number(
      (await dbClient.query("SELECT COALESCE(MAX(season_number), 0) AS mn FROM seasons")).rows[0].mn
    );
    const uniqueNum = Math.max(nextSeasonNumber, maxNum) + 1;
    seasonName = name
      ? `${name} (${uniqueNum})`
      : (resolvedMode === CAREER_MODES.INTERNATIONAL ? `International T20 Season ${uniqueNum}` : `Global T20 Season ${uniqueNum}`);
  }
  const teamsPerLeague = Math.ceil(resolvedTeamCount / resolvedLeagueCount);

  const inserted = await dbClient.query(
    `INSERT INTO seasons (season_number, name, year, format, competition_mode, team_count, league_count, teams_per_league, status, start_date)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'ACTIVE', CURRENT_DATE)
     RETURNING *`,
    [nextSeasonNumber, seasonName, year, format, resolvedMode, resolvedTeamCount, resolvedLeagueCount, teamsPerLeague]
  );

  const season = inserted.rows[0];

  const assignments = previousSeasonId
    ? await buildTierAssignmentsFromPreviousSeason(previousSeasonId, resolvedTeamCount, resolvedLeagueCount, dbClient)
    : await buildRandomTierAssignments(resolvedTeamCount, resolvedLeagueCount, dbClient);

  for (const assignment of assignments) {
    await dbClient.query(
      `INSERT INTO season_teams (season_id, franchise_id, is_ai, league_tier, previous_league_tier, movement)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (season_id, franchise_id) DO NOTHING`,
      [
        season.id,
        assignment.franchiseId,
        assignment.isAi,
        assignment.leagueTier,
        assignment.previousLeagueTier,
        assignment.movement
      ]
    );
  }

  await applyFranchiseTierUpdates(assignments, dbClient);
  await refreshPositions(season.id, dbClient);
  await ensureManagerBoardProfilesForSeason(season.id, dbClient);

  return season;
}

export async function ensureActiveSeason(dbClient = pool) {
  const active = await getActiveSeason(dbClient);
  if (active) {
    return active;
  }

  const franchiseCount = Number((await dbClient.query('SELECT COUNT(*)::int AS count FROM franchises')).rows[0].count);
  if (franchiseCount < 2) {
    return null;
  }

  const modeResult = await dbClient.query(
    `SELECT competition_mode, COUNT(*)::int AS count
     FROM franchises
     GROUP BY competition_mode
     ORDER BY COUNT(*) DESC
     LIMIT 1`
  );
  const competitionMode = normalizeCareerMode(modeResult.rows[0]?.competition_mode || CAREER_MODES.CLUB);
  const leagueCount = resolveLeagueCount(competitionMode);

  const seasonTeamTarget = competitionMode === CAREER_MODES.INTERNATIONAL ? DEFAULT_INTERNATIONAL_TEAM_COUNT : DEFAULT_LEAGUE_TEAM_COUNT;
  const teamCount = Math.min(seasonTeamTarget, franchiseCount);
  const nextYear = new Date().getFullYear();

  return createSeason(
    {
      name: null,
      year: nextYear,
      teamCount,
      format: 'T20',
      competitionMode,
      leagueCount
    },
    dbClient
  );
}

export async function generateDoubleRoundRobinFixtures(seasonId, dbClient = pool) {
  const existing = await dbClient.query('SELECT COUNT(*)::int AS count FROM matches WHERE season_id = $1', [seasonId]);
  if (Number(existing.rows[0].count) > 0) {
    return { inserted: 0, skipped: true };
  }

  const seasonResult = await dbClient.query(
    `SELECT league_count, competition_mode
     FROM seasons
     WHERE id = $1`,
    [seasonId]
  );
  const season = seasonResult.rows[0] || null;
  const leagueCount = resolveLeagueCount(season?.competition_mode || CAREER_MODES.CLUB, season?.league_count);
  const useDoubleRoundRobin = shouldUseDoubleRoundRobin(season?.competition_mode || CAREER_MODES.CLUB);

  const teamsByTier = await dbClient.query(
    `SELECT league_tier, franchise_id
     FROM season_teams
     WHERE season_id = $1
     ORDER BY league_tier, franchise_id`,
    [seasonId]
  );

  const tierMap = new Map();
  for (const row of teamsByTier.rows) {
    const tier = Number(row.league_tier || 1);
    if (!tierMap.has(tier)) {
      tierMap.set(tier, []);
    }
    tierMap.get(tier).push(Number(row.franchise_id));
  }

  if (!tierMap.size) {
    return { inserted: 0, skipped: true };
  }

  const schedulesByTier = new Map();
  let maxRounds = 0;

  for (let tier = 1; tier <= leagueCount; tier += 1) {
    const teamIds = tierMap.get(tier) || [];
    if (teamIds.length < 2) {
      continue;
    }

    const firstLeg = generateRoundRobin(teamIds);
    const fullSchedule = useDoubleRoundRobin
      ? [...firstLeg, ...firstLeg.map((round) => round.map(([home, away]) => [away, home]))]
      : firstLeg;

    schedulesByTier.set(tier, fullSchedule);
    maxRounds = Math.max(maxRounds, fullSchedule.length);
  }

  let inserted = 0;
  const baseTime = Date.now() + 10 * 60 * 1000;

  for (let roundIndex = 0; roundIndex < maxRounds; roundIndex += 1) {
    const roundNo = roundIndex + 1;

    for (let tier = 1; tier <= leagueCount; tier += 1) {
      const tierSchedule = schedulesByTier.get(tier);
      if (!tierSchedule || !tierSchedule[roundIndex]) {
        continue;
      }

      const round = tierSchedule[roundIndex];

      for (let matchIndex = 0; matchIndex < round.length; matchIndex += 1) {
        const [home, away] = round[matchIndex];

        const slotTime = new Date(baseTime + roundIndex * 24 * 60 * 60 * 1000 + (tier - 1) * 5 * 60 * 60 * 1000 + matchIndex * 30 * 60 * 1000);
        await dbClient.query(
          `INSERT INTO matches (
            season_id,
            home_franchise_id,
            away_franchise_id,
            stage,
            league_tier,
            round_no,
            matchday_label,
            scheduled_at,
            status
          ) VALUES ($1, $2, $3, 'REGULAR', $4, $5, $6, $7, 'SCHEDULED')`,
          [seasonId, home, away, tier, roundNo, `League ${tier} - Round ${roundNo}`, slotTime.toISOString()]
        );

        inserted += 1;
      }
    }
  }

  return { inserted, skipped: false };
}

export async function getLeagueTable(seasonId, dbClient = pool) {
  const table = await dbClient.query(
    `SELECT st.franchise_id,
            st.league_tier,
            st.previous_league_tier,
            st.movement,
            COALESCE(st.played, 0)::int AS played,
            COALESCE(st.won, 0)::int AS won,
            COALESCE(st.lost, 0)::int AS lost,
            COALESCE(st.tied, 0)::int AS tied,
            COALESCE(st.points, 0)::int AS points,
            COALESCE(st.runs_for, 0)::int AS runs_for,
            COALESCE(st.runs_against, 0)::int AS runs_against,
            COALESCE(st.net_run_rate, 0) AS net_run_rate,
            COALESCE(st.league_position, st.position)::int AS league_position,
            COALESCE(st.position, st.league_position)::int AS position,
            st.is_ai,
            f.franchise_name,
            f.current_league_tier,
            f.promotions,
            f.relegations,
            c.name AS city,
            c.country
     FROM season_teams st
     JOIN franchises f ON f.id = st.franchise_id
     JOIN cities c ON c.id = f.city_id
     WHERE st.season_id = $1
     ORDER BY st.league_tier ASC,
              COALESCE(st.league_position, st.position, 999) ASC,
              st.points DESC,
              st.net_run_rate DESC,
              st.won DESC,
              st.runs_for DESC,
              st.franchise_id ASC`,
    [seasonId]
  );

  return table.rows;
}

export async function getSeasonRoundOverview(seasonId, dbClient = pool) {
  const rounds = await dbClient.query(
    `SELECT round_no,
            COUNT(*)::int AS total_matches,
            COUNT(*) FILTER (WHERE status = 'COMPLETED')::int AS completed_matches,
            COUNT(*) FILTER (WHERE status = 'LIVE')::int AS live_matches
     FROM matches
     WHERE season_id = $1
       AND stage = 'REGULAR'
     GROUP BY round_no
     ORDER BY round_no`,
    [seasonId]
  );

  return rounds.rows;
}

export async function getSeasonPlayerLeaders(seasonId, dbClient = pool) {
  const batting = await dbClient.query(
    `SELECT p.id AS player_id,
            p.first_name,
            p.last_name,
            f.id AS franchise_id,
            f.franchise_name,
            COUNT(*) FILTER (WHERE pms.batting_balls > 0)::int AS innings,
            SUM(pms.batting_runs)::int AS runs,
            SUM(pms.batting_balls)::int AS balls,
            SUM(pms.fours)::int AS fours,
            SUM(pms.sixes)::int AS sixes,
            COUNT(*) FILTER (WHERE pms.not_out = FALSE AND pms.batting_balls > 0)::int AS dismissals,
            COALESCE(ROUND((SUM(pms.batting_runs)::numeric * 100) / NULLIF(SUM(pms.batting_balls), 0), 2), 0) AS strike_rate
     FROM player_match_stats pms
     JOIN matches m ON m.id = pms.match_id
     JOIN players p ON p.id = pms.player_id
     JOIN franchises f ON f.id = p.franchise_id
     WHERE m.season_id = $1
       AND m.stage = 'REGULAR'
     GROUP BY p.id, p.first_name, p.last_name, f.id, f.franchise_name
     HAVING SUM(pms.batting_balls) > 0
     ORDER BY runs DESC, strike_rate DESC
     LIMIT 30`,
    [seasonId]
  );

  const bowling = await dbClient.query(
    `SELECT p.id AS player_id,
            p.first_name,
            p.last_name,
            f.id AS franchise_id,
            f.franchise_name,
            SUM(pms.bowling_balls)::int AS balls,
            SUM(pms.bowling_runs)::int AS runs_conceded,
            SUM(pms.bowling_wickets)::int AS wickets,
            SUM(pms.maiden_overs)::int AS maidens,
            COALESCE(ROUND((SUM(pms.bowling_runs)::numeric * 6) / NULLIF(SUM(pms.bowling_balls), 0), 2), 0) AS economy
     FROM player_match_stats pms
     JOIN matches m ON m.id = pms.match_id
     JOIN players p ON p.id = pms.player_id
     JOIN franchises f ON f.id = p.franchise_id
     WHERE m.season_id = $1
       AND m.stage = 'REGULAR'
       AND p.role IN ('BOWLER', 'ALL_ROUNDER')
     GROUP BY p.id, p.first_name, p.last_name, f.id, f.franchise_name
     HAVING SUM(pms.bowling_balls) > 0
     ORDER BY wickets DESC, economy ASC
     LIMIT 30`,
    [seasonId]
  );

  return {
    batting: batting.rows,
    bowling: bowling.rows
  };
}

export async function updateSeasonTableWithMatch(matchId, dbClient = pool) {
  const matchResult = await dbClient.query(
    `SELECT id,
            season_id,
            stage,
            home_franchise_id,
            away_franchise_id,
            winner_franchise_id,
            home_score,
            away_score,
            home_balls,
            away_balls,
            status
     FROM matches
     WHERE id = $1`,
    [matchId]
  );

  if (!matchResult.rows.length) {
    return null;
  }

  const match = matchResult.rows[0];
  if (match.status !== 'COMPLETED') {
    return null;
  }

  if (match.stage !== 'REGULAR') {
    return getLeagueTable(match.season_id, dbClient);
  }

  const homeScore = Number(match.home_score || 0);
  const awayScore = Number(match.away_score || 0);
  const homeBalls = Number(match.home_balls || 120);
  const awayBalls = Number(match.away_balls || 120);

  const winnerId = match.winner_franchise_id ? Number(match.winner_franchise_id) : null;
  const isTie = !winnerId && homeScore === awayScore;

  const homeWon = winnerId === Number(match.home_franchise_id);
  const awayWon = winnerId === Number(match.away_franchise_id);

  const homePoints = isTie ? 1 : homeWon ? 2 : 0;
  const awayPoints = isTie ? 1 : awayWon ? 2 : 0;

  await dbClient.query(
    `UPDATE season_teams
     SET played = played + 1,
         won = won + $3,
         lost = lost + $4,
         tied = tied + $5,
         points = points + $6,
         runs_for = runs_for + $7,
         balls_faced = balls_faced + $8,
         runs_against = runs_against + $9,
         balls_bowled = balls_bowled + $10,
         net_run_rate = ROUND((((runs_for + $7)::numeric / NULLIF((balls_faced + $8), 0)) * 6 - ((runs_against + $9)::numeric / NULLIF((balls_bowled + $10), 0)) * 6), 3)
     WHERE season_id = $1
       AND franchise_id = $2`,
    [
      match.season_id,
      match.home_franchise_id,
      homeWon ? 1 : 0,
      !isTie && !homeWon ? 1 : 0,
      isTie ? 1 : 0,
      homePoints,
      homeScore,
      homeBalls,
      awayScore,
      awayBalls
    ]
  );

  await dbClient.query(
    `UPDATE season_teams
     SET played = played + 1,
         won = won + $3,
         lost = lost + $4,
         tied = tied + $5,
         points = points + $6,
         runs_for = runs_for + $7,
         balls_faced = balls_faced + $8,
         runs_against = runs_against + $9,
         balls_bowled = balls_bowled + $10,
         net_run_rate = ROUND((((runs_for + $7)::numeric / NULLIF((balls_faced + $8), 0)) * 6 - ((runs_against + $9)::numeric / NULLIF((balls_bowled + $10), 0)) * 6), 3)
     WHERE season_id = $1
       AND franchise_id = $2`,
    [
      match.season_id,
      match.away_franchise_id,
      awayWon ? 1 : 0,
      !isTie && !awayWon ? 1 : 0,
      isTie ? 1 : 0,
      awayPoints,
      awayScore,
      awayBalls,
      homeScore,
      homeBalls
    ]
  );

  await refreshPositions(match.season_id, dbClient);

  return getLeagueTable(match.season_id, dbClient);
}

async function createPlayoffMatches(seasonId, dbClient = pool) {
  const seasonResult = await dbClient.query(
    `SELECT competition_mode, league_count
     FROM seasons
     WHERE id = $1`,
    [seasonId]
  );
  const season = seasonResult.rows[0] || null;
  const competitionMode = normalizeCareerMode(season?.competition_mode || CAREER_MODES.CLUB);
  if (competitionMode !== CAREER_MODES.CLUB) {
    return;
  }
  const leagueCount = resolveLeagueCount(competitionMode, season?.league_count);

  const existing = await dbClient.query(
    `SELECT COUNT(*)::int AS count
     FROM matches
     WHERE season_id = $1
       AND stage = 'PLAYOFF'`,
    [seasonId]
  );

  if (Number(existing.rows[0].count) > 0) {
    return;
  }

  const table = await getLeagueTable(seasonId, dbClient);
  const leagueWinners = [];

  for (let tier = 1; tier <= leagueCount; tier += 1) {
    const winner = table
      .filter((row) => Number(row.league_tier) === tier)
      .sort((a, b) => Number(a.league_position || 999) - Number(b.league_position || 999))[0];

    if (winner) {
      leagueWinners.push(winner);
    }
  }

  if (leagueWinners.length < 4) {
    return;
  }

  const maxRound = Number((await dbClient.query('SELECT COALESCE(MAX(round_no), 0) AS value FROM matches WHERE season_id = $1', [seasonId])).rows[0].value);

  const finalists = leagueWinners.slice(0, 4);
  const semi1 = [Number(finalists[0].franchise_id), Number(finalists[3].franchise_id)];
  const semi2 = [Number(finalists[1].franchise_id), Number(finalists[2].franchise_id)];

  await dbClient.query(
    `INSERT INTO matches (season_id, home_franchise_id, away_franchise_id, stage, league_tier, round_no, matchday_label, scheduled_at, status)
     VALUES
       ($1, $2, $3, 'PLAYOFF', NULL, $4, 'Semifinal 1', NOW() + INTERVAL '1 day', 'SCHEDULED'),
       ($1, $5, $6, 'PLAYOFF', NULL, $4, 'Semifinal 2', NOW() + INTERVAL '1 day 3 hours', 'SCHEDULED')`,
    [seasonId, semi1[0], semi1[1], maxRound + 1, semi2[0], semi2[1]]
  );
}

async function createFinalIfReady(seasonId, dbClient = pool) {
  const playoffsDone = await dbClient.query(
    `SELECT winner_franchise_id
     FROM matches
     WHERE season_id = $1
       AND stage = 'PLAYOFF'
       AND status = 'COMPLETED'
     ORDER BY id`,
    [seasonId]
  );

  if (playoffsDone.rows.length < 2) {
    return;
  }

  const finalExists = await dbClient.query(
    `SELECT id
     FROM matches
     WHERE season_id = $1
       AND stage = 'FINAL'
     LIMIT 1`,
    [seasonId]
  );

  if (finalExists.rows.length) {
    return;
  }

  const winners = playoffsDone.rows.map((row) => row.winner_franchise_id).filter(Boolean);
  if (winners.length < 2) {
    return;
  }

  const maxRound = Number((await dbClient.query('SELECT COALESCE(MAX(round_no), 0) AS value FROM matches WHERE season_id = $1', [seasonId])).rows[0].value);

  await dbClient.query(
    `INSERT INTO matches (season_id, home_franchise_id, away_franchise_id, stage, league_tier, round_no, matchday_label, scheduled_at, status)
     VALUES ($1, $2, $3, 'FINAL', NULL, $4, 'Final', NOW() + INTERVAL '2 day', 'SCHEDULED')`,
    [seasonId, winners[0], winners[1], maxRound + 1]
  );
}

async function finalizeSeasonIfChampionKnown(seasonId, dbClient = pool) {
  const seasonResult = await dbClient.query('SELECT status FROM seasons WHERE id = $1', [seasonId]);
  if (!seasonResult.rows.length || seasonResult.rows[0].status === 'COMPLETED') {
    return false;
  }

  const final = await dbClient.query(
    `SELECT winner_franchise_id
     FROM matches
     WHERE season_id = $1
       AND stage = 'FINAL'
       AND status = 'COMPLETED'
     LIMIT 1`,
    [seasonId]
  );

  if (!final.rows.length || !final.rows[0].winner_franchise_id) {
    return false;
  }

  const championId = Number(final.rows[0].winner_franchise_id);

  await dbClient.query(
    `UPDATE franchises
     SET championships = championships + 1,
         fan_rating = LEAST(100, fan_rating + 6)
     WHERE id = $1`,
    [championId]
  );

  await dbClient.query(
    `INSERT INTO trophy_cabinet (franchise_id, season_id, title)
     VALUES ($1, $2, $3)`,
    [championId, seasonId, 'Global T20 Championship']
  );

  await dbClient.query(
    `UPDATE seasons
     SET status = 'COMPLETED',
         end_date = CURRENT_DATE
     WHERE id = $1`,
    [seasonId]
  );

  return true;
}

async function finalizeInternationalSeason(seasonId, dbClient = pool) {
  const seasonResult = await dbClient.query(
    `SELECT status, league_count
     FROM seasons
     WHERE id = $1`,
    [seasonId]
  );
  if (!seasonResult.rows.length || seasonResult.rows[0].status === 'COMPLETED') {
    return false;
  }

  const leagueCount = Number(seasonResult.rows[0].league_count || DEFAULT_INTERNATIONAL_LEAGUE_COUNT);
  const table = await getLeagueTable(seasonId, dbClient);

  for (let tier = 1; tier <= leagueCount; tier += 1) {
    const winner = table
      .filter((row) => Number(row.league_tier) === tier)
      .sort((a, b) => Number(a.league_position || 999) - Number(b.league_position || 999))[0];

    if (!winner) {
      continue;
    }

    const winnerId = Number(winner.franchise_id);
    await dbClient.query(
      `UPDATE franchises
       SET fan_rating = LEAST(100, fan_rating + 3)
       WHERE id = $1`,
      [winnerId]
    );

    await dbClient.query(
      `INSERT INTO trophy_cabinet (franchise_id, season_id, title)
       VALUES ($1, $2, $3)`,
      [winnerId, seasonId, `League ${tier} Division Winner`]
    );
  }

  await dbClient.query(
    `UPDATE seasons
     SET status = 'COMPLETED',
         end_date = CURRENT_DATE
     WHERE id = $1`,
    [seasonId]
  );

  return true;
}

export async function progressSeasonStructure(seasonId, dbClient = pool) {
  const season = await dbClient.query(
    `SELECT competition_mode
     FROM seasons
     WHERE id = $1`,
    [seasonId]
  );
  const competitionMode = normalizeCareerMode(season.rows[0]?.competition_mode || CAREER_MODES.CLUB);

  const regularRemaining = Number(
    (
      await dbClient.query(
        `SELECT COUNT(*)::int AS count
         FROM matches
         WHERE season_id = $1
           AND stage = 'REGULAR'
           AND status <> 'COMPLETED'`,
        [seasonId]
      )
    ).rows[0].count
  );

  if (competitionMode === CAREER_MODES.INTERNATIONAL) {
    if (regularRemaining === 0) {
      const completed = await finalizeInternationalSeason(seasonId, dbClient);
      return { state: completed ? 'SEASON_COMPLETED' : 'PROGRESSED' };
    }
    return { state: 'PROGRESSED' };
  }

  if (regularRemaining === 0) {
    await createPlayoffMatches(seasonId, dbClient);

    const playoffRemaining = Number(
      (
        await dbClient.query(
          `SELECT COUNT(*)::int AS count
           FROM matches
           WHERE season_id = $1
             AND stage = 'PLAYOFF'
             AND status <> 'COMPLETED'`,
          [seasonId]
        )
      ).rows[0].count
    );

    if (playoffRemaining === 0) {
      await createFinalIfReady(seasonId, dbClient);
    }
  }

  const completed = await finalizeSeasonIfChampionKnown(seasonId, dbClient);
  return { state: completed ? 'SEASON_COMPLETED' : 'PROGRESSED' };
}

export async function createNextSeasonFromCompleted(completedSeasonId, dbClient = pool) {
  const completed = await dbClient.query('SELECT * FROM seasons WHERE id = $1', [completedSeasonId]);
  if (!completed.rows.length || completed.rows[0].status !== 'COMPLETED') {
    return null;
  }

  const existingActive = await getActiveSeason(dbClient);
  if (existingActive) {
    return existingActive;
  }

  // Guard: if a season with this number already exists (e.g. stale retry), skip to its record
  const nextNumber = Number(completed.rows[0].season_number) + 1;
  const existingNext = await dbClient.query(
    'SELECT * FROM seasons WHERE season_number = $1', [nextNumber]
  );
  if (existingNext.rows.length) {
    return existingNext.rows[0];
  }

  await processSeasonRetirements(completedSeasonId, dbClient);

  const nextYear = Number(completed.rows[0].year) + 1;
  const teamCount = Number(completed.rows[0].team_count);
  const competitionMode = normalizeCareerMode(completed.rows[0].competition_mode || CAREER_MODES.CLUB);
  const leagueCount = resolveLeagueCount(competitionMode, completed.rows[0].league_count);
  const nextSeasonName = competitionMode === CAREER_MODES.INTERNATIONAL
    ? `International T20 Season ${nextNumber}`
    : `Global T20 Season ${nextNumber}`;

  const season = await createSeason(
    {
      name: nextSeasonName,
      year: nextYear,
      teamCount,
      format: completed.rows[0].format,
      competitionMode,
      leagueCount,
      seasonNumber: nextNumber,
      previousSeasonId: completedSeasonId
    },
    dbClient
  );

  await generateDoubleRoundRobinFixtures(season.id, dbClient);
  await refreshPositions(season.id, dbClient);

  return season;
}

export async function getSeasonSummary(seasonId, dbClient = pool) {
  const seasonResult = await dbClient.query('SELECT * FROM seasons WHERE id = $1', [seasonId]);
  if (!seasonResult.rows.length) {
    return null;
  }

  const rounds = await getSeasonRoundOverview(seasonId, dbClient);
  const table = await getLeagueTable(seasonId, dbClient);

  const fixtureCounts = await dbClient.query(
    `SELECT COUNT(*)::int AS total_matches,
            COUNT(*) FILTER (WHERE status = 'COMPLETED')::int AS completed_matches,
            COUNT(*) FILTER (WHERE status = 'SCHEDULED')::int AS scheduled_matches,
            COUNT(*) FILTER (WHERE status = 'LIVE')::int AS live_matches
     FROM matches
     WHERE season_id = $1`,
    [seasonId]
  );

  const leagueOverview = await dbClient.query(
    `SELECT league_tier,
            COUNT(*)::int AS total_matches,
            COUNT(*) FILTER (WHERE status = 'COMPLETED')::int AS completed_matches,
            COUNT(*) FILTER (WHERE stage = 'REGULAR')::int AS regular_matches
     FROM matches
     WHERE season_id = $1
       AND stage = 'REGULAR'
     GROUP BY league_tier
     ORDER BY league_tier`,
    [seasonId]
  );

  return {
    season: seasonResult.rows[0],
    rounds,
    table,
    fixtures: fixtureCounts.rows[0],
    leagueOverview: leagueOverview.rows
  };
}
