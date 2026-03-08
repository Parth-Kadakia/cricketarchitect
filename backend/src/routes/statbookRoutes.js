import { Router } from 'express';
import pool from '../config/db.js';
import asyncHandler from '../utils/asyncHandler.js';
import { getMatchScorecard } from '../services/matchEngine.js';
import { optionalAuth } from '../middleware/auth.js';

const router = Router();

function parseSeasonId(value) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function parseId(value) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function parseLimit(value, defaultValue = 20, max = 100) {
  const parsed = Number(value || 0);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return defaultValue;
  }
  return Math.min(max, Math.floor(parsed));
}

function oversFromBalls(balls) {
  const safeBalls = Number(balls || 0);
  return `${Math.floor(safeBalls / 6)}.${safeBalls % 6}`;
}

router.get(
  '/overview',
  optionalAuth,
  asyncHandler(async (req, res) => {
    const seasonId = parseSeasonId(req.query.seasonId);
    const worldId = req.user?.active_world_id || null;

    if (seasonId && worldId) {
      const check = await pool.query('SELECT id FROM seasons WHERE id = $1 AND world_id = $2', [seasonId, worldId]);
      if (!check.rows.length) return res.status(403).json({ message: 'Season not found in your world.' });
    }

    const [seasons, teams, totals, boundaries, highestTeamTotal, lowestTeamTotal, highestIndividual, bestBowling, milestones] = await Promise.all([
      pool.query(
        `SELECT id, season_number, name, status
         FROM seasons
         WHERE ($1::bigint IS NULL OR world_id = $1)
         ORDER BY season_number DESC`,
        [worldId]
      ),
      pool.query(
        `WITH filtered AS (
           SELECT DISTINCT home_franchise_id AS franchise_id
           FROM matches m
           WHERE m.status = 'COMPLETED'
             AND ($1::bigint IS NULL OR m.season_id = $1::bigint)
             AND ($2::bigint IS NULL OR m.season_id IN (SELECT id FROM seasons WHERE world_id = $2))
           UNION
           SELECT DISTINCT away_franchise_id
           FROM matches m
           WHERE m.status = 'COMPLETED'
             AND ($1::bigint IS NULL OR m.season_id = $1::bigint)
             AND ($2::bigint IS NULL OR m.season_id IN (SELECT id FROM seasons WHERE world_id = $2))
         )
         SELECT f.id AS franchise_id,
                f.franchise_name,
                c.country,
                c.name AS city_name
         FROM filtered flt
         JOIN franchises f ON f.id = flt.franchise_id
         JOIN cities c ON c.id = f.city_id
         ORDER BY c.country, f.franchise_name`,
        [seasonId, worldId]
      ),
      pool.query(
        `WITH filtered_matches AS (
           SELECT m.*
           FROM matches m
           WHERE m.status = 'COMPLETED'
             AND ($1::bigint IS NULL OR m.season_id = $1::bigint)
             AND ($2::bigint IS NULL OR m.season_id IN (SELECT id FROM seasons WHERE world_id = $2))
         )
         SELECT COUNT(*)::int AS completed_matches,
                COALESCE(SUM(COALESCE(home_score, 0) + COALESCE(away_score, 0)), 0)::int AS total_runs,
                COALESCE(SUM(COALESCE(home_wickets, 0) + COALESCE(away_wickets, 0)), 0)::int AS total_wickets,
                COALESCE(SUM(COALESCE(home_balls, 0) + COALESCE(away_balls, 0)), 0)::int AS total_balls,
                COUNT(*) FILTER (WHERE winner_franchise_id IS NULL)::int AS ties_or_no_result,
                (SELECT COUNT(DISTINCT player_id)::int
                 FROM player_match_stats pms
                 JOIN filtered_matches fm ON fm.id = pms.match_id) AS players_involved
         FROM filtered_matches`,
        [seasonId, worldId]
      ),
      pool.query(
        `WITH filtered_matches AS (
           SELECT m.id
           FROM matches m
           WHERE m.status = 'COMPLETED'
             AND ($1::bigint IS NULL OR m.season_id = $1::bigint)
             AND ($2::bigint IS NULL OR m.season_id IN (SELECT id FROM seasons WHERE world_id = $2))
         )
         SELECT COALESCE(SUM(pms.fours), 0)::int AS fours,
                COALESCE(SUM(pms.sixes), 0)::int AS sixes
         FROM player_match_stats pms
         JOIN filtered_matches fm ON fm.id = pms.match_id`,
        [seasonId, worldId]
      ),
      pool.query(
        `WITH filtered_matches AS (
           SELECT m.*
           FROM matches m
           WHERE m.status = 'COMPLETED'
             AND ($1::bigint IS NULL OR m.season_id = $1::bigint)
             AND ($2::bigint IS NULL OR m.season_id IN (SELECT id FROM seasons WHERE world_id = $2))
         ),
         innings AS (
           SELECT fm.id AS match_id,
                  fm.home_franchise_id AS franchise_id,
                  fm.home_score AS runs,
                  fm.home_wickets AS wickets,
                  fm.home_balls AS balls
           FROM filtered_matches fm
           UNION ALL
           SELECT fm.id AS match_id,
                  fm.away_franchise_id AS franchise_id,
                  fm.away_score AS runs,
                  fm.away_wickets AS wickets,
                  fm.away_balls AS balls
           FROM filtered_matches fm
         )
         SELECT i.match_id,
                i.franchise_id,
                f.franchise_name,
                c.country,
                i.runs,
                i.wickets,
                i.balls
         FROM innings i
         JOIN franchises f ON f.id = i.franchise_id
         JOIN cities c ON c.id = f.city_id
         WHERE i.runs IS NOT NULL
         ORDER BY i.runs DESC, i.wickets ASC, i.balls ASC
         LIMIT 1`,
        [seasonId, worldId]
      ),
      pool.query(
        `WITH filtered_matches AS (
           SELECT m.*
           FROM matches m
           WHERE m.status = 'COMPLETED'
             AND ($1::bigint IS NULL OR m.season_id = $1::bigint)
             AND ($2::bigint IS NULL OR m.season_id IN (SELECT id FROM seasons WHERE world_id = $2))
         ),
         innings AS (
           SELECT fm.id AS match_id,
                  fm.home_franchise_id AS franchise_id,
                  fm.home_score AS runs,
                  fm.home_wickets AS wickets,
                  fm.home_balls AS balls
           FROM filtered_matches fm
           UNION ALL
           SELECT fm.id AS match_id,
                  fm.away_franchise_id AS franchise_id,
                  fm.away_score AS runs,
                  fm.away_wickets AS wickets,
                  fm.away_balls AS balls
           FROM filtered_matches fm
         )
         SELECT i.match_id,
                i.franchise_id,
                f.franchise_name,
                c.country,
                i.runs,
                i.wickets,
                i.balls
         FROM innings i
         JOIN franchises f ON f.id = i.franchise_id
         JOIN cities c ON c.id = f.city_id
         WHERE i.runs IS NOT NULL
         ORDER BY i.runs ASC, i.wickets DESC, i.balls ASC
         LIMIT 1`,
        [seasonId, worldId]
      ),
      pool.query(
        `SELECT pms.match_id,
                pms.player_id,
                p.first_name,
                p.last_name,
                pms.franchise_id,
                f.franchise_name,
                c.country,
                pms.batting_runs,
                pms.batting_balls,
                pms.fours,
                pms.sixes
         FROM player_match_stats pms
         JOIN matches m ON m.id = pms.match_id
         JOIN players p ON p.id = pms.player_id
         JOIN franchises f ON f.id = pms.franchise_id
         JOIN cities c ON c.id = f.city_id
         WHERE m.status = 'COMPLETED'
           AND ($1::bigint IS NULL OR m.season_id = $1::bigint)
           AND ($2::bigint IS NULL OR m.season_id IN (SELECT id FROM seasons WHERE world_id = $2))
         ORDER BY pms.batting_runs DESC, pms.batting_balls ASC
         LIMIT 1`,
        [seasonId, worldId]
      ),
      pool.query(
        `SELECT pms.match_id,
                pms.player_id,
                p.first_name,
                p.last_name,
                pms.franchise_id,
                f.franchise_name,
                c.country,
                pms.bowling_wickets,
                pms.bowling_runs,
                pms.bowling_balls
         FROM player_match_stats pms
         JOIN matches m ON m.id = pms.match_id
         JOIN players p ON p.id = pms.player_id
         JOIN franchises f ON f.id = pms.franchise_id
         JOIN cities c ON c.id = f.city_id
         WHERE m.status = 'COMPLETED'
           AND ($1::bigint IS NULL OR m.season_id = $1::bigint)
           AND ($2::bigint IS NULL OR m.season_id IN (SELECT id FROM seasons WHERE world_id = $2))
         ORDER BY pms.bowling_wickets DESC, pms.bowling_runs ASC, pms.bowling_balls ASC
         LIMIT 1`,
        [seasonId, worldId]
      ),
      pool.query(
        `WITH filtered_matches AS (
           SELECT id
           FROM matches m
           WHERE m.status = 'COMPLETED'
             AND ($1::bigint IS NULL OR m.season_id = $1::bigint)
             AND ($2::bigint IS NULL OR m.season_id IN (SELECT id FROM seasons WHERE world_id = $2))
         )
         SELECT
           COALESCE(SUM(CASE WHEN pms.batting_runs BETWEEN 50 AND 99 THEN 1 ELSE 0 END), 0)::int AS fifties,
           COALESCE(SUM(CASE WHEN pms.batting_runs >= 100 THEN 1 ELSE 0 END), 0)::int AS hundreds,
           COALESCE(SUM(CASE WHEN pms.bowling_wickets >= 5 THEN 1 ELSE 0 END), 0)::int AS five_wicket_hauls
         FROM player_match_stats pms
         JOIN filtered_matches fm ON fm.id = pms.match_id`,
        [seasonId, worldId]
      )
    ]);

    const totalsRow = totals.rows[0] || {};
    const boundaryRow = boundaries.rows[0] || {};
    const milestoneRow = milestones.rows[0] || {};

    return res.json({
      seasonId,
      seasons: seasons.rows,
      teams: teams.rows,
      totals: {
        completed_matches: Number(totalsRow.completed_matches || 0),
        teams_involved: teams.rows.length,
        players_involved: Number(totalsRow.players_involved || 0),
        total_runs: Number(totalsRow.total_runs || 0),
        total_wickets: Number(totalsRow.total_wickets || 0),
        total_balls: Number(totalsRow.total_balls || 0),
        total_overs: oversFromBalls(totalsRow.total_balls || 0),
        ties_or_no_result: Number(totalsRow.ties_or_no_result || 0),
        fours: Number(boundaryRow.fours || 0),
        sixes: Number(boundaryRow.sixes || 0)
      },
      records: {
        highest_team_total: highestTeamTotal.rows[0] || null,
        lowest_team_total: lowestTeamTotal.rows[0] || null,
        highest_individual_score: highestIndividual.rows[0] || null,
        best_bowling_figures: bestBowling.rows[0] || null
      },
      milestones: {
        fifties: Number(milestoneRow.fifties || 0),
        hundreds: Number(milestoneRow.hundreds || 0),
        five_wicket_hauls: Number(milestoneRow.five_wicket_hauls || 0)
      }
    });
  })
);

