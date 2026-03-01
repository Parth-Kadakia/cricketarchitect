import pool from '../config/db.js';
import env from '../config/env.js';
import { clamp, randomFloat, randomInt, toOverNotation, weightedChoice } from '../utils/gameMath.js';
import {
  createNextSeasonFromCompleted,
  getActiveSeason,
  getLeagueTable,
  progressSeasonStructure,
  updateSeasonTableWithMatch
} from './leagueService.js';
import { simulateBallViaStreetApi, simulateTossViaStreetApi } from './streetCricketService.js';
import { calculateFranchiseValuation } from './valuationService.js';

const activeSimulations = new Set();

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function sortByBatting(players) {
  return [...players].sort((a, b) => {
    const aScore = Number(a.batting) * 0.55 + Number(a.form) * 0.2 + Number(a.temperament) * 0.15 + Number(a.fitness) * 0.1;
    const bScore = Number(b.batting) * 0.55 + Number(b.form) * 0.2 + Number(b.temperament) * 0.15 + Number(b.fitness) * 0.1;
    return bScore - aScore;
  });
}

function selectBowlers(players) {
  const sorted = [...players].sort((a, b) => {
    const aScore = Number(a.bowling) * 0.58 + Number(a.form) * 0.2 + Number(a.fitness) * 0.22;
    const bScore = Number(b.bowling) * 0.58 + Number(b.form) * 0.2 + Number(b.fitness) * 0.22;
    return bScore - aScore;
  });

  return sorted.slice(0, 6);
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
  return {
    pitchConditions: pickFrom(['good', 'green', 'flat', 'dusty', 'dry', 'damp', 'bouncy']),
    weatherConditions: pickFrom(['clear', 'overcast', 'humid', 'windy', 'hot', 'cold']),
    windConditions: pickFrom(['light', 'moderate', 'strong']),
    timeOfDay: pickFrom(['day', 'day_night', 'night']),
    groundSize: pickFrom(['Short', 'Medium', 'Large']),
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
  const query = `SELECT *
                 FROM players
                 WHERE franchise_id = $1
                   AND squad_status IN ('MAIN_SQUAD', 'YOUTH')
                   AND squad_status <> 'RETIRED'
                 ORDER BY starting_xi DESC, squad_status = 'MAIN_SQUAD' DESC, (batting + bowling + fielding) DESC`;

  const homePlayers = (await dbClient.query(query, [match.home_franchise_id])).rows;
  const awayPlayers = (await dbClient.query(query, [match.away_franchise_id])).rows;

  const resolvedHome = homePlayers.slice(0, 11);
  const resolvedAway = awayPlayers.slice(0, 11);

  if (resolvedHome.length < 11 || resolvedAway.length < 11) {
    const error = new Error('One or both teams do not have enough players to simulate this match.');
    error.status = 400;
    throw error;
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
      $7, $8, $9, $10, 0, $11,
      $12, $13, $14, $15
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
        innings,
        over: overNumber,
        ball: ballNumber,
        battingFranchiseId,
        bowlingFranchiseId,
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

      broadcast(
        'match:over_summary',
        {
          matchId,
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
           form = LEAST(100, GREATEST(5, form + $10)),
           morale = LEAST(100, GREATEST(5, morale + $11))
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
       SET fan_rating = LEAST(100, fan_rating + 0.4)
       WHERE id IN ($1, $2)`,
      [homeId, awayId]
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
         growth_points = growth_points + 5
     WHERE id = $1`,
    [winnerId]
  );

  await dbClient.query(
    `UPDATE franchises
     SET losses = losses + 1,
         win_streak = 0,
         fan_rating = GREATEST(5, fan_rating - 1.2)
     WHERE id = $1`,
    [loserId]
  );

  await dbClient.query(
    `INSERT INTO transactions (franchise_id, transaction_type, amount, description)
     VALUES ($1, 'POINT_REWARD', 0, 'Match win reward: +5 prospect points, +5 growth points')`,
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
    useExternalBallApi = true
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

    await pool.query('DELETE FROM match_events WHERE match_id = $1', [match.id]);
    await pool.query('DELETE FROM player_match_stats WHERE match_id = $1', [match.id]);

    await pool.query(`UPDATE matches SET status = 'LIVE' WHERE id = $1`, [match.id]);

    const homeFranchiseId = Number(match.home_franchise_id);
    const awayFranchiseId = Number(match.away_franchise_id);

    const { homeTeam, awayTeam } = await loadMatchTeams(match, pool);
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
      ballOptions: {
        useExternalBallApi,
        matchContext: matchConditions
      }
    });

    firstInnings.battingId = firstBattingId;

    broadcast(
      'match:innings_break',
      {
        matchId: match.id,
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
      ballOptions: {
        useExternalBallApi,
        matchContext: matchConditions
      }
    });

    secondInnings.battingId = secondBattingId;

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
           result_summary = $11
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

    const table = await updateSeasonTableWithMatch(match.id, pool);
    const seasonState = await progressSeasonStructure(match.season_id, pool);

    await calculateFranchiseValuation(homeFranchiseId, match.season_id, pool);
    await calculateFranchiseValuation(awayFranchiseId, match.season_id, pool);

    if (seasonState.state === 'SEASON_COMPLETED' && autoCreateNextSeason) {
      await createNextSeasonFromCompleted(match.season_id, pool);
    }

    const scorecard = await getMatchScorecard(match.id);

    broadcast('match:complete', scorecard, `match:${match.id}`);
    broadcast('league:update', { seasonId: match.season_id, table: table || (await getLeagueTable(match.season_id, pool)) }, 'league');

    return scorecard;
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

  const scorecard = {
    match: {
      ...match.rows[0],
      player_of_match_name: match.rows[0].pom_first_name ? `${match.rows[0].pom_first_name} ${match.rows[0].pom_last_name}` : null,
      home_overs: inningsBallsToOvers(Number(match.rows[0].home_balls || 0)),
      away_overs: inningsBallsToOvers(Number(match.rows[0].away_balls || 0))
    },
    stats: stats.rows,
    events: events.rows,
    worm: wormByOver.rows
  };

  return scorecard;
}

export async function simulateRound(roundNo, options = {}) {
  const {
    broadcast = () => {},
    includePlayoffs = false,
    seasonId = null,
    autoCreateNextSeason = true,
    useExternalBallApi = env.streetCricketUseForBatchSims
  } = options;
  const activeSeason = seasonId
    ? (await pool.query('SELECT * FROM seasons WHERE id = $1', [seasonId])).rows[0] || null
    : await getActiveSeason(pool);

  if (!activeSeason) {
    return { simulated: 0, roundNo: null, seasonId: null };
  }

  const stageFilter = includePlayoffs ? `AND stage IN ('REGULAR', 'PLAYOFF', 'FINAL')` : `AND stage = 'REGULAR'`;
  const targetRound =
    roundNo ||
    Number(
      (
        await pool.query(
          `SELECT MIN(round_no)::int AS round_no
           FROM matches
           WHERE season_id = $1
             ${stageFilter}
             AND status <> 'COMPLETED'`,
          [activeSeason.id]
        )
      ).rows[0].round_no
    );

  if (!targetRound) {
    return { simulated: 0, roundNo: null, seasonId: activeSeason.id };
  }

  const matches = await pool.query(
    `SELECT id
     FROM matches
     WHERE season_id = $1
       AND round_no = $2
       ${stageFilter}
       AND status <> 'COMPLETED'
     ORDER BY id`,
    [activeSeason.id, targetRound]
  );

  let simulated = 0;

  for (const match of matches.rows) {
    await simulateMatchLive(match.id, { ballDelayMs: 0, broadcast, autoCreateNextSeason, useExternalBallApi });
    simulated += 1;
  }

  return {
    simulated,
    roundNo: targetRound,
    seasonId: activeSeason.id
  };
}

export async function simulateSeasonToEnd(options = {}) {
  const { broadcast = () => {} } = options;
  const activeSeason = await getActiveSeason(pool);

  if (!activeSeason) {
    return { totalSimulated: 0, seasonId: null, completedSeasonId: null, nextSeasonId: null };
  }

  const targetSeasonId = Number(activeSeason.id);

  let totalSimulated = 0;

  while (true) {
    const result = await simulateRound(null, {
      broadcast,
      includePlayoffs: true,
      seasonId: targetSeasonId,
      autoCreateNextSeason: false
    });

    if (!result.simulated) {
      break;
    }

    totalSimulated += result.simulated;
  }

  const seasonResult = await pool.query('SELECT id, status FROM seasons WHERE id = $1', [targetSeasonId]);
  const completedSeasonId = seasonResult.rows[0]?.status === 'COMPLETED' ? targetSeasonId : null;
  const nextSeason = completedSeasonId ? await createNextSeasonFromCompleted(completedSeasonId, pool) : null;

  return {
    totalSimulated,
    seasonId: targetSeasonId,
    completedSeasonId,
    nextSeasonId: nextSeason ? Number(nextSeason.id) : null
  };
}
