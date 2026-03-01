import { Router } from 'express';
import pool from '../config/db.js';
import { requireAdmin, requireAuth } from '../middleware/auth.js';
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
import { getMatchScorecard, isMatchSimulationRunning, simulateMatchLive, simulateRound, simulateSeasonToEnd } from '../services/matchEngine.js';
import { runCpuMarketCycle } from '../services/cpuManagerService.js';
import { broadcast } from '../ws/realtime.js';

const router = Router();

router.get(
  '/seasons',
  asyncHandler(async (req, res) => {
    const seasons = await listSeasons(Math.max(5, Math.min(30, Number(req.query.limit || 12))));
    return res.json({ seasons });
  })
);

router.get(
  '/seasons/active',
  asyncHandler(async (req, res) => {
    const season = await ensureActiveSeason(pool);
    return res.json({ season });
  })
);

router.get(
  '/seasons/:seasonId/summary',
  asyncHandler(async (req, res) => {
    const summary = await getSeasonSummary(req.params.seasonId, pool);
    if (!summary) {
      return res.status(404).json({ message: 'Season not found.' });
    }
    return res.json(summary);
  })
);

router.get(
  '/seasons/:seasonId/stats',
  asyncHandler(async (req, res) => {
    const seasonId = Number(req.params.seasonId || 0);
    if (!seasonId) {
      return res.status(400).json({ message: 'Invalid season id.' });
    }

    const leaders = await getSeasonPlayerLeaders(seasonId, pool);
    return res.json(leaders);
  })
);

router.post(
  '/seasons',
  requireAuth,
  requireAdmin,
  asyncHandler(async (req, res) => {
    const { name, year, teamCount } = req.body;

    if (!year || !teamCount) {
      return res.status(400).json({ message: 'year and teamCount are required.' });
    }

    const season = await createSeason({ name, year, teamCount }, pool);
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
  asyncHandler(async (req, res) => {
    let seasonId = Number(req.query.seasonId || 0);

    if (!seasonId) {
      const activeSeason = await ensureActiveSeason(pool);
      if (!activeSeason) {
        return res.status(404).json({ message: 'No active season yet. Claim a city franchise to start your career.' });
      }
      seasonId = activeSeason.id;
    }

    const leagueTier = Number(req.query.leagueTier || 0) || null;
    const table = await getLeagueTable(seasonId, pool);
    const filtered = leagueTier ? table.filter((row) => Number(row.league_tier) === leagueTier) : table;
    return res.json({ seasonId, leagueTier, table: filtered });
  })
);

router.get(
  '/rounds',
  asyncHandler(async (req, res) => {
    let seasonId = Number(req.query.seasonId || 0);

    if (!seasonId) {
      const activeSeason = await ensureActiveSeason(pool);
      if (!activeSeason) {
        return res.status(404).json({ message: 'No active season yet. Claim a city franchise to start your career.' });
      }
      seasonId = activeSeason.id;
    }

    const rounds = await getSeasonRoundOverview(seasonId, pool);
    return res.json({ seasonId, rounds });
  })
);

router.get(
  '/fixtures',
  asyncHandler(async (req, res) => {
    let seasonId = Number(req.query.seasonId || 0);

    if (!seasonId) {
      const activeSeason = await ensureActiveSeason(pool);
      if (!activeSeason) {
        return res.status(404).json({ message: 'No active season yet. Claim a city franchise to start your career.' });
      }
      seasonId = activeSeason.id;
    }

    const roundNo = Number(req.query.roundNo || 0);
    const whereRound = roundNo ? 'AND m.round_no = $2' : '';

    const fixtures = await pool.query(
      `SELECT
         m.id,
         m.stage,
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
         ac.country AS away_country
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
  '/matches/:matchId/events',
  asyncHandler(async (req, res) => {
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
  asyncHandler(async (req, res) => {
    const scorecard = await getMatchScorecard(req.params.matchId, pool);

    if (!scorecard) {
      return res.status(404).json({ message: 'Match not found.' });
    }

    return res.json(scorecard);
  })
);

router.post(
  '/matches/:matchId/simulate-live',
  requireAuth,
  asyncHandler(async (req, res) => {
    const matchId = Number(req.params.matchId);
    const ballDelayMs = Number(req.body.ballDelayMs ?? 120);

    if (!matchId) {
      return res.status(400).json({ message: 'Invalid match id.' });
    }

    if (isMatchSimulationRunning(matchId)) {
      return res.status(409).json({ message: 'This match simulation is already in progress.' });
    }

    simulateMatchLive(matchId, {
      ballDelayMs: Math.max(0, Math.min(500, ballDelayMs)),
      broadcast
    }).catch((error) => {
      broadcast('match:error', { matchId, message: error.message }, `match:${matchId}`);
    });

    return res.status(202).json({ message: 'Match simulation started.', matchId });
  })
);

router.post(
  '/matches/:matchId/simulate-instant',
  requireAuth,
  asyncHandler(async (req, res) => {
    const matchId = Number(req.params.matchId);
    const result = await simulateMatchLive(matchId, { ballDelayMs: 0, broadcast });
    return res.json(result);
  })
);

router.post(
  '/simulate-next-round',
  requireAuth,
  asyncHandler(async (req, res) => {
    const result = await simulateRound(null, { broadcast });

    if (result.seasonId) {
      await runCpuMarketCycle(result.seasonId, pool);
    }

    return res.json(result);
  })
);

router.post(
  '/simulate-season',
  requireAuth,
  asyncHandler(async (req, res) => {
    const result = await simulateSeasonToEnd({ broadcast });

    const cpuCycleSeasonId = result.nextSeasonId || result.seasonId;
    if (cpuCycleSeasonId) {
      await runCpuMarketCycle(cpuCycleSeasonId, pool);
    }

    return res.json(result);
  })
);

export default router;