router.get(
  '/player-records',
  optionalAuth,
  asyncHandler(async (req, res) => {
    const seasonId = parseSeasonId(req.query.seasonId);
    const limit = parseLimit(req.query.limit, 20, 100);
    const worldId = req.user?.active_world_id || null;

    if (seasonId && worldId) {
      const check = await pool.query('SELECT id FROM seasons WHERE id = $1 AND world_id = $2', [seasonId, worldId]);
      if (!check.rows.length) return res.status(403).json({ message: 'Season not found in your world.' });
    }

    const [aggregates, bestBowlingInnings, fastestFifty, fastestHundred] = await Promise.all([
      pool.query(
        `SELECT p.id AS player_id,
                p.first_name,
                p.last_name,
                p.role,
                f.franchise_name,
                c.country,
                COUNT(*)::int AS matches,
                SUM(pms.batting_runs)::int AS runs,
                SUM(pms.batting_balls)::int AS batting_balls,
                SUM(CASE WHEN pms.not_out THEN 1 ELSE 0 END)::int AS not_outs,
                SUM(CASE WHEN NOT pms.not_out AND pms.batting_balls > 0 THEN 1 ELSE 0 END)::int AS outs,
                SUM(pms.fours)::int AS fours,
                SUM(pms.sixes)::int AS sixes,
                SUM(pms.bowling_wickets)::int AS wickets,
                SUM(pms.bowling_balls)::int AS bowling_balls,
                SUM(pms.bowling_runs)::int AS bowling_runs,
                SUM(CASE WHEN pms.batting_runs BETWEEN 50 AND 99 THEN 1 ELSE 0 END)::int AS fifties,
                SUM(CASE WHEN pms.batting_runs >= 100 THEN 1 ELSE 0 END)::int AS hundreds,
                MAX(pms.batting_runs)::int AS highest_score,
                MAX(pms.bowling_wickets)::int AS best_wickets,
                ROUND(AVG(pms.player_rating), 2) AS avg_rating
         FROM player_match_stats pms
         JOIN matches m ON m.id = pms.match_id
         JOIN players p ON p.id = pms.player_id
         JOIN franchises f ON f.id = pms.franchise_id
         JOIN cities c ON c.id = f.city_id
         WHERE m.status = 'COMPLETED'
           AND ($1::bigint IS NULL OR m.season_id = $1::bigint)
           AND ($2::bigint IS NULL OR m.season_id IN (SELECT id FROM seasons WHERE world_id = $2))
         GROUP BY p.id, p.first_name, p.last_name, p.role, f.franchise_name, c.country`,
        [seasonId, worldId]
      ),
      pool.query(
        `SELECT pms.match_id,
                pms.player_id,
                p.first_name,
                p.last_name,
                p.role,
                f.franchise_name,
                c.country,
                pms.bowling_wickets,
                pms.bowling_runs,
                pms.bowling_balls
         FROM player_match_stats pms
         JOIN matches m ON m.id = pms.match_id
         JOIN players p ON p.id = pms.player_id
         JOIN franchises f ON f.id = pms.franchise_id
         JOIN cities c ON c.id = f.city_id
         WHERE m.status = 'COMPLETED'
           AND ($1::bigint IS NULL OR m.season_id = $1::bigint)
           AND ($3::bigint IS NULL OR m.season_id IN (SELECT id FROM seasons WHERE world_id = $3))
           AND pms.bowling_balls > 0
         ORDER BY pms.bowling_wickets DESC, pms.bowling_runs ASC, pms.bowling_balls ASC
         LIMIT $2`,
        [seasonId, limit, worldId]
      ),
      pool.query(
        `SELECT pms.match_id,
                pms.player_id,
                p.first_name,
                p.last_name,
                p.role,
                f.franchise_name,
                c.country,
                pms.batting_runs,
                pms.batting_balls
         FROM player_match_stats pms
         JOIN matches m ON m.id = pms.match_id
         JOIN players p ON p.id = pms.player_id
         JOIN franchises f ON f.id = pms.franchise_id
         JOIN cities c ON c.id = f.city_id
         WHERE m.status = 'COMPLETED'
           AND ($1::bigint IS NULL OR m.season_id = $1::bigint)
           AND ($2::bigint IS NULL OR m.season_id IN (SELECT id FROM seasons WHERE world_id = $2))
           AND pms.batting_runs >= 50
         ORDER BY pms.batting_balls ASC, pms.batting_runs DESC
         LIMIT 1`,
        [seasonId, worldId]
      ),
      pool.query(
        `SELECT pms.match_id,
                pms.player_id,
                p.first_name,
                p.last_name,
                p.role,
                f.franchise_name,
                c.country,
                pms.batting_runs,
                pms.batting_balls
         FROM player_match_stats pms
         JOIN matches m ON m.id = pms.match_id
         JOIN players p ON p.id = pms.player_id
         JOIN franchises f ON f.id = pms.franchise_id
         JOIN cities c ON c.id = f.city_id
         WHERE m.status = 'COMPLETED'
           AND ($1::bigint IS NULL OR m.season_id = $1::bigint)
           AND ($2::bigint IS NULL OR m.season_id IN (SELECT id FROM seasons WHERE world_id = $2))
           AND pms.batting_runs >= 100
         ORDER BY pms.batting_balls ASC, pms.batting_runs DESC
         LIMIT 1`,
        [seasonId, worldId]
      )
    ]);

    const rows = aggregates.rows.map((row) => {
      const runs = Number(row.runs || 0);
      const battingBalls = Number(row.batting_balls || 0);
      const outs = Number(row.outs || 0);
      const bowlingRuns = Number(row.bowling_runs || 0);
      const bowlingBalls = Number(row.bowling_balls || 0);
      const wickets = Number(row.wickets || 0);

      return {
        ...row,
        runs,
        batting_balls: battingBalls,
        wickets,
        bowling_balls: bowlingBalls,
        bowling_runs: bowlingRuns,
        batting_average: outs > 0 ? Number((runs / outs).toFixed(2)) : runs,
        strike_rate: battingBalls > 0 ? Number(((runs * 100) / battingBalls).toFixed(2)) : 0,
        economy: bowlingBalls > 0 ? Number(((bowlingRuns * 6) / bowlingBalls).toFixed(2)) : 0
      };
    });

    const topBy = (arr, compare) => [...arr].sort(compare).slice(0, limit);

    return res.json({
      seasonId,
      most_runs: topBy(rows, (a, b) => b.runs - a.runs || b.strike_rate - a.strike_rate),
      most_wickets: topBy(rows.filter((row) => row.bowling_balls > 0), (a, b) => b.wickets - a.wickets || a.economy - b.economy),
      best_batting_average: topBy(rows.filter((row) => row.runs >= 200), (a, b) => b.batting_average - a.batting_average || b.runs - a.runs),
      best_strike_rate: topBy(rows.filter((row) => row.runs >= 200), (a, b) => b.strike_rate - a.strike_rate || b.runs - a.runs),
      best_economy: topBy(rows.filter((row) => row.bowling_balls >= 120), (a, b) => a.economy - b.economy || b.wickets - a.wickets),
      most_fifties: topBy(rows.filter((row) => Number(row.fifties || 0) > 0), (a, b) => Number(b.fifties || 0) - Number(a.fifties || 0) || b.runs - a.runs),
      most_hundreds: topBy(rows.filter((row) => Number(row.hundreds || 0) > 0), (a, b) => Number(b.hundreds || 0) - Number(a.hundreds || 0) || b.runs - a.runs),
      most_sixes: topBy(rows.filter((row) => Number(row.sixes || 0) > 0), (a, b) => Number(b.sixes || 0) - Number(a.sixes || 0) || b.runs - a.runs),
      best_bowling_innings: bestBowlingInnings.rows,
      fastest_fifty: fastestFifty.rows[0] || null,
      fastest_hundred: fastestHundred.rows[0] || null
    });
  })
);

