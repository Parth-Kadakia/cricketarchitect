import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import pool, { withTransaction } from '../config/db.js';
import { requireAdmin, requireAuth, optionalAuth } from '../middleware/auth.js';
import asyncHandler from '../utils/asyncHandler.js';
import {
  createSeason,
  ensureActiveSeason,
  generateDoubleRoundRobinFixtures,
  getLeagueTable,
  getSeasonPlayerLeaders,
  getSeasonRoundOverview,
  getSeasonSummary,
  listSeasons
} from '../services/leagueService.js';
import {
  getMatchScorecard,
  isMatchSimulationRunning,
  simulateInternationalNextDay,
  simulateLeagueRound,
  simulateMatchLive,
  simulateMatchOutsideCenter,
  simulateHalfSeason,
  simulateMyLeagueRound,
  simulateRound,
  simulateSeasonToEnd
} from '../services/matchEngine.js';
import {
  getInternationalCalendar,
  getInternationalCalendarOverview,
  getSeriesMatchesForManager,
  scheduleInternationalSeries
} from '../services/internationalCalendarService.js';
import { runCpuMarketCycle } from '../services/cpuManagerService.js';
import { broadcast } from '../ws/realtime.js';
import { CAREER_MODES, normalizeCareerMode } from '../constants/gameModes.js';

const router = Router();

function resolveOperationId(req, prefix = 'sim') {
  const fromBody = String(req.body?.operationId || '').trim();
  if (fromBody) {
    return fromBody.slice(0, 96);
  }

  return `${prefix}-${randomUUID()}`;
}

function pushSimulationProgress(payload) {
  broadcast('league:simulation_progress', payload, 'league');
}

async function shouldRunCpuCycleForSeason(seasonId) {
  const season = await pool.query(
    `SELECT competition_mode
     FROM seasons
     WHERE id = $1`,
    [seasonId]
  );
  return normalizeCareerMode(season.rows[0]?.competition_mode || CAREER_MODES.CLUB) === CAREER_MODES.CLUB;
}

async function getActiveSeasonMode(worldId) {
  const activeSeason = await ensureActiveSeason(pool, worldId);
  if (!activeSeason) {
    return { season: null, mode: CAREER_MODES.CLUB };
  }
  return {
    season: activeSeason,
    mode: normalizeCareerMode(activeSeason.competition_mode || CAREER_MODES.CLUB)
  };
}

router.get(
  '/seasons',
  optionalAuth,
  asyncHandler(async (req, res) => {
    const worldId = req.user?.active_world_id || null;
    if (!worldId) return res.json({ seasons: [] });
    const seasons = await listSeasons(Math.max(5, Math.min(30, Number(req.query.limit || 12))), worldId);
    return res.json({ seasons });
  })
);

router.get(
  '/seasons/active',
  optionalAuth,
  asyncHandler(async (req, res) => {
    const worldId = req.user?.active_world_id || null;
    if (!worldId) return res.json({ season: null });
    const season = await ensureActiveSeason(pool, worldId);
    return res.json({ season });
  })
);

router.get(
  '/seasons/:seasonId/summary',
  optionalAuth,
  asyncHandler(async (req, res) => {
    const worldId = req.user?.active_world_id || null;
    if (!worldId) return res.status(403).json({ message: 'Claim a franchise to view season data.' });
    const check = await pool.query('SELECT id FROM seasons WHERE id = $1 AND world_id = $2', [req.params.seasonId, worldId]);
    if (!check.rows.length) return res.status(403).json({ message: 'Season not found in your world.' });
    const summary = await getSeasonSummary(req.params.seasonId, pool);
    if (!summary) {
      return res.status(404).json({ message: 'Season not found.' });
    }
    return res.json(summary);
  })
);

router.get(
  '/seasons/:seasonId/stats',
  optionalAuth,
  asyncHandler(async (req, res) => {
    const seasonId = Number(req.params.seasonId || 0);
    if (!seasonId) {
      return res.status(400).json({ message: 'Invalid season id.' });
    }
    const worldId = req.user?.active_world_id || null;
    if (!worldId) return res.status(403).json({ message: 'Claim a franchise to view stats.' });
    const check = await pool.query('SELECT id FROM seasons WHERE id = $1 AND world_id = $2', [seasonId, worldId]);
    if (!check.rows.length) return res.status(403).json({ message: 'Season not found in your world.' });

    const leaders = await getSeasonPlayerLeaders(seasonId, pool);
    return res.json(leaders);
  })
);

