import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api } from '../api/client';
import DualLineChart from '../components/DualLineChart';
import Panel from '../components/Panel';
import ScorecardTable from '../components/ScorecardTable';
import { useAuth } from '../context/AuthContext';
import { useSocket } from '../context/SocketContext';

function oversFromBalls(balls) {
  const complete = Math.floor(Number(balls || 0) / 6);
  const rem = Number(balls || 0) % 6;
  return `${complete}.${rem}`;
}

function scoreLabel(runs, wickets, balls) {
  if (runs == null) {
    return '-';
  }

  return `${runs}/${wickets} (${oversFromBalls(balls)})`;
}

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
    });

    const offOverSummary = subscribe('match:over_summary', async (message) => {
      if (Number(message.payload?.matchId) !== Number(numericMatchId)) {
        return;
      }

      try {
        const [eventsResponse, scorecardResponse] = await Promise.all([api.league.events(numericMatchId), api.league.scorecard(numericMatchId)]);
        setEventRows(eventsResponse.events || []);
        setScorecard(scorecardResponse);
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
        setEventRows(message.payload.events || []);
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
    });

    return () => {
      offStart();
      offTick();
      offOverSummary();
      offComplete();
      offError();
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

  const fallbackBowlingRowsByInnings = useMemo(
    () => ({
      1: buildFallbackBowlingRows(eventRows, 1, inningsMeta[1]?.bowlingId, playerLookup),
      2: buildFallbackBowlingRows(eventRows, 2, inningsMeta[2]?.bowlingId, playerLookup)
    }),
    [eventRows, inningsMeta, playerLookup]
  );

  if (loading) {
    return <div className="loading-state">Loading match center...</div>;
  }

  const activeMeta = inningsMeta[activeInnings];
  const activeRows = inningsRows[activeInnings] || { batting: [], bowling: [] };
  const activeBowlingRows =
    (activeRows.bowling || []).some((row) => Number(row.bowling_balls || 0) > 0) ? activeRows.bowling : fallbackBowlingRowsByInnings[activeInnings] || [];
  const activeCommentary = inningsCommentary[activeInnings] || [];
  const inningsOneLabel = `Innings 1 - ${inningsMeta[1]?.battingName || 'Team'} (${inningsMeta[1]?.battingVenueTag || '?'}) - ${inningsMeta[1]?.battingScore || '-'}`;
  const inningsTwoLabel = `Innings 2 - ${inningsMeta[2]?.battingName || 'Team'} (${inningsMeta[2]?.battingVenueTag || '?'}) - ${inningsMeta[2]?.battingScore || '-'}`;

  let tossSummary = 'Toss pending';
  if (scorecard?.match) {
    const homeId = Number(scorecard.match.home_franchise_id || 0);
    const awayId = Number(scorecard.match.away_franchise_id || 0);
    const tossWinnerId = Number(scorecard.match.toss_winner_franchise_id || 0);
    const tossDecision = String(scorecard.match.toss_decision || '').toUpperCase();

    if (tossWinnerId && (tossDecision === 'BAT' || tossDecision === 'BOWL')) {
      const tossWinnerName =
        tossWinnerId === homeId
          ? `${scorecard.match.home_name} (${scorecard.match.home_country || '-'})`
          : tossWinnerId === awayId
            ? `${scorecard.match.away_name} (${scorecard.match.away_country || '-'})`
            : `Franchise ${tossWinnerId}`;
      tossSummary = `${tossWinnerName} won the toss and chose to ${tossDecision === 'BAT' ? 'bat' : 'bowl'} first.`;
    }
  }

  return (
    <div className="page-grid">
      {error ? <p className="error-text full-width">{error}</p> : null}

      <Panel
        title={
          scorecard?.match
            ? `${scorecard.match.home_name} (${scorecard.match.home_country || '-'}) vs ${scorecard.match.away_name} (${scorecard.match.away_country || '-'})`
            : `Match #${numericMatchId}`
        }
        className="full-width"
        actions={
          <div className="row-actions">
            <button
              type="button"
              className="button ghost"
              onClick={() =>
                navigate(`/fixtures?${[seasonId ? `season=${seasonId}` : null, roundNo ? `round=${roundNo}` : null].filter(Boolean).join('&')}`)
              }
            >
              Back To Season Center
            </button>
            <button className="button" type="button" disabled={!numericMatchId || simulating} onClick={runLive}>
              {simulating ? 'Live Simulation...' : 'Simulate Live'}
            </button>
            <button className="button secondary" type="button" disabled={!numericMatchId || simulating} onClick={runInstant}>
              Simulate Instant
            </button>
          </div>
        }
      >
        {scorecard?.match ? (
          <div className="inline-metrics">
            <p>
              Result: <strong>{scorecard.match.result_summary || 'Pending'}</strong>
            </p>
            <p>
              Toss: <strong>{tossSummary}</strong>
            </p>
            <p>
              Live Sync: <strong>{connected ? 'Connected' : 'Reconnecting...'}</strong>
            </p>
            <p>
              <strong>{inningsOneLabel}</strong>
            </p>
            <p>
              <strong>{inningsTwoLabel}</strong>
            </p>
            <p>
              Player of Match: <strong>{scorecard.match.player_of_match_name || 'TBD'}</strong>
            </p>
          </div>
        ) : (
          <div className="empty-state">Match details unavailable.</div>
        )}
      </Panel>

      <Panel title="Innings" className="full-width">
        <div className="match-tabs">
          <button type="button" className={`match-tab-btn ${activeInnings === 1 ? 'active' : ''}`} onClick={() => setActiveInnings(1)}>
            {inningsOneLabel}
          </button>
          <button type="button" className={`match-tab-btn ${activeInnings === 2 ? 'active' : ''}`} onClick={() => setActiveInnings(2)}>
            {inningsTwoLabel}
          </button>
        </div>
      </Panel>

      <Panel title={`Batting Scorecard - ${activeMeta?.battingName || 'Team'}`}>
        <ScorecardTable rows={activeRows.batting} mode="batting" />
      </Panel>

      <Panel title={`Bowling Scorecard - ${activeMeta?.bowlingName || 'Team'}`}>
        <ScorecardTable rows={activeBowlingRows} mode="bowling" />
      </Panel>

      <Panel title="Runs Per Over Comparison" className="full-width">
        <DualLineChart innings1={series.innings1} innings2={series.innings2} />
      </Panel>

      <Panel title={`Ball-by-Ball Commentary - Innings ${activeInnings}`} className="full-width">
        {!activeCommentary.length ? (
          <div className="empty-state">No commentary available for this innings yet.</div>
        ) : (
          <div className="innings-commentary">
            {activeCommentary.map((overBlock) => (
              <article key={`innings-${activeInnings}-over-${overBlock.over}`} className="over-block">
                <div className="over-summary">
                  <strong>{overBlock.summaryTitle}</strong>
                  <small>{overBlock.pressureLine}</small>
                  <small>{overBlock.closingLine}</small>
                  <small>{overBlock.battersLine}</small>
                  <small>{overBlock.bowlerLine}</small>
                </div>
                {overBlock.balls.map((ball) => (
                  <div key={ball.key} className="ball-line">
                    <span className="ball-no">{ball.ballNo}</span>
                    <span className="ball-result">{ball.result}</span>
                    <p className="ball-text">{ball.text}</p>
                  </div>
                ))}
              </article>
            ))}
          </div>
        )}
      </Panel>
    </div>
  );
}