router.get(
  '/team-records',
  optionalAuth,
  asyncHandler(async (req, res) => {
    const seasonId = parseSeasonId(req.query.seasonId);
    const limit = parseLimit(req.query.limit, 20, 100);
    const worldId = req.user?.active_world_id || null;

    if (seasonId && worldId) {
      const check = await pool.query('SELECT id FROM seasons WHERE id = $1 AND world_id = $2', [seasonId, worldId]);
      if (!check.rows.length) return res.status(403).json({ message: 'Season not found in your world.' });
    }

    const [teamPerformance, highestTotals, lowestTotals, biggestWinsByRuns, biggestWinsByWickets] = await Promise.all([
      pool.query(
        `SELECT f.id AS franchise_id,
                f.franchise_name,
                c.country,
                SUM(st.played)::int AS played,
                SUM(st.won)::int AS won,
                SUM(st.lost)::int AS lost,
                SUM(st.tied)::int AS tied,
                SUM(st.points)::int AS points,
                ROUND(AVG(st.net_run_rate), 3) AS avg_nrr
         FROM season_teams st
         JOIN franchises f ON f.id = st.franchise_id
         JOIN cities c ON c.id = f.city_id
         WHERE ($1::bigint IS NULL OR st.season_id = $1::bigint)
           AND ($3::bigint IS NULL OR st.season_id IN (SELECT id FROM seasons WHERE world_id = $3))
         GROUP BY f.id, f.franchise_name, c.country
         ORDER BY SUM(st.won) DESC, SUM(st.points) DESC
         LIMIT $2`,
        [seasonId, limit, worldId]
      ),
      pool.query(
        `WITH filtered_matches AS (
           SELECT m.*
           FROM matches m
           WHERE m.status = 'COMPLETED'
             AND ($1::bigint IS NULL OR m.season_id = $1::bigint)
             AND ($3::bigint IS NULL OR m.season_id IN (SELECT id FROM seasons WHERE world_id = $3))
         ),
         innings AS (
           SELECT fm.id AS match_id,
                  fm.season_id,
                  fm.home_franchise_id AS franchise_id,
                  fm.home_score AS runs,
                  fm.home_wickets AS wickets,
                  fm.home_balls AS balls
           FROM filtered_matches fm
           UNION ALL
           SELECT fm.id AS match_id,
                  fm.season_id,
                  fm.away_franchise_id AS franchise_id,
                  fm.away_score AS runs,
                  fm.away_wickets AS wickets,
                  fm.away_balls AS balls
           FROM filtered_matches fm
         )
         SELECT i.*,
                f.franchise_name,
                c.country
         FROM innings i
         JOIN franchises f ON f.id = i.franchise_id
         JOIN cities c ON c.id = f.city_id
         WHERE i.runs IS NOT NULL
         ORDER BY i.runs DESC, i.wickets ASC
         LIMIT $2`,
        [seasonId, limit, worldId]
      ),
      pool.query(
        `WITH filtered_matches AS (
           SELECT m.*
           FROM matches m
           WHERE m.status = 'COMPLETED'
             AND ($1::bigint IS NULL OR m.season_id = $1::bigint)
             AND ($3::bigint IS NULL OR m.season_id IN (SELECT id FROM seasons WHERE world_id = $3))
         ),
         innings AS (
           SELECT fm.id AS match_id,
                  fm.season_id,
                  fm.home_franchise_id AS franchise_id,
                  fm.home_score AS runs,
                  fm.home_wickets AS wickets,
                  fm.home_balls AS balls
           FROM filtered_matches fm
           UNION ALL
           SELECT fm.id AS match_id,
                  fm.season_id,
                  fm.away_franchise_id AS franchise_id,
                  fm.away_score AS runs,
                  fm.away_wickets AS wickets,
                  fm.away_balls AS balls
           FROM filtered_matches fm
         )
         SELECT i.*,
                f.franchise_name,
                c.country
         FROM innings i
         JOIN franchises f ON f.id = i.franchise_id
         JOIN cities c ON c.id = f.city_id
         WHERE i.runs IS NOT NULL
         ORDER BY i.runs ASC, i.wickets DESC
         LIMIT $2`,
        [seasonId, limit, worldId]
      ),
      pool.query(
        `SELECT m.id AS match_id,
                m.season_id,
                m.round_no,
                m.result_summary,
                m.winner_franchise_id,
                hf.franchise_name AS home_team,
                af.franchise_name AS away_team,
                wf.franchise_name AS winner_name,
                COALESCE((regexp_match(lower(m.result_summary), 'by\\s+([0-9]+)\\s+runs'))[1], '0')::int AS margin_runs
         FROM matches m
         JOIN franchises hf ON hf.id = m.home_franchise_id
         JOIN franchises af ON af.id = m.away_franchise_id
         LEFT JOIN franchises wf ON wf.id = m.winner_franchise_id
         WHERE m.status = 'COMPLETED'
           AND ($1::bigint IS NULL OR m.season_id = $1::bigint)
           AND ($3::bigint IS NULL OR m.season_id IN (SELECT id FROM seasons WHERE world_id = $3))
           AND lower(COALESCE(m.result_summary, '')) ~ 'by\\s+[0-9]+\\s+runs'
         ORDER BY margin_runs DESC
         LIMIT $2`,
        [seasonId, limit, worldId]
      ),
      pool.query(
        `SELECT m.id AS match_id,
                m.season_id,
                m.round_no,
                m.result_summary,
                m.winner_franchise_id,
                hf.franchise_name AS home_team,
                af.franchise_name AS away_team,
                wf.franchise_name AS winner_name,
                COALESCE((regexp_match(lower(m.result_summary), 'by\\s+([0-9]+)\\s+wickets'))[1], '0')::int AS margin_wickets
         FROM matches m
         JOIN franchises hf ON hf.id = m.home_franchise_id
         JOIN franchises af ON af.id = m.away_franchise_id
         LEFT JOIN franchises wf ON wf.id = m.winner_franchise_id
         WHERE m.status = 'COMPLETED'
           AND ($1::bigint IS NULL OR m.season_id = $1::bigint)
           AND ($3::bigint IS NULL OR m.season_id IN (SELECT id FROM seasons WHERE world_id = $3))
           AND lower(COALESCE(m.result_summary, '')) ~ 'by\\s+[0-9]+\\s+wickets'
         ORDER BY margin_wickets DESC
         LIMIT $2`,
        [seasonId, limit, worldId]
      )
    ]);

    return res.json({
      seasonId,
      top_teams: teamPerformance.rows,
      highest_totals: highestTotals.rows,
      lowest_totals: lowestTotals.rows,
      biggest_wins_by_runs: biggestWinsByRuns.rows,
      biggest_wins_by_wickets: biggestWinsByWickets.rows
    });
  })
);