/* ── All-time player leaderboards ── */
router.get(
  '/all-stats',
  optionalAuth,
  asyncHandler(async (req, res) => {
    const limit = Math.min(Number(req.query.limit) || 100, 200);
    const seasonFilter = Number(req.query.seasonId) || null;
    const worldId = req.user?.active_world_id || null;

    if (!worldId) return res.json({ batting: [], bowling: [], allRounders: [], seasons: [] });

    if (seasonFilter) {
      const check = await pool.query('SELECT id FROM seasons WHERE id = $1 AND world_id = $2', [seasonFilter, worldId]);
      if (!check.rows.length) return res.status(403).json({ message: 'Season not found in your world.' });
    }

    const conditions = [];
    const params = [];
    if (seasonFilter) {
      params.push(seasonFilter);
      conditions.push(`AND m.season_id = $${params.length}`);
    } else {
      params.push(worldId);
      conditions.push(`AND m.season_id IN (SELECT id FROM seasons WHERE world_id = $${params.length})`);
    }
    const filterClause = conditions.join(' ');
    const limitParam = `$${params.length + 1}`;

    const batting = await pool.query(
      `SELECT p.id AS player_id,
              p.first_name,
              p.last_name,
              p.role,
              p.age,
              f.id AS franchise_id,
              f.franchise_name,
              COUNT(*)::int AS matches,
              COUNT(*) FILTER (WHERE pms.batting_balls > 0)::int AS innings,
              SUM(pms.batting_runs)::int AS runs,
              SUM(pms.batting_balls)::int AS balls,
              SUM(pms.fours)::int AS fours,
              SUM(pms.sixes)::int AS sixes,
              MAX(pms.batting_runs)::int AS highest_score,
              COUNT(*) FILTER (WHERE pms.not_out)::int AS not_outs,
              COALESCE(ROUND(SUM(pms.batting_runs)::numeric / NULLIF(COUNT(*) FILTER (WHERE NOT pms.not_out AND pms.batting_balls > 0), 0), 2), 0) AS average,
              COALESCE(ROUND((SUM(pms.batting_runs)::numeric * 100) / NULLIF(SUM(pms.batting_balls), 0), 2), 0) AS strike_rate,
              ROUND(AVG(pms.player_rating), 2) AS avg_rating
       FROM player_match_stats pms
       JOIN matches m ON m.id = pms.match_id
       JOIN players p ON p.id = pms.player_id
       JOIN franchises f ON f.id = p.franchise_id
       WHERE m.status = 'COMPLETED' ${filterClause}
       GROUP BY p.id, p.first_name, p.last_name, p.role, p.age, f.id, f.franchise_name
       HAVING SUM(pms.batting_balls) > 0
       ORDER BY runs DESC, strike_rate DESC
       LIMIT ${limitParam}`,
      [...params, limit]
    );

    const bowling = await pool.query(
      `SELECT p.id AS player_id,
              p.first_name,
              p.last_name,
              p.role,
              p.age,
              f.id AS franchise_id,
              f.franchise_name,
              COUNT(*)::int AS matches,
              SUM(pms.bowling_balls)::int AS bowling_balls,
              SUM(pms.bowling_runs)::int AS runs_conceded,
              SUM(pms.bowling_wickets)::int AS wickets,
              SUM(pms.maiden_overs)::int AS maidens,
              MAX(pms.bowling_wickets)::int AS best_wickets,
              COALESCE(ROUND(SUM(pms.bowling_runs)::numeric / NULLIF(SUM(pms.bowling_wickets), 0), 2), 0) AS average,
              COALESCE(ROUND((SUM(pms.bowling_runs)::numeric * 6) / NULLIF(SUM(pms.bowling_balls), 0), 2), 0) AS economy,
              ROUND(AVG(pms.player_rating), 2) AS avg_rating
      FROM player_match_stats pms
      JOIN matches m ON m.id = pms.match_id
      JOIN players p ON p.id = pms.player_id
      JOIN franchises f ON f.id = p.franchise_id
      WHERE m.status = 'COMPLETED' ${filterClause}
         AND p.role = 'BOWLER'
      GROUP BY p.id, p.first_name, p.last_name, p.role, p.age, f.id, f.franchise_name
      HAVING SUM(pms.bowling_balls) > 0
      ORDER BY wickets DESC, economy ASC
       LIMIT ${limitParam}`,
      [...params, limit]
    );

    const allRounders = await pool.query(
      `SELECT p.id AS player_id,
              p.first_name,
              p.last_name,
              p.role,
              p.age,
              f.id AS franchise_id,
              f.franchise_name,
              COUNT(*)::int AS matches,
              SUM(pms.batting_runs)::int AS runs,
              SUM(pms.batting_balls)::int AS balls,
              SUM(pms.bowling_wickets)::int AS wickets,
              SUM(pms.bowling_balls)::int AS bowling_balls,
              SUM(pms.bowling_runs)::int AS runs_conceded,
              COALESCE(ROUND((SUM(pms.batting_runs)::numeric * 100) / NULLIF(SUM(pms.batting_balls), 0), 2), 0) AS strike_rate,
              COALESCE(ROUND((SUM(pms.bowling_runs)::numeric * 6) / NULLIF(SUM(pms.bowling_balls), 0), 2), 0) AS economy,
              SUM(pms.catches)::int AS catches,
              ROUND(AVG(pms.player_rating), 2) AS avg_rating
       FROM player_match_stats pms
       JOIN matches m ON m.id = pms.match_id
       JOIN players p ON p.id = pms.player_id
       JOIN franchises f ON f.id = p.franchise_id
       WHERE m.status = 'COMPLETED' ${filterClause}
         AND p.role = 'ALL_ROUNDER'
       GROUP BY p.id, p.first_name, p.last_name, p.role, p.age, f.id, f.franchise_name
       HAVING SUM(pms.batting_balls) > 0 AND SUM(pms.bowling_balls) > 0
       ORDER BY (SUM(pms.batting_runs) + SUM(pms.bowling_wickets) * 25) DESC
       LIMIT ${limitParam}`,
      [...params, limit]
    );

    const seasons = await pool.query(
      `SELECT id, season_number, name, status FROM seasons WHERE world_id = $1 ORDER BY season_number`,
      [worldId]
    );

    return res.json({
      batting: batting.rows,
      bowling: bowling.rows,
      allRounders: allRounders.rows,
      seasons: seasons.rows
    });
  })
);

