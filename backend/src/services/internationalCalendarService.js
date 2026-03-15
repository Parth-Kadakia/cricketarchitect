import pool from '../config/db.js';
import { CAREER_MODES, normalizeCareerMode } from '../constants/gameModes.js';

const INTERNATIONAL_CYCLE_YEARS = 4;
const SERIES_INTERVAL_DAYS = 14;
const SERIES_MATCH_OFFSETS = [0, 2, 4];
const CALENDAR_DEFAULT_SPAN_DAYS = 14;
const WORLD_CUP_TEAM_COUNT = 32;
const WORLD_CUP_GROUPS = ['A', 'B', 'C', 'D'];

function toNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseDate(value) {
  if (!value) {
    return null;
  }
  const parsed = value instanceof Date ? new Date(value.getTime()) : new Date(`${String(value).slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  return parsed;
}

function addDays(dateValue, days) {
  const base = parseDate(dateValue);
  if (!base) {
    return null;
  }
  const next = new Date(base.getTime());
  next.setUTCDate(next.getUTCDate() + Number(days || 0));
  return next;
}

function formatDate(dateValue) {
  const parsed = parseDate(dateValue);
  if (!parsed) {
    return null;
  }
  return parsed.toISOString().slice(0, 10);
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

    for (let index = 0; index < teams.length / 2; index += 1) {
      const teamA = teams[index];
      const teamB = teams[teams.length - 1 - index];
      if (teamA && teamB) {
        pairings.push([Number(teamA), Number(teamB)]);
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

function buildPairKey(teamAId, teamBId) {
  const low = Math.min(Number(teamAId || 0), Number(teamBId || 0));
  const high = Math.max(Number(teamAId || 0), Number(teamBId || 0));
  return `${low}:${high}`;
}

function compareRankingRows(a, b) {
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

function determineCycleYear(season, dateValue) {
  const currentDate = parseDate(dateValue);
  const cycleStart = parseDate(season?.cycle_start_date || season?.start_date);
  if (!currentDate || !cycleStart) {
    return 1;
  }
  return Math.max(1, Math.min(INTERNATIONAL_CYCLE_YEARS, currentDate.getUTCFullYear() - cycleStart.getUTCFullYear() + 1));
}

function buildCycleSeasonDates(season) {
  const startYear = Number(season?.year || new Date().getUTCFullYear());
  const cycleStart = parseDate(season?.cycle_start_date || `${startYear}-01-05`);
  const ftpEnd = addDays(cycleStart, (99 - 1) * SERIES_INTERVAL_DAYS + SERIES_MATCH_OFFSETS[SERIES_MATCH_OFFSETS.length - 1]);
  return {
    cycleStart,
    ftpEnd,
    nominalCycleEnd: addDays(cycleStart, 365 * INTERNATIONAL_CYCLE_YEARS - 1)
  };
}

async function batchInsert(dbClient, tableName, columns, rows, chunkSize = 250) {
  if (!rows.length) {
    return;
  }

  for (let start = 0; start < rows.length; start += chunkSize) {
    const chunk = rows.slice(start, start + chunkSize);
    const values = [];
    const placeholders = chunk.map((row, rowIndex) => {
      const baseIndex = rowIndex * columns.length;
      columns.forEach((column) => {
        values.push(row[column]);
      });
      return `(${columns.map((_, index) => `$${baseIndex + index + 1}`).join(', ')})`;
    });

    await dbClient.query(
      `INSERT INTO ${tableName} (${columns.join(', ')})
       VALUES ${placeholders.join(', ')}`,
      values
    );
  }
}

async function getSeasonContext(seasonId, dbClient = pool) {
  const result = await dbClient.query(
    `SELECT *
     FROM seasons
     WHERE id = $1`,
    [seasonId]
  );
  return result.rows[0] || null;
}

async function resetInternationalStandings(seasonId, dbClient = pool) {
  await dbClient.query(
    `UPDATE season_teams
     SET league_tier = 1,
         previous_league_tier = 1,
         movement = 'STAY',
         played = 0,
         won = 0,
         lost = 0,
         tied = 0,
         points = 0,
         runs_for = 0,
         balls_faced = 0,
         runs_against = 0,
         balls_bowled = 0,
         net_run_rate = 0,
         league_position = NULL,
         position = NULL
     WHERE season_id = $1`,
    [seasonId]
  );
}

async function refreshInternationalPositions(seasonId, dbClient = pool) {
  const sorted = await dbClient.query(
    `SELECT id, points, net_run_rate, won, runs_for, franchise_id
     FROM season_teams
     WHERE season_id = $1
     ORDER BY points DESC,
              net_run_rate DESC,
              won DESC,
              runs_for DESC,
              franchise_id ASC`,
    [seasonId]
  );

  for (let index = 0; index < sorted.rows.length; index += 1) {
    await dbClient.query(
      `UPDATE season_teams
       SET position = $2,
           league_position = $2
       WHERE id = $1`,
      [sorted.rows[index].id, index + 1]
    );
  }
}

async function getInternationalTeamsForSeason(seasonId, dbClient = pool) {
  const result = await dbClient.query(
    `SELECT st.franchise_id,
            st.is_ai,
            f.franchise_name,
            c.country,
            c.name AS city_name
     FROM season_teams st
     JOIN franchises f ON f.id = st.franchise_id
     JOIN cities c ON c.id = f.city_id
     WHERE st.season_id = $1
     ORDER BY f.id ASC`,
    [seasonId]
  );
  return result.rows.map((row) => ({
    franchiseId: Number(row.franchise_id),
    isAi: Boolean(row.is_ai),
    franchiseName: row.franchise_name,
    country: row.country,
    cityName: row.city_name
  }));
}

async function getPreviousVenueMap(season, dbClient = pool) {
  const previousSeasonResult = await dbClient.query(
    `SELECT id
     FROM seasons
     WHERE world_id = $1
       AND competition_mode = 'INTERNATIONAL'
       AND season_number < $2
     ORDER BY season_number DESC
     LIMIT 1`,
    [season.world_id, season.season_number]
  );

  const previousSeasonId = Number(previousSeasonResult.rows[0]?.id || 0);
  if (!previousSeasonId) {
    return new Map();
  }

  const venueRows = await dbClient.query(
    `SELECT pair_key,
            home_franchise_id,
            away_franchise_id
     FROM international_series
     WHERE season_id = $1`,
    [previousSeasonId]
  );

  const venueMap = new Map();
  for (const row of venueRows.rows) {
    const pairKey = row.pair_key || buildPairKey(row.home_franchise_id, row.away_franchise_id);
    venueMap.set(pairKey, Number(row.home_franchise_id));
  }
  return venueMap;
}

function chooseHomeTeam(teamAId, teamBId, pairKey, previousVenueMap, seasonNumber) {
  const previousHomeId = Number(previousVenueMap.get(pairKey) || 0);
  if (previousHomeId) {
    return previousHomeId === Number(teamAId) ? Number(teamBId) : Number(teamAId);
  }

  const low = Math.min(Number(teamAId), Number(teamBId));
  const high = Math.max(Number(teamAId), Number(teamBId));
  const parity = (low * 31 + high * 17 + Number(seasonNumber || 1) * 7) % 2;
  return parity === 0 ? low : high;
}

function buildWorldCupGroups(qualifiedRows) {
  const groups = WORLD_CUP_GROUPS.map((name) => ({ name, teams: [] }));
  const rows = [...qualifiedRows];
  const pots = [];
  for (let index = 0; index < rows.length; index += 8) {
    pots.push(rows.slice(index, index + 8));
  }

  for (let potIndex = 0; potIndex < pots.length; potIndex += 1) {
    const pot = pots[potIndex];
    const target = potIndex % 2 === 0 ? groups : [...groups].reverse();
    for (let teamIndex = 0; teamIndex < pot.length; teamIndex += 1) {
      target[teamIndex % target.length].teams.push(pot[teamIndex]);
    }
  }

  return groups;
}

async function getDetailedMatchRows(seasonId, startDate, endDate, dbClient = pool) {
  const result = await dbClient.query(
    `SELECT m.id,
            m.series_id,
            m.series_match_no,
            m.stage,
            m.group_name,
            m.round_no,
            m.matchday_label,
            m.scheduled_at,
            m.status,
            m.result_summary,
            m.home_score,
            m.home_wickets,
            m.home_balls,
            m.away_score,
            m.away_wickets,
            m.away_balls,
            m.winner_franchise_id,
            hf.id AS home_franchise_id,
            hf.franchise_name AS home_franchise_name,
            hc.country AS home_country,
            af.id AS away_franchise_id,
            af.franchise_name AS away_franchise_name,
            ac.country AS away_country
     FROM matches m
     JOIN franchises hf ON hf.id = m.home_franchise_id
     JOIN cities hc ON hc.id = hf.city_id
     JOIN franchises af ON af.id = m.away_franchise_id
     JOIN cities ac ON ac.id = af.city_id
     WHERE m.season_id = $1
       AND DATE(COALESCE(m.scheduled_at, CURRENT_DATE)) BETWEEN $2::date AND $3::date
     ORDER BY DATE(COALESCE(m.scheduled_at, CURRENT_DATE)) ASC,
              COALESCE(m.scheduled_at, NOW()) ASC,
              m.id ASC`,
    [seasonId, formatDate(startDate), formatDate(endDate)]
  );
  return result.rows;
}

function buildDayGroups(matchRows, managedFranchiseId = null) {
  const grouped = new Map();

  for (const row of matchRows) {
    const dateKey = formatDate(row.scheduled_at);
    if (!grouped.has(dateKey)) {
      grouped.set(dateKey, []);
    }

    grouped.get(dateKey).push({
      ...row,
      managedTeamInvolved:
        Number(managedFranchiseId || 0) > 0 &&
        (Number(row.home_franchise_id) === Number(managedFranchiseId) || Number(row.away_franchise_id) === Number(managedFranchiseId))
    });
  }

  return [...grouped.entries()].map(([date, matches]) => ({
    date,
    matches
  }));
}

async function getSeriesRowsForTeams(seasonId, franchiseIds, dbClient = pool) {
  if (!franchiseIds.length) {
    return [];
  }

  const result = await dbClient.query(
    `SELECT s.id,
            s.pair_key,
            s.series_type,
            s.window_no,
            s.cycle_year,
            s.start_date,
            s.end_date,
            s.home_franchise_id,
            s.away_franchise_id,
            hf.franchise_name AS home_franchise_name,
            hc.country AS home_country,
            af.franchise_name AS away_franchise_name,
            ac.country AS away_country
     FROM international_series s
     JOIN franchises hf ON hf.id = s.home_franchise_id
     JOIN cities hc ON hc.id = hf.city_id
     JOIN franchises af ON af.id = s.away_franchise_id
     JOIN cities ac ON ac.id = af.city_id
     WHERE s.season_id = $1
       AND (s.manager_franchise_id = ANY($2::bigint[]) OR s.opponent_franchise_id = ANY($2::bigint[]))
     ORDER BY s.start_date ASC, s.id ASC`,
    [seasonId, franchiseIds]
  );
  return result.rows;
}

async function getSeriesMatches(seriesIds, dbClient = pool) {
  if (!seriesIds.length) {
    return [];
  }

  const result = await dbClient.query(
    `SELECT m.id,
            m.season_id,
            m.series_id,
            m.series_match_no,
            m.stage,
            m.group_name,
            m.round_no,
            m.matchday_label,
            m.scheduled_at,
            m.status,
            m.result_summary,
            m.home_franchise_id,
            m.away_franchise_id,
            m.winner_franchise_id,
            m.home_score,
            m.home_wickets,
            m.home_balls,
            m.away_score,
            m.away_wickets,
            m.away_balls,
            hf.franchise_name AS home_franchise_name,
            af.franchise_name AS away_franchise_name
     FROM matches m
     JOIN franchises hf ON hf.id = m.home_franchise_id
     JOIN franchises af ON af.id = m.away_franchise_id
     WHERE m.series_id = ANY($1::bigint[])
     ORDER BY m.scheduled_at ASC, m.id ASC`,
    [seriesIds]
  );
  return result.rows;
}

function buildSeriesPayload(seriesRows, matchRows) {
  const matchMap = new Map();
  for (const match of matchRows) {
    const seriesId = Number(match.series_id || 0);
    if (!matchMap.has(seriesId)) {
      matchMap.set(seriesId, []);
    }
    matchMap.get(seriesId).push(match);
  }

  return seriesRows.map((series) => {
    const matches = (matchMap.get(Number(series.id)) || []).slice().sort((a, b) => Number(a.series_match_no || 0) - Number(b.series_match_no || 0));
    const completedMatches = matches.filter((match) => String(match.status || '').toUpperCase() === 'COMPLETED').length;
    const homeWins = matches.filter((match) => Number(match.winner_franchise_id || 0) === Number(series.home_franchise_id)).length;
    const awayWins = matches.filter((match) => Number(match.winner_franchise_id || 0) === Number(series.away_franchise_id)).length;
    let result = 'Series not started';
    if (completedMatches) {
      if (completedMatches < matches.length) {
        result = `${series.home_franchise_name} ${homeWins}-${awayWins} ${series.away_franchise_name}`;
      } else if (homeWins === awayWins) {
        result = `Series tied ${homeWins}-${awayWins}`;
      } else if (homeWins > awayWins) {
        result = `${series.home_franchise_name} won ${homeWins}-${awayWins}`;
      } else {
        result = `${series.away_franchise_name} won ${awayWins}-${homeWins}`;
      }
    }

    return {
      id: Number(series.id),
      pairKey: series.pair_key,
      seriesType: series.series_type,
      roundNo: Number(series.window_no || 0),
      cycleYear: Number(series.cycle_year || 1),
      startDate: formatDate(series.start_date),
      endDate: formatDate(series.end_date),
      homeTeam: {
        franchiseId: Number(series.home_franchise_id),
        franchiseName: series.home_franchise_name,
        country: series.home_country
      },
      awayTeam: {
        franchiseId: Number(series.away_franchise_id),
        franchiseName: series.away_franchise_name,
        country: series.away_country
      },
      title: `${series.home_franchise_name} vs ${series.away_franchise_name}`,
      result,
      completedMatches,
      totalMatches: matches.length,
      status:
        completedMatches === 0
          ? 'SCHEDULED'
          : completedMatches === matches.length
            ? 'COMPLETED'
            : 'IN_PROGRESS',
      matches
    };
  });
}

async function createWorldCupGroupMatches(season, dbClient = pool) {
  const existing = await dbClient.query(
    `SELECT COUNT(*)::int AS count
     FROM matches
     WHERE season_id = $1
       AND stage LIKE 'WORLD_CUP_%'`,
    [season.id]
  );
  if (Number(existing.rows[0]?.count || 0) > 0) {
    return false;
  }

  const tableResult = await dbClient.query(
    `SELECT st.franchise_id,
            st.played,
            st.won,
            st.lost,
            st.tied,
            st.points,
            st.runs_for,
            st.runs_against,
            st.net_run_rate,
            f.franchise_name,
            c.country
     FROM season_teams st
     JOIN franchises f ON f.id = st.franchise_id
     JOIN cities c ON c.id = f.city_id
     WHERE st.season_id = $1
     ORDER BY COALESCE(st.position, 999) ASC,
              st.points DESC,
              st.net_run_rate DESC,
              st.won DESC,
              st.runs_for DESC,
              st.franchise_id ASC`,
    [season.id]
  );

  const qualified = tableResult.rows.slice(0, WORLD_CUP_TEAM_COUNT);
  if (qualified.length < WORLD_CUP_TEAM_COUNT) {
    return false;
  }

  const groups = buildWorldCupGroups(qualified);
  const cycleDates = buildCycleSeasonDates(season);
  const worldCupStart = addDays(cycleDates.ftpEnd, 10);
  const matchRows = [];
  let roundBase = 1000;

  for (let groupIndex = 0; groupIndex < groups.length; groupIndex += 1) {
    const group = groups[groupIndex];
    const groupRounds = generateRoundRobin(group.teams.map((team) => Number(team.franchise_id)));

    for (let roundIndex = 0; roundIndex < groupRounds.length; roundIndex += 1) {
      const roundDate = addDays(worldCupStart, roundIndex * 2 + groupIndex % 2);
      for (let matchIndex = 0; matchIndex < groupRounds[roundIndex].length; matchIndex += 1) {
        const [homeId, awayId] = groupRounds[roundIndex][matchIndex];
        const scheduled = new Date(roundDate.getTime());
        scheduled.setUTCHours(10 + (matchIndex % 4) * 3, 0, 0, 0);
        matchRows.push({
          season_id: Number(season.id),
          home_franchise_id: Number(homeId),
          away_franchise_id: Number(awayId),
          series_id: null,
          series_match_no: null,
          stage: 'WORLD_CUP_GROUP',
          group_name: group.name,
          league_tier: 1,
          round_no: roundBase + roundIndex + 1,
          matchday_label: `World Cup Group ${group.name} - Round ${roundIndex + 1}`,
          scheduled_at: scheduled.toISOString(),
          status: 'SCHEDULED'
        });
      }
    }
    roundBase += 20;
  }

  await batchInsert(
    dbClient,
    'matches',
    ['season_id', 'home_franchise_id', 'away_franchise_id', 'series_id', 'series_match_no', 'stage', 'group_name', 'league_tier', 'round_no', 'matchday_label', 'scheduled_at', 'status'],
    matchRows
  );

  await dbClient.query(
    `UPDATE seasons
     SET current_phase = 'WORLD_CUP_GROUP',
         world_cup_generated_at = NOW()
     WHERE id = $1`,
    [season.id]
  );

  return true;
}

async function getWorldCupGroupStandings(seasonId, dbClient = pool) {
  const matchesResult = await dbClient.query(
    `SELECT group_name,
            home_franchise_id,
            away_franchise_id,
            winner_franchise_id,
            home_score,
            home_balls,
            away_score,
            away_balls
     FROM matches
     WHERE season_id = $1
       AND stage = 'WORLD_CUP_GROUP'
       AND status = 'COMPLETED'
     ORDER BY id ASC`,
    [seasonId]
  );

  const teamMetaResult = await dbClient.query(
    `SELECT st.franchise_id,
            f.franchise_name,
            c.country
     FROM season_teams st
     JOIN franchises f ON f.id = st.franchise_id
     JOIN cities c ON c.id = f.city_id
     WHERE st.season_id = $1`,
    [seasonId]
  );

  const metaMap = new Map(teamMetaResult.rows.map((row) => [Number(row.franchise_id), row]));
  const groupMap = new Map();

  for (const match of matchesResult.rows) {
    const groupName = String(match.group_name || '');
    if (!groupName) {
      continue;
    }
    if (!groupMap.has(groupName)) {
      groupMap.set(groupName, new Map());
    }
    const standings = groupMap.get(groupName);
    const homeId = Number(match.home_franchise_id);
    const awayId = Number(match.away_franchise_id);
    for (const franchiseId of [homeId, awayId]) {
      if (!standings.has(franchiseId)) {
        const meta = metaMap.get(franchiseId) || {};
        standings.set(franchiseId, {
          franchise_id: franchiseId,
          franchise_name: meta.franchise_name || `Team ${franchiseId}`,
          country: meta.country || '',
          played: 0,
          won: 0,
          lost: 0,
          tied: 0,
          points: 0,
          runs_for: 0,
          balls_faced: 0,
          runs_against: 0,
          balls_bowled: 0,
          net_run_rate: 0
        });
      }
    }

    const home = standings.get(homeId);
    const away = standings.get(awayId);
    const homeScore = Number(match.home_score || 0);
    const awayScore = Number(match.away_score || 0);
    const homeBalls = Number(match.home_balls || 120);
    const awayBalls = Number(match.away_balls || 120);
    const winnerId = Number(match.winner_franchise_id || 0);
    const tie = !winnerId && homeScore === awayScore;

    home.played += 1;
    away.played += 1;
    home.runs_for += homeScore;
    home.balls_faced += homeBalls;
    home.runs_against += awayScore;
    home.balls_bowled += awayBalls;
    away.runs_for += awayScore;
    away.balls_faced += awayBalls;
    away.runs_against += homeScore;
    away.balls_bowled += homeBalls;

    if (tie) {
      home.tied += 1;
      away.tied += 1;
      home.points += 1;
      away.points += 1;
    } else if (winnerId === homeId) {
      home.won += 1;
      away.lost += 1;
      home.points += 2;
    } else if (winnerId === awayId) {
      away.won += 1;
      home.lost += 1;
      away.points += 2;
    }
  }

  return [...groupMap.entries()].map(([groupName, standingsMap]) => ({
    groupName,
    rows: [...standingsMap.values()]
      .map((row) => ({
        ...row,
        net_run_rate:
          row.balls_faced > 0 && row.balls_bowled > 0
            ? Number((((row.runs_for / row.balls_faced) * 6) - ((row.runs_against / row.balls_bowled) * 6)).toFixed(3))
            : 0
      }))
      .sort(compareRankingRows)
  })).sort((a, b) => a.groupName.localeCompare(b.groupName));
}

async function createWorldCupQuarterfinals(seasonId, dbClient = pool) {
  const existing = await dbClient.query(
    `SELECT COUNT(*)::int AS count
     FROM matches
     WHERE season_id = $1
       AND stage = 'WORLD_CUP_QF'`,
    [seasonId]
  );
  if (Number(existing.rows[0]?.count || 0) > 0) {
    return false;
  }

  const remainingGroups = await dbClient.query(
    `SELECT COUNT(*)::int AS count
     FROM matches
     WHERE season_id = $1
       AND stage = 'WORLD_CUP_GROUP'
       AND status <> 'COMPLETED'`,
    [seasonId]
  );
  if (Number(remainingGroups.rows[0]?.count || 0) > 0) {
    return false;
  }

  const groups = await getWorldCupGroupStandings(seasonId, dbClient);
  if (groups.length < 4 || groups.some((group) => group.rows.length < 2)) {
    return false;
  }

  const pairings = [
    [groups[0].rows[0], groups[1].rows[1], 'Quarterfinal 1'],
    [groups[1].rows[0], groups[0].rows[1], 'Quarterfinal 2'],
    [groups[2].rows[0], groups[3].rows[1], 'Quarterfinal 3'],
    [groups[3].rows[0], groups[2].rows[1], 'Quarterfinal 4']
  ];

  const latestGroupDateResult = await dbClient.query(
    `SELECT MAX(DATE(scheduled_at))::date AS max_date
     FROM matches
     WHERE season_id = $1
       AND stage = 'WORLD_CUP_GROUP'`,
    [seasonId]
  );
  const baseDate = addDays(latestGroupDateResult.rows[0]?.max_date, 3);
  const matchRows = pairings.map(([home, away, label], index) => {
    const scheduled = addDays(baseDate, Math.floor(index / 2));
    scheduled.setUTCHours(11 + (index % 2) * 5, 0, 0, 0);
    return {
      season_id: Number(seasonId),
      home_franchise_id: Number(home.franchise_id),
      away_franchise_id: Number(away.franchise_id),
      series_id: null,
      series_match_no: null,
      stage: 'WORLD_CUP_QF',
      group_name: null,
      league_tier: 1,
      round_no: 2000 + index + 1,
      matchday_label: `World Cup ${label}`,
      scheduled_at: scheduled.toISOString(),
      status: 'SCHEDULED'
    };
  });

  await batchInsert(
    dbClient,
    'matches',
    ['season_id', 'home_franchise_id', 'away_franchise_id', 'series_id', 'series_match_no', 'stage', 'group_name', 'league_tier', 'round_no', 'matchday_label', 'scheduled_at', 'status'],
    matchRows
  );
  await dbClient.query(`UPDATE seasons SET current_phase = 'WORLD_CUP_KNOCKOUT' WHERE id = $1`, [seasonId]);
  return true;
}

async function createWorldCupSemifinals(seasonId, dbClient = pool) {
  const existing = await dbClient.query(
    `SELECT COUNT(*)::int AS count
     FROM matches
     WHERE season_id = $1
       AND stage = 'WORLD_CUP_SF'`,
    [seasonId]
  );
  if (Number(existing.rows[0]?.count || 0) > 0) {
    return false;
  }

  const remaining = await dbClient.query(
    `SELECT COUNT(*)::int AS count
     FROM matches
     WHERE season_id = $1
       AND stage = 'WORLD_CUP_QF'
       AND status <> 'COMPLETED'`,
    [seasonId]
  );
  if (Number(remaining.rows[0]?.count || 0) > 0) {
    return false;
  }

  const winners = await dbClient.query(
    `SELECT winner_franchise_id
     FROM matches
     WHERE season_id = $1
       AND stage = 'WORLD_CUP_QF'
       AND status = 'COMPLETED'
     ORDER BY round_no ASC, id ASC`,
    [seasonId]
  );
  const ids = winners.rows.map((row) => Number(row.winner_franchise_id || 0)).filter(Boolean);
  if (ids.length < 4) {
    return false;
  }

  const latestDateResult = await dbClient.query(
    `SELECT MAX(DATE(scheduled_at))::date AS max_date
     FROM matches
     WHERE season_id = $1
       AND stage = 'WORLD_CUP_QF'`,
    [seasonId]
  );
  const baseDate = addDays(latestDateResult.rows[0]?.max_date, 3);
  const pairings = [
    [ids[0], ids[1], 'Semifinal 1'],
    [ids[2], ids[3], 'Semifinal 2']
  ];

  const matchRows = pairings.map(([homeId, awayId, label], index) => {
    const scheduled = addDays(baseDate, index);
    scheduled.setUTCHours(14, 0, 0, 0);
    return {
      season_id: Number(seasonId),
      home_franchise_id: Number(homeId),
      away_franchise_id: Number(awayId),
      series_id: null,
      series_match_no: null,
      stage: 'WORLD_CUP_SF',
      group_name: null,
      league_tier: 1,
      round_no: 3000 + index + 1,
      matchday_label: `World Cup ${label}`,
      scheduled_at: scheduled.toISOString(),
      status: 'SCHEDULED'
    };
  });

  await batchInsert(
    dbClient,
    'matches',
    ['season_id', 'home_franchise_id', 'away_franchise_id', 'series_id', 'series_match_no', 'stage', 'group_name', 'league_tier', 'round_no', 'matchday_label', 'scheduled_at', 'status'],
    matchRows
  );
  return true;
}

async function createWorldCupFinal(seasonId, dbClient = pool) {
  const existing = await dbClient.query(
    `SELECT COUNT(*)::int AS count
     FROM matches
     WHERE season_id = $1
       AND stage = 'WORLD_CUP_FINAL'`,
    [seasonId]
  );
  if (Number(existing.rows[0]?.count || 0) > 0) {
    return false;
  }

  const remaining = await dbClient.query(
    `SELECT COUNT(*)::int AS count
     FROM matches
     WHERE season_id = $1
       AND stage = 'WORLD_CUP_SF'
       AND status <> 'COMPLETED'`,
    [seasonId]
  );
  if (Number(remaining.rows[0]?.count || 0) > 0) {
    return false;
  }

  const winners = await dbClient.query(
    `SELECT winner_franchise_id
     FROM matches
     WHERE season_id = $1
       AND stage = 'WORLD_CUP_SF'
       AND status = 'COMPLETED'
     ORDER BY round_no ASC, id ASC`,
    [seasonId]
  );
  const ids = winners.rows.map((row) => Number(row.winner_franchise_id || 0)).filter(Boolean);
  if (ids.length < 2) {
    return false;
  }

  const latestDateResult = await dbClient.query(
    `SELECT MAX(DATE(scheduled_at))::date AS max_date
     FROM matches
     WHERE season_id = $1
       AND stage = 'WORLD_CUP_SF'`,
    [seasonId]
  );
  const scheduled = addDays(latestDateResult.rows[0]?.max_date, 4);
  scheduled.setUTCHours(15, 0, 0, 0);

  await dbClient.query(
    `INSERT INTO matches (
      season_id,
      home_franchise_id,
      away_franchise_id,
      series_id,
      series_match_no,
      stage,
      group_name,
      league_tier,
      round_no,
      matchday_label,
      scheduled_at,
      status
    ) VALUES ($1, $2, $3, NULL, NULL, 'WORLD_CUP_FINAL', NULL, 1, 4001, 'World Cup Final', $4, 'SCHEDULED')`,
    [seasonId, ids[0], ids[1], scheduled.toISOString()]
  );
  return true;
}

async function finalizeInternationalSeason(seasonId, dbClient = pool) {
  const seasonResult = await dbClient.query(
    `SELECT status
     FROM seasons
     WHERE id = $1`,
    [seasonId]
  );
  if (!seasonResult.rows.length || String(seasonResult.rows[0].status || '').toUpperCase() === 'COMPLETED') {
    return false;
  }

  const finalResult = await dbClient.query(
    `SELECT winner_franchise_id
     FROM matches
     WHERE season_id = $1
       AND stage = 'WORLD_CUP_FINAL'
       AND status = 'COMPLETED'
     LIMIT 1`,
    [seasonId]
  );
  const championId = Number(finalResult.rows[0]?.winner_franchise_id || 0);
  if (!championId) {
    return false;
  }

  await dbClient.query(
    `UPDATE franchises
     SET championships = championships + 1,
         fan_rating = LEAST(100, fan_rating + 5)
     WHERE id = $1`,
    [championId]
  );

  await dbClient.query(
    `INSERT INTO trophy_cabinet (franchise_id, season_id, title)
     VALUES ($1, $2, 'International T20 World Cup')`,
    [championId, seasonId]
  );

  await dbClient.query(
    `UPDATE seasons
     SET status = 'COMPLETED',
         current_phase = 'COMPLETED',
         end_date = CURRENT_DATE
     WHERE id = $1`,
    [seasonId]
  );

  return true;
}

export async function maybeProgressInternationalCompetition(seasonId, dbClient = pool) {
  const season = await getSeasonContext(seasonId, dbClient);
  if (!season || normalizeCareerMode(season.competition_mode || CAREER_MODES.CLUB) !== CAREER_MODES.INTERNATIONAL) {
    return { state: 'IGNORED' };
  }

  const bilateralRemaining = Number(
    (
      await dbClient.query(
        `SELECT COUNT(*)::int AS count
         FROM matches
         WHERE season_id = $1
           AND stage = 'SERIES'
           AND status <> 'COMPLETED'`,
        [seasonId]
      )
    ).rows[0]?.count || 0
  );

  const wcGroupRemaining = Number(
    (
      await dbClient.query(
        `SELECT COUNT(*)::int AS count
         FROM matches
         WHERE season_id = $1
           AND stage = 'WORLD_CUP_GROUP'
           AND status <> 'COMPLETED'`,
        [seasonId]
      )
    ).rows[0]?.count || 0
  );

  const wcQfRemaining = Number(
    (
      await dbClient.query(
        `SELECT COUNT(*)::int AS count
         FROM matches
         WHERE season_id = $1
           AND stage = 'WORLD_CUP_QF'
           AND status <> 'COMPLETED'`,
        [seasonId]
      )
    ).rows[0]?.count || 0
  );

  const wcSfRemaining = Number(
    (
      await dbClient.query(
        `SELECT COUNT(*)::int AS count
         FROM matches
         WHERE season_id = $1
           AND stage = 'WORLD_CUP_SF'
           AND status <> 'COMPLETED'`,
        [seasonId]
      )
    ).rows[0]?.count || 0
  );

  const wcFinalRemaining = Number(
    (
      await dbClient.query(
        `SELECT COUNT(*)::int AS count
         FROM matches
         WHERE season_id = $1
           AND stage = 'WORLD_CUP_FINAL'
           AND status <> 'COMPLETED'`,
        [seasonId]
      )
    ).rows[0]?.count || 0
  );

  if (bilateralRemaining === 0) {
    if (!season.world_cup_generated_at) {
      const created = await createWorldCupGroupMatches(season, dbClient);
      if (created) {
        return { state: 'WORLD_CUP_CREATED' };
      }
    }

    if (wcGroupRemaining === 0) {
      const qfCreated = await createWorldCupQuarterfinals(seasonId, dbClient);
      if (qfCreated) {
        return { state: 'WORLD_CUP_QF_CREATED' };
      }
    }

    if (wcQfRemaining === 0) {
      const sfCreated = await createWorldCupSemifinals(seasonId, dbClient);
      if (sfCreated) {
        return { state: 'WORLD_CUP_SF_CREATED' };
      }
    }

    if (wcSfRemaining === 0) {
      const finalCreated = await createWorldCupFinal(seasonId, dbClient);
      if (finalCreated) {
        return { state: 'WORLD_CUP_FINAL_CREATED' };
      }
    }

    if (wcFinalRemaining === 0) {
      const completed = await finalizeInternationalSeason(seasonId, dbClient);
      return { state: completed ? 'SEASON_COMPLETED' : 'PROGRESSED' };
    }
  }

  return { state: 'PROGRESSED' };
}

export async function ensureInternationalCycleSchedule(seasonId, dbClient = pool, options = {}) {
  const season = await getSeasonContext(seasonId, dbClient);
  if (!season || normalizeCareerMode(season.competition_mode || CAREER_MODES.CLUB) !== CAREER_MODES.INTERNATIONAL) {
    return { insertedSeries: 0, insertedMatches: 0, skipped: true };
  }

  const existingSeriesCount = Number(
    (
      await dbClient.query(
        `SELECT COUNT(*)::int AS count
         FROM international_series
         WHERE season_id = $1`,
        [seasonId]
      )
    ).rows[0]?.count || 0
  );
  const existingMatchCount = Number(
    (
      await dbClient.query(
        `SELECT COUNT(*)::int AS count
         FROM matches
         WHERE season_id = $1`,
        [seasonId]
      )
    ).rows[0]?.count || 0
  );
  const legacyRegularCount = Number(
    (
      await dbClient.query(
        `SELECT COUNT(*)::int AS count
         FROM matches
         WHERE season_id = $1
           AND stage = 'REGULAR'`,
        [seasonId]
      )
    ).rows[0]?.count || 0
  );

  const shouldRebuild = Boolean(options.forceRebuild) || (!season.ftp_generated_at && (legacyRegularCount > 0 || existingSeriesCount > 0 || existingMatchCount > 0));
  if (season.ftp_generated_at && !shouldRebuild) {
    return { insertedSeries: 0, insertedMatches: 0, skipped: true };
  }

  if (shouldRebuild || existingSeriesCount > 0 || existingMatchCount > 0) {
    await dbClient.query(`DELETE FROM matches WHERE season_id = $1`, [seasonId]);
    await dbClient.query(`DELETE FROM international_series WHERE season_id = $1`, [seasonId]);
    await resetInternationalStandings(seasonId, dbClient);
  }

  const teams = await getInternationalTeamsForSeason(seasonId, dbClient);
  const teamIds = teams.map((team) => Number(team.franchiseId)).sort((a, b) => a - b);
  if (teamIds.length < 2) {
    return { insertedSeries: 0, insertedMatches: 0, skipped: true };
  }

  const teamMap = new Map(teams.map((team) => [Number(team.franchiseId), team]));
  const previousVenueMap = await getPreviousVenueMap(season, dbClient);
  const rounds = generateRoundRobin(teamIds);
  const cycleDates = buildCycleSeasonDates(season);
  const seasonStart = cycleDates.cycleStart;

  const seriesRows = [];
  const matchRows = [];
  let seriesIdCounter = 1;

  for (let roundIndex = 0; roundIndex < rounds.length; roundIndex += 1) {
    const roundNo = roundIndex + 1;
    const startDate = addDays(seasonStart, roundIndex * SERIES_INTERVAL_DAYS);
    const endDate = addDays(startDate, SERIES_MATCH_OFFSETS[SERIES_MATCH_OFFSETS.length - 1]);
    const cycleYear = determineCycleYear({ cycle_start_date: seasonStart }, startDate);

    for (const [teamAId, teamBId] of rounds[roundIndex]) {
      const pairKey = buildPairKey(teamAId, teamBId);
      const homeId = chooseHomeTeam(teamAId, teamBId, pairKey, previousVenueMap, season.season_number);
      const awayId = Number(homeId) === Number(teamAId) ? Number(teamBId) : Number(teamAId);
      const nominalVenue = Number(homeId) === Number(teamAId) ? 'HOME' : 'AWAY';
      const seriesTitle = `${teamMap.get(homeId)?.franchiseName || `Team ${homeId}`} vs ${teamMap.get(awayId)?.franchiseName || `Team ${awayId}`}`;

      seriesRows.push({
        season_id: Number(seasonId),
        manager_franchise_id: Number(teamAId),
        opponent_franchise_id: Number(teamBId),
        home_franchise_id: Number(homeId),
        away_franchise_id: Number(awayId),
        created_by_user_id: null,
        window_no: roundNo,
        venue: nominalVenue,
        anchor_round_no: roundNo,
        title: seriesTitle,
        pair_key: pairKey,
        series_type: 'BILATERAL',
        cycle_year: cycleYear,
        start_date: formatDate(startDate),
        end_date: formatDate(endDate)
      });

      const generatedSeriesId = seriesIdCounter;
      seriesIdCounter += 1;

      for (let matchIndex = 0; matchIndex < SERIES_MATCH_OFFSETS.length; matchIndex += 1) {
        const scheduledDate = addDays(startDate, SERIES_MATCH_OFFSETS[matchIndex]);
        scheduledDate.setUTCHours(13 + ((matchIndex + roundIndex) % 2) * 5, 0, 0, 0);

        matchRows.push({
          season_id: Number(seasonId),
          home_franchise_id: Number(homeId),
          away_franchise_id: Number(awayId),
          series_id: generatedSeriesId,
          series_match_no: matchIndex + 1,
          stage: 'SERIES',
          group_name: null,
          league_tier: 1,
          round_no: roundNo,
          matchday_label: `FTP Round ${roundNo} - Match ${matchIndex + 1}`,
          scheduled_at: scheduledDate.toISOString(),
          status: 'SCHEDULED'
        });
      }
    }
  }

  await batchInsert(
    dbClient,
    'international_series',
    [
      'season_id',
      'manager_franchise_id',
      'opponent_franchise_id',
      'home_franchise_id',
      'away_franchise_id',
      'created_by_user_id',
      'window_no',
      'venue',
      'anchor_round_no',
      'title',
      'pair_key',
      'series_type',
      'cycle_year',
      'start_date',
      'end_date'
    ],
    seriesRows
  );

  const insertedSeries = await dbClient.query(
    `SELECT id, pair_key
     FROM international_series
     WHERE season_id = $1
     ORDER BY id ASC`,
    [seasonId]
  );
  const seriesIdByPair = new Map(insertedSeries.rows.map((row) => [row.pair_key, Number(row.id)]));
  for (const row of matchRows) {
    const pairKey = buildPairKey(row.home_franchise_id, row.away_franchise_id);
    row.series_id = seriesIdByPair.get(pairKey) || null;
  }

  await batchInsert(
    dbClient,
    'matches',
    ['season_id', 'home_franchise_id', 'away_franchise_id', 'series_id', 'series_match_no', 'stage', 'group_name', 'league_tier', 'round_no', 'matchday_label', 'scheduled_at', 'status'],
    matchRows
  );

  await dbClient.query(
    `UPDATE seasons
     SET start_date = COALESCE(start_date, $2::date),
         calendar_date = COALESCE(calendar_date, $2::date),
         cycle_start_date = COALESCE(cycle_start_date, $2::date),
         cycle_end_date = COALESCE(cycle_end_date, $3::date),
         cycle_length_years = COALESCE(NULLIF(cycle_length_years, 0), $4),
         current_cycle_year = COALESCE(NULLIF(current_cycle_year, 0), 1),
         current_phase = 'FTP',
         league_count = 1,
         teams_per_league = team_count,
         ftp_generated_at = NOW()
     WHERE id = $1`,
    [seasonId, formatDate(seasonStart), formatDate(cycleDates.nominalCycleEnd), INTERNATIONAL_CYCLE_YEARS]
  );

  await resetInternationalStandings(seasonId, dbClient);
  await refreshInternationalPositions(seasonId, dbClient);

  return {
    insertedSeries: seriesRows.length,
    insertedMatches: matchRows.length,
    skipped: false
  };
}

export async function ensureCpuInternationalSeries(seasonId, dbClient = pool) {
  return ensureInternationalCycleSchedule(seasonId, dbClient);
}

async function buildRankings(seasonId, dbClient = pool) {
  const table = await dbClient.query(
    `SELECT st.franchise_id,
            COALESCE(st.position, st.league_position)::int AS rank,
            st.played,
            st.won,
            st.lost,
            st.tied,
            st.points,
            st.net_run_rate,
            st.runs_for,
            st.runs_against,
            f.franchise_name,
            c.country
     FROM season_teams st
     JOIN franchises f ON f.id = st.franchise_id
     JOIN cities c ON c.id = f.city_id
     WHERE st.season_id = $1
     ORDER BY COALESCE(st.position, st.league_position, 999) ASC,
              st.points DESC,
              st.net_run_rate DESC,
              st.won DESC,
              st.runs_for DESC,
              st.franchise_id ASC`,
    [seasonId]
  );
  return table.rows;
}

export async function getManagedInternationalTeam(userId, seasonId, dbClient = pool) {
  const result = await dbClient.query(
    `SELECT f.id AS franchise_id,
            f.franchise_name,
            c.name AS city_name,
            c.country,
            COALESCE(st.position, st.league_position)::int AS world_rank,
            st.played,
            st.won,
            st.lost,
            st.tied,
            st.points,
            st.net_run_rate
     FROM franchises f
     JOIN cities c ON c.id = f.city_id
     JOIN season_teams st ON st.franchise_id = f.id AND st.season_id = $2
     WHERE f.owner_user_id = $1
       AND COALESCE(NULLIF(f.competition_mode, ''), 'CLUB') = 'INTERNATIONAL'
     LIMIT 1`,
    [userId, seasonId]
  );

  return result.rows[0] || null;
}

export async function getInternationalCalendar(userId, seasonId, dbClient = pool, options = {}) {
  const season = await getSeasonContext(seasonId, dbClient);
  if (!season || normalizeCareerMode(season.competition_mode || CAREER_MODES.CLUB) !== CAREER_MODES.INTERNATIONAL) {
    const error = new Error('International calendar is only available in international mode.');
    error.status = 400;
    throw error;
  }

  await ensureInternationalCycleSchedule(seasonId, dbClient);
  const managedTeam = await getManagedInternationalTeam(userId, seasonId, dbClient);
  if (!managedTeam) {
    const error = new Error('No managed international team found for this season.');
    error.status = 404;
    throw error;
  }

  const currentDate = parseDate(season.calendar_date || season.cycle_start_date || season.start_date);
  const offsetDays = toNumber(options.offsetDays, 0);
  const spanDays = Math.max(1, Math.min(45, toNumber(options.spanDays, CALENDAR_DEFAULT_SPAN_DAYS)));
  const viewStart = addDays(currentDate, offsetDays);
  const viewEnd = addDays(viewStart, spanDays - 1);
  const matchRows = await getDetailedMatchRows(seasonId, viewStart, viewEnd, dbClient);
  const rankings = await buildRankings(seasonId, dbClient);
  const seriesRows = await getSeriesRowsForTeams(seasonId, [Number(managedTeam.franchise_id)], dbClient);
  const seriesMatches = await getSeriesMatches(seriesRows.map((row) => Number(row.id)), dbClient);
  const upcomingSeries = buildSeriesPayload(seriesRows, seriesMatches)
    .filter((series) => formatDate(series.endDate) >= formatDate(currentDate))
    .slice(0, 8);
  const todayMatches = matchRows.filter((row) => formatDate(row.scheduled_at) === formatDate(currentDate));

  return {
    seasonId: Number(seasonId),
    season: {
      id: Number(season.id),
      seasonNumber: Number(season.season_number),
      name: season.name,
      year: Number(season.year),
      competitionMode: season.competition_mode,
      currentPhase: season.current_phase || 'FTP',
      currentDate: formatDate(currentDate),
      cycleYear: determineCycleYear(season, currentDate),
      cycleLengthYears: Number(season.cycle_length_years || INTERNATIONAL_CYCLE_YEARS),
      cycleStartDate: formatDate(season.cycle_start_date || season.start_date),
      cycleEndDate: formatDate(season.cycle_end_date),
      worldCupGeneratedAt: season.world_cup_generated_at
    },
    managedTeam: {
      franchiseId: Number(managedTeam.franchise_id),
      franchiseName: managedTeam.franchise_name,
      cityName: managedTeam.city_name,
      country: managedTeam.country,
      worldRank: Number(managedTeam.world_rank || 0),
      played: Number(managedTeam.played || 0),
      won: Number(managedTeam.won || 0),
      lost: Number(managedTeam.lost || 0),
      tied: Number(managedTeam.tied || 0),
      points: Number(managedTeam.points || 0),
      netRunRate: Number(managedTeam.net_run_rate || 0)
    },
    view: {
      startDate: formatDate(viewStart),
      endDate: formatDate(viewEnd),
      spanDays
    },
    todayMatches,
    dayGroups: buildDayGroups(matchRows, Number(managedTeam.franchise_id)),
    rankings,
    upcomingSeries,
    worldCupGroups: await getWorldCupGroupStandings(seasonId, dbClient)
  };
}

export async function getInternationalCalendarOverview(seasonId, dbClient = pool, options = {}) {
  const season = await getSeasonContext(seasonId, dbClient);
  if (!season || normalizeCareerMode(season.competition_mode || CAREER_MODES.CLUB) !== CAREER_MODES.INTERNATIONAL) {
    const error = new Error('International calendar overview is only available in international mode.');
    error.status = 400;
    throw error;
  }

  await ensureInternationalCycleSchedule(seasonId, dbClient);

  const currentDate = parseDate(season.calendar_date || season.cycle_start_date || season.start_date);
  const offsetDays = toNumber(options.offsetDays, 0);
  const spanDays = Math.max(1, Math.min(45, toNumber(options.spanDays, CALENDAR_DEFAULT_SPAN_DAYS)));
  const viewStart = addDays(currentDate, offsetDays);
  const viewEnd = addDays(viewStart, spanDays - 1);
  const rankings = await buildRankings(seasonId, dbClient);
  const matchRows = await getDetailedMatchRows(seasonId, viewStart, viewEnd, dbClient);
  const seriesRows = await dbClient.query(
    `SELECT *
     FROM international_series
     WHERE season_id = $1
       AND start_date <= $3::date
       AND end_date >= $2::date
     ORDER BY start_date ASC, id ASC`,
    [seasonId, formatDate(viewStart), formatDate(viewEnd)]
  );
  const seriesMatches = await getSeriesMatches(seriesRows.rows.map((row) => Number(row.id)), dbClient);

  return {
    seasonId: Number(seasonId),
    season: {
      id: Number(season.id),
      name: season.name,
      seasonNumber: Number(season.season_number),
      currentDate: formatDate(currentDate),
      currentPhase: season.current_phase || 'FTP',
      cycleYear: determineCycleYear(season, currentDate)
    },
    view: {
      startDate: formatDate(viewStart),
      endDate: formatDate(viewEnd),
      spanDays
    },
    teams: rankings.map((row) => ({
      franchiseId: Number(row.franchise_id),
      franchiseName: row.franchise_name,
      country: row.country,
      rank: Number(row.rank || 0),
      points: Number(row.points || 0),
      netRunRate: Number(row.net_run_rate || 0)
    })),
    rankings,
    dayGroups: buildDayGroups(matchRows),
    activeSeries: buildSeriesPayload(seriesRows.rows, seriesMatches),
    worldCupGroups: await getWorldCupGroupStandings(seasonId, dbClient)
  };
}

export async function getSeriesMatchesForManager(userId, seriesId, dbClient = pool) {
  const managed = await dbClient.query(
    `SELECT f.id AS franchise_id
     FROM franchises f
     WHERE f.owner_user_id = $1
       AND COALESCE(NULLIF(f.competition_mode, ''), 'CLUB') = 'INTERNATIONAL'
     LIMIT 1`,
    [userId]
  );

  const rows = await dbClient.query(
    `SELECT m.*
     FROM matches m
     JOIN international_series s ON s.id = m.series_id
     WHERE s.id = $1
     ORDER BY m.series_match_no ASC, m.id ASC`,
    [seriesId]
  );

  if (!managed.rows.length) {
    return [];
  }

  const franchiseId = Number(managed.rows[0].franchise_id || 0);
  if (!rows.rows.length) {
    return [];
  }

  const first = rows.rows[0];
  const series = await dbClient.query(
    `SELECT manager_franchise_id,
            opponent_franchise_id
     FROM international_series
     WHERE id = $1`,
    [seriesId]
  );
  const belongs = series.rows.length && (
    Number(series.rows[0].manager_franchise_id) === franchiseId ||
    Number(series.rows[0].opponent_franchise_id) === franchiseId ||
    Number(first.home_franchise_id) === franchiseId ||
    Number(first.away_franchise_id) === franchiseId
  );

  return belongs ? rows.rows : [];
}

export async function scheduleInternationalSeries() {
  const error = new Error('International FTP is auto-generated. Manual bilateral scheduling is disabled in this format.');
  error.status = 409;
  throw error;
}
