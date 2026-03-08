import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api } from '../api/client';
import TeamNameButton from '../components/TeamNameButton';
import { useAuth } from '../context/AuthContext';
import { useSocket } from '../context/SocketContext';
import { oversFromBalls, scoreLabel, setPageTitle } from '../utils/format';

function stripCommentaryPrefix(commentary) {
  const value = String(commentary || '').trim();
  if (!value) {
    return 'Ball update.';
  }

  const parts = value.split(':');
  if (parts.length <= 1) {
    return value;
  }

  return parts.slice(1).join(':').replace(/\s*Score\s+\d+\/\d+\.\s*$/i, '').trim();
}

function extractScoreFromCommentary(commentary) {
  const match = String(commentary || '').match(/Score\s+(\d+)\/(\d+)/i);
  if (!match) {
    return null;
  }

  return {
    runs: Number(match[1]),
    wickets: Number(match[2])
  };
}

function formatBowlerSpell(line) {
  if (!line) {
    return '0-0-0-0';
  }

  const overs = oversFromBalls(line.balls);
  return `${overs}-${line.maidens || 0}-${line.runs || 0}-${line.wickets || 0}`;
}

function splitName(fullName) {
  const raw = String(fullName || '').trim();
  if (!raw) {
    return { firstName: 'Unknown', lastName: 'Player' };
  }
  const parts = raw.split(/\s+/);
  if (parts.length === 1) {
    return { firstName: parts[0], lastName: '' };
  }
  return { firstName: parts[0], lastName: parts.slice(1).join(' ') };
}

function normalizedBallKey(eventLike) {
  const innings = Number(eventLike?.innings || 0);
  const over = Number(eventLike?.over_number || eventLike?.over || 0);
  const ball = Number(eventLike?.ball_number || eventLike?.ball || 0);
  return `${innings}-${over}-${ball}`;
}

function mergeEventRows(existingRows, incomingRows) {
  const map = new Map();

  for (const row of existingRows || []) {
    map.set(normalizedBallKey(row), row);
  }

  for (const row of incomingRows || []) {
    const key = normalizedBallKey(row);
    const prior = map.get(key);
    map.set(key, {
      ...(prior || {}),
      ...row
    });
  }

  return [...map.values()].sort((a, b) => {
    if (Number(a.innings) !== Number(b.innings)) {
      return Number(a.innings) - Number(b.innings);
    }
    if (Number(a.over_number || a.over) !== Number(b.over_number || b.over)) {
      return Number(a.over_number || a.over) - Number(b.over_number || b.over);
    }
    if (Number(a.ball_number || a.ball) !== Number(b.ball_number || b.ball)) {
      return Number(a.ball_number || a.ball) - Number(b.ball_number || b.ball);
    }
    return Number(a.id || 0) - Number(b.id || 0);
  });
}