router.post(
  '/seasons',
  requireAuth,
  requireAdmin,
  asyncHandler(async (req, res) => {
    const { name, year, teamCount, competitionMode, leagueCount } = req.body;

    if (!year || !teamCount) {
      return res.status(400).json({ message: 'year and teamCount are required.' });
    }

    const season = await createSeason({ name, year, teamCount, competitionMode, leagueCount }, pool);
    await generateDoubleRoundRobinFixtures(season.id, pool);

    return res.status(201).json({ season });
  })
);

router.post(
  '/fixtures/generate',
  requireAuth,
  requireAdmin,
  asyncHandler(async (req, res) => {
    const seasonId = Number(req.body.seasonId || 0);

    if (!seasonId) {
      return res.status(400).json({ message: 'seasonId is required.' });
    }

    const result = await generateDoubleRoundRobinFixtures(seasonId, pool);
    return res.json(result);
  })
);

router.get(
  '/table',
  optionalAuth,
  asyncHandler(async (req, res) => {
    let seasonId = Number(req.query.seasonId || 0);
    const worldId = req.user?.active_world_id || null;

    if (!worldId) return res.status(404).json({ message: 'Claim a franchise to view the league table.' });

    if (!seasonId) {
      const activeSeason = await ensureActiveSeason(pool, worldId);
      if (!activeSeason) {
        return res.status(404).json({ message: 'No active season yet. Claim a city franchise to start your career.' });
      }
      seasonId = activeSeason.id;
    } else {
      const check = await pool.query('SELECT id FROM seasons WHERE id = $1 AND world_id = $2', [seasonId, worldId]);
      if (!check.rows.length) return res.status(403).json({ message: 'Season not found in your world.' });
    }

    const leagueTier = Number(req.query.leagueTier || 0) || null;
    const table = await getLeagueTable(seasonId, pool);
    const filtered = leagueTier ? table.filter((row) => Number(row.league_tier) === leagueTier) : table;
    return res.json({ seasonId, leagueTier, table: filtered });
  })
);

