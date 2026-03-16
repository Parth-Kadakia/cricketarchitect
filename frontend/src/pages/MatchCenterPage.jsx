import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api } from '../api/client';
import CountryLabel from '../components/CountryLabel';
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

function hashSeed(value) {
  const input = String(value || '');
  let hash = 0;
  for (let index = 0; index < input.length; index += 1) {
    hash = (hash * 31 + input.charCodeAt(index)) >>> 0;
  }
  return hash;
}

function seededBetween(seed, min, max) {
  const normalized = (Math.sin(seed) + 1) / 2;
  return min + normalized * (max - min);
}

function buildOverAnalytics(events) {
  const inningsMap = new Map([
    [1, new Map()],
    [2, new Map()]
  ]);

  const sorted = [...(events || [])].sort((a, b) => {
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

  for (const event of sorted) {
    const innings = Number(event.innings || 0);
    const over = Number(event.over_number || 0);
    if (!innings || !over || !inningsMap.has(innings)) {
      continue;
    }

    const overMap = inningsMap.get(innings);
    const row = overMap.get(over) || { over, runs: 0, wickets: 0, balls: 0 };
    row.runs += Number(event.runs || 0) + Number(event.extras || 0);
    row.balls += 1;
    if (Number(event.is_wicket)) {
      row.wickets += 1;
    }
    overMap.set(over, row);
  }

  function finalize(innings) {
    let cumulative = 0;
    let wickets = 0;
    return [...inningsMap.get(innings).values()]
      .sort((a, b) => a.over - b.over)
      .map((row) => {
        cumulative += Number(row.runs || 0);
        wickets += Number(row.wickets || 0);
        return {
          ...row,
          cumulative,
          cumulativeWickets: wickets
        };
      });
  }

  return {
    innings1: finalize(1),
    innings2: finalize(2)
  };
}

function normalizeBowlerStyleLabel(value) {
  const text = String(value || '').trim();
  if (!text) {
    return 'Seam';
  }
  return text
    .replace(/\s*Bowler\s*/gi, ' ')
    .replace(/\s*\(including Chinaman\)/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function inferShotSector(commentary, batsmanHand = 'Right', seed = 1) {
  const text = String(commentary || '').toLowerCase();
  const hand = String(batsmanHand || 'Right').toLowerCase() === 'left' ? 'left' : 'right';
  const mirrored = hand === 'left';

  const sectors = [
    { label: 'third man', angle: 145, match: /(third man|upper cut|ramp)/ },
    { label: 'point', angle: 112, match: /(point|cut|backward point|square cut)/ },
    { label: 'cover', angle: 58, match: /(cover|extra cover|inside out|mid-off)/ },
    { label: 'straight', angle: 0, match: /(straight|down the ground|long off|long on|mid on|mid off|drive)/ },
    { label: 'midwicket', angle: -48, match: /(midwicket|mid wicket|cow corner|long on|flick|leg side)/ },
    { label: 'square leg', angle: -92, match: /(square leg|pull|hook|deep square)/ },
    { label: 'fine leg', angle: -138, match: /(fine leg|glance|tickle|scoop|swept fine)/ }
  ];

  const matched = sectors.find((sector) => sector.match.test(text)) || sectors[hashSeed(`${text}:${seed}`) % sectors.length];
  let angle = matched.angle + seededBetween(seed * 0.37, -12, 12);
  if (mirrored) {
    angle *= -1;
  }
  return {
    label: matched.label,
    angle
  };
}

function buildShotMap(events, innings, playerStatsLookup) {
  const shots = [];
  for (const event of events || []) {
    if (Number(event.innings) !== Number(innings)) {
      continue;
    }
    const totalRuns = Number(event.runs || 0) + Number(event.extras || 0);
    if (!totalRuns || Number(event.extras || 0) >= totalRuns) {
      continue;
    }

    const strikerId = Number(event.striker_player_id || 0);
    const playerMeta = playerStatsLookup.get(strikerId) || {};
    const seed = hashSeed(`${event.id || 0}:${strikerId}:${totalRuns}`);
    const sector = inferShotSector(event.commentary, playerMeta.batsman_hand, seed);
    const radiusBase = totalRuns >= 6 ? 94 : totalRuns >= 4 ? 84 : totalRuns === 3 ? 68 : totalRuns === 2 ? 52 : 34;
    const radius = radiusBase + seededBetween(seed * 0.71, -6, 6);
    const angleRadians = (sector.angle * Math.PI) / 180;
    const x = 110 + Math.sin(angleRadians) * radius;
    const y = 110 - Math.cos(angleRadians) * radius;

    shots.push({
      id: event.id,
      runs: totalRuns,
      x,
      y,
      angle: sector.angle,
      label: sector.label,
      commentary: stripCommentaryPrefix(event.commentary)
    });
  }

  return shots;
}

function inferPitchZone(commentary, bowlerStyle, seed) {
  const text = String(commentary || '').toLowerCase();
  const style = String(bowlerStyle || '').toLowerCase();

  let x = seededBetween(seed * 0.11, 28, 72);
  let y = seededBetween(seed * 0.23, 18, 82);

  if (/outside off|wide outside off|left alone/.test(text)) x = seededBetween(seed * 0.31, 20, 35);
  if (/leg stump|middle and leg|pads|flick|leg side/.test(text)) x = seededBetween(seed * 0.41, 65, 82);
  if (/middle stump|straight|lbw/.test(text)) x = seededBetween(seed * 0.51, 45, 58);

  if (/yorker|very full|full toss|driven/.test(text)) y = seededBetween(seed * 0.61, 70, 90);
  else if (/short|bouncer|pull|hook/.test(text)) y = seededBetween(seed * 0.71, 8, 26);
  else if (/good length|back of a length|tight line/.test(text)) y = seededBetween(seed * 0.81, 38, 58);

  if (style.includes('spin')) {
    x += seededBetween(seed * 0.91, -8, 8);
    y = Math.min(88, Math.max(14, y + seededBetween(seed * 1.07, -10, 10)));
  }

  return {
    x: Math.max(14, Math.min(86, x)),
    y: Math.max(10, Math.min(90, y))
  };
}

function buildPitchMap(events, innings, playerStatsLookup) {
  return (events || [])
    .filter((event) => Number(event.innings) === Number(innings))
    .map((event) => {
      const bowlerId = Number(event.bowler_player_id || 0);
      const bowlerMeta = playerStatsLookup.get(bowlerId) || {};
      const seed = hashSeed(`${event.id || 0}:${bowlerId}:${event.over_number}.${event.ball_number}`);
      const zone = inferPitchZone(event.commentary, bowlerMeta.bowler_style, seed);
      const totalRuns = Number(event.runs || 0) + Number(event.extras || 0);
      return {
        id: event.id,
        x: zone.x,
        y: zone.y,
        result: Number(event.is_wicket) ? 'wicket' : Number(event.is_boundary) ? 'boundary' : totalRuns === 0 ? 'dot' : 'run',
        bowlerStyle: normalizeBowlerStyleLabel(bowlerMeta.bowler_style),
        commentary: stripCommentaryPrefix(event.commentary),
        overBall: `${event.over_number}.${event.ball_number}`
      };
    });
}

function buildFallbackFallOfWickets(events, innings, playerLookup) {
  const rows = [];
  let cumulativeRuns = 0;
  let wicketNo = 0;

  for (const event of (events || []).filter((row) => Number(row.innings) === Number(innings))) {
    cumulativeRuns += Number(event.runs || 0) + Number(event.extras || 0);
    const scoreFromCommentary = extractScoreFromCommentary(event.commentary);
    if (scoreFromCommentary) {
      cumulativeRuns = Number(scoreFromCommentary.runs || cumulativeRuns);
    }
    if (!Number(event.is_wicket)) {
      continue;
    }
    wicketNo += 1;
    const strikerId = Number(event.striker_player_id || 0);
    rows.push({
      wicket_no: wicketNo,
      score_at_fall: cumulativeRuns,
      over_label: `${event.over_number}.${event.ball_number}`,
      batter_name: playerLookup.get(strikerId) || 'Unknown Batter',
      dismissal_text: toDismissalText(event.commentary, playerLookup.get(strikerId) || '')
    });
  }

  return rows;
}

function buildFallbackPartnerships(events, innings, playerLookup) {
  const rows = [];
  const inningsEvents = (events || [])
    .filter((row) => Number(row.innings) === Number(innings))
    .sort((a, b) => {
      if (Number(a.over_number) !== Number(b.over_number)) {
        return Number(a.over_number) - Number(b.over_number);
      }
      if (Number(a.ball_number) !== Number(b.ball_number)) {
        return Number(a.ball_number) - Number(b.ball_number);
      }
      return Number(a.id || 0) - Number(b.id || 0);
    });

  let partnershipNo = 1;
  let current = null;

  for (const event of inningsEvents) {
    const strikerId = Number(event.striker_player_id || 0) || null;
    const nonStrikerId = Number(event.non_striker_player_id || 0) || null;
    if (!current) {
      current = {
        partnership_no: partnershipNo,
        runs: 0,
        balls: 0,
        batter_one_player_id: strikerId,
        batter_one_name: strikerId ? playerLookup.get(strikerId) || 'Unknown Batter' : null,
        batter_two_player_id: nonStrikerId,
        batter_two_name: nonStrikerId ? playerLookup.get(nonStrikerId) || 'Unknown Batter' : null
      };
    }

    current.runs += Number(event.runs || 0) + Number(event.extras || 0);
    current.balls += 1;

    if (Number(event.is_wicket)) {
      rows.push(current);
      partnershipNo += 1;
      current = null;
    }
  }

  if (current && Number(current.balls || 0) > 0) {
    rows.push(current);
  }

  return rows;
}

function buildBowlingSpells(events, innings, bowlingFranchiseId, playerLookup, playerStatsLookup) {
  const bowlers = new Map();

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

    const bowler = bowlers.get(bowlerId) || {
      bowlerId,
      name: playerLookup.get(bowlerId) || 'Unknown Bowler',
      style: normalizeBowlerStyleLabel(playerStatsLookup.get(bowlerId)?.bowler_style),
      overMap: new Map()
    };

    const overNo = Number(event.over_number || 0);
    const overLine = bowler.overMap.get(overNo) || { over: overNo, balls: 0, runs: 0, wickets: 0 };
    overLine.balls += 1;
    overLine.runs += Number(event.runs || 0) + Number(event.extras || 0);
    if (Number(event.is_wicket) && !String(event.commentary || '').toLowerCase().includes('run out')) {
      overLine.wickets += 1;
    }
    bowler.overMap.set(overNo, overLine);
    bowlers.set(bowlerId, bowler);
  }

  const spells = [];

  for (const bowler of bowlers.values()) {
    const overs = [...bowler.overMap.values()].sort((a, b) => a.over - b.over);
    let currentSpell = null;

    for (const overLine of overs) {
      if (!currentSpell || overLine.over !== currentSpell.endOver + 1) {
        if (currentSpell) {
          spells.push(currentSpell);
        }
        currentSpell = {
          bowlerId: bowler.bowlerId,
          bowlerName: bowler.name,
          style: bowler.style,
          startOver: overLine.over,
          endOver: overLine.over,
          overs: 1,
          balls: overLine.balls,
          runs: overLine.runs,
          wickets: overLine.wickets
        };
      } else {
        currentSpell.endOver = overLine.over;
        currentSpell.overs += 1;
        currentSpell.balls += overLine.balls;
        currentSpell.runs += overLine.runs;
        currentSpell.wickets += overLine.wickets;
      }
    }

    if (currentSpell) {
      spells.push(currentSpell);
    }
  }

  return spells.sort((a, b) => {
    if (a.startOver !== b.startOver) {
      return a.startOver - b.startOver;
    }
    return Number(b.wickets || 0) - Number(a.wickets || 0);
  });
}

function buildLinePath(data, width, height, maxOver, maxRuns) {
  if (!data.length) {
    return '';
  }
  const innerWidth = width - 56;
  const innerHeight = height - 38;
  return data
    .map((point, index) => {
      const x = 28 + (((Number(point.over) || index + 1) - 1) / Math.max(1, maxOver - 1 || 1)) * innerWidth;
      const y = height - 22 - (Number(point.cumulative || 0) / Math.max(1, maxRuns)) * innerHeight;
      return `${index === 0 ? 'M' : 'L'} ${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(' ');
}

function PremiumWormChart({ innings1 = [], innings2 = [] }) {
  if (!innings1.length && !innings2.length) {
    return <div className="sq-empty">No over progression available yet.</div>;
  }

  const width = 540;
  const height = 230;
  const maxOver = Math.max(1, ...innings1.map((row) => Number(row.over || 0)), ...innings2.map((row) => Number(row.over || 0)));
  const maxRuns = Math.max(20, ...innings1.map((row) => Number(row.cumulative || 0)), ...innings2.map((row) => Number(row.cumulative || 0)));
  const gridValues = [0, 0.25, 0.5, 0.75, 1].map((step) => Math.round(maxRuns * step));

  return (
    <div className="mc-premium-chart">
      <svg className="mc-premium-svg" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none">
        {gridValues.map((value) => {
          const y = height - 22 - (value / Math.max(1, maxRuns)) * (height - 38);
          return (
            <g key={value}>
              <line x1="28" x2={width - 28} y1={y} y2={y} className="mc-grid-line" />
              <text x="22" y={y + 4} className="mc-axis-label" textAnchor="end">{value}</text>
            </g>
          );
        })}
        {[...Array(maxOver)].map((_, index) => {
          const x = 28 + (index / Math.max(1, maxOver - 1 || 1)) * (width - 56);
          return <line key={`ov-${index + 1}`} x1={x} x2={x} y1="16" y2={height - 22} className="mc-grid-line mc-grid-line--vertical" />;
        })}

        {innings1.length > 0 && <path d={buildLinePath(innings1, width, height, maxOver, maxRuns)} className="mc-line mc-line--one" />}
        {innings2.length > 0 && <path d={buildLinePath(innings2, width, height, maxOver, maxRuns)} className="mc-line mc-line--two" />}

        {innings1.map((point) => {
          const x = 28 + ((Number(point.over) - 1) / Math.max(1, maxOver - 1 || 1)) * (width - 56);
          const y = height - 22 - (Number(point.cumulative || 0) / Math.max(1, maxRuns)) * (height - 38);
          return <circle key={`i1-${point.over}`} cx={x} cy={y} r="3.6" className="mc-point mc-point--one" />;
        })}
        {innings2.map((point) => {
          const x = 28 + ((Number(point.over) - 1) / Math.max(1, maxOver - 1 || 1)) * (width - 56);
          const y = height - 22 - (Number(point.cumulative || 0) / Math.max(1, maxRuns)) * (height - 38);
          return <circle key={`i2-${point.over}`} cx={x} cy={y} r="3.6" className="mc-point mc-point--two" />;
        })}

        {[...Array(maxOver)].map((_, index) => {
          const x = 28 + (index / Math.max(1, maxOver - 1 || 1)) * (width - 56);
          return <text key={`label-${index + 1}`} x={x} y={height - 8} className="mc-axis-label" textAnchor="middle">{index + 1}</text>;
        })}
      </svg>
      <div className="mc-chart-legend">
        <span className="mc-chart-legend-item"><span className="mc-chart-swatch mc-chart-swatch--one" />Innings 1 cumulative</span>
        <span className="mc-chart-legend-item"><span className="mc-chart-swatch mc-chart-swatch--two" />Innings 2 cumulative</span>
      </div>
    </div>
  );
}

function ManhattanChart({ innings1 = [], innings2 = [] }) {
  if (!innings1.length && !innings2.length) {
    return <div className="sq-empty">No over-by-over runs available yet.</div>;
  }

  const maxOver = Math.max(1, ...innings1.map((row) => Number(row.over || 0)), ...innings2.map((row) => Number(row.over || 0)));
  const maxRuns = Math.max(6, ...innings1.map((row) => Number(row.runs || 0)), ...innings2.map((row) => Number(row.runs || 0)));
  const byOverOne = new Map(innings1.map((row) => [Number(row.over), Number(row.runs || 0)]));
  const byOverTwo = new Map(innings2.map((row) => [Number(row.over), Number(row.runs || 0)]));

  return (
    <div className="mc-manhattan">
      {[...Array(maxOver)].map((_, index) => {
        const over = index + 1;
        const one = byOverOne.get(over) || 0;
        const two = byOverTwo.get(over) || 0;
        return (
          <div key={`man-${over}`} className="mc-manhattan-col">
            <div className="mc-manhattan-bars">
              <span className="mc-manhattan-bar mc-manhattan-bar--one" style={{ height: `${(one / maxRuns) * 100}%` }} title={`Innings 1: ${one}`} />
              <span className="mc-manhattan-bar mc-manhattan-bar--two" style={{ height: `${(two / maxRuns) * 100}%` }} title={`Innings 2: ${two}`} />
            </div>
            <span className="mc-manhattan-label">{over}</span>
          </div>
        );
      })}
      <div className="mc-chart-legend">
        <span className="mc-chart-legend-item"><span className="mc-chart-swatch mc-chart-swatch--one" />Innings 1 runs per over</span>
        <span className="mc-chart-legend-item"><span className="mc-chart-swatch mc-chart-swatch--two" />Innings 2 runs per over</span>
      </div>
    </div>
  );
}

function WagonWheelGraphic({ shots = [] }) {
  if (!shots.length) {
    return <div className="sq-empty">No scoring shots mapped yet.</div>;
  }

  return (
    <div className="mc-surface-chart">
      <svg className="mc-surface-svg" viewBox="0 0 220 220" preserveAspectRatio="xMidYMid meet">
        <circle cx="110" cy="110" r="98" className="mc-wheel-ring" />
        <circle cx="110" cy="110" r="70" className="mc-wheel-ring mc-wheel-ring--inner" />
        <circle cx="110" cy="110" r="42" className="mc-wheel-ring mc-wheel-ring--inner" />
        <line x1="110" y1="18" x2="110" y2="202" className="mc-wheel-axis" />
        <line x1="18" y1="110" x2="202" y2="110" className="mc-wheel-axis" />
        {shots.map((shot) => (
          <g key={shot.id}>
            <line
              x1="110"
              y1="110"
              x2={shot.x}
              y2={shot.y}
              className={`mc-shot-line mc-shot-line--${shot.runs >= 4 ? 'boundary' : 'run'}`}
            />
            <circle
              cx={shot.x}
              cy={shot.y}
              r={shot.runs >= 6 ? 4.5 : shot.runs >= 4 ? 4 : 3}
              className={`mc-shot-dot mc-shot-dot--${shot.runs >= 4 ? 'boundary' : 'run'}`}
            />
          </g>
        ))}
      </svg>
      <div className="mc-chart-caption">Scoring wagon wheel from simulated shot outcomes.</div>
    </div>
  );
}

function PitchMapGraphic({ deliveries = [] }) {
  if (!deliveries.length) {
    return <div className="sq-empty">No delivery map available yet.</div>;
  }

  return (
    <div className="mc-surface-chart">
      <svg className="mc-surface-svg" viewBox="0 0 220 260" preserveAspectRatio="xMidYMid meet">
        <rect x="54" y="20" width="112" height="220" rx="18" className="mc-pitch-body" />
        <rect x="84" y="30" width="52" height="200" rx="10" className="mc-pitch-strip" />
        <line x1="84" y1="86" x2="136" y2="86" className="mc-pitch-guide" />
        <line x1="84" y1="132" x2="136" y2="132" className="mc-pitch-guide" />
        <line x1="84" y1="178" x2="136" y2="178" className="mc-pitch-guide" />
        {deliveries.map((delivery) => (
          <circle
            key={delivery.id}
            cx={54 + ((delivery.x / 100) * 112)}
            cy={20 + ((delivery.y / 100) * 220)}
            r="4.1"
            className={`mc-pitch-dot mc-pitch-dot--${delivery.result}`}
          />
        ))}
      </svg>
      <div className="mc-chart-caption">Pitch map from simulated line and length zones.</div>
    </div>
  );
}

function PartnershipsGraph({ rows = [] }) {
  if (!rows.length) {
    return <div className="sq-empty">No partnership data yet.</div>;
  }

  const maxRuns = Math.max(1, ...rows.map((row) => Number(row.runs || 0)));
  return (
    <div className="mc-partnership-list">
      {rows.map((row) => {
        const label = [row.batter_one_name, row.batter_two_name].filter(Boolean).join(' + ') || `Partnership ${row.partnership_no}`;
        const contribution = [row.batter_one_name ? `${row.batter_one_name} ${row.batter_one_runs || 0}` : null, row.batter_two_name ? `${row.batter_two_name} ${row.batter_two_runs || 0}` : null]
          .filter(Boolean)
          .join(' • ');
        return (
          <div key={`part-${row.partnership_no}`} className="mc-partnership-row">
            <div className="mc-partnership-head">
              <div className="mc-partnership-copy">
                <span className="mc-partnership-name">{label}</span>
                {contribution ? <span className="mc-partnership-copyline">{contribution}</span> : null}
              </div>
              <span className="mc-partnership-meta">{row.runs} runs • {row.balls} balls</span>
            </div>
            <div className="mc-partnership-bar">
              <span className="mc-partnership-fill" style={{ width: `${(Number(row.runs || 0) / maxRuns) * 100}%` }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function FallOfWicketsStrip({ wickets = [], totalRuns = 0 }) {
  if (!wickets.length) {
    return <div className="sq-empty">No wickets fell in this innings.</div>;
  }

  const denominator = Math.max(1, totalRuns, ...wickets.map((row) => Number(row.score_at_fall || 0)));
  return (
    <div className="mc-fow-strip">
      <div className="mc-fow-line" />
      {wickets.map((row) => {
        const left = `${(Number(row.score_at_fall || 0) / denominator) * 100}%`;
        return (
          <div key={`fow-${row.wicket_no}-${row.score_at_fall}`} className="mc-fow-node" style={{ left }}>
            <span className="mc-fow-badge">{row.wicket_no}</span>
            <div className="mc-fow-node-card">
              <strong>{row.score_at_fall}/{row.wicket_no}</strong>
              <span>{row.batter_name || 'Batter'}</span>
              <small>{row.over_label || ''}</small>
            </div>
          </div>
        );
      })}
    </div>
  );
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
      const [scorecardResponse, eventsResponse] = await Promise.all([api.league.scorecard(token, numericMatchId), api.league.events(token, numericMatchId)]);
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
        const [eventsResponse, scorecardResponse] = await Promise.all([api.league.events(token, numericMatchId), api.league.scorecard(token, numericMatchId)]);
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

  const playerStatsLookup = useMemo(() => {
    const map = new Map();
    for (const row of scorecard?.stats || []) {
      map.set(Number(row.player_id), row);
    }
    return map;
  }, [scorecard]);

  const overAnalytics = useMemo(() => buildOverAnalytics(eventRows), [eventRows]);
  const innings1Runs = useMemo(() => {
    const values = overAnalytics.innings1;
    return Number(values[values.length - 1]?.cumulative || 0);
  }, [overAnalytics.innings1]);

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

  const activeShotMap = useMemo(
    () => buildShotMap(eventRows, activeInnings, playerStatsLookup),
    [eventRows, activeInnings, playerStatsLookup]
  );

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

  const fallbackFallOfWicketsByInnings = useMemo(
    () => ({
      1: buildFallbackFallOfWickets(eventRows, 1, playerLookup),
      2: buildFallbackFallOfWickets(eventRows, 2, playerLookup)
    }),
    [eventRows, playerLookup]
  );

  const fallbackPartnershipsByInnings = useMemo(
    () => ({
      1: buildFallbackPartnerships(eventRows, 1, playerLookup),
      2: buildFallbackPartnerships(eventRows, 2, playerLookup)
    }),
    [eventRows, playerLookup]
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
    const bb = format === 'bbcode';
    const ln = [];
    const hr = md ? '---' : bb ? '' : '━'.repeat(56);
    const pad = (s, w, right) => { const str = String(s); return right ? str.padStart(w) : str.padEnd(w); };

    // Header
    const title = `${homeName} (${homeCountry}) vs ${awayName} (${awayCountry})`;
    if (bb) {
      ln.push(`[size=5][b]${title}[/b][/size]`);
    } else {
      ln.push(md ? `## ${title}` : title);
    }
    if (!bb) ln.push(hr);
    if (scorecard?.match?.result_summary) {
      ln.push(bb ? `[b][color=green]${scorecard.match.result_summary}[/color][/b]` : md ? `**${scorecard.match.result_summary}**` : scorecard.match.result_summary);
    }
    ln.push(tossSummary);
    if (scorecard?.match?.player_of_match_name) {
      ln.push(bb ? `[b]Player of the Match:[/b] ${scorecard.match.player_of_match_name}` : `Player of the Match: ${scorecard.match.player_of_match_name}`);
    }
    ln.push('');

    // Per innings
    for (const inn of [1, 2]) {
      const meta = inningsMeta[inn];
      if (!meta) continue;
      const batRows = getBattingRowsForInnings(inn);
      const bowlRows = getBowlingRowsForInnings(inn).filter((r) => Number(r.bowling_balls || 0) > 0);

      if (bb) {
        ln.push(`[size=4][b]Innings ${inn} — ${meta.battingName} ${meta.battingScore}[/b][/size]`);
      } else {
        ln.push(md ? `### Innings ${inn} — ${meta.battingName} ${meta.battingScore}` : `INNINGS ${inn} — ${meta.battingName}  ${meta.battingScore}`);
      }
      ln.push('');

      // Batting
      if (bb) {
        ln.push('[table]');
        ln.push('[tr][th]Batter[/th][th]Dismissal[/th][th]R[/th][th]B[/th][th]SR[/th][th]4s[/th][th]6s[/th][/tr]');
        for (const r of batRows) {
          const runs = Number(r.batting_runs || 0);
          const balls = Number(r.batting_balls || 0);
          const sr = balls ? ((runs / balls) * 100).toFixed(1) : '-';
          const isNO = r.not_out !== false && r.not_out !== 'false';
          const dis = isNO ? (balls > 0 ? 'not out' : 'DNB') : (r.dismissal_text || 'Out');
          const name = `${r.first_name} ${r.last_name}${isNO && balls > 0 ? '*' : ''}`;
          const isTop = runs > 0 && runs === Math.max(...batRows.map((b) => Number(b.batting_runs || 0)));
          const nameCell = isTop ? `[b][color=green]${name}[/color][/b]` : name;
          const runsCell = isTop ? `[b]${runs}[/b]` : String(runs);
          ln.push(`[tr][td]${nameCell}[/td][td]${dis}[/td][td]${runsCell}[/td][td]${balls}[/td][td]${sr}[/td][td]${r.fours || 0}[/td][td]${r.sixes || 0}[/td][/tr]`);
        }
        ln.push('[/table]');
      } else if (md) {
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
        if (bb) {
          ln.push('[table]');
          ln.push('[tr][th]Bowler[/th][th]O[/th][th]M[/th][th]R[/th][th]W[/th][th]Econ[/th][/tr]');
          for (const r of bowlRows) {
            const balls = Number(r.bowling_balls || 0);
            const overs = `${Math.floor(balls / 6)}.${balls % 6}`;
            const runs = Number(r.bowling_runs || 0);
            const wkts = Number(r.bowling_wickets || 0);
            const econ = balls ? ((runs / balls) * 6).toFixed(1) : '-';
            const isBest = wkts > 0 && wkts === Math.max(...bowlRows.map((b) => Number(b.bowling_wickets || 0)));
            const nameCell = isBest ? `[b][color=green]${r.first_name} ${r.last_name}[/color][/b]` : `${r.first_name} ${r.last_name}`;
            const wktsCell = isBest ? `[b]${wkts}[/b]` : String(wkts);
            ln.push(`[tr][td]${nameCell}[/td][td]${overs}[/td][td]${r.maiden_overs || 0}[/td][td]${runs}[/td][td]${wktsCell}[/td][td]${econ}[/td][/tr]`);
          }
          ln.push('[/table]');
        } else if (md) {
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
      if (!bb) ln.push(hr);
      ln.push('');
    }

    // Full ball-by-ball commentary
    for (const inn of [1, 2]) {
      const overs = inningsCommentary[inn] || [];
      if (!overs.length) continue;
      const meta = inningsMeta[inn];
      if (bb) {
        ln.push(`[size=4][b]Ball-by-Ball — Innings ${inn}[/b][/size]`);
      } else {
        ln.push(md ? `### Ball-by-Ball — Innings ${inn}` : `BALL-BY-BALL — INNINGS ${inn}`);
      }
      ln.push('');
      // overs are stored newest-first, reverse for chronological
      const chronoOvers = [...overs].reverse();
      for (const ov of chronoOvers) {
        if (bb) {
          ln.push(`[b]Over ${ov.over}[/b] (${ov.overRuns} runs) — ${ov.closingLine}`);
        } else {
          ln.push(md ? `**Over ${ov.over}** (${ov.overRuns} runs) — ${ov.closingLine}` : `Over ${ov.over}  (${ov.overRuns} runs)  ${ov.closingLine}`);
        }
        // balls are stored newest-first inside each over, reverse them
        const chronoBalls = [...ov.balls].reverse();
        for (const ball of chronoBalls) {
          const chip = ball.result === 'W' ? 'W!' : ball.result === '•' ? '·' : ball.result;
          if (bb) {
            const chipBB = ball.result === 'W' ? '[color=red][b]W![/b][/color]' :
              (ball.result === '4' || ball.result === '6') ? `[color=blue][b]${ball.result}[/b][/color]` :
              ball.result === '•' ? '[color=gray]·[/color]' : chip;
            ln.push(`  ${ball.ballNo}  ${chipBB}  ${ball.text}`);
          } else {
            ln.push(`  ${ball.ballNo}  ${chip}  ${ball.text}`);
          }
        }
        ln.push('');
      }
      if (!bb) ln.push(hr);
      ln.push('');
    }

    if (bb) {
      ln.push('[i]Generated by Global T20 Cricket Manager[/i]');
    } else {
      ln.push(md ? '*Generated by Global T20 Cricket Manager*' : '— Global T20 Cricket Manager');
    }
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
  const activeOverAnalytics = activeInnings === 1 ? overAnalytics.innings1 : overAnalytics.innings2;
  const activeTotalRuns = Number(activeOverAnalytics[activeOverAnalytics.length - 1]?.cumulative || 0);
  const activePartnershipRows = (() => {
    const fallbackRows = fallbackPartnershipsByInnings[activeInnings] || [];
    const rows = (scorecard?.partnerships || []).filter((row) => Number(row.innings) === Number(activeInnings));
    if (!rows.length) {
      return fallbackRows;
    }
    return rows.map((row, index) => {
      const fallback = fallbackRows.find((candidate) => Number(candidate.partnership_no) === Number(row.partnership_no)) || fallbackRows[index] || {};
      return {
        ...fallback,
        ...row,
        batter_one_name: row.batter_one_name || fallback.batter_one_name || null,
        batter_two_name: row.batter_two_name || fallback.batter_two_name || null,
        batter_one_runs: row.batter_one_runs || fallback.batter_one_runs || 0,
        batter_two_runs: row.batter_two_runs || fallback.batter_two_runs || 0
      };
    });
  })();
  const activeFallOfWickets = (() => {
    const rows = (scorecard?.fall_of_wickets || []).filter((row) => Number(row.innings) === Number(activeInnings));
    return rows.length ? rows : fallbackFallOfWicketsByInnings[activeInnings] || [];
  })();

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
            <span className="mc-hero-team-country"><CountryLabel country={homeCountry} /></span>
            <span className="mc-hero-team-score">{homeScore}</span>
          </div>

          <div className="mc-hero-vs">vs</div>

          <div className={`mc-hero-team ${winnerId === awayId ? 'mc-hero-team--winner' : ''}`}>
            <TeamNameButton franchiseId={awayId} name={awayName} country={awayCountry} className="mc-hero-team-name">
              {awayName}
            </TeamNameButton>
            <span className="mc-hero-team-country"><CountryLabel country={awayCountry} /></span>
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
                <button className="mc-share-option" onClick={() => copyShare('bbcode')}>
                  📋 Copy as BB Code
                  <span className="mc-share-hint">Forums (phpBB, vBulletin, XenForo)</span>
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

      <div className="mc-premium-grid">
        <div className="mc-card mc-card--premium mc-card--span-2">
          <div className="mc-card-head">
            <div>
              <h3 className="mc-section-title">Match Momentum</h3>
              <p className="mc-section-subtitle">Cumulative worm and over-by-over Manhattan comparison across both innings.</p>
            </div>
          </div>
          <div className="mc-chart-stack">
            <PremiumWormChart innings1={overAnalytics.innings1} innings2={overAnalytics.innings2} />
            <ManhattanChart innings1={overAnalytics.innings1} innings2={overAnalytics.innings2} />
          </div>
        </div>

        <div className="mc-card mc-card--premium">
          <div className="mc-card-head">
            <div>
              <h3 className="mc-section-title">Wagon Wheel</h3>
              <p className="mc-section-subtitle">{activeMeta?.battingName?.replace(/\s*\(.*\)/, '') || 'Batting side'} scoring zones</p>
            </div>
          </div>
          <WagonWheelGraphic shots={activeShotMap} />
        </div>

        <div className="mc-card mc-card--premium">
          <div className="mc-card-head">
            <div>
              <h3 className="mc-section-title">Partnerships</h3>
              <p className="mc-section-subtitle">Built innings phases and stand values for innings {activeInnings}.</p>
            </div>
          </div>
          <PartnershipsGraph rows={activePartnershipRows} />
        </div>
      </div>

      <div className="mc-card mc-card--premium mc-fow-card">
        <div className="mc-card-head">
          <div>
            <h3 className="mc-section-title">Fall of Wickets</h3>
            <p className="mc-section-subtitle">Dismissal checkpoints across innings {activeInnings}.</p>
          </div>
          <span className="mc-headline-chip">{activeTotalRuns || 0} total</span>
        </div>
        <FallOfWicketsStrip wickets={activeFallOfWickets} totalRuns={activeTotalRuns} />
      </div>

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
