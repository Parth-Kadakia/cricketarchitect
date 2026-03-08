import pool from '../config/db.js';
import env from '../config/env.js';
import { clamp, randomFloat, randomInt, toOverNotation, weightedChoice } from '../utils/gameMath.js';
import {
  createNextSeasonFromCompleted,
  getActiveSeason,
  getLeagueTable,
  getSeasonRoundOverview,
  progressSeasonStructure,
  updateSeasonTableWithMatch
} from './leagueService.js';
import { simulateBallViaStreetApi, simulateMatchViaStreetApi, simulateTossViaStreetApi } from './streetCricketService.js';
import { calculateFranchiseValuation } from './valuationService.js';
import { ensureFranchiseLineup } from './lineupService.js';
import {
  finalizeGlobalManagerSeasonLifecycle,
  finalizeManagerSeasonEvaluations,
  processCpuManagerLifecycleForRound,
  processManagerAfterMatch
} from './managerCareerService.js';

const activeSimulations = new Set();
const MATCH_WIN_CASH_REWARD = 10;
const MATCH_LOSS_CASH_REWARD = 5;

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function maybeEmitSimulationProgress(handler, payload) {
  if (typeof handler !== 'function') {
    return;
  }

  try {
    await handler(payload);
  } catch {
    // Progress callbacks are best-effort and must never break simulation flow.
  }
}

async function maybeRunCpuManagerLifecycleForRound(seasonId, roundNo, dbClient = pool) {
  const safeSeasonId = Number(seasonId || 0);
  const safeRoundNo = Number(roundNo || 0);
  if (!safeSeasonId || !safeRoundNo) {
    return null;
  }

  const roundScope = await dbClient.query(
    `SELECT COUNT(*)::int AS total_regular,
            COUNT(*) FILTER (WHERE status <> 'COMPLETED')::int AS pending_regular
     FROM matches
     WHERE season_id = $1
       AND stage = 'REGULAR'
       AND round_no = $2`,
    [safeSeasonId, safeRoundNo]
  );

  const totalRegular = Number(roundScope.rows[0]?.total_regular || 0);
  const pendingRegular = Number(roundScope.rows[0]?.pending_regular || 0);
  if (!totalRegular || pendingRegular > 0) {
    return null;
  }

  return processCpuManagerLifecycleForRound({
    seasonId: safeSeasonId,
    roundNo: safeRoundNo,
    dbClient
  });
}

async function finalizeManagerSeasonLifecycle(seasonId, dbClient = pool) {
  const safeSeasonId = Number(seasonId || 0);
  if (!safeSeasonId) {
    return null;
  }
  await finalizeManagerSeasonEvaluations(safeSeasonId, dbClient);
  return finalizeGlobalManagerSeasonLifecycle(safeSeasonId, dbClient);
}

function sortByBatting(players) {
  const hasOrderedLineup = players.some((player) => Number(player.starting_xi) && Number(player.lineup_slot || 0) > 0);
  if (hasOrderedLineup) {
    const starters = players
      .filter((player) => Number(player.starting_xi))
      .sort((a, b) => Number(a.lineup_slot || 99) - Number(b.lineup_slot || 99));
    const nonStarters = players
      .filter((player) => !Number(player.starting_xi))
      .sort((a, b) => {
        const aScore = Number(a.batting) * 0.55 + Number(a.form) * 0.2 + Number(a.temperament) * 0.15 + Number(a.fitness) * 0.1;
        const bScore = Number(b.batting) * 0.55 + Number(b.form) * 0.2 + Number(b.temperament) * 0.15 + Number(b.fitness) * 0.1;
        return bScore - aScore;
      });
    return [...starters, ...nonStarters];
  }

  return [...players].sort((a, b) => {
    const aScore = Number(a.batting) * 0.55 + Number(a.form) * 0.2 + Number(a.temperament) * 0.15 + Number(a.fitness) * 0.1;
    const bScore = Number(b.batting) * 0.55 + Number(b.form) * 0.2 + Number(b.temperament) * 0.15 + Number(b.fitness) * 0.1;
    return bScore - aScore;
  });
}

function selectBowlers(players) {
  const scorePlayer = (player) => {
    const role = String(player.role || '').toUpperCase();
    const roleBonus = role === 'BOWLER' ? 2.2 : role === 'ALL_ROUNDER' ? 1.1 : role === 'BATTER' ? -1 : -4;
    return Number(player.bowling) * 0.58 + Number(player.form) * 0.2 + Number(player.fitness) * 0.22 + roleBonus;
  };

  const specialists = players.filter((player) => {
    const role = String(player.role || '').toUpperCase();
    const bowl = Number(player.bowling || 0);
    if (role === 'BOWLER') {
      return bowl >= 32;
    }
    if (role === 'ALL_ROUNDER') {
      return bowl >= 28;
    }
    return false;
  });

  const backupBatters = players.filter((player) => {
    const role = String(player.role || '').toUpperCase();
    return role === 'BATTER' && Number(player.bowling || 0) >= 68;
  });
  const nonKeepers = players.filter((player) => String(player.role || '').toUpperCase() !== 'WICKET_KEEPER');

  let candidatePool = specialists;
  if (candidatePool.length < 5) {
    candidatePool = [...candidatePool, ...backupBatters];
  }
  if (!candidatePool.length) {
    candidatePool = nonKeepers.length ? nonKeepers : players;
  }

  const sorted = [...candidatePool].sort((a, b) => {
    const aScore = scorePlayer(a);
    const bScore = scorePlayer(b);
    return bScore - aScore;
  });

  return sorted.slice(0, 5);
}

function getOverPhase(overNumber) {
  if (overNumber <= 6) {
    return 'POWERPLAY';
  }

  if (overNumber >= 17) {
    return 'DEATH';
  }

  return 'MIDDLE';
}

function oversFromBallsWhole(balls) {
  return Math.floor(Number(balls || 0) / 6);
}

function estimateRequiredRate(target, runs, ballsBowled) {
  if (target == null) {
    return null;
  }

  const runsNeeded = Math.max(0, target + 1 - runs);
  const ballsRemaining = Math.max(1, 120 - Number(ballsBowled || 0));
  return (runsNeeded / ballsRemaining) * 6;
}

function chooseBowlerForOver({ overNumber, bowlers, bowlingStats, previousOverBowlerId, runs, wickets, target, ballsBowled }) {
  const phase = getOverPhase(overNumber);
  const requiredRate = estimateRequiredRate(target, runs, ballsBowled);

  const freshCandidates = bowlers.filter((bowler) => {
    const line = bowlingStats.get(Number(bowler.id));
    const overs = oversFromBallsWhole(line?.balls);

    return overs < 4 && Number(bowler.id) !== Number(previousOverBowlerId);
  });

  const quotaCandidates = bowlers.filter((bowler) => {
    const line = bowlingStats.get(Number(bowler.id));
    return oversFromBallsWhole(line?.balls) < 4;
  });

  const candidates = freshCandidates.length ? freshCandidates : quotaCandidates.length ? quotaCandidates : bowlers;

  let best = candidates[0];
  let bestScore = Number.NEGATIVE_INFINITY;

  for (const bowler of candidates) {
    const line = bowlingStats.get(Number(bowler.id)) || { balls: 0, runs: 0, wickets: 0 };
    const oversBowled = oversFromBallsWhole(line.balls);
    const economy = Number(line.balls) ? (Number(line.runs) / Number(line.balls)) * 6 : 7;
    const role = String(bowler.role || 'BOWLER');

    let score =
      Number(bowler.bowling) * 0.66 +
      Number(bowler.form) * 0.18 +
      Number(bowler.fitness) * 0.16 +
      Number(bowler.temperament || 50) * 0.05;

    score -= oversBowled * 2.8;
    score += clamp(7.2 - economy, -3, 4) * 1.2;
    score += Number(line.wickets || 0) * 2;

    if (phase === 'POWERPLAY') {
      score += role === 'BOWLER' ? 2.5 : role === 'ALL_ROUNDER' ? 0.9 : -1.2;
    } else if (phase === 'MIDDLE') {
      score += role === 'ALL_ROUNDER' ? 1.8 : role === 'BOWLER' ? 0.7 : 0;
      score += wickets >= 4 ? Number(line.wickets || 0) * 0.8 : 0;
    } else {
      score += role === 'BOWLER' ? 2.2 : role === 'ALL_ROUNDER' ? 1.4 : -1;
      score += Number(line.wickets || 0) * 2.4;
      score += clamp(7.6 - economy, -2.8, 3.5) * 1.1;
    }

    if (requiredRate != null) {
      if (requiredRate > 9) {
        score += Number(line.wickets || 0) * 2.2 + Number(bowler.bowling) * 0.06;
      } else if (requiredRate < 6.3) {
        score += clamp(7 - economy, -2, 2);
      }
    }

    score += randomFloat(-1.6, 1.6);

    if (score > bestScore) {
      bestScore = score;
      best = bowler;
    }
  }

  return best;
}

function pickFrom(list) {
  return list[randomInt(0, list.length - 1)];
}

function buildMatchConditions() {
  const pitchConditions = weightedChoice([
    { value: 'good', weight: 18 },
    { value: 'green', weight: 18 },
    { value: 'flat', weight: 8 },
    { value: 'dusty', weight: 14 },
    { value: 'dry', weight: 20 },
    { value: 'damp', weight: 16 },
    { value: 'bouncy', weight: 6 }
  ]);

  const weatherConditions = weightedChoice([
    { value: 'clear', weight: 28 },
    { value: 'overcast', weight: 32 },
    { value: 'humid', weight: 14 },
    { value: 'windy', weight: 16 },
    { value: 'hot', weight: 6 },
    { value: 'cold', weight: 4 }
  ]);

  const windConditions = weightedChoice([
    { value: 'light', weight: 22 },
    { value: 'moderate', weight: 44 },
    { value: 'strong', weight: 34 }
  ]);

  const timeOfDay = weightedChoice([
    { value: 'day', weight: 52 },
    { value: 'day_night', weight: 34 },
    { value: 'night', weight: 14 }
  ]);

  const groundSize = weightedChoice([
    { value: 'Short', weight: 12 },
    { value: 'Medium', weight: 38 },
    { value: 'Large', weight: 50 }
  ]);

  return {
    pitchConditions,
    weatherConditions,
    windConditions,
    timeOfDay,
    groundSize,
    formatType: 'T20',
    totalOvers: 20
  };
}

function deriveTeamStrength(team) {
  const avgBat = team.reduce((sum, player) => sum + Number(player.batting || 0), 0) / Math.max(1, team.length);
  const avgBowl = team.reduce((sum, player) => sum + Number(player.bowling || 0), 0) / Math.max(1, team.length);
  return avgBat >= avgBowl ? 'Batting' : 'Bowling';
}

function resolveTossWinnerId(tossWinnerName, match) {
  const normalized = String(tossWinnerName || '').trim().toLowerCase();
  const homeName = String(match.home_name || '').trim().toLowerCase();
  const awayName = String(match.away_name || '').trim().toLowerCase();

  if (normalized && (homeName.includes(normalized) || normalized.includes(homeName))) {
    return Number(match.home_franchise_id);
  }
  if (normalized && (awayName.includes(normalized) || normalized.includes(awayName))) {
    return Number(match.away_franchise_id);
  }

  return null;
}

function parseTossDecision(decisionRaw) {
  const value = String(decisionRaw || '').trim().toLowerCase();
  if (value.includes('bowl') || value.includes('field')) {
    return 'BOWL';
  }
  return 'BAT';
}

function normalizeNameKey(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function buildPlayerNameLookup(players = []) {
  const lookup = new Map();
  for (const player of players) {
    const full = normalizeNameKey(`${player.first_name || ''} ${player.last_name || ''}`);
    if (full && !lookup.has(full)) {
      lookup.set(full, player);
    }

    const first = normalizeNameKey(player.first_name);
    if (first && !lookup.has(first)) {
      lookup.set(first, player);
    }

    const last = normalizeNameKey(player.last_name);
    if (last && !lookup.has(last)) {
      lookup.set(last, player);
    }
  }
  return lookup;
}

function resolvePlayerByName(name, players = [], lookup = null) {
  const key = normalizeNameKey(name);
  if (!key) {
    return null;
  }

  const map = lookup || buildPlayerNameLookup(players);
  if (map.has(key)) {
    return map.get(key);
  }

  const numbered = key.match(/^player\s+(\d+)$/i);
  if (numbered) {
    const index = Number(numbered[1]) - 1;
    if (players.length) {
      const safeIndex = ((index % players.length) + players.length) % players.length;
      return players[safeIndex];
    }
  }

  const tokens = key.split(' ').filter(Boolean);
  if (tokens.length >= 2) {
    const fallback = players.find((player) => {
      const first = normalizeNameKey(player.first_name);
      const last = normalizeNameKey(player.last_name);
      return first === tokens[0] && last === tokens[tokens.length - 1];
    });
    if (fallback) {
      return fallback;
    }
  }

  return players.find((player) => normalizeNameKey(`${player.first_name || ''} ${player.last_name || ''}`).includes(key)) || null;
}

function oversTextToBalls(oversValue) {
  const raw = String(oversValue ?? '').trim();
  if (!raw) {
    return 0;
  }
  const match = raw.match(/^(\d+)(?:\.(\d+))?$/);
  if (!match) {
    return 0;
  }
  const overPart = Number(match[1] || 0);
  const ballPart = Number(match[2] || 0);
  return overPart * 6 + Math.max(0, Math.min(5, ballPart));
}

function toInt(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.round(parsed)) : fallback;
}

function normalizeDismissalText(value) {
  const raw = String(value || '').trim();
  if (!raw) {
    return null;
  }
  if (/^not\s*out$/i.test(raw)) {
    return null;
  }
  if (/^dnb$/i.test(raw)) {
    return null;
  }
  return raw;
}