router.get(
  '/rounds',
  optionalAuth,
  asyncHandler(async (req, res) => {
    let seasonId = Number(req.query.seasonId || 0);
    const worldId = req.user?.active_world_id || null;

    if (!worldId) return res.json({ seasonId: null, rounds: [] });

    if (!seasonId) {
      const activeSeason = await ensureActiveSeason(pool, worldId);
      if (!activeSeason) {
        return res.status(404).json({ message: 'No active season yet. Claim a city franchise to start your career.' });
      }
      seasonId = activeSeason.id;
    } else {
      const check = await pool.query('SELECT id FROM seasons WHERE id = $1 AND world_id = $2', [seasonId, worldId]);
      if (!check.rows.length) return res.status(403).json({ message: 'Season not found in your world.' });
    }

    const rounds = await getSeasonRoundOverview(seasonId, pool);
    return res.json({ seasonId, rounds });
  })
);

router.get(
  '/fixtures',
  optionalAuth,
  asyncHandler(async (req, res) => {
    let seasonId = Number(req.query.seasonId || 0);
    const worldId = req.user?.active_world_id || null;

    if (!worldId) return res.json({ seasonId: null, fixtures: [] });

    if (!seasonId) {
      const activeSeason = await ensureActiveSeason(pool, worldId);
      if (!activeSeason) {
        return res.status(404).json({ message: 'No active season yet. Claim a city franchise to start your career.' });
      }
      seasonId = activeSeason.id;
    } else {
      const check = await pool.query('SELECT id FROM seasons WHERE id = $1 AND world_id = $2', [seasonId, worldId]);
      if (!check.rows.length) return res.status(403).json({ message: 'Season not found in your world.' });
    }

    const roundNo = Number(req.query.roundNo || 0);
    const whereRound = roundNo ? 'AND m.round_no = $2' : '';

    const fixtures = await pool.query(
      `SELECT
         m.id,
         m.stage,
         m.group_name,
         m.league_tier,
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
         m.toss_winner_franchise_id,
         m.toss_decision,
         m.winner_franchise_id,
         m.player_of_match_id,
         hf.id AS home_franchise_id,
         hf.franchise_name AS home_franchise_name,
         hc.name AS home_city_name,
         hc.country AS home_country,
         af.id AS away_franchise_id,
         af.franchise_name AS away_franchise_name,
         ac.name AS away_city_name,
         ac.country AS away_country,
         COALESCE((SELECT ROUND(AVG((p.batting + p.bowling + p.fielding + p.fitness + p.temperament) / 5.0), 1) FROM players p WHERE p.franchise_id = hf.id AND p.squad_status = 'MAIN_SQUAD'), 0) AS home_avg_overall,
         COALESCE((SELECT ROUND(AVG((p.batting + p.bowling + p.fielding + p.fitness + p.temperament) / 5.0), 1) FROM players p WHERE p.franchise_id = af.id AND p.squad_status = 'MAIN_SQUAD'), 0) AS away_avg_overall
       FROM matches m
       JOIN franchises hf ON hf.id = m.home_franchise_id
       JOIN cities hc ON hc.id = hf.city_id
       JOIN franchises af ON af.id = m.away_franchise_id
       JOIN cities ac ON ac.id = af.city_id
       WHERE m.season_id = $1
       ${whereRound}
       ORDER BY m.round_no, COALESCE(m.league_tier, 0), m.stage, m.id`,
      roundNo ? [seasonId, roundNo] : [seasonId]
    );

    return res.json({ seasonId, fixtures: fixtures.rows });
  })
);