router.get(
  '/head-to-head',
  optionalAuth,
  asyncHandler(async (req, res) => {
    const seasonId = parseSeasonId(req.query.seasonId);
    const teamAId = parseId(req.query.teamAId);
    const teamBId = parseId(req.query.teamBId);
    const limit = parseLimit(req.query.limit, 20, 50);
    const worldId = req.user?.active_world_id || null;

    if (seasonId && worldId) {
      const check = await pool.query('SELECT id FROM seasons WHERE id = $1 AND world_id = $2', [seasonId, worldId]);
      if (!check.rows.length) return res.status(403).json({ message: 'Season not found in your world.' });
    }
    if (worldId && teamAId) {
      const check = await pool.query('SELECT id FROM franchises WHERE id = $1 AND world_id = $2', [teamAId, worldId]);
      if (!check.rows.length) return res.status(403).json({ message: 'Team not found in your world.' });
    }

    if (!teamAId || !teamBId || teamAId === teamBId) {
      return res.status(400).json({ message: 'teamAId and teamBId are required and must be different.' });
    }

    const [teams, summary, matches] = await Promise.all([
      pool.query(
        `SELECT f.id AS franchise_id,
                f.franchise_name,
                c.country
         FROM franchises f
         JOIN cities c ON c.id = f.city_id
         WHERE f.id IN ($1, $2)`,
        [teamAId, teamBId]
      ),
      pool.query(
        `SELECT COUNT(*)::int AS matches,
                SUM(CASE WHEN m.winner_franchise_id = $2 THEN 1 ELSE 0 END)::int AS team_a_wins,
                SUM(CASE WHEN m.winner_franchise_id = $3 THEN 1 ELSE 0 END)::int AS team_b_wins,
                SUM(CASE WHEN m.winner_franchise_id IS NULL THEN 1 ELSE 0 END)::int AS ties_or_no_result,
                COALESCE(ROUND(AVG(COALESCE(m.home_score, 0) + COALESCE(m.away_score, 0)), 2), 0) AS avg_total_runs
         FROM matches m
         WHERE m.status = 'COMPLETED'
           AND ($1::bigint IS NULL OR m.season_id = $1::bigint)
           AND ($4::bigint IS NULL OR m.season_id IN (SELECT id FROM seasons WHERE world_id = $4))
           AND (
             (m.home_franchise_id = $2 AND m.away_franchise_id = $3)
             OR
             (m.home_franchise_id = $3 AND m.away_franchise_id = $2)
           )`,
        [seasonId, teamAId, teamBId, worldId]
      ),
      pool.query(
        `SELECT m.id,
                m.season_id,
                m.round_no,
                m.stage,
                m.result_summary,
                m.home_score,
                m.home_wickets,
                m.home_balls,
                m.away_score,
                m.away_wickets,
                m.away_balls,
                m.winner_franchise_id,
                hf.franchise_name AS home_team,
                af.franchise_name AS away_team
         FROM matches m
         JOIN franchises hf ON hf.id = m.home_franchise_id
         JOIN franchises af ON af.id = m.away_franchise_id
         WHERE m.status = 'COMPLETED'
           AND ($1::bigint IS NULL OR m.season_id = $1::bigint)
           AND ($5::bigint IS NULL OR m.season_id IN (SELECT id FROM seasons WHERE world_id = $5))
           AND (
             (m.home_franchise_id = $2 AND m.away_franchise_id = $3)
             OR
             (m.home_franchise_id = $3 AND m.away_franchise_id = $2)
           )
         ORDER BY m.id DESC
         LIMIT $4`,
        [seasonId, teamAId, teamBId, limit, worldId]
      )
    ]);

    return res.json({
      seasonId,
      teams: teams.rows,
      summary: summary.rows[0] || null,
      matches: matches.rows
    });
  })
);