function cleanPlayerNameToken(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseDismissalDetails(value) {
  const raw = String(value || '').trim();
  const normalized = normalizeDismissalText(raw);
  if (!normalized) {
    return {
      text: null,
      type: null,
      bowlerName: null,
      fielderName: null
    };
  }

  const lower = raw.toLowerCase();
  if (lower.includes('run out')) {
    const runOutMatch =
      raw.match(/run out\s*\(([^)]+)\)/i) ||
      raw.match(/run out(?:\s+by\s+([A-Za-z0-9 .'-]+))?/i);
    const fielderToken = runOutMatch ? (runOutMatch[1] || runOutMatch[2] || '') : '';
    const fielderName = cleanPlayerNameToken(String(fielderToken).split(/[,&/]/)[0]);
    return {
      text: fielderName ? `run out (${fielderName})` : 'run out',
      type: 'RUN_OUT',
      bowlerName: null,
      fielderName: fielderName || null
    };
  }

  const bowlerMatch = raw.match(/\bb\s+([A-Za-z0-9 .'-]+)\s*(?:\(|$)/i);
  const bowlerName = bowlerMatch ? cleanPlayerNameToken(bowlerMatch[1]) : null;

  const caughtMatch = raw.match(/\bc\s+(.+?)\s+b\b/i);
  const stumpedMatch = raw.match(/\bst\s+(.+?)\s+b\b/i);
  const fielderName = cleanPlayerNameToken((caughtMatch?.[1] || stumpedMatch?.[1] || '').split(/[,&/]/)[0]) || null;

  if (lower.includes('c ')) {
    return {
      text: normalized,
      type: 'CAUGHT',
      bowlerName,
      fielderName
    };
  }

  if (lower.includes('lbw')) {
    return {
      text: bowlerName ? `lbw b ${bowlerName}` : 'lbw',
      type: 'LBW',
      bowlerName,
      fielderName: null
    };
  }

  if (lower.includes('st ')) {
    return {
      text: normalized,
      type: 'STUMPED',
      bowlerName,
      fielderName
    };
  }

  if (bowlerName) {
    return {
      text: `b ${bowlerName}`,
      type: 'BOWLED',
      bowlerName,
      fielderName: null
    };
  }

  return {
    text: normalized,
    type: 'OTHER',
    bowlerName: null,
    fielderName: null
  };
}

function inferInningsBattingId(inningsPayload, homeTeam, awayTeam, homeId, awayId) {
  const battingScorecard = inningsPayload?.batting_scorecard || {};
  const names = Object.keys(battingScorecard);
  if (!names.length) {
    return null;
  }

  const homeLookup = buildPlayerNameLookup(homeTeam);
  const awayLookup = buildPlayerNameLookup(awayTeam);

  let homeHits = 0;
  let awayHits = 0;
  for (const name of names) {
    if (resolvePlayerByName(name, homeTeam, homeLookup)) {
      homeHits += 1;
    }
    if (resolvePlayerByName(name, awayTeam, awayLookup)) {
      awayHits += 1;
    }
  }

  if (homeHits === 0 && awayHits === 0) {
    return null;
  }

  return homeHits >= awayHits ? Number(homeId) : Number(awayId);
}

function parseEventFromCommentaryLine({
  line,
  inningsNo,
  battingFranchiseId,
  bowlingFranchiseId,
  battingTeam,
  bowlingTeam,
  battingLookup,
  bowlingLookup,
  fallbackBallCounter
}) {
  const text = String(line || '').trim();
  if (!text || text.startsWith('OVER_SUMMARY:')) {
    return null;
  }

  const withPrefix = text.match(/^Over\s+(\d+)\.(\d+):\s*Ball\s+\d+:\s*(.+)$/i);
  const localPrefix = text.match(/^O(\d+)\.(\d+)\s+(.+)$/i);
  const match = withPrefix || localPrefix;
  const fallbackOver = Math.floor(fallbackBallCounter / 6) + 1;
  const fallbackBall = (fallbackBallCounter % 6) + 1;

  let overNumber = fallbackOver;
  let ballNumber = fallbackBall;
  let body = text;

  if (match) {
    overNumber = Number(match[1] || fallbackOver);
    ballNumber = Number(match[2] || fallbackBall);
    body = String(match[3] || text).trim();
  }

  const core =
    body.match(/^(.+?)\s+to\s+(.+?)\s+\(([^)]+)\)\s*(.*)$/i) ||
    body.match(/^(.+?)\s+to\s+(.+?)[,:]\s*(.*)$/i);

  let bowlerName = null;
  let strikerName = null;
  let outcome = '';
  let detail = body;

  if (core) {
    bowlerName = String(core[1] || '').trim();
    strikerName = String(core[2] || '').trim();
    outcome = String(core[3] || '').trim();
    detail = String(core[4] || '').trim();
  }

  const outcomeText = `${outcome} ${detail}`.toLowerCase();
  const isWicket =
    /\bout\b/.test(outcomeText) ||
    /\blbw\b/.test(outcomeText) ||
    /\bbowled\b/.test(outcomeText) ||
    /\bcaught\b/.test(outcomeText) ||
    /\brun out\b/.test(outcomeText);

  let runs = 0;
  let extras = 0;
  let eventType = 'RUN';

  if (/\bwide\b/.test(outcomeText) || /\bno[- ]?ball\b/.test(outcomeText)) {
    extras = 1;
    runs = 1;
    eventType = 'EXTRA';
  } else if (/\bsix\b/.test(outcomeText)) {
    runs = 6;
  } else if (/\bfour\b/.test(outcomeText)) {
    runs = 4;
  } else if (/\bthree\b/.test(outcomeText) || /\b3 run/.test(outcomeText)) {
    runs = 3;
  } else if (/\btwo\b/.test(outcomeText) || /\b2 run/.test(outcomeText)) {
    runs = 2;
  } else if (/\bsingle\b/.test(outcomeText) || /\b1 run/.test(outcomeText) || /\bone run\b/.test(outcomeText)) {
    runs = 1;
  } else if (/\bdot\b/.test(outcomeText) || /\bno run\b/.test(outcomeText)) {
    runs = 0;
  }

  if (isWicket) {
    eventType = 'WICKET';
    runs = 0;
  }

  const striker = strikerName ? resolvePlayerByName(strikerName, battingTeam, battingLookup) : null;
  const bowler = bowlerName ? resolvePlayerByName(bowlerName, bowlingTeam, bowlingLookup) : null;

  return {
    innings: inningsNo,
    overNumber,
    ballNumber,
    battingFranchiseId,
    bowlingFranchiseId,
    strikerPlayerId: striker ? Number(striker.id) : null,
    nonStrikerPlayerId: null,
    bowlerPlayerId: bowler ? Number(bowler.id) : null,
    runs,
    extras,
    eventType,
    isBoundary: runs === 4 || runs === 6,
    isSix: runs === 6,
    isWicket,
    commentary: text
  };
}

function summarizeOverRuns(inningsPayload = {}) {
  const overScores = Array.isArray(inningsPayload.over_scores) ? inningsPayload.over_scores : [];
  if (!overScores.length) {
    return [];
  }

  const sorted = [...overScores].sort((a, b) => Number(a.over || 0) - Number(b.over || 0));
  const cumulative = [];
  let running = 0;
  for (const over of sorted) {
    const cumulativeValue = Number(over.cumulative);
    if (Number.isFinite(cumulativeValue)) {
      running = cumulativeValue;
    } else {
      running += Number(over.runs || 0);
    }
    cumulative.push(running);
  }
  return cumulative;
}

function safeRunRate(runs, balls) {
  const numericRuns = Number(runs || 0);
  const numericBalls = Number(balls || 0);
  if (!numericBalls) {
    return 0;
  }
  return Number(((numericRuns / numericBalls) * 6).toFixed(2));
}

function overBallToAbsoluteBall(overNumber, ballNumber) {
  const over = Math.max(1, Number(overNumber || 1));
  const ball = Math.max(0, Math.min(6, Number(ballNumber || 0)));
  return (over - 1) * 6 + ball;
}

function extractDismissalTextFromCommentary(commentary) {
  const text = String(commentary || '').trim();
  if (!text) {
    return null;
  }

  const runOut = text.match(/\brun out(?:\s+by\s+([A-Za-z .'-]{2,80}))?/i);
  if (runOut) {
    return runOut[1] ? `run out (${runOut[1].trim()})` : 'run out';
  }

  const caught = text.match(/\bc\s+([A-Za-z .'-]{2,80})\s+b\s+([A-Za-z .'-]{2,80})/i);
  if (caught) {
    return `c ${caught[1].trim()} b ${caught[2].trim()}`;
  }

  const lbw = text.match(/\blbw\b(?:\s+b\s+([A-Za-z .'-]{2,80}))?/i);
  if (lbw) {
    return lbw[1] ? `lbw b ${lbw[1].trim()}` : 'lbw';
  }

  const bowled = text.match(/\bbowled\b(?:\s+([A-Za-z .'-]{2,80}))?/i);
  if (bowled) {
    return bowled[1] ? `b ${bowled[1].trim()}` : 'b ?';
  }

  return 'out';
}

async function clearDeepMatchData(matchId, dbClient = pool) {
  await dbClient.query('DELETE FROM match_partnerships WHERE match_id = $1', [matchId]);
  await dbClient.query('DELETE FROM match_fall_of_wickets WHERE match_id = $1', [matchId]);
  await dbClient.query('DELETE FROM match_over_stats WHERE match_id = $1', [matchId]);
  await dbClient.query('DELETE FROM match_innings_stats WHERE match_id = $1', [matchId]);
}

async function saveInningsSummary({
  matchId,
  innings,
  battingFranchiseId,
  bowlingFranchiseId,
  runs,
  wickets,
  balls,
  targetRuns = null,
  summaryText = null,
  dbClient = pool
}) {
  const requiredRate =
    targetRuns != null && Number(balls || 0) < 120
      ? Number((((Math.max(0, Number(targetRuns) - Number(runs || 0)) / Math.max(1, 120 - Number(balls || 0))) * 6).toFixed(2)))
      : null;

  await dbClient.query(
    `INSERT INTO match_innings_stats (
       match_id,
       innings,
       batting_franchise_id,
       bowling_franchise_id,
       total_runs,
       wickets,
       balls,
       run_rate,
       target_runs,
       required_rate,
       summary_text
     ) VALUES (
       $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11
     )
     ON CONFLICT (match_id, innings)
     DO UPDATE SET
       batting_franchise_id = EXCLUDED.batting_franchise_id,
       bowling_franchise_id = EXCLUDED.bowling_franchise_id,
       total_runs = EXCLUDED.total_runs,
       wickets = EXCLUDED.wickets,
       balls = EXCLUDED.balls,
       run_rate = EXCLUDED.run_rate,
       target_runs = EXCLUDED.target_runs,
       required_rate = EXCLUDED.required_rate,
       summary_text = EXCLUDED.summary_text`,
    [
      matchId,
      innings,
      battingFranchiseId,
      bowlingFranchiseId,
      Number(runs || 0),
      Number(wickets || 0),
      Number(balls || 0),
      safeRunRate(runs, balls),
      targetRuns == null ? null : Number(targetRuns),
      requiredRate,
      summaryText
    ]
  );
}

async function persistDeepStatsFromEvents({
  matchId,
  firstInnings,
  secondInnings,
  dbClient = pool
}) {
  await clearDeepMatchData(matchId, dbClient);

  const chaseTarget = Number(firstInnings.runs || 0) + 1;
  await saveInningsSummary({
    matchId,
    innings: 1,
    battingFranchiseId: firstInnings.battingId,
    bowlingFranchiseId: firstInnings.bowlingId,
    runs: firstInnings.runs,
    wickets: firstInnings.wickets,
    balls: firstInnings.balls,
    targetRuns: null,
    summaryText: null,
    dbClient
  });
  await saveInningsSummary({
    matchId,
    innings: 2,
    battingFranchiseId: secondInnings.battingId,
    bowlingFranchiseId: secondInnings.bowlingId,
    runs: secondInnings.runs,
    wickets: secondInnings.wickets,
    balls: secondInnings.balls,
    targetRuns: chaseTarget,
    summaryText: null,
    dbClient
  });

  const overBreakdown = await dbClient.query(
    `SELECT innings,
            over_number,
            COUNT(*)::int AS balls_in_over,
            COALESCE(SUM(runs + extras), 0)::int AS runs_in_over,
            COALESCE(SUM(CASE WHEN is_wicket THEN 1 ELSE 0 END), 0)::int AS wickets_in_over
     FROM match_events
     WHERE match_id = $1
     GROUP BY innings, over_number
     ORDER BY innings, over_number`,
    [matchId]
  );

  const inningState = new Map();
  for (const row of overBreakdown.rows) {
    const inningsNo = Number(row.innings || 0);
    const previous = inningState.get(inningsNo) || { runs: 0, wickets: 0, balls: 0 };
    const cumulativeRuns = previous.runs + Number(row.runs_in_over || 0);
    const cumulativeWickets = previous.wickets + Number(row.wickets_in_over || 0);
    const cumulativeBalls = previous.balls + Number(row.balls_in_over || 0);
    inningState.set(inningsNo, {
      runs: cumulativeRuns,
      wickets: cumulativeWickets,
      balls: cumulativeBalls
    });

    const targetRuns = inningsNo === 2 ? chaseTarget : null;
    const ballsRemaining = inningsNo === 2 ? Math.max(0, 120 - cumulativeBalls) : null;
    const requiredRuns = inningsNo === 2 ? Math.max(0, chaseTarget - cumulativeRuns) : null;
    const requiredRate =
      inningsNo === 2 && ballsRemaining
        ? Number(((requiredRuns / ballsRemaining) * 6).toFixed(2))
        : null;

    await dbClient.query(
      `INSERT INTO match_over_stats (
         match_id,
         innings,
         over_number,
         runs_in_over,
         wickets_in_over,
         cumulative_runs,
         cumulative_wickets,
         required_runs,
         balls_remaining,
         required_rate,
         summary_text
       ) VALUES (
         $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11
       )
       ON CONFLICT (match_id, innings, over_number)
       DO UPDATE SET
         runs_in_over = EXCLUDED.runs_in_over,
         wickets_in_over = EXCLUDED.wickets_in_over,
         cumulative_runs = EXCLUDED.cumulative_runs,
         cumulative_wickets = EXCLUDED.cumulative_wickets,
         required_runs = EXCLUDED.required_runs,
         balls_remaining = EXCLUDED.balls_remaining,
         required_rate = EXCLUDED.required_rate,
         summary_text = EXCLUDED.summary_text`,
      [
        matchId,
        inningsNo,
        Number(row.over_number || 0),
        Number(row.runs_in_over || 0),
        Number(row.wickets_in_over || 0),
        cumulativeRuns,
        cumulativeWickets,
        requiredRuns,
        ballsRemaining,
        requiredRate,
        null
      ]
    );
  }

  const detailedEvents = await dbClient.query(
    `SELECT me.id,
            me.innings,
            me.over_number,
            me.ball_number,
            me.runs,
            me.extras,
            me.is_wicket,
            me.commentary,
            me.striker_player_id,
            p.first_name,
            p.last_name
     FROM match_events me
     LEFT JOIN players p ON p.id = me.striker_player_id
     WHERE me.match_id = $1
     ORDER BY me.innings, me.over_number, me.ball_number, me.id`,
    [matchId]
  );

  const runningScore = new Map();
  const wicketCount = new Map();
  const fowRowsByInnings = new Map();

  for (const event of detailedEvents.rows) {
    const inningsNo = Number(event.innings || 0);
    const scoreSoFar = Number(runningScore.get(inningsNo) || 0) + Number(event.runs || 0) + Number(event.extras || 0);
    runningScore.set(inningsNo, scoreSoFar);

    if (!Number(event.is_wicket)) {
      continue;
    }

    const wicketNo = Number(wicketCount.get(inningsNo) || 0) + 1;
    wicketCount.set(inningsNo, wicketNo);

    const batterName = `${event.first_name || ''} ${event.last_name || ''}`.trim() || null;
    const fowRow = {
      wicketNo,
      scoreAtFall: scoreSoFar,
      ballNumber: overBallToAbsoluteBall(event.over_number, event.ball_number),
      overLabel: `${Number(event.over_number || 0)}.${Number(event.ball_number || 0)}`,
      batterPlayerId: event.striker_player_id ? Number(event.striker_player_id) : null,
      batterName,
      dismissalText: extractDismissalTextFromCommentary(event.commentary)
    };

    const existing = fowRowsByInnings.get(inningsNo) || [];
    existing.push(fowRow);
    fowRowsByInnings.set(inningsNo, existing);

    await dbClient.query(
      `INSERT INTO match_fall_of_wickets (
         match_id,
         innings,
         wicket_no,
         score_at_fall,
         ball_number,
         over_label,
         batter_player_id,
         batter_name,
         dismissal_text
       ) VALUES (
         $1, $2, $3, $4, $5, $6, $7, $8, $9
       )
       ON CONFLICT (match_id, innings, wicket_no)
       DO UPDATE SET
         score_at_fall = EXCLUDED.score_at_fall,
         ball_number = EXCLUDED.ball_number,
         over_label = EXCLUDED.over_label,
         batter_player_id = EXCLUDED.batter_player_id,
         batter_name = EXCLUDED.batter_name,
         dismissal_text = EXCLUDED.dismissal_text`,
      [
        matchId,
        inningsNo,
        wicketNo,
        fowRow.scoreAtFall,
        fowRow.ballNumber,
        fowRow.overLabel,
        fowRow.batterPlayerId,
        fowRow.batterName,
        fowRow.dismissalText
      ]
    );
  }

  const inningsTotals = new Map([
    [1, { runs: Number(firstInnings.runs || 0), balls: Number(firstInnings.balls || 0) }],
    [2, { runs: Number(secondInnings.runs || 0), balls: Number(secondInnings.balls || 0) }]
  ]);

  for (const [inningsNo, totals] of inningsTotals.entries()) {
    const wickets = [...(fowRowsByInnings.get(inningsNo) || [])].sort((a, b) => a.wicketNo - b.wicketNo);
    let prevRuns = 0;
    let prevBall = 0;
    let partnershipNo = 1;

    for (const wicket of wickets) {
      const runs = Math.max(0, Number(wicket.scoreAtFall || 0) - prevRuns);
      const balls = Math.max(0, Number(wicket.ballNumber || 0) - prevBall);
      await dbClient.query(
        `INSERT INTO match_partnerships (
           match_id,
           innings,
           partnership_no,
           runs,
           balls,
           batter_one_player_id,
           batter_one_name,
           batter_one_runs,
           batter_two_player_id,
           batter_two_name,
           batter_two_runs
         ) VALUES (
           $1, $2, $3, $4, $5, NULL, NULL, 0, NULL, NULL, 0
         )
         ON CONFLICT (match_id, innings, partnership_no)
         DO UPDATE SET
           runs = EXCLUDED.runs,
           balls = EXCLUDED.balls`,
        [matchId, inningsNo, partnershipNo, runs, balls]
      );

      partnershipNo += 1;
      prevRuns = Number(wicket.scoreAtFall || 0);
      prevBall = Number(wicket.ballNumber || 0);
    }

    if (partnershipNo <= 10 && Number(totals.runs || 0) > prevRuns) {
      const runs = Math.max(0, Number(totals.runs || 0) - prevRuns);
      const balls = Math.max(0, Number(totals.balls || 0) - prevBall);
      await dbClient.query(
        `INSERT INTO match_partnerships (
           match_id,
           innings,
           partnership_no,
           runs,
           balls,
           batter_one_player_id,
           batter_one_name,
           batter_one_runs,
           batter_two_player_id,
           batter_two_name,
           batter_two_runs
         ) VALUES (
           $1, $2, $3, $4, $5, NULL, NULL, 0, NULL, NULL, 0
         )
         ON CONFLICT (match_id, innings, partnership_no)
         DO UPDATE SET
           runs = EXCLUDED.runs,
           balls = EXCLUDED.balls`,
        [matchId, inningsNo, partnershipNo, runs, balls]
      );
    }
  }
}

function buildOverSummaryMap(commentaryLines = []) {
  const map = new Map();
  for (const line of commentaryLines) {
    const text = String(line || '').trim();
    if (!text.startsWith('OVER_SUMMARY:')) {
      continue;
    }
    const match = text.match(/^OVER_SUMMARY:\s*Over\s+(\d+):\s*(.+)$/i);
    if (!match) {
      continue;
    }
    map.set(Number(match[1] || 0), String(match[2] || '').trim());
  }
  return map;
}

async function persistDeepStatsFromApi({
  matchId,
  apiResult,
  firstInnings,
  secondInnings,
  homeTeam,
  awayTeam,
  homeFranchiseId,
  awayFranchiseId,
  dbClient = pool
}) {
  await clearDeepMatchData(matchId, dbClient);

  const firstPayload = apiResult?.first_innings || {};
  const secondPayload = apiResult?.second_innings || {};
  const chaseTarget = Number(firstInnings.runs || 0) + 1;

  await saveInningsSummary({
    matchId,
    innings: 1,
    battingFranchiseId: firstInnings.battingId,
    bowlingFranchiseId: firstInnings.bowlingId,
    runs: firstInnings.runs,
    wickets: firstInnings.wickets,
    balls: firstInnings.balls,
    targetRuns: null,
    summaryText: String(firstPayload.ai_innings_summary || '').trim() || null,
    dbClient
  });
  await saveInningsSummary({
    matchId,
    innings: 2,
    battingFranchiseId: secondInnings.battingId,
    bowlingFranchiseId: secondInnings.bowlingId,
    runs: secondInnings.runs,
    wickets: secondInnings.wickets,
    balls: secondInnings.balls,
    targetRuns: chaseTarget,
    summaryText: String(secondPayload.ai_innings_summary || '').trim() || null,
    dbClient
  });

  const inningPayloads = [
    { inningsNo: 1, payload: firstPayload, battingId: firstInnings.battingId, battingTeam: firstInnings.battingId === Number(homeFranchiseId) ? homeTeam : awayTeam },
    { inningsNo: 2, payload: secondPayload, battingId: secondInnings.battingId, battingTeam: secondInnings.battingId === Number(homeFranchiseId) ? homeTeam : awayTeam }
  ];

  for (const inning of inningPayloads) {
    const overScores = Array.isArray(inning.payload?.over_scores) ? inning.payload.over_scores : [];
    const overSummaryMap = buildOverSummaryMap(Array.isArray(inning.payload?.commentary) ? inning.payload.commentary : []);
    let prevRuns = 0;
    let cumulativeWickets = 0;
    let cumulativeBalls = 0;

    for (const over of overScores) {
      const overNo = Number(over?.over || 0);
      if (!overNo) {
        continue;
      }

      const cumulativeRuns =
        Number.isFinite(Number(over?.cumulative))
          ? Number(over.cumulative)
          : prevRuns + Number(over?.runs || 0);
      const runsInOver = Number.isFinite(Number(over?.runs))
        ? Number(over.runs)
        : Math.max(0, cumulativeRuns - prevRuns);
      prevRuns = cumulativeRuns;

      const wicketsInOver = Number(over?.wickets || 0);
      cumulativeWickets += wicketsInOver;
      cumulativeBalls = Math.min(120, overNo * 6);

      const targetRuns = inning.inningsNo === 2 ? chaseTarget : null;
      const ballsRemaining = inning.inningsNo === 2 ? Math.max(0, 120 - cumulativeBalls) : null;
      const requiredRuns = inning.inningsNo === 2 ? Math.max(0, chaseTarget - cumulativeRuns) : null;
      const requiredRate =
        inning.inningsNo === 2 && ballsRemaining
          ? Number(((requiredRuns / ballsRemaining) * 6).toFixed(2))
          : null;

      await dbClient.query(
        `INSERT INTO match_over_stats (
           match_id,
           innings,
           over_number,
           runs_in_over,
           wickets_in_over,
           cumulative_runs,
           cumulative_wickets,
           required_runs,
           balls_remaining,
           required_rate,
           summary_text
         ) VALUES (
           $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11
         )
         ON CONFLICT (match_id, innings, over_number)
         DO UPDATE SET
           runs_in_over = EXCLUDED.runs_in_over,
           wickets_in_over = EXCLUDED.wickets_in_over,
           cumulative_runs = EXCLUDED.cumulative_runs,
           cumulative_wickets = EXCLUDED.cumulative_wickets,
           required_runs = EXCLUDED.required_runs,
           balls_remaining = EXCLUDED.balls_remaining,
           required_rate = EXCLUDED.required_rate,
           summary_text = EXCLUDED.summary_text`,
        [
          matchId,
          inning.inningsNo,
          overNo,
          runsInOver,
          wicketsInOver,
          cumulativeRuns,
          cumulativeWickets,
          requiredRuns,
          ballsRemaining,
          requiredRate,
          overSummaryMap.get(overNo) || null
        ]
      );
    }

    const fow = Array.isArray(inning.payload?.fall_of_wickets) ? inning.payload.fall_of_wickets : [];
    const battingLookup = buildPlayerNameLookup(inning.battingTeam);
    for (let i = 0; i < fow.length; i += 1) {
      const row = fow[i] || {};
      const wicketNo = Number(row.wicket || i + 1);
      const batterName = String(row.batsman || '').trim() || null;
      const batterPlayer = batterName ? resolvePlayerByName(batterName, inning.battingTeam, battingLookup) : null;
      const absoluteBall = toInt(row.ball, overBallToAbsoluteBall(String(row.ov || '').split('.')[0], String(row.ov || '').split('.')[1]));
      const overLabel = String(row.ov || '').trim() || null;
      const scoreAtFall = toInt(row.score, 0);

      await dbClient.query(
        `INSERT INTO match_fall_of_wickets (
           match_id,
           innings,
           wicket_no,
           score_at_fall,
           ball_number,
           over_label,
           batter_player_id,
           batter_name,
           dismissal_text
         ) VALUES (
           $1, $2, $3, $4, $5, $6, $7, $8, $9
         )
         ON CONFLICT (match_id, innings, wicket_no)
         DO UPDATE SET
           score_at_fall = EXCLUDED.score_at_fall,
           ball_number = EXCLUDED.ball_number,
           over_label = EXCLUDED.over_label,
           batter_player_id = EXCLUDED.batter_player_id,
           batter_name = EXCLUDED.batter_name,
           dismissal_text = EXCLUDED.dismissal_text`,
        [
          matchId,
          inning.inningsNo,
          wicketNo,
          scoreAtFall,
          absoluteBall || null,
          overLabel,
          batterPlayer ? Number(batterPlayer.id) : null,
          batterName,
          null
        ]
      );
    }

    const partnerships = Array.isArray(inning.payload?.partnerships) ? inning.payload.partnerships : [];
    for (let i = 0; i < partnerships.length; i += 1) {
      const row = partnerships[i] || {};
      const batters = row.batsmen && typeof row.batsmen === 'object' ? Object.entries(row.batsmen) : [];
      const [b1NameRaw, b1RunsRaw] = batters[0] || [null, 0];
      const [b2NameRaw, b2RunsRaw] = batters[1] || [null, 0];
      const b1Name = String(b1NameRaw || '').trim() || null;
      const b2Name = String(b2NameRaw || '').trim() || null;
      const b1 = b1Name ? resolvePlayerByName(b1Name, inning.battingTeam, battingLookup) : null;
      const b2 = b2Name ? resolvePlayerByName(b2Name, inning.battingTeam, battingLookup) : null;

      await dbClient.query(
        `INSERT INTO match_partnerships (
           match_id,
           innings,
           partnership_no,
           runs,
           balls,
           batter_one_player_id,
           batter_one_name,
           batter_one_runs,
           batter_two_player_id,
           batter_two_name,
           batter_two_runs
         ) VALUES (
           $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11
         )
         ON CONFLICT (match_id, innings, partnership_no)
         DO UPDATE SET
           runs = EXCLUDED.runs,
           balls = EXCLUDED.balls,
           batter_one_player_id = EXCLUDED.batter_one_player_id,
           batter_one_name = EXCLUDED.batter_one_name,
           batter_one_runs = EXCLUDED.batter_one_runs,
           batter_two_player_id = EXCLUDED.batter_two_player_id,
           batter_two_name = EXCLUDED.batter_two_name,
           batter_two_runs = EXCLUDED.batter_two_runs`,
        [
          matchId,
          inning.inningsNo,
          i + 1,
          toInt(row.runs, 0),
          toInt(row.balls, 0),
          b1 ? Number(b1.id) : null,
          b1Name,
          toInt(b1RunsRaw, 0),
          b2 ? Number(b2.id) : null,
          b2Name,
          toInt(b2RunsRaw, 0)
        ]
      );
    }
  }
}

function buildInningsFromApiPayload({
  inningsNo,
  inningsPayload,
  battingFranchiseId,
  bowlingFranchiseId,
  battingTeam,
  bowlingTeam,
  matchId
}) {
  const battingLookup = buildPlayerNameLookup(battingTeam);
  const bowlingLookup = buildPlayerNameLookup(bowlingTeam);

  const battingStats = initBattingStats(battingTeam);
  const bowlingStats = initBowlingStats(bowlingTeam);
  const fieldingStats = initFieldingStats(bowlingTeam);
  const battingOrderByPlayerId = new Map();
  for (let i = 0; i < battingTeam.length; i += 1) {
    const playerId = Number(battingTeam[i]?.id || 0);
    if (!playerId) {
      continue;
    }
    battingOrderByPlayerId.set(playerId, i + 1);
    const row = battingStats.get(playerId);
    if (row) {
      // Keep XI lineup order as the canonical batting order for external full-match sims.
      row.battingOrder = i + 1;
    }
  }

  const battingScorecard = inningsPayload?.batting_scorecard || {};
  const battingEntries = Object.entries(battingScorecard);
  const derivedBowlerWickets = new Map();

  for (const [name, line] of battingEntries) {
    const player = resolvePlayerByName(name, battingTeam, battingLookup);
    if (!player) {
      continue;
    }

    const row = battingStats.get(Number(player.id));
    row.innings = inningsNo;
    row.battingOrder = Number(battingOrderByPlayerId.get(Number(player.id)) || row.battingOrder || null);
    row.runs = toInt(line?.R ?? line?.runs ?? 0);
    row.balls = toInt(line?.B ?? line?.balls ?? 0);
    row.fours = toInt(line?.['4s'] ?? line?.fours ?? 0);
    row.sixes = toInt(line?.['6s'] ?? line?.sixes ?? 0);

    const dismissalRaw = String(line?.dismissal ?? line?.dismissal_text ?? '');
    const dismissal = parseDismissalDetails(dismissalRaw);
    row.dismissalText = dismissal.text;
    row.notOut = !dismissal.text;

    if (dismissal.type === 'RUN_OUT') {
      if (dismissal.fielderName) {
        const fielder = resolvePlayerByName(dismissal.fielderName, bowlingTeam, bowlingLookup);
        if (fielder) {
          const fieldLine = fieldingStats.get(Number(fielder.id));
          fieldLine.runOuts += 1;
        }
      }
      continue;
    }

    if (dismissal.type === 'CAUGHT' && dismissal.fielderName) {
      const fielder = resolvePlayerByName(dismissal.fielderName, bowlingTeam, bowlingLookup);
      if (fielder) {
        const fieldLine = fieldingStats.get(Number(fielder.id));
        fieldLine.catches += 1;
      }
    }

    if (dismissal.bowlerName) {
      const bowler = resolvePlayerByName(dismissal.bowlerName, bowlingTeam, bowlingLookup);
      if (bowler) {
        const bowlerId = Number(bowler.id);
        derivedBowlerWickets.set(bowlerId, Number(derivedBowlerWickets.get(bowlerId) || 0) + 1);
      }
    }
  }

  const bowlingScorecard = inningsPayload?.bowling_scorecard || {};
  const useDerivedWicketCredits = battingEntries.length > 0;
  for (const [name, line] of Object.entries(bowlingScorecard)) {
    const player = resolvePlayerByName(name, bowlingTeam, bowlingLookup);
    if (!player) {
      continue;
    }

    const row = bowlingStats.get(Number(player.id));
    row.balls = toInt(line?.B ?? line?.balls ?? oversTextToBalls(line?.O ?? line?.overs ?? 0));
    row.runs = toInt(line?.R ?? line?.runs ?? 0);
    row.wickets = useDerivedWicketCredits
      ? Number(derivedBowlerWickets.get(Number(player.id)) || 0)
      : toInt(line?.W ?? line?.wkts ?? line?.wickets ?? 0);
    row.maidens = toInt(line?.M ?? line?.maidens ?? 0);
    row.currentOverRuns = 0;
  }

  normalizeBowlingByRole({
    bowlingTeam,
    bowlingStats
  });

  const commentaryLines = Array.isArray(inningsPayload?.commentary) ? inningsPayload.commentary : [];
  const events = [];
  for (let i = 0; i < commentaryLines.length; i += 1) {
    const parsed = parseEventFromCommentaryLine({
      line: commentaryLines[i],
      inningsNo,
      battingFranchiseId,
      bowlingFranchiseId,
      battingTeam,
      bowlingTeam,
      battingLookup,
      bowlingLookup,
      fallbackBallCounter: i
    });

    if (parsed) {
      events.push({
        ...parsed,
        matchId,
        sortIndex: i
      });
    }
  }

  const overRuns = summarizeOverRuns(inningsPayload);

  if (!events.length && overRuns.length) {
    let previous = 0;
    for (let i = 0; i < overRuns.length; i += 1) {
      const cumulative = Number(overRuns[i] || 0);
      const overRunsDelta = Math.max(0, cumulative - previous);
      previous = cumulative;
      events.push({
        matchId,
        innings: inningsNo,
        overNumber: i + 1,
        ballNumber: 6,
        battingFranchiseId,
        bowlingFranchiseId,
        strikerPlayerId: null,
        nonStrikerPlayerId: null,
        bowlerPlayerId: null,
        runs: overRunsDelta,
        extras: 0,
        eventType: 'RUN',
        isBoundary: false,
        isSix: false,
        isWicket: false,
        commentary: `Over ${i + 1}.6: End of over, ${overRunsDelta} run${overRunsDelta === 1 ? '' : 's'}.`,
        sortIndex: i
      });
    }
  }

  const runs = toInt(inningsPayload?.total_runs, 0);
  const wickets = Math.min(10, toInt(inningsPayload?.wickets, 0));
  let balls = toInt(inningsPayload?.legal_balls, 0);
  if (!balls && overRuns.length) {
    balls = Math.min(120, overRuns.length * 6);
  }

  return {
    runs,
    wickets,
    balls,
    overRuns,
    battingStats,
    bowlingStats,
    fieldingStats,
    battingOrder: battingTeam,
    bowlers: bowlingTeam,
    events,
    battingId: battingFranchiseId,
    bowlingId: bowlingFranchiseId
  };
}

function normalizeBowlingByRole({ bowlingTeam, bowlingStats }) {
  const roleOf = (player) => String(player?.role || '').toUpperCase();
  const canPrimaryBowl = (player) => {
    const role = roleOf(player);
    if (role === 'BOWLER' || role === 'ALL_ROUNDER') {
      return true;
    }
    return false;
  };

  let legalBowlers = bowlingTeam.filter(canPrimaryBowl);
  if (legalBowlers.length < 3) {
    const backups = [...bowlingTeam]
      .filter((player) => roleOf(player) !== 'WICKET_KEEPER' && !legalBowlers.some((legal) => Number(legal.id) === Number(player.id)))
      .sort((a, b) => Number(b.bowling || 0) - Number(a.bowling || 0));
    while (legalBowlers.length < 3 && backups.length) {
      legalBowlers.push(backups.shift());
    }
  }

  if (!legalBowlers.length) {
    return;
  }

  const legalIds = new Set(legalBowlers.map((player) => Number(player.id)));
  const overflow = { balls: 0, runs: 0, wickets: 0, maidens: 0 };

  for (const player of bowlingTeam) {
    const playerId = Number(player.id);
    const row = bowlingStats.get(playerId);
    if (!row) {
      continue;
    }
    if (legalIds.has(playerId)) {
      continue;
    }
    const hasContribution =
      Number(row.balls || 0) > 0 ||
      Number(row.runs || 0) > 0 ||
      Number(row.wickets || 0) > 0 ||
      Number(row.maidens || 0) > 0;
    if (!hasContribution) {
      continue;
    }

    overflow.balls += Number(row.balls || 0);
    overflow.runs += Number(row.runs || 0);
    overflow.wickets += Number(row.wickets || 0);
    overflow.maidens += Number(row.maidens || 0);

    row.balls = 0;
    row.runs = 0;
    row.wickets = 0;
    row.maidens = 0;
    row.currentOverRuns = 0;
  }

  if (!overflow.balls && !overflow.runs && !overflow.wickets && !overflow.maidens) {
    return;
  }

  const recipients = [...legalBowlers].sort((a, b) => {
    const aRow = bowlingStats.get(Number(a.id)) || { balls: 0 };
    const bRow = bowlingStats.get(Number(b.id)) || { balls: 0 };
    if (Number(aRow.balls || 0) !== Number(bRow.balls || 0)) {
      return Number(aRow.balls || 0) - Number(bRow.balls || 0);
    }
    return Number(b.bowling || 0) - Number(a.bowling || 0);
  });

  const addedBallsByPlayer = new Map();
  let remainingBalls = Number(overflow.balls || 0);

  while (remainingBalls > 0) {
    let progressed = false;
    for (const player of recipients) {
      if (remainingBalls <= 0) {
        break;
      }

      const row = bowlingStats.get(Number(player.id));
      const currentBalls = Number(row?.balls || 0);
      const cap = Math.max(0, 24 - currentBalls);
      if (cap <= 0) {
        continue;
      }

      const give = Math.min(remainingBalls, Math.min(6, cap));
      row.balls = currentBalls + give;
      addedBallsByPlayer.set(Number(player.id), Number(addedBallsByPlayer.get(Number(player.id)) || 0) + give);
      remainingBalls -= give;
      progressed = true;
    }

    if (!progressed) {
      break;
    }
  }

  if (remainingBalls > 0) {
    const fallback = recipients[0];
    const row = bowlingStats.get(Number(fallback.id));
    row.balls = Number(row.balls || 0) + remainingBalls;
    addedBallsByPlayer.set(Number(fallback.id), Number(addedBallsByPlayer.get(Number(fallback.id)) || 0) + remainingBalls);
    remainingBalls = 0;
  }

  const totalAddedBalls = [...addedBallsByPlayer.values()].reduce((sum, value) => sum + Number(value || 0), 0);
  const rankedRecipients = [...recipients].sort((a, b) => Number(b.bowling || 0) - Number(a.bowling || 0));

  let runsLeft = Number(overflow.runs || 0);
  for (let i = 0; i < rankedRecipients.length; i += 1) {
    const player = rankedRecipients[i];
    const row = bowlingStats.get(Number(player.id));
    const added = Number(addedBallsByPlayer.get(Number(player.id)) || 0);
    if (!added) {
      continue;
    }

    const share =
      i === rankedRecipients.length - 1
        ? runsLeft
        : Math.min(
          runsLeft,
          Math.round((Number(overflow.runs || 0) * added) / Math.max(1, totalAddedBalls))
        );
    row.runs = Number(row.runs || 0) + share;
    runsLeft -= share;
  }

  while (runsLeft > 0) {
    const target = rankedRecipients[0];
    const row = bowlingStats.get(Number(target.id));
    row.runs = Number(row.runs || 0) + 1;
    runsLeft -= 1;
  }

  let wicketsLeft = Number(overflow.wickets || 0);
  let wicketCursor = 0;
  while (wicketsLeft > 0) {
    const target = rankedRecipients[wicketCursor % rankedRecipients.length];
    const row = bowlingStats.get(Number(target.id));
    row.wickets = Number(row.wickets || 0) + 1;
    wicketsLeft -= 1;
    wicketCursor += 1;
  }

  let maidensLeft = Number(overflow.maidens || 0);
  let maidenCursor = 0;
  const maidenOrder = [...rankedRecipients].sort((a, b) => {
    const aAdded = Number(addedBallsByPlayer.get(Number(a.id)) || 0);
    const bAdded = Number(addedBallsByPlayer.get(Number(b.id)) || 0);
    return bAdded - aAdded;
  });
  while (maidensLeft > 0) {
    const target = maidenOrder[maidenCursor % maidenOrder.length];
    const row = bowlingStats.get(Number(target.id));
    row.maidens = Number(row.maidens || 0) + 1;
    maidensLeft -= 1;
    maidenCursor += 1;
  }
}

function pickDismissalType() {
  return weightedChoice([
    { value: 'caught', weight: 55 },
    { value: 'bowled', weight: 23 },
    { value: 'lbw', weight: 12 },
    { value: 'run out', weight: 10 }
  ]);
}

function fullName(player) {
  return `${player.first_name} ${player.last_name}`;
}

function buildCommentary({
  striker,
  bowler,
  runs,
  wicket,
  dismissalType,
  wicketFieldingName,
  overNumber,
  ballNumber,
  score,
  wickets
}) {
  const strikerName = fullName(striker);
  const bowlerName = fullName(bowler);
  const prefix = `O${overNumber}.${ballNumber} ${bowlerName} to ${strikerName}:`;

  const boundaryPhrases = ['driven beautifully through cover', 'finds the gap and races away', 'timed well through mid-off'];
  const sixPhrases = ['launches it over long-on', 'clears the rope with ease', 'goes big and gets maximum'];
  const runPhrases = [
    `worked to the leg side for ${runs}`,
    `nudged into space for ${runs}`,
    `placed into the gap for ${runs} run${runs > 1 ? 's' : ''}`
  ];
  const dotPhrases = ['solidly defended, no run', 'beaten outside off, dot ball', 'tight line and length, no run'];

  if (wicket) {
    if (dismissalType === 'caught') {
      return `${prefix} OUT! ${strikerName} c ${wicketFieldingName} b ${bowlerName}. Score ${score}/${wickets}.`;
    }

    if (dismissalType === 'run out') {
      return `${prefix} OUT! ${strikerName} run out${wicketFieldingName ? ` by ${wicketFieldingName}` : ''}. Score ${score}/${wickets}.`;
    }

    if (dismissalType === 'lbw') {
      return `${prefix} OUT LBW! ${strikerName} trapped in front. Score ${score}/${wickets}.`;
    }

    return `${prefix} OUT! Bowled ${strikerName}. Score ${score}/${wickets}.`;
  }

  if (runs === 6) {
    const phrase = sixPhrases[randomInt(0, sixPhrases.length - 1)];
    return `${prefix} ${phrase}, SIX! Score ${score}/${wickets}.`;
  }

  if (runs === 4) {
    const phrase = boundaryPhrases[randomInt(0, boundaryPhrases.length - 1)];
    return `${prefix} ${phrase}, FOUR. Score ${score}/${wickets}.`;
  }

  if (runs === 0) {
    const phrase = dotPhrases[randomInt(0, dotPhrases.length - 1)];
    return `${prefix} ${phrase}. Score ${score}/${wickets}.`;
  }

  const phrase = runPhrases[randomInt(0, runPhrases.length - 1)];
  return `${prefix} ${phrase}. Score ${score}/${wickets}.`;
}

function resolveBallLocal(striker, bowler, context = {}) {
  const phase = context.phase || 'MIDDLE';
  const requiredRate = context.requiredRate ?? null;

  const battingPower = Number(striker.batting) * 0.52 + Number(striker.form) * 0.18 + Number(striker.morale) * 0.12 + Number(striker.temperament) * 0.18 + randomFloat(-8, 8);
  const bowlingPower = Number(bowler.bowling) * 0.56 + Number(bowler.form) * 0.16 + Number(bowler.fitness) * 0.2 + randomFloat(-8, 8);

  let aggression = 0;
  if (phase === 'POWERPLAY') {
    aggression += 0.08;
  } else if (phase === 'DEATH') {
    aggression += 0.17;
  }

  if (requiredRate != null) {
    if (requiredRate > 9) {
      aggression += 0.14;
    } else if (requiredRate < 6.3) {
      aggression -= 0.05;
    }
  }

  const edge = battingPower - bowlingPower + aggression * 16;
  const wicketChance = clamp(
    0.085 - edge / 300 + (100 - Number(striker.fitness)) / 900 + aggression * 0.045 + randomFloat(-0.015, 0.02),
    0.01,
    0.24
  );

  if (Math.random() < wicketChance) {
    return { wicket: true, runs: 0 };
  }

  let runWeights;

  if (edge > 18) {
    runWeights = [
      { value: 0, weight: 12 },
      { value: 1, weight: 33 },
      { value: 2, weight: 22 },
      { value: 3, weight: 3 },
      { value: 4, weight: 21 },
      { value: 6, weight: 9 }
    ];
  } else if (edge > 6) {
    runWeights = [
      { value: 0, weight: 16 },
      { value: 1, weight: 35 },
      { value: 2, weight: 24 },
      { value: 3, weight: 3 },
      { value: 4, weight: 18 },
      { value: 6, weight: 4 }
    ];
  } else if (edge > -10) {
    runWeights = [
      { value: 0, weight: 23 },
      { value: 1, weight: 38 },
      { value: 2, weight: 20 },
      { value: 3, weight: 2 },
      { value: 4, weight: 14 },
      { value: 6, weight: 3 }
    ];
  } else {
    runWeights = [
      { value: 0, weight: 32 },
      { value: 1, weight: 39 },
      { value: 2, weight: 17 },
      { value: 3, weight: 1 },
      { value: 4, weight: 9 },
      { value: 6, weight: 2 }
    ];
  }

  if (phase === 'DEATH' || aggression > 0.15) {
    runWeights = runWeights.map((entry) => {
      if (entry.value === 0) {
        return { ...entry, weight: Math.max(4, entry.weight - 6) };
      }

      if (entry.value === 1) {
        return { ...entry, weight: Math.max(15, entry.weight - 4) };
      }

      if (entry.value === 4) {
        return { ...entry, weight: entry.weight + 5 };
      }

      if (entry.value === 6) {
        return { ...entry, weight: entry.weight + 4 };
      }

      return entry;
    });
  } else if (phase === 'MIDDLE' && aggression < 0.05) {
    runWeights = runWeights.map((entry) => {
      if (entry.value === 0) {
        return { ...entry, weight: entry.weight + 2 };
      }

      if (entry.value === 1) {
        return { ...entry, weight: entry.weight + 2 };
      }

      if (entry.value === 4) {
        return { ...entry, weight: Math.max(6, entry.weight - 3) };
      }

      if (entry.value === 6) {
        return { ...entry, weight: Math.max(1, entry.weight - 2) };
      }

      return entry;
    });
  }

  return { wicket: false, runs: weightedChoice(runWeights) };
}

function initBattingStats(order) {
  const stats = new Map();

  for (let i = 0; i < order.length; i += 1) {
    stats.set(Number(order[i].id), {
      playerId: Number(order[i].id),
      innings: null,
      battingOrder: null,
      runs: 0,
      balls: 0,
      fours: 0,
      sixes: 0,
      dismissalText: null,
      notOut: true
    });
  }

  return stats;
}

function initBowlingStats(players) {
  const stats = new Map();

  for (const player of players) {
    stats.set(Number(player.id), {
      playerId: Number(player.id),
      balls: 0,
      runs: 0,
      wickets: 0,
      maidens: 0,
      currentOverRuns: 0
    });
  }

  return stats;
}

function initFieldingStats(players) {
  const stats = new Map();

  for (const player of players) {
    stats.set(Number(player.id), {
      catches: 0,
      runOuts: 0
    });
  }

  return stats;
}

async function loadMatchTeams(match, dbClient = pool) {
  const franchiseMeta = await dbClient.query(
    `SELECT id, owner_user_id
     FROM franchises
     WHERE id = ANY($1::bigint[])`,
    [[Number(match.home_franchise_id), Number(match.away_franchise_id)]]
  );
  const metaById = new Map(franchiseMeta.rows.map((row) => [Number(row.id), row]));

  await ensureFranchiseLineup(
    Number(match.home_franchise_id),
    dbClient,
    { mode: metaById.get(Number(match.home_franchise_id))?.owner_user_id ? 'smart' : 'auto' }
  );
  await ensureFranchiseLineup(
    Number(match.away_franchise_id),
    dbClient,
    { mode: metaById.get(Number(match.away_franchise_id))?.owner_user_id ? 'smart' : 'auto' }
  );

  // Primary query: active squad players
  const query = `SELECT *
                 FROM players
                 WHERE franchise_id = $1
                   AND squad_status IN ('MAIN_SQUAD', 'YOUTH')
                   AND squad_status <> 'RETIRED'
                 ORDER BY starting_xi DESC, lineup_slot ASC NULLS LAST, squad_status = 'MAIN_SQUAD' DESC, (batting + bowling + fielding) DESC`;

  let homePlayers = (await dbClient.query(query, [match.home_franchise_id])).rows;
  let awayPlayers = (await dbClient.query(query, [match.away_franchise_id])).rows;

  // If a team has fewer than 11 active players, pull ANY non-retired player from the franchise
  // so the simulation doesn't break. This covers edge cases after retirements/transfers.
  if (homePlayers.length < 11) {
    const fallback = await dbClient.query(
      `SELECT * FROM players
       WHERE franchise_id = $1 AND squad_status <> 'RETIRED'
       ORDER BY starting_xi DESC, lineup_slot ASC NULLS LAST, (batting + bowling + fielding) DESC`,
      [match.home_franchise_id]
    );
    homePlayers = fallback.rows;
  }
  if (awayPlayers.length < 11) {
    const fallback = await dbClient.query(
      `SELECT * FROM players
       WHERE franchise_id = $1 AND squad_status <> 'RETIRED'
       ORDER BY starting_xi DESC, lineup_slot ASC NULLS LAST, (batting + bowling + fielding) DESC`,
      [match.away_franchise_id]
    );
    awayPlayers = fallback.rows;
  }

  const resolvedHome = homePlayers.slice(0, 11);
  const resolvedAway = awayPlayers.slice(0, 11);

  if (resolvedHome.length < 1 || resolvedAway.length < 1) {
    const error = new Error('One or both teams have no players available to simulate this match.');
    error.status = 400;
    throw error;
  }

  if (resolvedHome.length < 11 || resolvedAway.length < 11) {
    console.warn(
      `[MatchEngine] loadMatchTeams matchId=${match.id}: home=${resolvedHome.length} away=${resolvedAway.length} (< 11). Proceeding with available players.`
    );
  }

  return {
    homeTeam: resolvedHome,
    awayTeam: resolvedAway
  };
}

async function saveBallEvent(matchId, innings, overNumber, ballNumber, battingId, bowlingId, strikerId, nonStrikerId, bowlerId, ballOutcome) {
  await pool.query(
    `INSERT INTO match_events (
      match_id,
      innings,
      over_number,
      ball_number,
      batting_franchise_id,
      bowling_franchise_id,
      striker_player_id,
      non_striker_player_id,
      bowler_player_id,
      runs,
      extras,
      event_type,
      is_boundary,
      is_six,
      is_wicket,
      commentary
    ) VALUES (
      $1, $2, $3, $4, $5, $6,
      $7, $8, $9, $10, $11, $12,
      $13, $14, $15, $16
    )`,
    [
      matchId,
      innings,
      overNumber,
      ballNumber,
      battingId,
      bowlingId,
      strikerId,
      nonStrikerId,
      bowlerId,
      ballOutcome.runs,
      Number(ballOutcome.extras || 0),
      ballOutcome.eventType,
      ballOutcome.runs === 4 || ballOutcome.runs === 6,
      ballOutcome.runs === 6,
      ballOutcome.wicket,
      ballOutcome.commentary
    ]
  );
}

function pickFielder(bowlingTeam, bowlerId) {
  const fielders = bowlingTeam.filter((player) => Number(player.id) !== Number(bowlerId));
  return fielders[randomInt(0, fielders.length - 1)] || bowlingTeam[0];
}

async function simulateInnings({
  matchId,
  innings,
  battingFranchiseId,
  bowlingFranchiseId,
  battingTeam,
  bowlingTeam,
  target,
  ballDelayMs,
  broadcast,
  simulationOperationId = null,
  ballOptions = {}
}) {
  const battingOrder = sortByBatting(battingTeam);
  const bowlers = selectBowlers(bowlingTeam);
  const battingStats = initBattingStats(battingOrder);
  const bowlingStats = initBowlingStats(bowlers);
  const fieldingStats = initFieldingStats(bowlingTeam);

  let runs = 0;
  let wickets = 0;
  let balls = 0;

  let strikerIndex = 0;
  let nonStrikerIndex = 1;
  let nextBatterIndex = 2;
  let previousOverBowlerId = null;
  let activeOverBowler = null;
  let dotBallsWindow = [];
  let boundaryWindow = [];

  const overRuns = [];

  while (balls < 120 && wickets < 10) {
    if (target != null && runs > target) {
      break;
    }

    const striker = battingOrder[strikerIndex];
    const nonStriker = battingOrder[nonStrikerIndex];
    const overNumber = Math.floor(balls / 6) + 1;
    const ballNumber = (balls % 6) + 1;
    const isNewOver = ballNumber === 1;

    if (isNewOver) {
      activeOverBowler = chooseBowlerForOver({
        overNumber,
        bowlers,
        bowlingStats,
        previousOverBowlerId,
        runs,
        wickets,
        target,
        ballsBowled: balls
      });
      previousOverBowlerId = Number(activeOverBowler.id);
    }

    const bowler = activeOverBowler || bowlers[0];
    const useStreetBallApi = Boolean(ballOptions.useExternalBallApi);
    const matchContext = ballOptions.matchContext || {};
    const streetBall = useStreetBallApi
      ? await simulateBallViaStreetApi({
        striker,
        bowler,
        strikerBalls: battingStats.get(Number(striker.id))?.balls || 0,
        context: {
          phase: getOverPhase(overNumber),
          requiredRate: estimateRequiredRate(target, runs, balls),
          overNumber,
          ballNumber: balls + 1,
          deliveriesBowled: balls,
          wickets,
          target,
          totalRuns: runs,
          totalOvers: Number(matchContext.totalOvers || 20),
          dotPressure: dotBallsWindow.length ? dotBallsWindow.reduce((sum, value) => sum + value, 0) / dotBallsWindow.length : 0,
          boundaryMomentum: boundaryWindow.length ? boundaryWindow.reduce((sum, value) => sum + value, 0) / boundaryWindow.length : 0,
          bowlerBalls: bowlingStats.get(Number(bowler.id))?.balls || 0,
          pitchConditions: matchContext.pitchConditions,
          weatherConditions: matchContext.weatherConditions,
          windConditions: matchContext.windConditions,
          timeOfDay: matchContext.timeOfDay,
          groundSize: matchContext.groundSize,
          formatType: matchContext.formatType
        }
      })
      : null;

    const localBall = resolveBallLocal(striker, bowler, {
      phase: getOverPhase(overNumber),
      requiredRate: estimateRequiredRate(target, runs, balls)
    });

    const ball = streetBall || localBall;

    const strikerLine = battingStats.get(Number(striker.id));
    const bowlerLine = bowlingStats.get(Number(bowler.id));

    strikerLine.innings = innings;
    if (!strikerLine.battingOrder) {
      strikerLine.battingOrder = strikerIndex + 1;
    }

    strikerLine.balls += 1;
    bowlerLine.balls += 1;

    let dismissalType = null;
    let fielder = null;
    let eventType = 'RUN';

    if (ball.wicket) {
      wickets += 1;
      dismissalType = ball.dismissalType || pickDismissalType();
      eventType = 'WICKET';

      if (dismissalType === 'caught' || dismissalType === 'run out') {
        fielder = pickFielder(bowlingTeam, bowler.id);
        const fieldLine = fieldingStats.get(Number(fielder.id));
        if (dismissalType === 'caught') {
          fieldLine.catches += 1;
        } else {
          fieldLine.runOuts += 1;
        }
      }

      if (dismissalType !== 'run out') {
        bowlerLine.wickets += 1;
      }

      strikerLine.notOut = false;
      const fielderName = fielder ? `${fielder.first_name} ${fielder.last_name}` : null;
      if (dismissalType === 'caught') {
        strikerLine.dismissalText = `c ${fielderName} b ${fullName(bowler)}`;
      } else if (dismissalType === 'run out') {
        strikerLine.dismissalText = `run out${fielderName ? ` (${fielderName})` : ''}`;
      } else if (dismissalType === 'lbw') {
        strikerLine.dismissalText = `lbw b ${fullName(bowler)}`;
      } else {
        strikerLine.dismissalText = `b ${fullName(bowler)}`;
      }

      if (wickets < 10) {
        strikerIndex = nextBatterIndex;
        nextBatterIndex += 1;
      }
    } else {
      const teamRuns = Number(ball.runs || 0);
      const batsmanRuns = Number(ball.batsmanRuns ?? teamRuns);

      runs += teamRuns;
      strikerLine.runs += batsmanRuns;
      bowlerLine.runs += teamRuns;
      bowlerLine.currentOverRuns += teamRuns;

      if (batsmanRuns === 4) {
        strikerLine.fours += 1;
      }

      if (batsmanRuns === 6) {
        strikerLine.sixes += 1;
      }

      if (teamRuns % 2 === 1) {
        const swap = strikerIndex;
        strikerIndex = nonStrikerIndex;
        nonStrikerIndex = swap;
      }
    }

    const commentary =
      ball.commentary ||
      buildCommentary({
        striker,
        bowler,
        runs: ball.runs,
        wicket: ball.wicket,
        dismissalType,
        wicketFieldingName: fielder ? `${fielder.first_name} ${fielder.last_name}` : null,
        overNumber,
        ballNumber,
        score: runs,
        wickets
      });

    await saveBallEvent(
      matchId,
      innings,
      overNumber,
      ballNumber,
      battingFranchiseId,
      bowlingFranchiseId,
      striker.id,
      nonStriker?.id || null,
      bowler.id,
      {
        runs: ball.runs,
        wicket: ball.wicket,
        eventType: ball.eventType || eventType,
        commentary
      }
    );

    broadcast(
      'match:tick',
      {
        matchId,
        simulationOperationId,
        innings,
        over: overNumber,
        ball: ballNumber,
        battingFranchiseId,
        bowlingFranchiseId,
        strikerPlayerId: Number(striker.id),
        nonStrikerPlayerId: nonStriker?.id ? Number(nonStriker.id) : null,
        bowlerPlayerId: Number(bowler.id),
        runs: Number(ball.runs || 0),
        extras: 0,
        isBoundary: Number(ball.runs || 0) === 4 || Number(ball.runs || 0) === 6,
        isSix: Number(ball.runs || 0) === 6,
        isWicket: Boolean(ball.wicket),
        eventType: ball.eventType || eventType,
        score: runs,
        wickets,
        overs: toOverNotation(balls + 1),
        target,
        commentary
      },
      `match:${matchId}`
    );

    balls += 1;

    dotBallsWindow = [...dotBallsWindow.slice(-5), Number(ball.runs || 0) === 0 ? 1 : 0];
    boundaryWindow = [...boundaryWindow.slice(-5), Number(ball.runs || 0) >= 4 ? 1 : 0];

    if (balls % 6 === 0) {
      overRuns.push(runs);

      if (bowlerLine.currentOverRuns === 0) {
        bowlerLine.maidens += 1;
      }

      bowlerLine.currentOverRuns = 0;

      const swap = strikerIndex;
      strikerIndex = nonStrikerIndex;
      nonStrikerIndex = swap;

      // Persist running scores so API re-fetches during live sim return accurate data.
      await pool.query(
        `UPDATE matches
         SET home_score   = CASE WHEN home_franchise_id = $2 THEN $3 ELSE home_score END,
             home_wickets = CASE WHEN home_franchise_id = $2 THEN $4 ELSE home_wickets END,
             home_balls   = CASE WHEN home_franchise_id = $2 THEN $5 ELSE home_balls END,
             away_score   = CASE WHEN away_franchise_id = $2 THEN $3 ELSE away_score END,
             away_wickets = CASE WHEN away_franchise_id = $2 THEN $4 ELSE away_wickets END,
             away_balls   = CASE WHEN away_franchise_id = $2 THEN $5 ELSE away_balls END
         WHERE id = $1`,
        [matchId, battingFranchiseId, runs, wickets, balls]
      ).catch(() => { /* best-effort; next over or match-complete will correct */ });

      broadcast(
        'match:over_summary',
        {
          matchId,
          simulationOperationId,
          innings,
          over: Math.floor(balls / 6),
          score: runs,
          wickets,
          required: target == null ? null : Math.max(0, target + 1 - runs)
        },
        `match:${matchId}`
      );

      activeOverBowler = null;
    }

    if (ballDelayMs > 0) {
      await delay(ballDelayMs);
    }
  }

  return {
    runs,
    wickets,
    balls,
    overRuns,
    battingStats,
    bowlingStats,
    fieldingStats,
    battingOrder,
    bowlers
  };
}

function inningsBallsToOvers(balls) {
  const completeOvers = Math.floor(balls / 6);
  const ballsPart = balls % 6;
  return Number(`${completeOvers}.${ballsPart}`);
}

function calculatePlayerRating(line) {
  const strikeRate = line.batting_balls ? (line.batting_runs / line.batting_balls) * 100 : 0;
  const econ = line.bowling_balls ? (line.bowling_runs / line.bowling_balls) * 6 : 0;
  return Number((line.batting_runs * 0.9 + line.bowling_wickets * 18 + line.catches * 7 + strikeRate * 0.08 - econ * 0.5).toFixed(2));
}

async function persistScorecard({ matchId, franchiseId, teamPlayers, innings, battingStats, bowlingStats, fieldingStats }) {
  const byId = new Map(teamPlayers.map((player) => [Number(player.id), player]));

  for (const player of teamPlayers) {
    const id = Number(player.id);
    const bat = battingStats.get(id) || {
      innings,
      battingOrder: null,
      runs: 0,
      balls: 0,
      fours: 0,
      sixes: 0,
      dismissalText: null,
      notOut: true
    };

    const bowl = bowlingStats.get(id) || {
      balls: 0,
      runs: 0,
      wickets: 0,
      maidens: 0
    };

    const field = fieldingStats.get(id) || {
      catches: 0,
      runOuts: 0
    };

    const statLine = {
      match_id: matchId,
      player_id: id,
      franchise_id: franchiseId,
      innings: bat.innings || innings,
      batting_order: bat.battingOrder,
      batting_runs: bat.runs,
      batting_balls: bat.balls,
      fours: bat.fours,
      sixes: bat.sixes,
      dismissal_text: bat.dismissalText,
      not_out: bat.notOut,
      bowling_balls: bowl.balls,
      bowling_runs: bowl.runs,
      bowling_wickets: bowl.wickets,
      maiden_overs: bowl.maidens,
      catches: field.catches,
      run_outs: field.runOuts
    };

    const rating = calculatePlayerRating(statLine);

    await pool.query(
      `INSERT INTO player_match_stats (
        match_id,
        player_id,
        franchise_id,
        innings,
        batting_order,
        batting_runs,
        batting_balls,
        fours,
        sixes,
        dismissal_text,
        not_out,
        bowling_balls,
        bowling_runs,
        bowling_wickets,
        maiden_overs,
        catches,
        run_outs,
        player_rating
      ) VALUES (
        $1, $2, $3, $4, $5,
        $6, $7, $8, $9, $10,
        $11, $12, $13, $14, $15,
        $16, $17, $18
      ) ON CONFLICT (match_id, player_id)
      DO UPDATE SET
        innings = EXCLUDED.innings,
        batting_order = EXCLUDED.batting_order,
        batting_runs = EXCLUDED.batting_runs,
        batting_balls = EXCLUDED.batting_balls,
        fours = EXCLUDED.fours,
        sixes = EXCLUDED.sixes,
        dismissal_text = EXCLUDED.dismissal_text,
        not_out = EXCLUDED.not_out,
        bowling_balls = EXCLUDED.bowling_balls,
        bowling_runs = EXCLUDED.bowling_runs,
        bowling_wickets = EXCLUDED.bowling_wickets,
        maiden_overs = EXCLUDED.maiden_overs,
        catches = EXCLUDED.catches,
        run_outs = EXCLUDED.run_outs,
        player_rating = EXCLUDED.player_rating`,
      [
        matchId,
        id,
        franchiseId,
        statLine.innings,
        statLine.batting_order,
        statLine.batting_runs,
        statLine.batting_balls,
        statLine.fours,
        statLine.sixes,
        statLine.dismissal_text,
        statLine.not_out,
        statLine.bowling_balls,
        statLine.bowling_runs,
        statLine.bowling_wickets,
        statLine.maiden_overs,
        statLine.catches,
        statLine.run_outs,
        rating
      ]
    );

    const careerOversDelta = inningsBallsToOvers(statLine.bowling_balls);
    const careerFiftyDelta = statLine.batting_runs >= 50 && statLine.batting_runs < 100 ? 1 : 0;
    const careerHundredDelta = statLine.batting_runs >= 100 ? 1 : 0;

    await pool.query(
      `UPDATE players
       SET career_matches = career_matches + 1,
           career_runs = career_runs + $2,
           career_balls = career_balls + $3,
           career_fours = career_fours + $4,
           career_sixes = career_sixes + $5,
           career_wickets = career_wickets + $6,
           career_overs = career_overs + $7,
           career_runs_conceded = career_runs_conceded + $8,
           career_catches = career_catches + $9,
           career_fifties = career_fifties + $10,
           career_hundreds = career_hundreds + $11,
           form = LEAST(100, GREATEST(5, form + $12)),
           morale = LEAST(100, GREATEST(5, morale + $13))
       WHERE id = $1`,
      [
        id,
        statLine.batting_runs,
        statLine.batting_balls,
        statLine.fours,
        statLine.sixes,
        statLine.bowling_wickets,
        careerOversDelta,
        statLine.bowling_runs,
        statLine.catches,
        careerFiftyDelta,
        careerHundredDelta,
        Number((statLine.batting_runs / 20 + statLine.bowling_wickets * 2.2 - statLine.bowling_runs / 40).toFixed(2)),
        Number((statLine.batting_runs / 25 + statLine.bowling_wickets * 1.5 + statLine.catches * 0.5 - 1).toFixed(2))
      ]
    );

    if (!byId.has(id)) {
      // no-op branch to avoid linter warnings in static checks for unused map
    }
  }
}

async function choosePlayerOfMatch(matchId) {
  const best = await pool.query(
    `SELECT player_id
     FROM player_match_stats
     WHERE match_id = $1
     ORDER BY player_rating DESC
     LIMIT 1`,
    [matchId]
  );

  return best.rows[0]?.player_id || null;
}

async function updateFranchiseResults(homeId, awayId, winnerId, dbClient = pool) {
  if (!winnerId) {
    await dbClient.query(
      `UPDATE franchises
       SET fan_rating = LEAST(100, fan_rating + 0.4),
           financial_balance = financial_balance + $3
       WHERE id IN ($1, $2)`,
      [homeId, awayId, MATCH_LOSS_CASH_REWARD]
    );

    await dbClient.query(
      `INSERT INTO transactions (franchise_id, transaction_type, amount, description)
       VALUES
         ($1, 'PRIZE_MONEY', $3, $4),
         ($2, 'PRIZE_MONEY', $3, $4)`,
      [homeId, awayId, MATCH_LOSS_CASH_REWARD, `Match reward: +$${MATCH_LOSS_CASH_REWARD.toFixed(2)} (tie/no result)`]
    );
    return;
  }

  const loserId = Number(winnerId) === Number(homeId) ? awayId : homeId;

  await dbClient.query(
    `UPDATE franchises
     SET wins = wins + 1,
         win_streak = win_streak + 1,
         best_win_streak = GREATEST(best_win_streak, win_streak + 1),
         fan_rating = LEAST(100, fan_rating + 2),
         prospect_points = prospect_points + 5,
         growth_points = growth_points + 5,
         financial_balance = financial_balance + $2
     WHERE id = $1`,
    [winnerId, MATCH_WIN_CASH_REWARD]
  );

  await dbClient.query(
    `UPDATE franchises
     SET losses = losses + 1,
         win_streak = 0,
         fan_rating = GREATEST(5, fan_rating - 1.2),
         financial_balance = financial_balance + $2
     WHERE id = $1`,
    [loserId, MATCH_LOSS_CASH_REWARD]
  );

  await dbClient.query(
    `INSERT INTO transactions (franchise_id, transaction_type, amount, description)
     VALUES
       ($1, 'PRIZE_MONEY', $3, $4),
       ($2, 'PRIZE_MONEY', $5, $6)`,
    [
      winnerId,
      loserId,
      MATCH_WIN_CASH_REWARD,
      `Match reward: +$${MATCH_WIN_CASH_REWARD.toFixed(2)} (win)`,
      MATCH_LOSS_CASH_REWARD,
      `Match reward: +$${MATCH_LOSS_CASH_REWARD.toFixed(2)} (loss)`
    ]
  );

  await dbClient.query(
    `INSERT INTO transactions (franchise_id, transaction_type, amount, description)
     VALUES
       ($1, 'POINT_REWARD', 0, 'Match win reward: +5 prospect points, +5 growth points')`,
    [winnerId]
  );
}

function matchSummary(homeName, awayName, firstInnings, secondInnings, winnerId, homeId, awayId) {
  if (!winnerId) {
    return `${homeName} and ${awayName} tied at ${firstInnings.runs}.`;
  }

  if (Number(winnerId) === Number(homeId)) {
    if (Number(firstInnings.battingId) === Number(homeId)) {
      return `${homeName} beat ${awayName} by ${firstInnings.runs - secondInnings.runs} runs.`;
    }

    return `${homeName} beat ${awayName} by ${10 - secondInnings.wickets} wickets.`;
  }

  if (Number(firstInnings.battingId) === Number(awayId)) {
    return `${awayName} beat ${homeName} by ${firstInnings.runs - secondInnings.runs} runs.`;
  }

  return `${awayName} beat ${homeName} by ${10 - secondInnings.wickets} wickets.`;
}

export async function simulateMatchLive(matchId, options = {}) {
  const {
    ballDelayMs = 80,
    broadcast = () => {},
    autoCreateNextSeason = true,
    useExternalBallApi = true,
    deferSeasonProgression = false,
    simulationOperationId = null
  } = options;

  if (activeSimulations.has(matchId)) {
    const error = new Error('Match simulation is already running.');
    error.status = 409;
    throw error;
  }

  activeSimulations.add(matchId);

  try {
    const matchResult = await pool.query(
      `SELECT m.*, hf.franchise_name AS home_name, af.franchise_name AS away_name
       FROM matches m
       JOIN franchises hf ON hf.id = m.home_franchise_id
       JOIN franchises af ON af.id = m.away_franchise_id
       WHERE m.id = $1`,
      [matchId]
    );

    if (!matchResult.rows.length) {
      const error = new Error('Match not found.');
      error.status = 404;
      throw error;
    }

    const match = matchResult.rows[0];

    if (match.status === 'COMPLETED') {
      return getMatchScorecard(match.id);
    }

    if (String(match.stage || '').toUpperCase() === 'REGULAR' && Number(match.round_no || 0) > 1) {
      const priorIncomplete = await pool.query(
        `SELECT MIN(round_no)::int AS round_no
         FROM matches
         WHERE season_id = $1
           AND stage = 'REGULAR'
           AND status <> 'COMPLETED'
           AND COALESCE(league_tier, 0) = COALESCE($2, 0)`,
        [match.season_id, match.league_tier]
      );

      const earliestIncompleteRound = Number(priorIncomplete.rows[0]?.round_no || 0);
      if (earliestIncompleteRound && Number(match.round_no) > earliestIncompleteRound) {
        const error = new Error(
          `Cannot simulate Round ${match.round_no} yet. Complete Round ${earliestIncompleteRound} first in League ${Number(match.league_tier || 1)}.`
        );
        error.status = 409;
        throw error;
      }
    }

    const homeFranchiseId = Number(match.home_franchise_id);
    const awayFranchiseId = Number(match.away_franchise_id);

    // Load teams BEFORE setting status to LIVE so a failure doesn't leave the match stuck.
    const { homeTeam, awayTeam } = await loadMatchTeams(match, pool);

    await pool.query('DELETE FROM match_events WHERE match_id = $1', [match.id]);
    await pool.query('DELETE FROM player_match_stats WHERE match_id = $1', [match.id]);
    await clearDeepMatchData(match.id, pool);

    await pool.query(`UPDATE matches SET status = 'LIVE' WHERE id = $1`, [match.id]);
    const matchConditions = buildMatchConditions();

    const tossApiResult = useExternalBallApi
      ? await simulateTossViaStreetApi({
        team1Name: match.home_name,
        team2Name: match.away_name,
        context: {
          ...matchConditions,
          team1Strength: deriveTeamStrength(homeTeam),
          team2Strength: deriveTeamStrength(awayTeam)
        }
      })
      : null;

    const fallbackTossWinnerIsHome = Math.random() >= 0.5;
    const fallbackTossWinnerId = fallbackTossWinnerIsHome ? homeFranchiseId : awayFranchiseId;
    const tossWinnerId = resolveTossWinnerId(tossApiResult?.tossWinnerName, match) || fallbackTossWinnerId;
    const tossDecision = tossApiResult?.tossDecision || (Math.random() >= 0.5 ? 'BAT' : 'BOWL');
    const tossWinnerIsHome = Number(tossWinnerId) === homeFranchiseId;

    const firstBattingId = tossDecision === 'BAT' ? Number(tossWinnerId) : Number(tossWinnerId) === homeFranchiseId ? awayFranchiseId : homeFranchiseId;
    const firstBowlingId = Number(firstBattingId) === homeFranchiseId ? awayFranchiseId : homeFranchiseId;

    const firstBattingTeam = Number(firstBattingId) === homeFranchiseId ? homeTeam : awayTeam;
    const firstBowlingTeam = Number(firstBattingId) === homeFranchiseId ? awayTeam : homeTeam;

    // Persist toss outcome immediately so scorecard queries reflect toss without waiting for match completion.
    await pool.query(
      `UPDATE matches
       SET toss_winner_franchise_id = $2,
           toss_decision = $3
       WHERE id = $1`,
      [match.id, tossWinnerId, tossDecision]
    );

    broadcast(
      'match:start',
      {
        matchId: match.id,
        simulationOperationId,
        homeFranchiseId,
        awayFranchiseId,
        tossWinnerFranchiseId: tossWinnerId,
        tossDecision,
        message:
          tossApiResult?.tossCommentary ||
          `${tossWinnerIsHome ? match.home_name : match.away_name} won the toss and chose to ${tossDecision.toLowerCase()} first.`,
        conditions: matchConditions
      },
      `match:${match.id}`
    );

    const firstInnings = await simulateInnings({
      matchId: match.id,
      innings: 1,
      battingFranchiseId: firstBattingId,
      bowlingFranchiseId: firstBowlingId,
      battingTeam: firstBattingTeam,
      bowlingTeam: firstBowlingTeam,
      target: null,
      ballDelayMs,
      broadcast,
      simulationOperationId,
      ballOptions: {
        useExternalBallApi,
        matchContext: matchConditions
      }
    });

    firstInnings.battingId = firstBattingId;
    firstInnings.bowlingId = firstBowlingId;

    broadcast(
      'match:innings_break',
      {
        matchId: match.id,
        simulationOperationId,
        innings: 1,
        target: firstInnings.runs + 1,
        summary: `${firstInnings.runs}/${firstInnings.wickets} in ${inningsBallsToOvers(firstInnings.balls)} overs`
      },
      `match:${match.id}`
    );

    const secondBattingId = firstBowlingId;
    const secondBowlingId = firstBattingId;

    const secondBattingTeam = Number(secondBattingId) === homeFranchiseId ? homeTeam : awayTeam;
    const secondBowlingTeam = Number(secondBattingId) === homeFranchiseId ? awayTeam : homeTeam;

    const secondInnings = await simulateInnings({
      matchId: match.id,
      innings: 2,
      battingFranchiseId: secondBattingId,
      bowlingFranchiseId: secondBowlingId,
      battingTeam: secondBattingTeam,
      bowlingTeam: secondBowlingTeam,
      target: firstInnings.runs,
      ballDelayMs,
      broadcast,
      simulationOperationId,
      ballOptions: {
        useExternalBallApi,
        matchContext: matchConditions
      }
    });

    secondInnings.battingId = secondBattingId;
    secondInnings.bowlingId = secondBowlingId;

    let winnerId = null;
    if (firstInnings.runs > secondInnings.runs) {
      winnerId = firstBattingId;
    } else if (secondInnings.runs > firstInnings.runs) {
      winnerId = secondBattingId;
    }

    const homeFirst = Number(firstBattingId) === homeFranchiseId;

    const homeScore = homeFirst ? firstInnings.runs : secondInnings.runs;
    const homeWickets = homeFirst ? firstInnings.wickets : secondInnings.wickets;
    const homeBalls = homeFirst ? firstInnings.balls : secondInnings.balls;

    const awayScore = homeFirst ? secondInnings.runs : firstInnings.runs;
    const awayWickets = homeFirst ? secondInnings.wickets : firstInnings.wickets;
    const awayBalls = homeFirst ? secondInnings.balls : firstInnings.balls;

    const summary = matchSummary(match.home_name, match.away_name, firstInnings, secondInnings, winnerId, homeFranchiseId, awayFranchiseId);

    await persistDeepStatsFromEvents({
      matchId: match.id,
      firstInnings,
      secondInnings,
      dbClient: pool
    });

    await pool.query(
      `UPDATE matches
       SET status = 'COMPLETED',
           toss_winner_franchise_id = $2,
           toss_decision = $3,
           winner_franchise_id = $4,
           home_score = $5,
           home_wickets = $6,
           home_balls = $7,
           away_score = $8,
           away_wickets = $9,
           away_balls = $10,
           result_summary = $11,
           ai_match_analysis = NULL
       WHERE id = $1`,
      [match.id, tossWinnerId, tossDecision, winnerId, homeScore, homeWickets, homeBalls, awayScore, awayWickets, awayBalls, summary]
    );

    await persistScorecard({
      matchId: match.id,
      franchiseId: firstBattingId,
      teamPlayers: firstBattingTeam,
      innings: 1,
      battingStats: firstInnings.battingStats,
      bowlingStats: secondInnings.bowlingStats,
      fieldingStats: secondInnings.fieldingStats
    });

    await persistScorecard({
      matchId: match.id,
      franchiseId: secondBattingId,
      teamPlayers: secondBattingTeam,
      innings: 2,
      battingStats: secondInnings.battingStats,
      bowlingStats: firstInnings.bowlingStats,
      fieldingStats: firstInnings.fieldingStats
    });

    const playerOfMatchId = await choosePlayerOfMatch(match.id);

    await pool.query(
      `UPDATE matches
       SET player_of_match_id = $2
       WHERE id = $1`,
      [match.id, playerOfMatchId]
    );

    if (playerOfMatchId) {
      await pool.query(
        `UPDATE players
         SET career_player_of_match = career_player_of_match + 1
         WHERE id = $1`,
        [playerOfMatchId]
      );
    }

    await updateFranchiseResults(homeFranchiseId, awayFranchiseId, winnerId, pool);
    await processManagerAfterMatch({
      seasonId: Number(match.season_id),
      roundNo: Number(match.round_no || 0),
      homeFranchiseId,
      awayFranchiseId,
      winnerFranchiseId: winnerId,
      dbClient: pool
    });

    const table = await updateSeasonTableWithMatch(match.id, pool);
    if (String(match.stage || '').toUpperCase() === 'REGULAR') {
      await maybeRunCpuManagerLifecycleForRound(Number(match.season_id), Number(match.round_no || 0), pool);
    }
    let seasonState = { state: 'DEFERRED' };
    if (!deferSeasonProgression) {
      seasonState = await progressSeasonStructure(match.season_id, pool);
    }

    await calculateFranchiseValuation(homeFranchiseId, match.season_id, pool);
    await calculateFranchiseValuation(awayFranchiseId, match.season_id, pool);

    if (!deferSeasonProgression && seasonState.state === 'SEASON_COMPLETED') {
      await finalizeManagerSeasonLifecycle(Number(match.season_id), pool);
      if (autoCreateNextSeason) {
        await createNextSeasonFromCompleted(match.season_id, pool);
      }
    }

    const scorecard = await getMatchScorecard(match.id);

    broadcast('match:complete', { ...scorecard, simulationOperationId }, `match:${match.id}`);
    broadcast('league:update', { seasonId: match.season_id, table: table || (await getLeagueTable(match.season_id, pool)) }, 'league');

    return scorecard;
  } catch (simError) {
    // If the match was set to LIVE but simulation failed before completing,
    // reset the status so it can be retried and doesn't stay stuck.
    try {
      const currentStatus = await pool.query('SELECT status FROM matches WHERE id = $1', [matchId]);
      if (String(currentStatus.rows[0]?.status || '').toUpperCase() === 'LIVE') {
        await pool.query(`UPDATE matches SET status = 'SCHEDULED' WHERE id = $1`, [matchId]);
        console.warn(`[MatchEngine] simulateMatchLive matchId=${matchId} failed — reset status from LIVE to SCHEDULED.`);
      }
    } catch { /* best-effort cleanup */ }
    throw simError;
  } finally {
    activeSimulations.delete(matchId);
  }
}

export function isMatchSimulationRunning(matchId) {
  return activeSimulations.has(matchId);
}

export async function getMatchScorecard(matchId, dbClient = pool) {
  const match = await dbClient.query(
    `SELECT m.*, hf.franchise_name AS home_name, af.franchise_name AS away_name,
            hc.name AS home_city_name, hc.country AS home_country,
            ac.name AS away_city_name, ac.country AS away_country,
            pom.first_name AS pom_first_name, pom.last_name AS pom_last_name
     FROM matches m
     JOIN franchises hf ON hf.id = m.home_franchise_id
     JOIN cities hc ON hc.id = hf.city_id
     JOIN franchises af ON af.id = m.away_franchise_id
     JOIN cities ac ON ac.id = af.city_id
     LEFT JOIN players pom ON pom.id = m.player_of_match_id
     WHERE m.id = $1`,
    [matchId]
  );

  if (!match.rows.length) {
    return null;
  }

  const stats = await dbClient.query(
    `SELECT pms.*, p.first_name, p.last_name, p.role
     FROM player_match_stats pms
     JOIN players p ON p.id = pms.player_id
     WHERE pms.match_id = $1
     ORDER BY pms.franchise_id, pms.batting_order NULLS LAST, pms.player_rating DESC`,
    [matchId]
  );

  const events = await dbClient.query(
    `SELECT id,
            innings,
            over_number,
            ball_number,
            batting_franchise_id,
            bowling_franchise_id,
            striker_player_id,
            non_striker_player_id,
            bowler_player_id,
            runs,
            extras,
            is_boundary,
            is_six,
            is_wicket,
            commentary,
            created_at
     FROM match_events
     WHERE match_id = $1
     ORDER BY innings, over_number, ball_number, id`,
    [matchId]
  );

  const wormByOver = await dbClient.query(
    `SELECT innings, over_number, SUM(runs)::int AS runs_in_over
     FROM match_events
     WHERE match_id = $1
     GROUP BY innings, over_number
     ORDER BY innings, over_number`,
    [matchId]
  );

  const inningsStats = await dbClient.query(
    `SELECT mis.*
     FROM match_innings_stats mis
     WHERE mis.match_id = $1
     ORDER BY mis.innings`,
    [matchId]
  );

  const overStats = await dbClient.query(
    `SELECT mos.*
     FROM match_over_stats mos
     WHERE mos.match_id = $1
     ORDER BY mos.innings, mos.over_number`,
    [matchId]
  );

  const fallOfWickets = await dbClient.query(
    `SELECT fow.*
     FROM match_fall_of_wickets fow
     WHERE fow.match_id = $1
     ORDER BY fow.innings, fow.wicket_no`,
    [matchId]
  );

  const partnerships = await dbClient.query(
    `SELECT mp.*
     FROM match_partnerships mp
     WHERE mp.match_id = $1
     ORDER BY mp.innings, mp.partnership_no`,
    [matchId]
  );

  const scorecard = {
    match: {
      ...match.rows[0],
      player_of_match_name: match.rows[0].pom_first_name ? `${match.rows[0].pom_first_name} ${match.rows[0].pom_last_name}` : null,
      home_overs: inningsBallsToOvers(Number(match.rows[0].home_balls || 0)),
      away_overs: inningsBallsToOvers(Number(match.rows[0].away_balls || 0))
    },
    stats: stats.rows,
    events: events.rows,
    worm: wormByOver.rows,
    innings_stats: inningsStats.rows,
    over_stats: overStats.rows,
    fall_of_wickets: fallOfWickets.rows,
    partnerships: partnerships.rows
  };

  return scorecard;
}

async function simulateMatchUsingStreetMatchApi(matchId, options = {}) {
  const {
    broadcast = () => {},
    autoCreateNextSeason = true,
    deferSeasonProgression = false,
    simulationOperationId = null
  } = options;

  if (activeSimulations.has(matchId)) {
    const error = new Error('Match simulation is already running.');
    error.status = 409;
    throw error;
  }

  activeSimulations.add(matchId);

  try {
    const matchResult = await pool.query(
      `SELECT m.*, hf.franchise_name AS home_name, af.franchise_name AS away_name
       FROM matches m
       JOIN franchises hf ON hf.id = m.home_franchise_id
       JOIN franchises af ON af.id = m.away_franchise_id
       WHERE m.id = $1`,
      [matchId]
    );

    if (!matchResult.rows.length) {
      const error = new Error('Match not found.');
      error.status = 404;
      throw error;
    }

    const match = matchResult.rows[0];
    if (String(match.status || '').toUpperCase() === 'COMPLETED') {
      return getMatchScorecard(match.id);
    }

    if (String(match.stage || '').toUpperCase() === 'REGULAR' && Number(match.round_no || 0) > 1) {
      const priorIncomplete = await pool.query(
        `SELECT MIN(round_no)::int AS round_no
         FROM matches
         WHERE season_id = $1
           AND stage = 'REGULAR'
           AND status <> 'COMPLETED'
           AND COALESCE(league_tier, 0) = COALESCE($2, 0)`,
        [match.season_id, match.league_tier]
      );

      const earliestIncompleteRound = Number(priorIncomplete.rows[0]?.round_no || 0);
      if (earliestIncompleteRound && Number(match.round_no) > earliestIncompleteRound) {
        const error = new Error(
          `Cannot simulate Round ${match.round_no} yet. Complete Round ${earliestIncompleteRound} first in League ${Number(match.league_tier || 1)}.`
        );
        error.status = 409;
        throw error;
      }
    }

    const { homeTeam, awayTeam } = await loadMatchTeams(match, pool);
    const matchConditions = buildMatchConditions();
    const apiResult = await simulateMatchViaStreetApi({
      team1Name: match.home_name,
      team2Name: match.away_name,
      team1Players: homeTeam,
      team2Players: awayTeam,
      context: {
        ...matchConditions,
        roundSeed: Number(match.round_no || 0) + Number(match.id || 0)
      }
    });

    if (!apiResult) {
      return null;
    }

    const homeFranchiseId = Number(match.home_franchise_id);
    const awayFranchiseId = Number(match.away_franchise_id);

    const tossData = apiResult.toss_result || {};
    const tossWinnerId =
      resolveTossWinnerId(tossData.TossWon || tossData.toss_winner || tossData.tossWon, match) ||
      (Math.random() >= 0.5 ? homeFranchiseId : awayFranchiseId);
    const tossDecisionRaw = parseTossDecision(tossData.TossDecision || tossData.toss_decision || tossData.TossDecisionText);

    const inferredFirstBattingId = inferInningsBattingId(apiResult.first_innings, homeTeam, awayTeam, homeFranchiseId, awayFranchiseId);
    const fallbackFirstBattingId =
      tossDecisionRaw === 'BAT' ? Number(tossWinnerId) : Number(tossWinnerId) === homeFranchiseId ? awayFranchiseId : homeFranchiseId;
    const firstBattingId = Number(inferredFirstBattingId || fallbackFirstBattingId);
    const secondBattingId = Number(firstBattingId) === homeFranchiseId ? awayFranchiseId : homeFranchiseId;

    // Keep toss decision aligned with actual innings order if API toss text and innings data disagree.
    const tossDecision = Number(tossWinnerId) === Number(firstBattingId) ? 'BAT' : 'BOWL';

    const firstBattingTeam = Number(firstBattingId) === homeFranchiseId ? homeTeam : awayTeam;
    const firstBowlingTeam = Number(firstBattingId) === homeFranchiseId ? awayTeam : homeTeam;
    const secondBattingTeam = Number(secondBattingId) === homeFranchiseId ? homeTeam : awayTeam;
    const secondBowlingTeam = Number(secondBattingId) === homeFranchiseId ? awayTeam : homeTeam;

    const firstInnings = buildInningsFromApiPayload({
      inningsNo: 1,
      inningsPayload: apiResult.first_innings || {},
      battingFranchiseId: firstBattingId,
      bowlingFranchiseId: secondBattingId,
      battingTeam: firstBattingTeam,
      bowlingTeam: firstBowlingTeam,
      matchId: match.id
    });

    const secondInnings = buildInningsFromApiPayload({
      inningsNo: 2,
      inningsPayload: apiResult.second_innings || {},
      battingFranchiseId: secondBattingId,
      bowlingFranchiseId: firstBattingId,
      battingTeam: secondBattingTeam,
      bowlingTeam: secondBowlingTeam,
      matchId: match.id
    });

    let winnerId = null;
    if (firstInnings.runs > secondInnings.runs) {
      winnerId = firstBattingId;
    } else if (secondInnings.runs > firstInnings.runs) {
      winnerId = secondBattingId;
    }

    const homeFirst = Number(firstBattingId) === homeFranchiseId;
    const homeScore = homeFirst ? firstInnings.runs : secondInnings.runs;
    const homeWickets = homeFirst ? firstInnings.wickets : secondInnings.wickets;
    const homeBalls = homeFirst ? firstInnings.balls : secondInnings.balls;
    const awayScore = homeFirst ? secondInnings.runs : firstInnings.runs;
    const awayWickets = homeFirst ? secondInnings.wickets : firstInnings.wickets;
    const awayBalls = homeFirst ? secondInnings.balls : firstInnings.balls;

    const resultSummary =
      String(apiResult?.match_summary?.result || '').trim() ||
      matchSummary(match.home_name, match.away_name, firstInnings, secondInnings, winnerId, homeFranchiseId, awayFranchiseId);

    await pool.query('DELETE FROM match_events WHERE match_id = $1', [match.id]);
    await pool.query('DELETE FROM player_match_stats WHERE match_id = $1', [match.id]);
    await clearDeepMatchData(match.id, pool);
    await pool.query(
      `UPDATE matches
       SET status = 'LIVE',
           toss_winner_franchise_id = $2,
           toss_decision = $3
       WHERE id = $1`,
      [match.id, tossWinnerId, tossDecision]
    );

    broadcast(
      'match:start',
      {
        matchId: match.id,
        simulationOperationId,
        homeFranchiseId,
        awayFranchiseId,
        tossWinnerFranchiseId: tossWinnerId,
        tossDecision,
        message:
          String(tossData.TossCommentary || '').trim() ||
          `${Number(tossWinnerId) === homeFranchiseId ? match.home_name : match.away_name} won the toss and chose to ${tossDecision.toLowerCase()} first.`,
        conditions: matchConditions
      },
      `match:${match.id}`
    );

    const persistedEvents = [...firstInnings.events, ...secondInnings.events].sort((a, b) => {
      if (Number(a.innings) !== Number(b.innings)) {
        return Number(a.innings) - Number(b.innings);
      }
      if (Number(a.overNumber) !== Number(b.overNumber)) {
        return Number(a.overNumber) - Number(b.overNumber);
      }
      if (Number(a.ballNumber) !== Number(b.ballNumber)) {
        return Number(a.ballNumber) - Number(b.ballNumber);
      }
      return Number(a.sortIndex || 0) - Number(b.sortIndex || 0);
    });

    for (const event of persistedEvents) {
      await saveBallEvent(
        match.id,
        event.innings,
        event.overNumber,
        event.ballNumber,
        event.battingFranchiseId,
        event.bowlingFranchiseId,
        event.strikerPlayerId,
        event.nonStrikerPlayerId,
        event.bowlerPlayerId,
        {
          runs: event.runs,
          extras: event.extras,
          wicket: event.isWicket,
          eventType: event.eventType,
          commentary: event.commentary
        }
      );
    }

    await persistDeepStatsFromApi({
      matchId: match.id,
      apiResult,
      firstInnings,
      secondInnings,
      homeTeam,
      awayTeam,
      homeFranchiseId,
      awayFranchiseId,
      dbClient: pool
    });

    await pool.query(
      `UPDATE matches
       SET status = 'COMPLETED',
           toss_winner_franchise_id = $2,
           toss_decision = $3,
           winner_franchise_id = $4,
           home_score = $5,
           home_wickets = $6,
           home_balls = $7,
           away_score = $8,
           away_wickets = $9,
           away_balls = $10,
           result_summary = $11,
           ai_match_analysis = $12
       WHERE id = $1`,
      [
        match.id,
        tossWinnerId,
        tossDecision,
        winnerId,
        homeScore,
        homeWickets,
        homeBalls,
        awayScore,
        awayWickets,
        awayBalls,
        resultSummary,
        String(apiResult?.ai_match_analysis || '').trim() || null
      ]
    );

    await persistScorecard({
      matchId: match.id,
      franchiseId: firstBattingId,
      teamPlayers: firstBattingTeam,
      innings: 1,
      battingStats: firstInnings.battingStats,
      bowlingStats: secondInnings.bowlingStats,
      fieldingStats: secondInnings.fieldingStats
    });

    await persistScorecard({
      matchId: match.id,
      franchiseId: secondBattingId,
      teamPlayers: secondBattingTeam,
      innings: 2,
      battingStats: secondInnings.battingStats,
      bowlingStats: firstInnings.bowlingStats,
      fieldingStats: firstInnings.fieldingStats
    });

    const pomName = String(apiResult?.match_summary?.player_of_match || apiResult?.player_of_match || '').trim();
    let playerOfMatchId = null;
    if (pomName) {
      const homeLookup = buildPlayerNameLookup(homeTeam);
      const awayLookup = buildPlayerNameLookup(awayTeam);
      playerOfMatchId = Number(resolvePlayerByName(pomName, homeTeam, homeLookup)?.id || resolvePlayerByName(pomName, awayTeam, awayLookup)?.id || 0) || null;
    }

    if (!playerOfMatchId) {
      playerOfMatchId = await choosePlayerOfMatch(match.id);
    }

    await pool.query(
      `UPDATE matches
       SET player_of_match_id = $2
       WHERE id = $1`,
      [match.id, playerOfMatchId]
    );

    if (playerOfMatchId) {
      await pool.query(
        `UPDATE players
         SET career_player_of_match = career_player_of_match + 1
         WHERE id = $1`,
        [playerOfMatchId]
      );
    }

    await updateFranchiseResults(homeFranchiseId, awayFranchiseId, winnerId, pool);
    await processManagerAfterMatch({
      seasonId: Number(match.season_id),
      roundNo: Number(match.round_no || 0),
      homeFranchiseId,
      awayFranchiseId,
      winnerFranchiseId: winnerId,
      dbClient: pool
    });
    const table = await updateSeasonTableWithMatch(match.id, pool);
    if (String(match.stage || '').toUpperCase() === 'REGULAR') {
      await maybeRunCpuManagerLifecycleForRound(Number(match.season_id), Number(match.round_no || 0), pool);
    }
    let seasonState = { state: 'DEFERRED' };
    if (!deferSeasonProgression) {
      seasonState = await progressSeasonStructure(match.season_id, pool);
    }

    await calculateFranchiseValuation(homeFranchiseId, match.season_id, pool);
    await calculateFranchiseValuation(awayFranchiseId, match.season_id, pool);

    if (!deferSeasonProgression && seasonState.state === 'SEASON_COMPLETED') {
      await finalizeManagerSeasonLifecycle(Number(match.season_id), pool);
      if (autoCreateNextSeason) {
        await createNextSeasonFromCompleted(match.season_id, pool);
      }
    }

    const scorecard = await getMatchScorecard(match.id);
    broadcast('match:complete', { ...scorecard, simulationOperationId }, `match:${match.id}`);
    broadcast('league:update', { seasonId: match.season_id, table: table || (await getLeagueTable(match.season_id, pool)) }, 'league');

    return scorecard;
  } catch (simError) {
    // If the match was set to LIVE but simulation failed before completing,
    // reset the status so it can be retried and doesn't stay stuck.
    try {
      const currentStatus = await pool.query('SELECT status FROM matches WHERE id = $1', [matchId]);
      if (String(currentStatus.rows[0]?.status || '').toUpperCase() === 'LIVE') {
        await pool.query(`UPDATE matches SET status = 'SCHEDULED' WHERE id = $1`, [matchId]);
        console.warn(`[MatchEngine] simulateMatchUsingStreetMatchApi matchId=${matchId} failed — reset status from LIVE to SCHEDULED.`);
      }
    } catch { /* best-effort cleanup */ }
    throw simError;
  } finally {
    activeSimulations.delete(matchId);
  }
}

async function simulateMatchForBatch(matchId, options = {}) {
  const {
    useExternalFullMatchApi = env.streetCricketFullMatchApiEnabled,
    useExternalBallApi = env.streetCricketUseForBatchSims,
    strictExternalFullMatchApi = false,
    deferSeasonProgression = true
  } = options;

  console.log(
    `[MatchEngine] simulateMatchForBatch matchId=${matchId} externalFull=${Boolean(useExternalFullMatchApi)} strictExternal=${Boolean(
      strictExternalFullMatchApi
    )} deferSeasonProgression=${Boolean(deferSeasonProgression)}`
  );

  if (useExternalFullMatchApi) {
    console.log(`[MatchEngine] matchId=${matchId} using external /simulate_match`);
    const externalResult = await simulateMatchUsingStreetMatchApi(matchId, {
      ...options,
      deferSeasonProgression
    });
    if (externalResult) {
      return externalResult;
    }

    console.error(`[MatchEngine] matchId=${matchId} external /simulate_match returned null`);

    if (strictExternalFullMatchApi) {
      const error = new Error('External /simulate_match failed. Local fallback is disabled.');
      error.status = 502;
      throw error;
    }
  }

  console.log(`[MatchEngine] matchId=${matchId} falling back to local ball engine`);
  return simulateMatchLive(matchId, {
    ...options,
    ballDelayMs: 0,
    useExternalBallApi,
    deferSeasonProgression
  });
}

export async function simulateMatchOutsideCenter(matchId, options = {}) {
  return simulateMatchForBatch(matchId, {
    ...options,
    deferSeasonProgression: false
  });
}

export async function simulateRound(roundNo, options = {}) {
  const {
    broadcast = () => {},
    includePlayoffs = false,
    seasonId = null,
    autoCreateNextSeason = true,
    useExternalBallApi = env.streetCricketUseForBatchSims,
    useExternalFullMatchApi = env.streetCricketFullMatchApiEnabled,
    strictExternalFullMatchApi = false,
    batchChunkSize = env.streetCricketBatchChunkSize,
    batchChunkPauseMs = env.streetCricketBatchChunkPauseMs,
    leagueTier = null,
    simulationOperationId = null,
    onSimulationProgress = null
  } = options;
  const activeSeason = seasonId
    ? (await pool.query('SELECT * FROM seasons WHERE id = $1', [seasonId])).rows[0] || null
    : await getActiveSeason(pool);

  if (!activeSeason) {
    return { simulated: 0, roundNo: null, seasonId: null };
  }

  const stageFilter = includePlayoffs ? `AND stage IN ('REGULAR', 'PLAYOFF', 'FINAL')` : `AND stage = 'REGULAR'`;
  const tierFilter = leagueTier ? `AND league_tier = $2` : '';
  const tierParams = leagueTier ? [activeSeason.id, Number(leagueTier)] : [activeSeason.id];
  const firstIncompleteRound = Number(
    (
      await pool.query(
        `SELECT MIN(round_no)::int AS round_no
         FROM matches
         WHERE season_id = $1
           ${tierFilter}
           ${stageFilter}
           AND status <> 'COMPLETED'`,
        tierParams
      )
    ).rows[0].round_no
  );

  if (!includePlayoffs && roundNo && firstIncompleteRound && Number(roundNo) > firstIncompleteRound) {
    const error = new Error(
      `Cannot simulate Round ${roundNo} yet. Complete Round ${firstIncompleteRound} first${leagueTier ? ` in League ${Number(leagueTier)}` : ''}.`
    );
    error.status = 409;
    throw error;
  }

  const targetRound = Number(roundNo || firstIncompleteRound || 0);

  if (!targetRound) {
    await maybeEmitSimulationProgress(onSimulationProgress, {
      scope: 'ROUND',
      phase: 'complete',
      operationId: simulationOperationId,
      seasonId: Number(activeSeason.id),
      roundNo: null,
      leagueTier: leagueTier ? Number(leagueTier) : null,
      completed: 0,
      total: 0
    });

    return { simulated: 0, totalMatches: 0, roundNo: null, seasonId: activeSeason.id, operationId: simulationOperationId };
  }

  const matches = await pool.query(
    `SELECT id
     FROM matches
     WHERE season_id = $1
       ${leagueTier ? 'AND league_tier = $2' : ''}
       AND round_no = $${leagueTier ? 3 : 2}
       ${stageFilter}
       AND status <> 'COMPLETED'
     ORDER BY id`,
    leagueTier ? [activeSeason.id, Number(leagueTier), targetRound] : [activeSeason.id, targetRound]
  );

  const totalMatches = Number(matches.rows.length || 0);
  await maybeEmitSimulationProgress(onSimulationProgress, {
    scope: 'ROUND',
    phase: 'start',
    operationId: simulationOperationId,
    seasonId: Number(activeSeason.id),
    roundNo: Number(targetRound),
    leagueTier: leagueTier ? Number(leagueTier) : null,
    completed: 0,
    total: totalMatches
  });

  let simulated = 0;
  const chunkSize = Math.max(1, Number(batchChunkSize || 1));
  const pauseMs = Math.max(0, Number(batchChunkPauseMs || 0));
  const chunks = [];
  for (let i = 0; i < matches.rows.length; i += chunkSize) {
    chunks.push(matches.rows.slice(i, i + chunkSize));
  }

  for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex += 1) {
    const chunk = chunks[chunkIndex];
    await Promise.all(
      chunk.map(async (match) => {
        try {
          await simulateMatchForBatch(match.id, {
            broadcast,
            autoCreateNextSeason: false,
            useExternalBallApi,
            useExternalFullMatchApi,
            strictExternalFullMatchApi,
            simulationOperationId
          });
        } catch (matchError) {
          // Broadcast error so any connected match-center client knows.
          broadcast('match:error', { matchId: match.id, simulationOperationId, message: matchError.message }, `match:${match.id}`);
          console.error(`[MatchEngine] simulateRound matchId=${match.id} failed:`, matchError.message);
          // Don't rethrow — let the rest of the round continue.
        }
        simulated += 1;
        await maybeEmitSimulationProgress(onSimulationProgress, {
          scope: 'ROUND',
          phase: 'progress',
          operationId: simulationOperationId,
          seasonId: Number(activeSeason.id),
          roundNo: Number(targetRound),
          leagueTier: leagueTier ? Number(leagueTier) : null,
          matchId: Number(match.id),
          completed: simulated,
          total: totalMatches,
          chunkIndex: chunkIndex + 1,
          chunkTotal: chunks.length
        });
      })
    );

    if (pauseMs > 0 && chunkIndex < chunks.length - 1) {
      await maybeEmitSimulationProgress(onSimulationProgress, {
        scope: 'ROUND',
        phase: 'cooldown',
        operationId: simulationOperationId,
        seasonId: Number(activeSeason.id),
        roundNo: Number(targetRound),
        leagueTier: leagueTier ? Number(leagueTier) : null,
        completed: simulated,
        total: totalMatches,
        waitMs: pauseMs,
        nextChunk: chunkIndex + 2
      });
      await delay(pauseMs);
    }
  }

  const cpuLifecycle = await maybeRunCpuManagerLifecycleForRound(
    Number(activeSeason.id),
    Number(targetRound || 0),
    pool
  );

  const seasonState = await progressSeasonStructure(activeSeason.id, pool);
  if (seasonState.state === 'SEASON_COMPLETED') {
    await finalizeManagerSeasonLifecycle(Number(activeSeason.id), pool);
  }
  if (seasonState.state === 'SEASON_COMPLETED' && autoCreateNextSeason) {
    await createNextSeasonFromCompleted(activeSeason.id, pool);
  }

  await maybeEmitSimulationProgress(onSimulationProgress, {
    scope: 'ROUND',
    phase: 'complete',
    operationId: simulationOperationId,
    seasonId: Number(activeSeason.id),
    roundNo: Number(targetRound),
    leagueTier: leagueTier ? Number(leagueTier) : null,
    completed: simulated,
    total: totalMatches
  });

  return {
    simulated,
    totalMatches,
    roundNo: targetRound,
    seasonId: activeSeason.id,
    seasonState: seasonState.state,
    leagueTier: leagueTier ? Number(leagueTier) : null,
    managerLifecycle: cpuLifecycle,
    operationId: simulationOperationId
  };
}

export async function simulateLeagueRound({ seasonId = null, roundNo = null, leagueTier }, options = {}) {
  const tier = Number(leagueTier || 0);
  const activeSeason = seasonId
    ? (await pool.query('SELECT id, league_count FROM seasons WHERE id = $1', [seasonId])).rows[0] || null
    : await getActiveSeason(pool);
  const maxTier = Number(activeSeason?.league_count || 4);

  if (!tier || tier < 1 || tier > maxTier) {
    const error = new Error(`leagueTier must be between 1 and ${maxTier}.`);
    error.status = 400;
    throw error;
  }

  return simulateRound(roundNo, {
    ...options,
    includePlayoffs: false,
    seasonId,
    autoCreateNextSeason: false,
    leagueTier: tier
  });
}

export async function simulateMyLeagueRound(userId, options = {}) {
  const activeSeason = await getActiveSeason(pool);
  if (!activeSeason) {
    return { simulated: 0, roundNo: null, seasonId: null, leagueTier: null };
  }

  const managed = await pool.query(
    `SELECT st.league_tier
     FROM franchises f
     JOIN season_teams st ON st.franchise_id = f.id AND st.season_id = $2
     WHERE f.owner_user_id = $1
     LIMIT 1`,
    [userId, activeSeason.id]
  );

  if (!managed.rows.length) {
    const error = new Error('No managed franchise found in the active season.');
    error.status = 404;
    throw error;
  }

  const leagueTier = Number(managed.rows[0].league_tier || 0);
  return simulateLeagueRound(
    { seasonId: activeSeason.id, roundNo: null, leagueTier },
    {
      ...options,
      autoCreateNextSeason: false
    }
  );
}

export async function simulateHalfSeason(options = {}) {
  const {
    broadcast = () => {},
    useExternalBallApi = env.streetCricketUseForBatchSims,
    useExternalFullMatchApi = env.streetCricketFullMatchApiEnabled,
    strictExternalFullMatchApi = false,
    simulationOperationId = null,
    onSimulationProgress = null
  } = options;

  const activeSeason = await getActiveSeason(pool);
  if (!activeSeason) {
    return { totalSimulated: 0, seasonId: null, roundsSimulated: [], totalMatches: 0 };
  }

  const targetSeasonId = Number(activeSeason.id);
  const regularRounds = await getSeasonRoundOverview(targetSeasonId, pool);
  const totalRoundCount = Number(regularRounds.length || 0);
  if (!totalRoundCount) {
    return { totalSimulated: 0, seasonId: targetSeasonId, roundsSimulated: [], totalMatches: 0, operationId: simulationOperationId };
  }

  const roundsPerHalf = Math.max(1, Math.ceil(totalRoundCount / 2));
  const pendingRounds = regularRounds
    .filter((round) => Number(round.completed_matches || 0) < Number(round.total_matches || 0))
    .map((round) => Number(round.round_no));
  const roundsToSimulate = pendingRounds.slice(0, roundsPerHalf);

  if (!roundsToSimulate.length) {
    await maybeEmitSimulationProgress(onSimulationProgress, {
      scope: 'HALF_SEASON',
      phase: 'complete',
      operationId: simulationOperationId,
      seasonId: targetSeasonId,
      completed: 0,
      total: 0
    });

    return { totalSimulated: 0, seasonId: targetSeasonId, roundsSimulated: [], totalMatches: 0, operationId: simulationOperationId };
  }

  const totalMatches = Number(
    (
      await pool.query(
        `SELECT COUNT(*)::int AS count
         FROM matches
         WHERE season_id = $1
           AND stage = 'REGULAR'
           AND round_no = ANY($2::int[])
           AND status <> 'COMPLETED'`,
        [targetSeasonId, roundsToSimulate]
      )
    ).rows[0].count
  );

  let totalSimulated = 0;
  await maybeEmitSimulationProgress(onSimulationProgress, {
    scope: 'HALF_SEASON',
    phase: 'start',
    operationId: simulationOperationId,
    seasonId: targetSeasonId,
    rounds: roundsToSimulate,
    completed: 0,
    total: totalMatches
  });

  for (const roundNo of roundsToSimulate) {
    const result = await simulateRound(roundNo, {
      broadcast,
      includePlayoffs: false,
      seasonId: targetSeasonId,
      autoCreateNextSeason: false,
      useExternalBallApi,
      useExternalFullMatchApi,
      strictExternalFullMatchApi,
      simulationOperationId,
      onSimulationProgress: async (progress) => {
        if (progress?.phase !== 'progress') {
          return;
        }

        await maybeEmitSimulationProgress(onSimulationProgress, {
          scope: 'HALF_SEASON',
          phase: 'progress',
          operationId: simulationOperationId,
          seasonId: targetSeasonId,
          roundNo: progress.roundNo,
          leagueTier: progress.leagueTier,
          matchId: progress.matchId,
          completed: Math.min(totalMatches, totalSimulated + Number(progress.completed || 0)),
          total: totalMatches
        });
      }
    });

    totalSimulated += Number(result.simulated || 0);
  }

  await maybeEmitSimulationProgress(onSimulationProgress, {
    scope: 'HALF_SEASON',
    phase: 'complete',
    operationId: simulationOperationId,
    seasonId: targetSeasonId,
    completed: totalSimulated,
    total: totalMatches
  });

  return {
    totalSimulated,
    totalMatches,
    seasonId: targetSeasonId,
    roundsSimulated: roundsToSimulate,
    operationId: simulationOperationId
  };
}

export async function simulateSeasonToEnd(options = {}) {
  const {
    broadcast = () => {},
    useExternalBallApi = env.streetCricketUseForBatchSims,
    useExternalFullMatchApi = env.streetCricketFullMatchApiEnabled,
    strictExternalFullMatchApi = false,
    simulationOperationId = null,
    onSimulationProgress = null
  } = options;
  const activeSeason = await getActiveSeason(pool);

  if (!activeSeason) {
    return { totalSimulated: 0, seasonId: null, completedSeasonId: null, nextSeasonId: null };
  }

  const targetSeasonId = Number(activeSeason.id);
  const totalPendingMatches = Number(
    (
      await pool.query(
        `SELECT COUNT(*)::int AS count
         FROM matches
         WHERE season_id = $1
           AND stage IN ('REGULAR', 'PLAYOFF', 'FINAL')
           AND status <> 'COMPLETED'`,
        [targetSeasonId]
      )
    ).rows[0].count
  );

  let totalSimulated = 0;

  await maybeEmitSimulationProgress(onSimulationProgress, {
    scope: 'SEASON',
    phase: 'start',
    operationId: simulationOperationId,
    seasonId: targetSeasonId,
    completed: 0,
    total: totalPendingMatches
  });

  while (true) {
    const result = await simulateRound(null, {
      broadcast,
      includePlayoffs: true,
      seasonId: targetSeasonId,
      autoCreateNextSeason: false,
      useExternalBallApi,
      useExternalFullMatchApi,
      strictExternalFullMatchApi,
      simulationOperationId,
      onSimulationProgress: async (progress) => {
        if (progress?.phase !== 'progress') {
          return;
        }

        await maybeEmitSimulationProgress(onSimulationProgress, {
          scope: 'SEASON',
          phase: 'progress',
          operationId: simulationOperationId,
          seasonId: targetSeasonId,
          roundNo: progress.roundNo,
          leagueTier: progress.leagueTier,
          matchId: progress.matchId,
          completed: Math.min(totalPendingMatches, totalSimulated + Number(progress.completed || 0)),
          total: totalPendingMatches
        });
      }
    });

    if (!result.simulated) {
      break;
    }

    totalSimulated += result.simulated;
  }

  const seasonResult = await pool.query('SELECT id, status FROM seasons WHERE id = $1', [targetSeasonId]);
  const completedSeasonId = seasonResult.rows[0]?.status === 'COMPLETED' ? targetSeasonId : null;
  if (completedSeasonId) {
    await finalizeManagerSeasonLifecycle(Number(completedSeasonId), pool);
  }
  const nextSeason = completedSeasonId ? await createNextSeasonFromCompleted(completedSeasonId, pool) : null;

  await maybeEmitSimulationProgress(onSimulationProgress, {
    scope: 'SEASON',
    phase: 'complete',
    operationId: simulationOperationId,
    seasonId: targetSeasonId,
    completed: totalSimulated,
    total: totalPendingMatches
  });

  return {
    totalSimulated,
    seasonId: targetSeasonId,
    completedSeasonId,
    nextSeasonId: nextSeason ? Number(nextSeason.id) : null,
    operationId: simulationOperationId
  };
}