router.get(
  '/calendar',
  requireAuth,
  asyncHandler(async (req, res) => {
    let seasonId = Number(req.query.seasonId || 0);
    const worldId = req.user?.active_world_id || null;

    if (!worldId) {
      return res.status(403).json({ message: 'No active world.' });
    }

    if (!seasonId) {
      const activeSeason = await ensureActiveSeason(pool, worldId);
      if (!activeSeason) {
        return res.status(404).json({ message: 'No active season yet.' });
      }
      seasonId = Number(activeSeason.id);
    } else {
      const check = await pool.query('SELECT id FROM seasons WHERE id = $1 AND world_id = $2', [seasonId, worldId]);
      if (!check.rows.length) {
        return res.status(403).json({ message: 'Season not found in your world.' });
      }
    }

    const offsetDays = Number(req.query.offsetDays || 0);
    const spanDays = Number(req.query.spanDays || 14);
    const calendar = await getInternationalCalendar(req.user.id, seasonId, pool, { offsetDays, spanDays });
    return res.json(calendar);
  })
);

router.get(
  '/calendar/all',
  requireAuth,
  asyncHandler(async (req, res) => {
    let seasonId = Number(req.query.seasonId || 0);
    const worldId = req.user?.active_world_id || null;

    if (!worldId) {
      return res.status(403).json({ message: 'No active world.' });
    }

    if (!seasonId) {
      const activeSeason = await ensureActiveSeason(pool, worldId);
      if (!activeSeason) {
        return res.status(404).json({ message: 'No active season yet.' });
      }
      seasonId = Number(activeSeason.id);
    } else {
      const check = await pool.query('SELECT id FROM seasons WHERE id = $1 AND world_id = $2', [seasonId, worldId]);
      if (!check.rows.length) {
        return res.status(403).json({ message: 'Season not found in your world.' });
      }
    }

    const offsetDays = Number(req.query.offsetDays || 0);
    const spanDays = Number(req.query.spanDays || 14);
    const calendar = await getInternationalCalendarOverview(seasonId, pool, { offsetDays, spanDays });
    return res.json(calendar);
  })
);

router.post(
  '/calendar/series',
  requireAuth,
  asyncHandler(async (req, res) => {
    const seasonId = Number(req.body?.seasonId || 0);
    const opponentFranchiseId = Number(req.body?.opponentFranchiseId || 0);
    const windowNo = Number(req.body?.windowNo || 0);
    const venue = String(req.body?.venue || 'HOME');
    const worldId = req.user?.active_world_id || null;

    if (!worldId) {
      return res.status(403).json({ message: 'No active world.' });
    }
    if (!seasonId || !opponentFranchiseId || !windowNo) {
      return res.status(400).json({ message: 'seasonId, opponentFranchiseId, and windowNo are required.' });
    }

    const check = await pool.query('SELECT id FROM seasons WHERE id = $1 AND world_id = $2', [seasonId, worldId]);
    if (!check.rows.length) {
      return res.status(403).json({ message: 'Season not found in your world.' });
    }

    const result = await withTransaction(async (dbClient) => {
      await scheduleInternationalSeries(
        {
          userId: req.user.id,
          seasonId,
          opponentFranchiseId,
          venue,
          windowNo
        },
        dbClient
      );
      return getInternationalCalendar(req.user.id, seasonId, dbClient);
    });

    return res.status(201).json(result);
  })
);

router.post(
  '/calendar/series/:seriesId/simulate',
  requireAuth,
  asyncHandler(async (req, res) => {
    const seriesId = Number(req.params.seriesId || 0);
    if (!seriesId) {
      return res.status(400).json({ message: 'Invalid series id.' });
    }

    const matches = await getSeriesMatchesForManager(req.user.id, seriesId, pool);
    if (!matches.length) {
      return res.status(404).json({ message: 'Series not found for your managed team.' });
    }

    let simulated = 0;
    for (const match of matches) {
      if (String(match.status || '').toUpperCase() === 'COMPLETED') {
        continue;
      }

      await simulateMatchOutsideCenter(match.id, {
        broadcast,
        useExternalBallApi: false,
        useExternalFullMatchApi: true,
        strictExternalFullMatchApi: true
      });
      simulated += 1;
    }

    const calendar = await getInternationalCalendar(req.user.id, Number(matches[0].season_id), pool);
    return res.json({
      simulated,
      calendar
    });
  })
);