router.get(
  '/match-archive',
  optionalAuth,
  asyncHandler(async (req, res) => {
    const seasonId = parseSeasonId(req.query.seasonId);
    const teamId = parseId(req.query.teamId);
    const limit = parseLimit(req.query.limit, 30, 200);
    const offset = Math.max(0, Number(req.query.offset || 0));
    const worldId = req.user?.active_world_id || null;

    if (seasonId && worldId) {
      const check = await pool.query('SELECT id FROM seasons WHERE id = $1 AND world_id = $2', [seasonId, worldId]);
      if (!check.rows.length) return res.status(403).json({ message: 'Season not found in your world.' });
    }

    const [count, matches] = await Promise.all([
      pool.query(
        `SELECT COUNT(*)::int AS total
         FROM matches m
         WHERE m.status = 'COMPLETED'
           AND ($1::bigint IS NULL OR m.season_id = $1::bigint)
           AND ($2::bigint IS NULL OR m.home_franchise_id = $2::bigint OR m.away_franchise_id = $2::bigint)
           AND ($3::bigint IS NULL OR m.season_id IN (SELECT id FROM seasons WHERE world_id = $3))`,
        [seasonId, teamId, worldId]
      ),
      pool.query(
        `SELECT m.id,
                m.season_id,
                s.name AS season_name,
                m.round_no,
                m.stage,
                m.league_tier,
                m.result_summary,
                m.home_score,
                m.home_wickets,
                m.home_balls,
                m.away_score,
                m.away_wickets,
                m.away_balls,
                m.winner_franchise_id,
                m.toss_winner_franchise_id,
                m.toss_decision,
                hf.id AS home_franchise_id,
                hf.franchise_name AS home_team,
                hc.country AS home_country,
                af.id AS away_franchise_id,
                af.franchise_name AS away_team,
                ac.country AS away_country,
                twf.franchise_name AS toss_winner_name,
                wf.franchise_name AS winner_name
         FROM matches m
         JOIN seasons s ON s.id = m.season_id
         JOIN franchises hf ON hf.id = m.home_franchise_id
         JOIN cities hc ON hc.id = hf.city_id
         JOIN franchises af ON af.id = m.away_franchise_id
         JOIN cities ac ON ac.id = af.city_id
         LEFT JOIN franchises twf ON twf.id = m.toss_winner_franchise_id
         LEFT JOIN franchises wf ON wf.id = m.winner_franchise_id
         WHERE m.status = 'COMPLETED'
           AND ($1::bigint IS NULL OR m.season_id = $1::bigint)
           AND ($2::bigint IS NULL OR m.home_franchise_id = $2::bigint OR m.away_franchise_id = $2::bigint)
           AND ($5::bigint IS NULL OR s.world_id = $5)
         ORDER BY m.id DESC
         LIMIT $3 OFFSET $4`,
        [seasonId, teamId, limit, offset, worldId]
      )
    ]);

    return res.json({
      seasonId,
      teamId,
      total: Number(count.rows[0]?.total || 0),
      limit,
      offset,
      matches: matches.rows
    });
  })
);

router.get(
  '/match-archive/:matchId',
  optionalAuth,
  asyncHandler(async (req, res) => {
    const matchId = parseId(req.params.matchId);
    if (!matchId) {
      return res.status(400).json({ message: 'Invalid match id.' });
    }

    const worldId = req.user?.active_world_id || null;
    if (worldId) {
      const check = await pool.query(
        'SELECT m.id FROM matches m JOIN seasons s ON s.id = m.season_id WHERE m.id = $1 AND s.world_id = $2',
        [matchId, worldId]
      );
      if (!check.rows.length) return res.status(403).json({ message: 'Match not found in your world.' });
    }

    const scorecard = await getMatchScorecard(matchId, pool);
    if (!scorecard) {
      return res.status(404).json({ message: 'Match not found.' });
    }

    return res.json(scorecard);
  })
);

export default router;