function toDismissalText(commentary, strikerName) {
  const raw = String(commentary || '')
    .replace(/\s+/g, ' ')
    .replace(/\s*Score\s+\d+\/\d+\.?\s*$/i, '')
    .trim();

  if (!raw) {
    return 'Out';
  }

  const deliveryMatch = raw.match(/^([A-Za-z .'-]{2,80})\s+to\s+([A-Za-z .'-]{2,80})/i);
  const bowlerName = deliveryMatch?.[1]?.trim() || '';

  const cAndB = raw.match(/\bc\s+([A-Za-z .'-]{2,80})\s+b\s+([A-Za-z .'-]{2,80})\b/i);
  if (cAndB) {
    return `c ${cAndB[1].trim()} b ${cAndB[2].trim()}`;
  }

  if (/\brun\s*out\b/i.test(raw)) {
    const runOutBy = raw.match(/\brun\s*out\s+by\s+([A-Za-z .'-]{2,80})\b/i)?.[1]?.trim();
    const runOutFielder = raw.match(/\brun\s*out\b.*?\(([^)]+)\)/i)?.[1]?.trim();
    const fielder = runOutBy || runOutFielder || '';
    return fielder ? `run out (${fielder})` : 'run out';
  }

  const lbwWithBowler = raw.match(/\blbw\b(?:\s+b\s+([A-Za-z .'-]{2,80}))?/i);
  if (lbwWithBowler) {
    const bowler = lbwWithBowler[1]?.trim() || bowlerName;
    return bowler ? `lbw b ${bowler}` : 'lbw';
  }

  if (/\bbowled\b/i.test(raw) || /\(BOWLED\)/i.test(raw)) {
    return bowlerName ? `b ${bowlerName}` : 'b ?';
  }

  const caughtBy = raw.match(/\bcaught\s+by\s+([A-Za-z .'-]{2,80})\b/i)?.[1]?.trim();
  if (caughtBy) {
    return bowlerName ? `c ${caughtBy} b ${bowlerName}` : `c ${caughtBy}`;
  }

  const inParens = raw.match(/\(([^)]+)\)/);
  const parenToken = (inParens?.[1] || '').trim().toUpperCase();
  if (parenToken.includes('LBW')) {
    return bowlerName ? `lbw b ${bowlerName}` : 'lbw';
  }
  if (parenToken.includes('RUN OUT')) {
    return 'run out';
  }
  if (parenToken.includes('BOWLED')) {
    return bowlerName ? `b ${bowlerName}` : 'b ?';
  }

  if (strikerName) {
    const safeName = strikerName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const fallbackCleaned = stripCommentaryPrefix(raw)
      .replace(new RegExp(`^${safeName}\\s+`, 'i'), '')
      .replace(/^OUT!?/i, '')
      .replace(/\.\s*$/g, '')
      .trim();
    if (fallbackCleaned && fallbackCleaned.length <= 48) {
      return fallbackCleaned;
    }
  }

  return 'Out';
}

function buildFallbackBattingRows(events, innings, battingFranchiseId, playerLookup) {
  const stats = new Map();
  let battingOrder = 0;

  const sortedEvents = [...(events || [])].sort((a, b) => {
    if (Number(a.innings) !== Number(b.innings)) {
      return Number(a.innings) - Number(b.innings);
    }
    if (Number(a.over_number) !== Number(b.over_number)) {
      return Number(a.over_number) - Number(b.over_number);
    }
    if (Number(a.ball_number) !== Number(b.ball_number)) {
      return Number(a.ball_number) - Number(b.ball_number);
    }
    return Number(a.id || 0) - Number(b.id || 0);
  });

  function ensureLine(playerId) {
    if (!playerId) {
      return null;
    }

    const id = Number(playerId);
    if (!stats.has(id)) {
      const fullName = playerLookup.get(id) || `Player ${id}`;
      const { firstName, lastName } = splitName(fullName);
      battingOrder += 1;
      stats.set(id, {
        player_id: id,
        first_name: firstName,
        last_name: lastName,
        batting_order: battingOrder,
        batting_runs: 0,
        batting_balls: 0,
        fours: 0,
        sixes: 0,
        dismissal_text: null,
        not_out: true
      });
    }

    return stats.get(id);
  }

  for (const event of sortedEvents) {
    if (Number(event.innings) !== Number(innings)) {
      continue;
    }
    if (Number(event.batting_franchise_id) !== Number(battingFranchiseId)) {
      continue;
    }

    const strikerId = Number(event.striker_player_id || 0);
    const nonStrikerId = Number(event.non_striker_player_id || 0);
    const striker = ensureLine(strikerId);
    ensureLine(nonStrikerId);

    if (!striker) {
      continue;
    }

    const batsmanRuns = Number(event.runs || 0);
    striker.batting_balls += 1;
    striker.batting_runs += batsmanRuns;
    if (Number(event.is_boundary)) {
      striker.fours += 1;
    }
    if (Number(event.is_six)) {
      striker.sixes += 1;
    }

    if (Number(event.is_wicket)) {
      striker.not_out = false;
      const strikerName = playerLookup.get(strikerId) || `${striker.first_name} ${striker.last_name}`.trim();
      striker.dismissal_text = toDismissalText(event.commentary, strikerName);
    }
  }

  return [...stats.values()].sort((a, b) => Number(a.batting_order || 0) - Number(b.batting_order || 0));
}

function buildFallbackBowlingRows(events, innings, bowlingFranchiseId, playerLookup) {
  const stats = new Map();

  for (const event of events || []) {
    if (Number(event.innings) !== Number(innings)) {
      continue;
    }
    if (Number(event.bowling_franchise_id) !== Number(bowlingFranchiseId)) {
      continue;
    }

    const bowlerId = Number(event.bowler_player_id || 0);
    if (!bowlerId) {
      continue;
    }

    const runsConceded = Number(event.runs || 0) + Number(event.extras || 0);
    if (!stats.has(bowlerId)) {
      stats.set(bowlerId, {
        player_id: bowlerId,
        bowling_balls: 0,
        bowling_runs: 0,
        bowling_wickets: 0,
        maiden_overs: 0,
        overMap: new Map()
      });
    }

    const line = stats.get(bowlerId);
    line.bowling_balls += 1;
    line.bowling_runs += runsConceded;

    if (Number(event.is_wicket) && !String(event.commentary || '').toLowerCase().includes('run out')) {
      line.bowling_wickets += 1;
    }

    const overNo = Number(event.over_number || 0);
    if (overNo) {
      const overLine = line.overMap.get(overNo) || { balls: 0, runs: 0 };
      overLine.balls += 1;
      overLine.runs += runsConceded;
      line.overMap.set(overNo, overLine);
    }
  }

  return [...stats.values()]
    .map((line) => {
      let maidens = 0;
      for (const overLine of line.overMap.values()) {
        if (Number(overLine.balls) === 6 && Number(overLine.runs) === 0) {
          maidens += 1;
        }
      }

      const fullName = playerLookup.get(Number(line.player_id)) || `Player ${line.player_id}`;
      const { firstName, lastName } = splitName(fullName);

      return {
        ...line,
        first_name: firstName,
        last_name: lastName,
        maiden_overs: maidens
      };
    })
    .sort((a, b) => {
      if (Number(b.bowling_wickets) !== Number(a.bowling_wickets)) {
        return Number(b.bowling_wickets) - Number(a.bowling_wickets);
      }
      const econA = Number(a.bowling_balls) ? (Number(a.bowling_runs) / Number(a.bowling_balls)) * 6 : 99;
      const econB = Number(b.bowling_balls) ? (Number(b.bowling_runs) / Number(b.bowling_balls)) * 6 : 99;
      return econA - econB;
    });
}

function extractNamesFromCommentary(commentary) {
  const value = String(commentary || '').trim();
  if (!value) {
    return null;
  }

  const normalized = value
    .replace(/^O\d+\.\d+\s+/i, '')
    .replace(/^Ball\s*\d+\s*:\s*/i, '');

  const match = normalized.match(/^([A-Za-z0-9 .'-]{2,60}?)\s+to\s+([A-Za-z0-9 .'-]{2,60}?)(?:\s*[:(]|$)/i);
  if (!match) {
    return null;
  }

  return {
    bowlerName: match[1].trim(),
    strikerName: match[2].trim()
  };
}

function buildInningsCommentary(events, playerLookup, targetsByInnings = {}) {
  const byInnings = new Map();

  for (const rawEvent of events || []) {
    const innings = Number(rawEvent.innings || 0);
    if (!innings) {
      continue;
    }

    if (!byInnings.has(innings)) {
      byInnings.set(innings, []);
    }

    byInnings.get(innings).push(rawEvent);
  }

  const result = {};

  for (const [innings, inningsEvents] of byInnings.entries()) {
    const overGroups = new Map();

    inningsEvents
      .sort((a, b) => {
        if (Number(a.over_number) !== Number(b.over_number)) {
          return Number(a.over_number) - Number(b.over_number);
        }
        if (Number(a.ball_number) !== Number(b.ball_number)) {
          return Number(a.ball_number) - Number(b.ball_number);
        }
        return Number(a.id || 0) - Number(b.id || 0);
      })
      .forEach((event) => {
        const over = Number(event.over_number);
        if (!overGroups.has(over)) {
          overGroups.set(over, []);
        }
        overGroups.get(over).push(event);
      });

    const batting = new Map();
    const bowling = new Map();
    const dismissed = new Set();
    let battingOrderIndex = 0;
    let cumulativeRuns = 0;
    let cumulativeWickets = 0;

    const overs = [];

    for (const [over, overEvents] of overGroups.entries()) {
      let overRuns = 0;
      const ballLines = [];

      for (const event of overEvents) {
        const strikerId = Number(event.striker_player_id || 0);
        const nonStrikerId = Number(event.non_striker_player_id || 0);
        const bowlerId = Number(event.bowler_player_id || 0);
        const runs = Number(event.runs || 0) + Number(event.extras || 0);

        if (strikerId) {
          if (!batting.has(strikerId)) {
            batting.set(strikerId, {
              playerId: strikerId,
              order: battingOrderIndex += 1,
              runs: 0,
              balls: 0,
              fours: 0,
              sixes: 0
            });
          }

          const striker = batting.get(strikerId);
          striker.runs += runs;
          striker.balls += 1;
          if (Number(event.is_boundary)) {
            striker.fours += 1;
          }
          if (Number(event.is_six)) {
            striker.sixes += 1;
          }
        }

        if (nonStrikerId && !batting.has(nonStrikerId)) {
          batting.set(nonStrikerId, {
            playerId: nonStrikerId,
            order: battingOrderIndex += 1,
            runs: 0,
            balls: 0,
            fours: 0,
            sixes: 0
          });
        }

        if (bowlerId) {
          if (!bowling.has(bowlerId)) {
            bowling.set(bowlerId, {
              playerId: bowlerId,
              balls: 0,
              runs: 0,
              wickets: 0,
              maidens: 0
            });
          }

          const bowler = bowling.get(bowlerId);
          bowler.balls += 1;
          bowler.runs += runs;
          if (Number(event.is_wicket) && !String(event.commentary || '').toLowerCase().includes('run out')) {
            bowler.wickets += 1;
          }
        }

        if (Number(event.is_wicket) && strikerId) {
          dismissed.add(strikerId);
          cumulativeWickets += 1;
        }

        overRuns += runs;
        cumulativeRuns += runs;

        const scoreFromLine = extractScoreFromCommentary(event.commentary);
        if (scoreFromLine) {
          cumulativeRuns = scoreFromLine.runs;
          cumulativeWickets = scoreFromLine.wickets;
        }

        ballLines.push({
          key: event.id,
          ballNo: `${over}.${event.ball_number}`,
          result: Number(event.is_wicket) ? 'W' : runs === 0 ? '•' : String(runs),
          text: stripCommentaryPrefix(event.commentary)
        });
      }

      const target = Number(targetsByInnings[innings] || 0) || null;
      const ballsRemaining = Math.max(0, 120 - over * 6);
      const runsNeeded = target != null ? Math.max(0, target + 1 - cumulativeRuns) : null;
      const crr = over > 0 ? ((cumulativeRuns / (over * 6)) * 6).toFixed(2) : '0.00';
      const rrr = target != null && ballsRemaining > 0 ? ((runsNeeded / ballsRemaining) * 6).toFixed(2) : null;

      const activeBatters = [...batting.values()]
        .filter((line) => !dismissed.has(Number(line.playerId)) && Number(line.balls) > 0)
        .sort((a, b) => a.order - b.order)
        .slice(0, 2)
        .map((line) => {
          const name = playerLookup.get(Number(line.playerId)) || 'Unknown Batter';
          return `${name} ${line.runs} (${line.balls}b ${line.fours}x4 ${line.sixes}x6)`;
        });

      const overBowlerId = Number(overEvents[overEvents.length - 1]?.bowler_player_id || 0);
      const overBowlerName = playerLookup.get(overBowlerId) || 'Unknown Bowler';
      const overBowlerSpell = formatBowlerSpell(bowling.get(overBowlerId));

      let closingLine = `${cumulativeRuns}/${cumulativeWickets}  CRR: ${crr}`;
      if (target != null && rrr != null) {
        closingLine += `  RRR: ${rrr}`;
      }

      const pressureLine =
        target != null && ballsRemaining > 0 ? `Need ${runsNeeded} from ${ballsRemaining}b` : innings === 1 ? 'First innings underway' : 'Target achieved';

      overs.push({
        over,
        overRuns,
        summaryTitle: `Over ${over} - ${overRuns} runs`,
        pressureLine,
        closingLine,
        battersLine: activeBatters.length ? activeBatters.join(' | ') : 'No active batters',
        bowlerLine: `${overBowlerName}  ${overBowlerSpell}`,
        balls: [...ballLines].reverse()
      });
    }

    result[innings] = overs.reverse();
  }

  return result;
}

function buildOverByOverSeries(events) {
  const inningMap = new Map([
    [1, new Map()],
    [2, new Map()]
  ]);

  for (const event of events || []) {
    const innings = Number(event.innings || 0);
    const over = Number(event.over_number || 0);
    const runs = Number(event.runs || 0) + Number(event.extras || 0);

    if (!innings || !over || !inningMap.has(innings)) {
      continue;
    }

    const overMap = inningMap.get(innings);
    overMap.set(over, (overMap.get(over) || 0) + runs);
  }

  return {
    innings1: [...inningMap.get(1).entries()].map(([label, value]) => ({ label, value })),
    innings2: [...inningMap.get(2).entries()].map(([label, value]) => ({ label, value }))
  };
}

export default function MatchCenterPage() {
  const navigate = useNavigate();
  const { matchId } = useParams();
  const [searchParams] = useSearchParams();
  const { token } = useAuth();
  const { subscribe, send, connected } = useSocket();

  const numericMatchId = Number(matchId || 0);

  const [scorecard, setScorecard] = useState(null);
  const [eventRows, setEventRows] = useState([]);
  const [seasonId, setSeasonId] = useState(Number(searchParams.get('season') || 0) || null);
  const [roundNo, setRoundNo] = useState(Number(searchParams.get('round') || 0) || null);
  const [activeInnings, setActiveInnings] = useState(1);
  const [simulating, setSimulating] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [shareOpen, setShareOpen] = useState(false);
  const [copied, setCopied] = useState('');

  useEffect(() => { setPageTitle('Match Center'); }, []);

  async function loadMatchCenterData() {
    if (!numericMatchId) {
      setScorecard(null);
      setEventRows([]);
      return;
    }

    setError('');
    setLoading(true);

    try {
      const [scorecardResponse, eventsResponse] = await Promise.all([api.league.scorecard(numericMatchId), api.league.events(numericMatchId)]);
      setScorecard(scorecardResponse);
      setEventRows(eventsResponse.events || []);
      setSimulating(String(scorecardResponse?.match?.status || '').toUpperCase() === 'LIVE');

      const resolvedSeasonId = Number(searchParams.get('season') || scorecardResponse.match?.season_id || 0) || null;
      const resolvedRoundNo = Number(searchParams.get('round') || scorecardResponse.match?.round_no || 0) || null;

      setSeasonId(resolvedSeasonId);
      setRoundNo(resolvedRoundNo);
    } catch (loadError) {
      setError(loadError.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadMatchCenterData();
  }, [numericMatchId]);

  useEffect(() => {
    if (!numericMatchId) {
      return undefined;
    }

    const channel = `match:${numericMatchId}`;
    send({ action: 'subscribe', channel });

    return () => {
      send({ action: 'unsubscribe', channel });
    };
  }, [numericMatchId, send]);

  useEffect(() => {
    const offStart = subscribe('match:start', (message) => {
      if (Number(message.payload?.matchId) !== Number(numericMatchId)) {
        return;
      }

      setSimulating(true);

      setScorecard((prev) => {
        if (!prev?.match) {
          return prev;
        }

        return {
          ...prev,
          match: {
            ...prev.match,
            toss_winner_franchise_id: message.payload?.tossWinnerFranchiseId ?? prev.match.toss_winner_franchise_id,
            toss_decision: message.payload?.tossDecision ?? prev.match.toss_decision,
            status: 'LIVE'
          }
        };
      });
    });

    const offTick = subscribe('match:tick', (message) => {
      if (Number(message.payload?.matchId) !== Number(numericMatchId)) {
        return;
      }

      setSimulating(true);
      const payload = message.payload || {};
      const syntheticEvent = {
        id: `live-${Number(payload.innings || 0)}-${Number(payload.over || 0)}-${Number(payload.ball || 0)}`,
        innings: Number(payload.innings || 0),
        over_number: Number(payload.over || 0),
        ball_number: Number(payload.ball || 0),
        batting_franchise_id: Number(payload.battingFranchiseId || 0),
        bowling_franchise_id: Number(payload.bowlingFranchiseId || 0),
        striker_player_id: Number(payload.strikerPlayerId || 0),
        non_striker_player_id: payload.nonStrikerPlayerId != null ? Number(payload.nonStrikerPlayerId) : null,
        bowler_player_id: Number(payload.bowlerPlayerId || 0),
        runs: Number(payload.runs || 0),
        extras: Number(payload.extras || 0),
        is_boundary: Boolean(payload.isBoundary),
        is_six: Boolean(payload.isSix),
        is_wicket: Boolean(payload.isWicket),
        commentary: payload.commentary || '',
        created_at: new Date().toISOString()
      };

      setEventRows((prev) => mergeEventRows(prev, [syntheticEvent]));

      setScorecard((prev) => {
        if (!prev?.match) {
          return prev;
        }

        const innings = Number(payload.innings || 0);
        const battingFranchiseId = Number(payload.battingFranchiseId || 0);
        const homeId = Number(prev.match.home_franchise_id || 0);
        const awayId = Number(prev.match.away_franchise_id || 0);
        const score = Number(payload.score || 0);
        const wickets = Number(payload.wickets || 0);
        const overValue = String(payload.overs || '0.0');
        const [completeOvers, ballPart] = overValue.split('.');
        const balls = Number(completeOvers || 0) * 6 + Number(ballPart || 0);

        const patch = { status: 'LIVE' };
        if (battingFranchiseId === homeId) {
          patch.home_score = score;
          patch.home_wickets = wickets;
          patch.home_balls = balls;
        } else if (battingFranchiseId === awayId) {
          patch.away_score = score;
          patch.away_wickets = wickets;
          patch.away_balls = balls;
        }

        return {
          ...prev,
          match: {
            ...prev.match,
            ...patch
          },
          events: mergeEventRows(prev.events || [], [syntheticEvent])
        };
      });

      if (Number(payload.innings || 1) === 2) {
        setActiveInnings(2);
      }
    });

    const offOverSummary = subscribe('match:over_summary', async (message) => {
      if (Number(message.payload?.matchId) !== Number(numericMatchId)) {
        return;
      }

      try {
        const [eventsResponse, scorecardResponse] = await Promise.all([api.league.events(numericMatchId), api.league.scorecard(numericMatchId)]);
        setEventRows((prev) => mergeEventRows(prev, eventsResponse.events || []));

        // Merge scorecard carefully: during live simulation the DB may not
        // have up-to-date running scores (they're only persisted after both
        // innings complete). Preserve the tick-derived scores so the first
        // innings data doesn't vanish when the second innings is in progress.
        setScorecard((prev) => {
          if (!prev) return scorecardResponse;

          const isLive = String(scorecardResponse.match?.status || '').toUpperCase() === 'LIVE';

          const mergedMatch = { ...scorecardResponse.match };
          if (isLive && prev.match) {
            // Keep whichever score value is higher / more up-to-date.
            // Tick handlers set these from the live payload; the DB may still have NULL/0.
            if (Number(prev.match.home_score || 0) >= Number(mergedMatch.home_score || 0)) {
              mergedMatch.home_score = prev.match.home_score;
              mergedMatch.home_wickets = prev.match.home_wickets;
              mergedMatch.home_balls = prev.match.home_balls;
            }
            if (Number(prev.match.away_score || 0) >= Number(mergedMatch.away_score || 0)) {
              mergedMatch.away_score = prev.match.away_score;
              mergedMatch.away_wickets = prev.match.away_wickets;
              mergedMatch.away_balls = prev.match.away_balls;
            }
          }

          return {
            ...scorecardResponse,
            match: mergedMatch,
            events: mergeEventRows(prev.events || [], scorecardResponse.events || []),
          };
        });
      } catch {
        // Ignore transient refresh issues during live simulation ticks.
      }
    });

    const offComplete = subscribe('match:complete', async (message) => {
      const completedMatchId = Number(
        message.payload?.match?.id || message.payload?.matchId || message.match?.id || message.matchId || 0
      );
      if (completedMatchId !== Number(numericMatchId)) {
        return;
      }

      setSimulating(false);

      if (message.payload?.match) {
        setScorecard(message.payload);
        setEventRows((prev) => mergeEventRows(prev, message.payload.events || []));
      } else {
        await loadMatchCenterData();
      }
    });

    const offError = subscribe('match:error', (message) => {
      if (Number(message.payload?.matchId) !== Number(numericMatchId)) {
        return;
      }

      setError(message.payload?.message || 'Simulation failed.');
      setSimulating(false);
      // Reload to get the corrected status (the backend resets LIVE → SCHEDULED on error).
      loadMatchCenterData();
    });

    const offReset = subscribe('match:reset', (message) => {
      if (Number(message.payload?.matchId) !== Number(numericMatchId)) {
        return;
      }

      setSimulating(false);
      loadMatchCenterData();
    });

    return () => {
      offStart();
      offTick();
      offOverSummary();
      offComplete();
      offError();
      offReset();
    };
  }, [subscribe, numericMatchId]);

  async function runLive() {
    if (!numericMatchId) {
      return;
    }

    try {
      setError('');
      setSimulating(true);
      await api.league.simulateLive(token, numericMatchId, 90);
    } catch (simulationError) {
      setError(simulationError.message);
      setSimulating(false);
    }
  }

  async function runInstant() {
    if (!numericMatchId) {
      return;
    }

    try {
      setError('');
      setSimulating(true);
      await api.league.simulateInstant(token, numericMatchId);
      await loadMatchCenterData();
    } catch (simulationError) {
      setError(simulationError.message);
    } finally {
      setSimulating(false);
    }
  }

  async function resetMatch() {
    if (!numericMatchId) {
      return;
    }

    try {
      setError('');
      await api.league.resetMatch(token, numericMatchId);
      setSimulating(false);
      await loadMatchCenterData();
    } catch (resetError) {
      setError(resetError.message);
    }
  }

  const playerLookup = useMemo(() => {
    const map = new Map();

    for (const row of scorecard?.stats || []) {
      map.set(Number(row.player_id), `${row.first_name} ${row.last_name}`);
    }

    for (const event of eventRows || []) {
      const parsed = extractNamesFromCommentary(event.commentary);
      if (!parsed) {
        continue;
      }

      const strikerId = Number(event.striker_player_id || 0);
      const bowlerId = Number(event.bowler_player_id || 0);

      if (strikerId && !map.has(strikerId)) {
        map.set(strikerId, parsed.strikerName);
      }

      if (bowlerId && !map.has(bowlerId)) {
        map.set(bowlerId, parsed.bowlerName);
      }
    }

    return map;
  }, [scorecard, eventRows]);

  const series = useMemo(() => buildOverByOverSeries(eventRows), [eventRows]);
  const innings1Runs = useMemo(() => {
    const values = series.innings1;
    return values.reduce((sum, entry) => sum + Number(entry.value || 0), 0);
  }, [series.innings1]);

  const inningsCommentary = useMemo(
    () => buildInningsCommentary(eventRows, playerLookup, { 2: innings1Runs }),
    [eventRows, playerLookup, innings1Runs]
  );

  const inningsMeta = useMemo(() => {
    const homeId = Number(scorecard?.match?.home_franchise_id || 0);
    const awayId = Number(scorecard?.match?.away_franchise_id || 0);
    const homeName = scorecard?.match?.home_name || 'Home';
    const awayName = scorecard?.match?.away_name || 'Away';
    const homeCountry = scorecard?.match?.home_country || '-';
    const awayCountry = scorecard?.match?.away_country || '-';
    const tossWinnerId = Number(scorecard?.match?.toss_winner_franchise_id || 0);
    const tossDecision = String(scorecard?.match?.toss_decision || '').toUpperCase();

    const innings1FirstBall = eventRows.find((event) => Number(event.innings) === 1);
    const innings2FirstBall = eventRows.find((event) => Number(event.innings) === 2);

    let firstBattingId = Number(innings1FirstBall?.batting_franchise_id || 0);

    if (!firstBattingId && tossWinnerId && (tossDecision === 'BAT' || tossDecision === 'BOWL')) {
      firstBattingId = tossDecision === 'BAT' ? tossWinnerId : tossWinnerId === homeId ? awayId : homeId;
    }

    if (!firstBattingId) {
      firstBattingId = homeId;
    }

    let secondBattingId = Number(innings2FirstBall?.batting_franchise_id || 0);
    if (!secondBattingId || secondBattingId === firstBattingId) {
      secondBattingId = firstBattingId === homeId ? awayId : homeId;
    }

    function franchiseNameById(id) {
      if (Number(id) === homeId) {
        return `${homeName} (${homeCountry})`;
      }
      if (Number(id) === awayId) {
        return `${awayName} (${awayCountry})`;
      }
      return `Franchise ${id}`;
    }

    function venueTagById(id) {
      if (Number(id) === homeId) {
        return 'H';
      }
      if (Number(id) === awayId) {
        return 'A';
      }
      return '?';
    }

    function scoreById(id) {
      if (Number(id) === homeId) {
        return scoreLabel(scorecard?.match?.home_score, scorecard?.match?.home_wickets, scorecard?.match?.home_balls);
      }
      if (Number(id) === awayId) {
        return scoreLabel(scorecard?.match?.away_score, scorecard?.match?.away_wickets, scorecard?.match?.away_balls);
      }
      return '-';
    }

    return {
      1: {
        battingId: firstBattingId,
        bowlingId: Number(firstBattingId) === homeId ? awayId : homeId,
        battingName: franchiseNameById(firstBattingId),
        bowlingName: franchiseNameById(Number(firstBattingId) === homeId ? awayId : homeId),
        battingVenueTag: venueTagById(firstBattingId),
        battingScore: scoreById(firstBattingId)
      },
      2: {
        battingId: secondBattingId,
        bowlingId: Number(secondBattingId) === homeId ? awayId : homeId,
        battingName: franchiseNameById(secondBattingId),
        bowlingName: franchiseNameById(Number(secondBattingId) === homeId ? awayId : homeId),
        battingVenueTag: venueTagById(secondBattingId),
        battingScore: scoreById(secondBattingId)
      }
    };
  }, [scorecard, eventRows]);

  const inningsRows = useMemo(() => {
    const stats = scorecard?.stats || [];
    const one = inningsMeta[1];
    const two = inningsMeta[2];

    return {
      1: {
        batting: stats.filter((row) => Number(row.franchise_id) === Number(one.battingId)),
        bowling: stats.filter((row) => Number(row.franchise_id) === Number(one.bowlingId))
      },
      2: {
        batting: stats.filter((row) => Number(row.franchise_id) === Number(two.battingId)),
        bowling: stats.filter((row) => Number(row.franchise_id) === Number(two.bowlingId))
      }
    };
  }, [scorecard, inningsMeta]);

  const fallbackBattingRowsByInnings = useMemo(
    () => ({
      1: buildFallbackBattingRows(eventRows, 1, inningsMeta[1]?.battingId, playerLookup),
      2: buildFallbackBattingRows(eventRows, 2, inningsMeta[2]?.battingId, playerLookup)
    }),
    [eventRows, inningsMeta, playerLookup]
  );

  const fallbackBowlingRowsByInnings = useMemo(
    () => ({
      1: buildFallbackBowlingRows(eventRows, 1, inningsMeta[1]?.bowlingId, playerLookup),
      2: buildFallbackBowlingRows(eventRows, 2, inningsMeta[2]?.bowlingId, playerLookup)
    }),
    [eventRows, inningsMeta, playerLookup]
  );

  /* ── share / export helpers ── */
  function getBattingRowsForInnings(inn) {
    const rows = inningsRows[inn] || { batting: [], bowling: [] };
    const hasBatData = (rows.batting || []).some((r) => Number(r.batting_balls || 0) > 0 || String(r.not_out || '') === 'false');
    return hasBatData ? rows.batting : (fallbackBattingRowsByInnings[inn] || []);
  }
  function getBowlingRowsForInnings(inn) {
    const rows = inningsRows[inn] || { batting: [], bowling: [] };
    const hasBowlData = (rows.bowling || []).some((r) => Number(r.bowling_balls || 0) > 0);
    return hasBowlData ? rows.bowling : (fallbackBowlingRowsByInnings[inn] || []);
  }

  function generateShareText(format) {
    const md = format === 'markdown';
    const ln = [];
    const hr = md ? '---' : '━'.repeat(56);
    const pad = (s, w, right) => { const str = String(s); return right ? str.padStart(w) : str.padEnd(w); };

    // Header
    const title = `${homeName} (${homeCountry}) vs ${awayName} (${awayCountry})`;
    ln.push(md ? `## ${title}` : title);
    ln.push(hr);
    if (scorecard?.match?.result_summary) ln.push(md ? `**${scorecard.match.result_summary}**` : scorecard.match.result_summary);
    ln.push(tossSummary);
    if (scorecard?.match?.player_of_match_name) ln.push(`Player of the Match: ${scorecard.match.player_of_match_name}`);
    ln.push('');

    // Per innings
    for (const inn of [1, 2]) {
      const meta = inningsMeta[inn];
      if (!meta) continue;
      const batRows = getBattingRowsForInnings(inn);
      const bowlRows = getBowlingRowsForInnings(inn).filter((r) => Number(r.bowling_balls || 0) > 0);

      ln.push(md ? `### Innings ${inn} — ${meta.battingName} ${meta.battingScore}` : `INNINGS ${inn} — ${meta.battingName}  ${meta.battingScore}`);
      ln.push('');

      // Batting
      if (md) {
        ln.push('| Batter | Dismissal | R | B | SR | 4s | 6s |');
        ln.push('|--------|-----------|--:|--:|---:|---:|---:|');
        for (const r of batRows) {
          const runs = Number(r.batting_runs || 0);
          const balls = Number(r.batting_balls || 0);
          const sr = balls ? ((runs / balls) * 100).toFixed(1) : '-';
          const isNO = r.not_out !== false && r.not_out !== 'false';
          const dis = isNO ? (balls > 0 ? 'not out' : 'DNB') : (r.dismissal_text || 'Out');
          const name = `${r.first_name} ${r.last_name}${isNO && balls > 0 ? '*' : ''}`;
          ln.push(`| ${name} | ${dis} | ${runs} | ${balls} | ${sr} | ${r.fours || 0} | ${r.sixes || 0} |`);
        }
      } else {
        ln.push(pad('Batter', 24) + pad('R', 5, true) + pad('B', 5, true) + pad('SR', 8, true) + pad('4s', 4, true) + pad('6s', 4, true));
        ln.push('-'.repeat(50));
        for (const r of batRows) {
          const runs = Number(r.batting_runs || 0);
          const balls = Number(r.batting_balls || 0);
          const sr = balls ? ((runs / balls) * 100).toFixed(1) : '-';
          const isNO = r.not_out !== false && r.not_out !== 'false';
          const name = `${r.first_name} ${r.last_name}${isNO && balls > 0 ? '*' : ''}`;
          const dis = isNO ? (balls > 0 ? 'not out' : 'DNB') : (r.dismissal_text || 'Out');
          ln.push(pad(name, 24) + pad(runs, 5, true) + pad(balls, 5, true) + pad(sr, 8, true) + pad(r.fours || 0, 4, true) + pad(r.sixes || 0, 4, true));
          if (!isNO && dis !== 'DNB') ln.push('  ' + dis);
        }
      }
      ln.push('');

      // Bowling
      if (bowlRows.length) {
        if (md) {
          ln.push('| Bowler | O | M | R | W | Econ |');
          ln.push('|--------|--:|--:|--:|--:|-----:|');
          for (const r of bowlRows) {
            const balls = Number(r.bowling_balls || 0);
            const overs = `${Math.floor(balls / 6)}.${balls % 6}`;
            const runs = Number(r.bowling_runs || 0);
            const econ = balls ? ((runs / balls) * 6).toFixed(1) : '-';
            ln.push(`| ${r.first_name} ${r.last_name} | ${overs} | ${r.maiden_overs || 0} | ${runs} | ${r.bowling_wickets || 0} | ${econ} |`);
          }
        } else {
          ln.push(pad('Bowler', 24) + pad('O', 6, true) + pad('M', 4, true) + pad('R', 5, true) + pad('W', 4, true) + pad('Econ', 7, true));
          ln.push('-'.repeat(50));
          for (const r of bowlRows) {
            const balls = Number(r.bowling_balls || 0);
            const overs = `${Math.floor(balls / 6)}.${balls % 6}`;
            const runs = Number(r.bowling_runs || 0);
            const econ = balls ? ((runs / balls) * 6).toFixed(1) : '-';
            ln.push(pad(`${r.first_name} ${r.last_name}`, 24) + pad(overs, 6, true) + pad(r.maiden_overs || 0, 4, true) + pad(runs, 5, true) + pad(r.bowling_wickets || 0, 4, true) + pad(econ, 7, true));
          }
        }
        ln.push('');
      }
      ln.push(hr);
      ln.push('');
    }

    // Full ball-by-ball commentary
    for (const inn of [1, 2]) {
      const overs = inningsCommentary[inn] || [];
      if (!overs.length) continue;
      const meta = inningsMeta[inn];
      ln.push(md ? `### Ball-by-Ball — Innings ${inn}` : `BALL-BY-BALL — INNINGS ${inn}`);
      ln.push('');
      // overs are stored newest-first, reverse for chronological
      const chronoOvers = [...overs].reverse();
      for (const ov of chronoOvers) {
        ln.push(md ? `**Over ${ov.over}** (${ov.overRuns} runs) — ${ov.closingLine}` : `Over ${ov.over}  (${ov.overRuns} runs)  ${ov.closingLine}`);
        // balls are stored newest-first inside each over, reverse them
        const chronoBalls = [...ov.balls].reverse();
        for (const ball of chronoBalls) {
          const chip = ball.result === 'W' ? 'W!' : ball.result === '•' ? '·' : ball.result;
          ln.push(`  ${ball.ballNo}  ${chip}  ${ball.text}`);
        }
        ln.push('');
      }
      ln.push(hr);
      ln.push('');
    }

    ln.push(md ? '*Generated by Global T20 Cricket Manager*' : '— Global T20 Cricket Manager');
    return ln.join('\n');
  }

  async function copyShare(format) {
    const text = generateShareText(format);
    try {
      await navigator.clipboard.writeText(text);
      setCopied(format);
      setTimeout(() => setCopied(''), 2000);
    } catch {
      // fallback
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      setCopied(format);
      setTimeout(() => setCopied(''), 2000);
    }
    setShareOpen(false);
  }

  function downloadScorecardPNG() {
    setShareOpen(false);
    const DPR = 2; // retina
    const COL = {
      bg: '#FAF8F4', surface: '#FFFFFF', border: '#E5E0D8',
      ink: '#2C2C2C', muted: '#8C8578', leaf: '#3E7F45',
      accent: '#FFAE47', danger: '#CC3737', cream: '#F2EDE4',
    };
    const FONT = (w, s) => `${w} ${s}px "Space Grotesk", "SF Pro Display", system-ui, sans-serif`;
    const BODY = (w, s) => `${w} ${s}px "Barlow", "SF Pro Text", system-ui, sans-serif`;

    // Gather data for both innings
    const innData = [1, 2].map((inn) => {
      const meta = inningsMeta[inn];
      const bat = getBattingRowsForInnings(inn);
      const bowl = getBowlingRowsForInnings(inn).filter((r) => Number(r.bowling_balls || 0) > 0);
      return { meta, bat, bowl };
    });

    // Measure canvas height
    const W = 900;
    const PAD = 32;
    const HEADER_H = 140;
    const INN_HEADER = 42;
    const ROW_H = 26;
    const SECTION_GAP = 20;
    const COL_GAP = 16;
    const FOOTER_H = 36;

    let totalH = PAD + HEADER_H + SECTION_GAP;
    for (const { bat, bowl } of innData) {
      totalH += INN_HEADER + (bat.length + 1) * ROW_H + SECTION_GAP + (bowl.length + 1) * ROW_H + SECTION_GAP;
    }
    totalH += FOOTER_H + PAD;

    const canvas = document.createElement('canvas');
    canvas.width = W * DPR;
    canvas.height = totalH * DPR;
    const ctx = canvas.getContext('2d');
    ctx.scale(DPR, DPR);

    // Background
    ctx.fillStyle = COL.bg;
    ctx.fillRect(0, 0, W, totalH);

    // Helper - rounded rect
    const rrect = (x, y, w, h, r) => {
      ctx.beginPath();
      ctx.moveTo(x + r, y);
      ctx.arcTo(x + w, y, x + w, y + h, r);
      ctx.arcTo(x + w, y + h, x, y + h, r);
      ctx.arcTo(x, y + h, x, y, r);
      ctx.arcTo(x, y, x + w, y, r);
      ctx.closePath();
    };

    let y = PAD;

    // ── HEADER CARD ──
    rrect(PAD, y, W - PAD * 2, HEADER_H, 14);
    ctx.fillStyle = COL.surface;
    ctx.fill();
    ctx.strokeStyle = COL.border;
    ctx.lineWidth = 1;
    ctx.stroke();

    const cx = W / 2;
    // Home
    ctx.fillStyle = winnerId === homeId ? COL.leaf : COL.ink;
    ctx.font = FONT('700', 18);
    ctx.textAlign = 'right';
    ctx.fillText(homeName, cx - 40, y + 36);
    ctx.font = FONT('400', 11);
    ctx.fillStyle = COL.muted;
    ctx.fillText(homeCountry.toUpperCase(), cx - 40, y + 52);
    ctx.font = FONT('800', 26);
    ctx.fillStyle = winnerId === homeId ? COL.leaf : COL.ink;
    ctx.fillText(homeScore, cx - 40, y + 84);

    // vs
    ctx.textAlign = 'center';
    ctx.font = FONT('600', 13);
    ctx.fillStyle = COL.muted;
    ctx.fillText('vs', cx, y + 44);

    // Away
    ctx.textAlign = 'left';
    ctx.fillStyle = winnerId === awayId ? COL.leaf : COL.ink;
    ctx.font = FONT('700', 18);
    ctx.fillText(awayName, cx + 40, y + 36);
    ctx.font = FONT('400', 11);
    ctx.fillStyle = COL.muted;
    ctx.fillText(awayCountry.toUpperCase(), cx + 40, y + 52);
    ctx.font = FONT('800', 26);
    ctx.fillStyle = winnerId === awayId ? COL.leaf : COL.ink;
    ctx.fillText(awayScore, cx + 40, y + 84);

    // Result
    ctx.textAlign = 'center';
    ctx.font = BODY('600', 12);
    ctx.fillStyle = COL.ink;
    if (scorecard?.match?.result_summary) {
      ctx.fillText(scorecard.match.result_summary, cx, y + 110);
    }
    ctx.font = BODY('400', 10);
    ctx.fillStyle = COL.muted;
    ctx.fillText(tossSummary, cx, y + 126);

    // POM badge
    if (scorecard?.match?.player_of_match_name) {
      ctx.font = BODY('600', 10);
      ctx.fillStyle = COL.accent;
      const pomText = `🏅 POM: ${scorecard.match.player_of_match_name}`;
      const pomW = ctx.measureText(pomText).width + 16;
      rrect(cx - pomW / 2, y + 6, pomW, 20, 6);
      ctx.fillStyle = 'rgba(255,174,71,0.12)';
      ctx.fill();
      ctx.fillStyle = COL.accent;
      ctx.font = BODY('600', 10);
      ctx.fillText(pomText, cx, y + 20);
    }

    y += HEADER_H + SECTION_GAP;

    // ── PER INNINGS ──
    for (const { meta, bat, bowl } of innData) {
      if (!meta) continue;
      const teamName = meta.battingName?.replace(/\s*\(.*\)/, '') || 'Team';

      // Inn header
      rrect(PAD, y, W - PAD * 2, INN_HEADER - 4, 10);
      ctx.fillStyle = COL.leaf;
      ctx.fill();
      ctx.textAlign = 'left';
      ctx.font = FONT('700', 14);
      ctx.fillStyle = '#fff';
      ctx.fillText(`${teamName}  ${meta.battingScore || ''}`, PAD + 14, y + 26);
      ctx.textAlign = 'right';
      ctx.font = FONT('400', 11);
      ctx.fillText(meta.battingVenueTag === 'H' ? 'HOME' : 'AWAY', W - PAD - 14, y + 26);
      y += INN_HEADER;

      // ── BATTING TABLE ──
      const batCols = [
        { label: 'BATTER', x: PAD + 10, align: 'left', w: 170 },
        { label: 'DISMISSAL', x: PAD + 180, align: 'left', w: 220 },
        { label: 'R', x: W - PAD - 210, align: 'right' },
        { label: 'B', x: W - PAD - 175, align: 'right' },
        { label: 'SR', x: W - PAD - 130, align: 'right' },
        { label: '4s', x: W - PAD - 80, align: 'right' },
        { label: '6s', x: W - PAD - 40, align: 'right' },
      ];

      // Header row
      ctx.fillStyle = COL.cream;
      ctx.fillRect(PAD, y, W - PAD * 2, ROW_H);
      ctx.font = FONT('700', 9);
      ctx.fillStyle = COL.muted;
      for (const col of batCols) {
        ctx.textAlign = col.align;
        ctx.fillText(col.label, col.x, y + 17);
      }
      y += ROW_H;

      for (let i = 0; i < bat.length; i++) {
        const r = bat[i];
        const runs = Number(r.batting_runs || 0);
        const balls = Number(r.batting_balls || 0);
        const sr = balls ? ((runs / balls) * 100).toFixed(1) : '-';
        const isNO = r.not_out !== false && r.not_out !== 'false';
        const dis = isNO ? (balls > 0 ? 'not out' : 'DNB') : (r.dismissal_text || 'Out');
        const name = `${r.first_name} ${r.last_name}${isNO && balls > 0 ? '*' : ''}`;
        const isTop = runs > 0 && runs === Math.max(...bat.map((b) => Number(b.batting_runs || 0)));

        // Row bg
        if (isTop) {
          ctx.fillStyle = 'rgba(62,127,69,0.07)';
          ctx.fillRect(PAD, y, W - PAD * 2, ROW_H);
        } else if (i % 2 === 0) {
          ctx.fillStyle = COL.surface;
          ctx.fillRect(PAD, y, W - PAD * 2, ROW_H);
        }

        // Divider
        ctx.strokeStyle = COL.border;
        ctx.lineWidth = 0.5;
        ctx.beginPath();
        ctx.moveTo(PAD, y + ROW_H);
        ctx.lineTo(W - PAD, y + ROW_H);
        ctx.stroke();

        // Name
        ctx.textAlign = 'left';
        ctx.font = BODY('600', 11);
        ctx.fillStyle = isTop ? COL.leaf : COL.ink;
        ctx.fillText(name.length > 22 ? name.slice(0, 20) + '…' : name, batCols[0].x, y + 17);
        // Dismissal
        ctx.font = BODY('400', 10);
        ctx.fillStyle = COL.muted;
        const disText = dis.length > 30 ? dis.slice(0, 28) + '…' : dis;
        ctx.fillText(disText, batCols[1].x, y + 17);
        // Nums
        ctx.font = FONT('600', 11);
        ctx.fillStyle = COL.ink;
        ctx.textAlign = 'right';
        ctx.fillText(String(runs), batCols[2].x, y + 17);
        ctx.fillStyle = COL.muted;
        ctx.fillText(String(balls), batCols[3].x, y + 17);
        ctx.fillText(String(sr), batCols[4].x, y + 17);
        ctx.fillText(String(r.fours || 0), batCols[5].x, y + 17);
        ctx.fillText(String(r.sixes || 0), batCols[6].x, y + 17);

        y += ROW_H;
      }

      y += SECTION_GAP / 2;

      // ── BOWLING TABLE ──
      if (bowl.length) {
        const bowlCols = [
          { label: 'BOWLER', x: PAD + 10, align: 'left', w: 170 },
          { label: 'O', x: W - PAD - 210, align: 'right' },
          { label: 'M', x: W - PAD - 170, align: 'right' },
          { label: 'R', x: W - PAD - 130, align: 'right' },
          { label: 'W', x: W - PAD - 80, align: 'right' },
          { label: 'ECON', x: W - PAD - 30, align: 'right' },
        ];

        ctx.fillStyle = COL.cream;
        ctx.fillRect(PAD, y, W - PAD * 2, ROW_H);
        ctx.font = FONT('700', 9);
        ctx.fillStyle = COL.muted;
        for (const col of bowlCols) {
          ctx.textAlign = col.align;
          ctx.fillText(col.label, col.x, y + 17);
        }
        y += ROW_H;

        for (let i = 0; i < bowl.length; i++) {
          const r = bowl[i];
          const balls = Number(r.bowling_balls || 0);
          const overs = `${Math.floor(balls / 6)}.${balls % 6}`;
          const runs = Number(r.bowling_runs || 0);
          const wkts = Number(r.bowling_wickets || 0);
          const econ = balls ? ((runs / balls) * 6).toFixed(1) : '-';
          const isBest = wkts > 0 && wkts === Math.max(...bowl.map((b) => Number(b.bowling_wickets || 0)));

          if (isBest) {
            ctx.fillStyle = 'rgba(62,127,69,0.07)';
            ctx.fillRect(PAD, y, W - PAD * 2, ROW_H);
          } else if (i % 2 === 0) {
            ctx.fillStyle = COL.surface;
            ctx.fillRect(PAD, y, W - PAD * 2, ROW_H);
          }

          ctx.strokeStyle = COL.border;
          ctx.lineWidth = 0.5;
          ctx.beginPath();
          ctx.moveTo(PAD, y + ROW_H);
          ctx.lineTo(W - PAD, y + ROW_H);
          ctx.stroke();

          const name = `${r.first_name} ${r.last_name}`;
          ctx.textAlign = 'left';
          ctx.font = BODY('600', 11);
          ctx.fillStyle = isBest ? COL.leaf : COL.ink;
          ctx.fillText(name.length > 22 ? name.slice(0, 20) + '…' : name, bowlCols[0].x, y + 17);
          ctx.font = FONT('600', 11);
          ctx.fillStyle = COL.ink;
          ctx.textAlign = 'right';
          ctx.fillText(overs, bowlCols[1].x, y + 17);
          ctx.fillStyle = COL.muted;
          ctx.fillText(String(r.maiden_overs || 0), bowlCols[2].x, y + 17);
          ctx.fillStyle = COL.ink;
          ctx.fillText(String(runs), bowlCols[3].x, y + 17);
          ctx.font = FONT('700', 11);
          ctx.fillStyle = isBest ? COL.leaf : COL.ink;
          ctx.fillText(String(wkts), bowlCols[4].x, y + 17);
          ctx.font = FONT('600', 11);
          ctx.fillStyle = COL.muted;
          ctx.fillText(econ, bowlCols[5].x, y + 17);

          y += ROW_H;
        }
      }

      y += SECTION_GAP;
    }

    // Footer
    ctx.textAlign = 'center';
    ctx.font = BODY('400', 10);
    ctx.fillStyle = COL.muted;
    ctx.fillText('Global T20 Cricket Manager', cx, y + 14);

    // Download
    const link = document.createElement('a');
    link.download = `scorecard-${homeName.replace(/\s+/g, '-')}-vs-${awayName.replace(/\s+/g, '-')}.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
  }

  if (loading) {
    return (
      <div className="sq-loading"><div className="sq-spinner" /><p>Loading match centre…</p></div>
    );
  }

  const activeMeta = inningsMeta[activeInnings];
  const activeRows = inningsRows[activeInnings] || { batting: [], bowling: [] };
  const activeBattingRows =
    (activeRows.batting || []).some((row) => Number(row.batting_balls || 0) > 0 || String(row.not_out || '') === 'false')
      ? activeRows.batting
      : fallbackBattingRowsByInnings[activeInnings] || [];
  const activeBowlingRows =
    (activeRows.bowling || []).some((row) => Number(row.bowling_balls || 0) > 0) ? activeRows.bowling : fallbackBowlingRowsByInnings[activeInnings] || [];
  const activeCommentary = inningsCommentary[activeInnings] || [];

  const matchStatus = String(scorecard?.match?.status || '').toUpperCase();
  const matchCompleted = matchStatus === 'COMPLETED';
  const isLive = matchStatus === 'LIVE' || simulating;

  const homeScore = scoreLabel(scorecard?.match?.home_score, scorecard?.match?.home_wickets, scorecard?.match?.home_balls);
  const awayScore = scoreLabel(scorecard?.match?.away_score, scorecard?.match?.away_wickets, scorecard?.match?.away_balls);
  const homeName = scorecard?.match?.home_name || 'Home';
  const awayName = scorecard?.match?.away_name || 'Away';
  const homeCountry = scorecard?.match?.home_country || '';
  const awayCountry = scorecard?.match?.away_country || '';
  const winnerId = Number(scorecard?.match?.winner_franchise_id || 0);
  const homeId = Number(scorecard?.match?.home_franchise_id || 0);
  const awayId = Number(scorecard?.match?.away_franchise_id || 0);

  let tossSummary = 'Toss pending';
  let tossWinnerMeta = null;
  if (scorecard?.match) {
    const hId = Number(scorecard.match.home_franchise_id || 0);
    const aId = Number(scorecard.match.away_franchise_id || 0);
    const tWin = Number(scorecard.match.toss_winner_franchise_id || 0);
    const tDec = String(scorecard.match.toss_decision || '').toUpperCase();
    if (tWin && (tDec === 'BAT' || tDec === 'BOWL')) {
      const tName = tWin === hId ? scorecard.match.home_name : tWin === aId ? scorecard.match.away_name : `Franchise ${tWin}`;
      const tCountry = tWin === hId ? scorecard.match.home_country : tWin === aId ? scorecard.match.away_country : '';
      tossSummary = `${tName} won toss, chose to ${tDec === 'BAT' ? 'bat' : 'bowl'}`;
      tossWinnerMeta = {
        id: tWin,
        name: tName,
        country: tCountry,
        decision: tDec
      };
    }
  }

  /* worm chart */
  const WormChart = () => {
    if (!series.innings1.length && !series.innings2.length) return null;
    const allVals = [...series.innings1, ...series.innings2].map((d) => d.value);
    const maxVal = Math.max(1, ...allVals);
    const maxOv = Math.max(1, ...series.innings1.map((d) => d.label), ...series.innings2.map((d) => d.label));
    const W = 500, H = 120, PX = 30, PY = 16;
    const toX = (ov) => PX + ((ov - 1) / Math.max(1, maxOv - 1)) * (W - PX * 2);
    const toY = (v) => H - PY - (v / maxVal) * (H - PY * 2);
    const makeLine = (data) => data.map((d) => `${toX(d.label).toFixed(1)},${toY(d.value).toFixed(1)}`).join(' ');
    const gridLines = [0, 0.25, 0.5, 0.75, 1].map((f) => Math.round(maxVal * f));
    return (
      <svg className="mc-worm" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet">
        {gridLines.map((v) => (
          <g key={v}>
            <line x1={PX} x2={W - PX} y1={toY(v)} y2={toY(v)} stroke="var(--border)" strokeWidth="0.5" />
            <text x={PX - 4} y={toY(v) + 3} textAnchor="end" fontSize="7" fill="var(--muted)">{v}</text>
          </g>
        ))}
        {series.innings1.length > 0 && <polyline points={makeLine(series.innings1)} fill="none" stroke="var(--leaf)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />}
        {series.innings2.length > 0 && <polyline points={makeLine(series.innings2)} fill="none" stroke="var(--accent)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />}
      </svg>
    );
  };

  return (
    <div className="mc-page sq-fade-in">

      {/* ── Back nav ── */}
      <button
        className="mc-back"
        onClick={() =>
          navigate(`/fixtures?${[seasonId ? `season=${seasonId}` : null, roundNo ? `round=${roundNo}` : null].filter(Boolean).join('&')}`)
        }
      >
        ← Back to Fixtures
      </button>

      {error && <div className="sq-error" style={{ marginBottom: '1rem' }}>{error}</div>}

      {/* ═══════════ HERO BANNER ═══════════ */}
      <div className={`mc-hero ${isLive ? 'mc-hero--live' : matchCompleted ? 'mc-hero--completed' : ''}`}>
        {isLive && <span className="mc-live-badge">● LIVE</span>}
        {matchCompleted && <span className="mc-status-badge">COMPLETED</span>}
        {!isLive && !matchCompleted && <span className="mc-status-badge">SCHEDULED</span>}

        <div className="mc-hero-teams">
          <div className={`mc-hero-team ${winnerId === homeId ? 'mc-hero-team--winner' : ''}`}>
            <TeamNameButton franchiseId={homeId} name={homeName} country={homeCountry} className="mc-hero-team-name">
              {homeName}
            </TeamNameButton>
            <span className="mc-hero-team-country">{homeCountry}</span>
            <span className="mc-hero-team-score">{homeScore}</span>
          </div>

          <div className="mc-hero-vs">vs</div>

          <div className={`mc-hero-team ${winnerId === awayId ? 'mc-hero-team--winner' : ''}`}>
            <TeamNameButton franchiseId={awayId} name={awayName} country={awayCountry} className="mc-hero-team-name">
              {awayName}
            </TeamNameButton>
            <span className="mc-hero-team-country">{awayCountry}</span>
            <span className="mc-hero-team-score">{awayScore}</span>
          </div>
        </div>

        <div className="mc-hero-meta">
          {matchCompleted && scorecard?.match?.result_summary && (
            <span className="mc-hero-result">{scorecard.match.result_summary}</span>
          )}
          <span className="mc-hero-toss">
            {tossWinnerMeta ? (
              <>
                🪙{' '}
                <TeamNameButton
                  franchiseId={tossWinnerMeta.id}
                  name={tossWinnerMeta.name}
                  country={tossWinnerMeta.country}
                  className="mc-inline-team-link"
                >
                  {tossWinnerMeta.name}
                </TeamNameButton>{' '}
                won toss, chose to {tossWinnerMeta.decision === 'BAT' ? 'bat' : 'bowl'}
              </>
            ) : (
              tossSummary
            )}
          </span>
          {scorecard?.match?.player_of_match_name && (
            <span className="mc-hero-pom">🏅 Player of the Match: <strong>{scorecard.match.player_of_match_name}</strong></span>
          )}
        </div>

        {/* Sim controls */}
        {!matchCompleted && (
          <div className="mc-hero-actions">
            <button className="sq-btn sq-btn--primary" disabled={!numericMatchId || simulating} onClick={runLive}>
              {simulating ? '● Simulating…' : '▶ Simulate Live'}
            </button>
            <button className="sq-btn" disabled={!numericMatchId || simulating} onClick={runInstant}>
              ⚡ Instant Result
            </button>
            {matchStatus === 'LIVE' && (
              <button className="sq-btn sq-btn--danger" disabled={simulating} onClick={resetMatch} title="Reset this stuck match back to Scheduled">
                ↺ Reset Match
              </button>
            )}
          </div>
        )}

        <div className="mc-hero-bottom">
          <div className="mc-hero-sync">
            <span className={`mc-sync-dot ${connected ? 'mc-sync-dot--on' : ''}`} />
            {connected ? 'Live sync connected' : 'Reconnecting…'}
          </div>

          {/* Share dropdown */}
          <div className="mc-share-wrap">
            <button className="mc-share-btn" onClick={() => setShareOpen((p) => !p)}>
              📋 Share Scorecard
            </button>
            {shareOpen && (
              <div className="mc-share-dropdown">
                <button className="mc-share-option" onClick={() => copyShare('plain')}>
                  📄 Copy as Plain Text
                  <span className="mc-share-hint">Discord, forums, chat</span>
                </button>
                <button className="mc-share-option" onClick={() => copyShare('markdown')}>
                  📝 Copy as Markdown
                  <span className="mc-share-hint">Reddit, GitHub, docs</span>
                </button>
                <hr className="mc-share-divider" />
                <button className="mc-share-option" onClick={downloadScorecardPNG}>
                  🖼️ Download as PNG
                  <span className="mc-share-hint">Image for forums, social media</span>
                </button>
              </div>
            )}
            {copied && <span className="mc-copied-toast">✓ Copied!</span>}
          </div>
        </div>
      </div>

      {/* ═══════════ INNINGS TABS ═══════════ */}
      <nav className="sq-tabs">
        {[1, 2].map((inn) => {
          const m = inningsMeta[inn];
          return (
            <button
              key={inn}
              className={`sq-tab${activeInnings === inn ? ' sq-tab--active' : ''}`}
              onClick={() => setActiveInnings(inn)}
            >
              <span className="mc-inn-label">
                {m?.battingName?.replace(/\s*\(.*\)/, '') || 'Team'}
                <small className="mc-inn-tag">{m?.battingVenueTag}</small>
              </span>
              <span className="mc-inn-score">{m?.battingScore || '-'}</span>
            </button>
          );
        })}
      </nav>

      {/* ═══════════ SCORECARD SECTION ═══════════ */}
      <div className="mc-two-col">
        {/* Batting */}
        <div className="mc-card">
          <h3 className="mc-section-title">
            🏏 Batting —{' '}
            <TeamNameButton
              franchiseId={activeMeta?.battingId}
              name={activeMeta?.battingName?.replace(/\s*\(.*\)/, '') || 'Team'}
              className="mc-inline-team-link"
            >
              {activeMeta?.battingName?.replace(/\s*\(.*\)/, '') || 'Team'}
            </TeamNameButton>
          </h3>
          {activeBattingRows.length === 0 ? (
            <div className="sq-empty">No batting data yet.</div>
          ) : (
            <div className="mc-table-wrap">
              <table className="mc-table">
                <thead>
                  <tr>
                    <th className="mc-th-name">Batter</th>
                    <th>Dismissal</th>
                    <th>R</th>
                    <th>B</th>
                    <th>SR</th>
                    <th>4s</th>
                    <th>6s</th>
                  </tr>
                </thead>
                <tbody>
                  {activeBattingRows.map((row) => {
                    const runs = Number(row.batting_runs || 0);
                    const balls = Number(row.batting_balls || 0);
                    const sr = balls ? ((runs / balls) * 100).toFixed(1) : '-';
                    const isNotOut = row.not_out !== false && row.not_out !== 'false';
                    const dismissal = isNotOut ? (balls > 0 ? 'not out' : 'DNB') : (row.dismissal_text || 'Out');
                    const isTopScorer = runs > 0 && runs === Math.max(...activeBattingRows.map((r) => Number(r.batting_runs || 0)));
                    return (
                      <tr key={row.player_id} className={isTopScorer ? 'mc-row--highlight' : ''}>
                        <td className="mc-td-name">
                          <span className="mc-batter-name">{row.first_name} {row.last_name}</span>
                          {isNotOut && balls > 0 && <span className="mc-not-out-badge">*</span>}
                        </td>
                        <td className="mc-td-dismissal">{dismissal}</td>
                        <td className="mc-td-num"><strong>{runs}</strong></td>
                        <td className="mc-td-num">{balls}</td>
                        <td className="mc-td-num">{sr}</td>
                        <td className="mc-td-num">{row.fours || 0}</td>
                        <td className="mc-td-num">{row.sixes || 0}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Bowling */}
        <div className="mc-card">
          <h3 className="mc-section-title">
            🎯 Bowling —{' '}
            <TeamNameButton
              franchiseId={activeMeta?.bowlingId}
              name={activeMeta?.bowlingName?.replace(/\s*\(.*\)/, '') || 'Team'}
              className="mc-inline-team-link"
            >
              {activeMeta?.bowlingName?.replace(/\s*\(.*\)/, '') || 'Team'}
            </TeamNameButton>
          </h3>
          {activeBowlingRows.length === 0 ? (
            <div className="sq-empty">No bowling data yet.</div>
          ) : (
            <div className="mc-table-wrap">
              <table className="mc-table">
                <thead>
                  <tr>
                    <th className="mc-th-name">Bowler</th>
                    <th>O</th>
                    <th>M</th>
                    <th>R</th>
                    <th>W</th>
                    <th>Econ</th>
                  </tr>
                </thead>
                <tbody>
                  {activeBowlingRows.filter((r) => Number(r.bowling_balls || 0) > 0).map((row) => {
                    const balls = Number(row.bowling_balls || 0);
                    const overs = `${Math.floor(balls / 6)}.${balls % 6}`;
                    const runs = Number(row.bowling_runs || 0);
                    const wkts = Number(row.bowling_wickets || 0);
                    const econ = balls ? ((runs / balls) * 6).toFixed(1) : '-';
                    const isBestBowler = wkts > 0 && wkts === Math.max(...activeBowlingRows.map((r) => Number(r.bowling_wickets || 0)));
                    return (
                      <tr key={row.player_id} className={isBestBowler ? 'mc-row--highlight' : ''}>
                        <td className="mc-td-name">{row.first_name} {row.last_name}</td>
                        <td className="mc-td-num">{overs}</td>
                        <td className="mc-td-num">{row.maiden_overs || 0}</td>
                        <td className="mc-td-num">{runs}</td>
                        <td className="mc-td-num"><strong>{wkts}</strong></td>
                        <td className="mc-td-num">{econ}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* ═══════════ WORM CHART ═══════════ */}
      {(series.innings1.length > 0 || series.innings2.length > 0) && (
        <div className="mc-card">
          <h3 className="mc-section-title">Runs Per Over — Worm</h3>
          <div className="mc-worm-wrap">
            <WormChart />
            <div className="mc-worm-legend">
              <span className="mc-worm-legend-item"><span className="mc-legend-dot" style={{ background: 'var(--leaf)' }} />Innings 1</span>
              <span className="mc-worm-legend-item"><span className="mc-legend-dot" style={{ background: 'var(--accent)' }} />Innings 2</span>
            </div>
          </div>
        </div>
      )}

      {/* ═══════════ COMMENTARY ═══════════ */}
      <div className="mc-card mc-commentary-card">
        <h3 className="mc-section-title">Ball-by-Ball — Innings {activeInnings}</h3>
        {activeCommentary.length === 0 ? (
          <div className="sq-empty">No commentary available yet.</div>
        ) : (
          <div className="mc-overs">
            {activeCommentary.map((overBlock) => (
              <details key={`inn-${activeInnings}-ov-${overBlock.over}`} className="mc-over-block" open={overBlock.over === activeCommentary[0]?.over}>
                <summary className="mc-over-header">
                  <span className="mc-over-num">Over {overBlock.over}</span>
                  <span className="mc-over-runs-badge">{overBlock.overRuns} runs</span>
                  <span className="mc-over-score">{overBlock.closingLine}</span>
                </summary>
                <div className="mc-over-detail">
                  <div className="mc-over-info">
                    <span className="mc-over-pressure">{overBlock.pressureLine}</span>
                    <span className="mc-over-batters">{overBlock.battersLine}</span>
                    <span className="mc-over-bowler">🎳 {overBlock.bowlerLine}</span>
                  </div>
                  <div className="mc-balls">
                    {overBlock.balls.map((ball) => {
                      const isWicket = ball.result === 'W';
                      const isBoundary = ball.result === '4' || ball.result === '6';
                      const isDot = ball.result === '•';
                      return (
                        <div key={ball.key} className={`mc-ball-line ${isWicket ? 'mc-ball-line--wicket' : ''}`}>
                          <span className="mc-ball-over-num">{ball.ballNo}</span>
                          <span className={`mc-ball-chip ${isWicket ? 'mc-ball-chip--W' : isBoundary ? 'mc-ball-chip--boundary' : isDot ? 'mc-ball-chip--dot' : 'mc-ball-chip--run'}`}>
                            {ball.result}
                          </span>
                          <span className="mc-ball-text">{ball.text}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </details>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