router.get(
  '/matches/:matchId/events',
  optionalAuth,
  asyncHandler(async (req, res) => {
    const worldId = req.user?.active_world_id || null;
    if (!worldId) return res.status(403).json({ message: 'Claim a franchise to view match data.' });
    const check = await pool.query(
      'SELECT m.id FROM matches m JOIN seasons s ON s.id = m.season_id WHERE m.id = $1 AND s.world_id = $2',
      [req.params.matchId, worldId]
    );
    if (!check.rows.length) return res.status(403).json({ message: 'Match not found in your world.' });
    const events = await pool.query(
      `SELECT *
       FROM match_events
       WHERE match_id = $1
       ORDER BY innings, over_number, ball_number, id`,
      [req.params.matchId]
    );

    return res.json({ events: events.rows });
  })
);

router.get(
  '/matches/:matchId/scorecard',
  optionalAuth,
  asyncHandler(async (req, res) => {
    const worldId = req.user?.active_world_id || null;
    if (!worldId) return res.status(403).json({ message: 'Claim a franchise to view match data.' });
    const check = await pool.query(
      'SELECT m.id FROM matches m JOIN seasons s ON s.id = m.season_id WHERE m.id = $1 AND s.world_id = $2',
      [req.params.matchId, worldId]
    );
    if (!check.rows.length) return res.status(403).json({ message: 'Match not found in your world.' });
    const scorecard = await getMatchScorecard(req.params.matchId, pool);

    if (!scorecard) {
      return res.status(404).json({ message: 'Match not found.' });
    }

    return res.json(scorecard);
  })
);

router.post(
  '/matches/:matchId/reset',
  requireAuth,
  asyncHandler(async (req, res) => {
    const matchId = Number(req.params.matchId);
    if (!matchId) {
      return res.status(400).json({ message: 'Invalid match id.' });
    }

    const worldId = req.user?.active_world_id || null;
    if (!worldId) return res.status(403).json({ message: 'No active world.' });
    const check = await pool.query(
      'SELECT m.id FROM matches m JOIN seasons s ON s.id = m.season_id WHERE m.id = $1 AND s.world_id = $2',
      [matchId, worldId]
    );
    if (!check.rows.length) return res.status(403).json({ message: 'Match not found in your world.' });

    if (isMatchSimulationRunning(matchId)) {
      return res.status(409).json({ message: 'Cannot reset a match while its simulation is actively running.' });
    }

    const current = await pool.query('SELECT status FROM matches WHERE id = $1', [matchId]);
    if (!current.rows.length) {
      return res.status(404).json({ message: 'Match not found.' });
    }

    const status = String(current.rows[0].status || '').toUpperCase();
    if (status === 'COMPLETED') {
      return res.status(409).json({ message: 'Cannot reset a completed match.' });
    }

    if (status !== 'LIVE') {
      return res.json({ message: 'Match is already in SCHEDULED state.', matchId, status });
    }

    await pool.query('DELETE FROM match_events WHERE match_id = $1', [matchId]);
    await pool.query('DELETE FROM player_match_stats WHERE match_id = $1', [matchId]);
    await pool.query('DELETE FROM match_partnerships WHERE match_id = $1', [matchId]);
    await pool.query('DELETE FROM match_fall_of_wickets WHERE match_id = $1', [matchId]);
    await pool.query('DELETE FROM match_over_stats WHERE match_id = $1', [matchId]);
    await pool.query('DELETE FROM match_innings_stats WHERE match_id = $1', [matchId]);
    await pool.query(
      `UPDATE matches
       SET status = 'SCHEDULED',
           home_score = NULL,
           home_wickets = NULL,
           home_balls = NULL,
           away_score = NULL,
           away_wickets = NULL,
           away_balls = NULL,
           winner_franchise_id = NULL,
           result_summary = NULL,
           ai_match_analysis = NULL,
           player_of_match_id = NULL
       WHERE id = $1`,
      [matchId]
    );

    broadcast('match:reset', { matchId }, `match:${matchId}`);
    return res.json({ message: 'Match reset to SCHEDULED.', matchId });
  })
);

router.post(
  '/matches/:matchId/simulate-live',
  requireAuth,
  asyncHandler(async (req, res) => {
    const matchId = Number(req.params.matchId);
    const ballDelayMs = Number(req.body.ballDelayMs ?? 120);
    const operationId = resolveOperationId(req, 'match-live');

    if (!matchId) {
      return res.status(400).json({ message: 'Invalid match id.' });
    }

    const worldId = req.user?.active_world_id || null;
    if (!worldId) return res.status(403).json({ message: 'No active world.' });
    const matchLiveCheck = await pool.query(
      'SELECT m.id FROM matches m JOIN seasons s ON s.id = m.season_id WHERE m.id = $1 AND s.world_id = $2',
      [matchId, worldId]
    );
    if (!matchLiveCheck.rows.length) return res.status(403).json({ message: 'Match not found in your world.' });

    if (isMatchSimulationRunning(matchId)) {
      return res.status(409).json({ message: 'This match simulation is already in progress.' });
    }

    simulateMatchLive(matchId, {
      ballDelayMs: Math.max(0, Math.min(500, ballDelayMs)),
      broadcast,
      simulationOperationId: operationId
    }).catch((error) => {
      broadcast('match:error', { matchId, simulationOperationId: operationId, message: error.message }, `match:${matchId}`);
    });

    return res.status(202).json({ message: 'Match simulation started.', matchId, operationId });
  })
);

router.post(
  '/matches/:matchId/simulate-instant',
  requireAuth,
  asyncHandler(async (req, res) => {
    const matchId = Number(req.params.matchId);
    const operationId = resolveOperationId(req, 'match-instant');
    const useExternalFullMatchApi = Boolean(req.body?.useExternalFullMatchApi);

    const worldId = req.user?.active_world_id || null;
    if (!worldId) return res.status(403).json({ message: 'No active world.' });
    const matchCheck2 = await pool.query(
      'SELECT m.id FROM matches m JOIN seasons s ON s.id = m.season_id WHERE m.id = $1 AND s.world_id = $2',
      [matchId, worldId]
    );
    if (!matchCheck2.rows.length) return res.status(403).json({ message: 'Match not found in your world.' });

    const result = useExternalFullMatchApi
      ? await simulateMatchOutsideCenter(matchId, {
        broadcast,
        useExternalBallApi: false,
        useExternalFullMatchApi: true,
        strictExternalFullMatchApi: true,
        simulationOperationId: operationId
      })
      : await simulateMatchLive(matchId, { ballDelayMs: 0, broadcast, simulationOperationId: operationId });
    return res.json(result);
  })
);

router.post(
  '/simulate-next-day',
  requireAuth,
  asyncHandler(async (req, res) => {
    const operationId = resolveOperationId(req, 'next-day');
    const worldId = req.user?.active_world_id || null;
    const result = await simulateInternationalNextDay({
      broadcast,
      useExternalBallApi: false,
      useExternalFullMatchApi: true,
      strictExternalFullMatchApi: true,
      simulationOperationId: operationId,
      worldId,
      onSimulationProgress: async (payload) => {
        pushSimulationProgress({ action: 'SIMULATE_NEXT_DAY', ...payload });
      }
    });

    return res.json({ ...result, operationId });
  })
);

router.post(
  '/simulate-next-round',
  requireAuth,
  asyncHandler(async (req, res) => {
    const operationId = resolveOperationId(req, 'round');
    const worldId = req.user?.active_world_id || null;
    const { mode } = await getActiveSeasonMode(worldId);
    if (mode === CAREER_MODES.INTERNATIONAL) {
      return res.status(409).json({ message: 'International mode uses daily FTP simulation. Use Simulate Next Day instead.' });
    }
    const result = await simulateRound(null, {
      broadcast,
      useExternalBallApi: false,
      useExternalFullMatchApi: true,
      strictExternalFullMatchApi: true,
      simulationOperationId: operationId,
      worldId,
      onSimulationProgress: async (payload) => {
        pushSimulationProgress({ action: 'SIMULATE_NEXT_ROUND', ...payload });
      }
    });

    if (result.seasonId && await shouldRunCpuCycleForSeason(result.seasonId)) {
      await runCpuMarketCycle(result.seasonId, pool);
    }

    return res.json({ ...result, operationId });
  })
);

router.post(
  '/simulate-league-round',
  requireAuth,
  asyncHandler(async (req, res) => {
    const seasonId = Number(req.body?.seasonId || 0) || null;
    const roundNo = Number(req.body?.roundNo || 0) || null;
    const leagueTier = Number(req.body?.leagueTier || 0);
    const operationId = resolveOperationId(req, 'league-round');

    if (!leagueTier) {
      return res.status(400).json({ message: 'leagueTier is required.' });
    }

    if (seasonId) {
      const seasonMeta = await pool.query('SELECT competition_mode FROM seasons WHERE id = $1', [seasonId]);
      if (normalizeCareerMode(seasonMeta.rows[0]?.competition_mode || CAREER_MODES.CLUB) === CAREER_MODES.INTERNATIONAL) {
        return res.status(409).json({ message: 'International mode does not use league rounds.' });
      }
    }

    const result = await simulateLeagueRound(
      { seasonId, roundNo, leagueTier },
      {
        broadcast,
        autoCreateNextSeason: false,
        useExternalBallApi: false,
        useExternalFullMatchApi: true,
        strictExternalFullMatchApi: true,
        simulationOperationId: operationId,
        worldId: req.user?.active_world_id || null,
        onSimulationProgress: async (payload) => {
          pushSimulationProgress({ action: 'SIMULATE_LEAGUE_ROUND', ...payload });
        }
      }
    );

    if (result.seasonId && await shouldRunCpuCycleForSeason(result.seasonId)) {
      await runCpuMarketCycle(result.seasonId, pool);
    }

    return res.json({ ...result, operationId });
  })
);

router.post(
  '/simulate-my-league-round',
  requireAuth,
  asyncHandler(async (req, res) => {
    const operationId = resolveOperationId(req, 'my-league');
    const worldId = req.user?.active_world_id || null;
    const { mode } = await getActiveSeasonMode(worldId);
    if (mode === CAREER_MODES.INTERNATIONAL) {
      return res.status(409).json({ message: 'International mode does not use league rounds. Use Simulate Next Day.' });
    }
    const result = await simulateMyLeagueRound(req.user.id, {
      broadcast,
      autoCreateNextSeason: false,
      useExternalBallApi: false,
      useExternalFullMatchApi: true,
      strictExternalFullMatchApi: true,
      simulationOperationId: operationId,
      worldId,
      onSimulationProgress: async (payload) => {
        pushSimulationProgress({ action: 'SIMULATE_MY_LEAGUE_ROUND', ...payload });
      }
    });

    if (result.seasonId && await shouldRunCpuCycleForSeason(result.seasonId)) {
      await runCpuMarketCycle(result.seasonId, pool);
    }

    return res.json({ ...result, operationId });
  })
);

router.post(
  '/simulate-half-season',
  requireAuth,
  asyncHandler(async (req, res) => {
    const operationId = resolveOperationId(req, 'half-season');
    const worldId = req.user?.active_world_id || null;
    const { mode } = await getActiveSeasonMode(worldId);
    if (mode === CAREER_MODES.INTERNATIONAL) {
      return res.status(409).json({ message: 'International mode advances by calendar day or full cycle, not half-season rounds.' });
    }
    const result = await simulateHalfSeason({
      broadcast,
      useExternalBallApi: false,
      useExternalFullMatchApi: true,
      strictExternalFullMatchApi: true,
      simulationOperationId: operationId,
      worldId,
      onSimulationProgress: async (payload) => {
        pushSimulationProgress({ action: 'SIMULATE_HALF_SEASON', ...payload });
      }
    });

    if (result.seasonId && await shouldRunCpuCycleForSeason(result.seasonId)) {
      await runCpuMarketCycle(result.seasonId, pool);
    }

    return res.json({ ...result, operationId });
  })
);

router.post(
  '/simulate-season',
  requireAuth,
  asyncHandler(async (req, res) => {
    const operationId = resolveOperationId(req, 'season');
    const result = await simulateSeasonToEnd({
      broadcast,
      useExternalBallApi: false,
      useExternalFullMatchApi: true,
      strictExternalFullMatchApi: true,
      simulationOperationId: operationId,
      worldId: req.user?.active_world_id || null,
      onSimulationProgress: async (payload) => {
        pushSimulationProgress({ action: 'SIMULATE_SEASON', ...payload });
      }
    });

    const cpuCycleSeasonId = result.nextSeasonId || result.seasonId;
    if (cpuCycleSeasonId && await shouldRunCpuCycleForSeason(cpuCycleSeasonId)) {
      await runCpuMarketCycle(cpuCycleSeasonId, pool);
    }

    return res.json({ ...result, operationId });
  })
);

export default router;
