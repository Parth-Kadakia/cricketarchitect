import env from '../config/env.js';

const VALID_PITCH = ['good', 'cracked', 'dusty', 'damp', 'green', 'flat', 'dead', 'dry', 'wet', 'sticky', 'bouncy', 'Astro Turf', 'Grass', 'Matting'];
const VALID_WEATHER = ['clear', 'overcast', 'humid', 'drizzle', 'windy', 'hot', 'cold', 'Sunny', 'Rainy', 'Cloudy'];
const VALID_WIND = ['none', 'light', 'moderate', 'strong', 'gusting'];
const VALID_TIME = ['day', 'day_night', 'night'];
const VALID_GROUND = ['Short', 'Medium', 'Large'];
const VALID_INNING_PART = ['PowerPlay', 'Middle', 'Death'];
const VALID_FORMAT = ['T20', 'ODI', 'Test', 'T10', 'The100', 'Five5'];
const VALID_BATSMAN_TYPE = ['Aggressive', 'Defensive', 'Balanced', 'Anchor', 'Finisher'];
const VALID_HAND = ['Left', 'Right'];
const VALID_BOWLER_STYLE = [
  'Fast Bowler (Express Pace)',
  'Fast Bowler (Swing)',
  'Medium Fast (Seam)',
  'Medium Fast (Cutters)',
  'Spin Bowler (Off Spin)',
  'Spin Bowler (Leg Spin)',
  'Spin Bowler (Left-arm Orthodox)',
  'Spin Bowler (Left-arm Wrist Spin)',
  'Spin Bowler (Mystery Spin)'
];
const VALID_BOWLER_MENTALITY = ['Wicket Taker', 'Economy', 'Balanced', 'Aggressive', 'Defensive'];
const VALID_MATCH_PITCH = ['good', 'average', 'poor'];
const VALID_MATCH_WEATHER = ['clear', 'overcast'];
const VALID_MATCH_WIND = ['calm', 'moderate', 'windy'];
const VALID_MATCH_GROUND = ['Short', 'Long'];
const VALID_MATCH_FORMAT = ['T10', 'Five5', 'T20', 'ODI', 'Test'];
const VALID_MATCH_BATSMAN_TYPE = ['Aggressive', 'Balanced', 'Defensive', 'Accumulator', 'Tail ender'];
const VALID_MATCH_BOWLER_STYLE = [
  'Fast Bowler (Express Pace)',
  'Fast-Medium Bowler',
  'Swing Bowler',
  'Medium Pace Bowler (Seam Bowler)',
  'Off-Spin Bowler',
  'Leg-Spin Bowler (including Chinaman)',
  'Slow Left-Arm Orthodox'
];
const VALID_MATCH_BOWLER_MENTALITY = ['Wicket Taker', 'Economical', 'Powerplay Specialist', 'Death Over Specialist'];

function clampInt(value, min, max, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, Math.round(parsed)));
}

function normalizeAllowed(value, validValues, fallback) {
  if (value == null) {
    return fallback;
  }

  const raw = String(value).trim();
  if (!raw) {
    return fallback;
  }

  const exact = validValues.find((item) => item === raw);
  if (exact) {
    return exact;
  }

  const lower = raw.toLowerCase();
  const loose = validValues.find((item) => item.toLowerCase() === lower);
  return loose || fallback;
}

function sanitizeName(value, fallback) {
  const safe = String(value || '')
    .replace(/[^A-Za-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60);

  return safe || fallback;
}

function mapInningPart(phase) {
  if (phase === 'POWERPLAY') {
    return 'PowerPlay';
  }
  if (phase === 'DEATH') {
    return 'Death';
  }
  return 'Middle';
}

function deriveHandFromId(playerId) {
  return Number(playerId || 0) % 4 === 0 ? 'Left' : 'Right';
}

function batsmanType(player, phase) {
  if (phase === 'DEATH' && Number(player.batting) >= 72) {
    return 'Finisher';
  }
  if (Number(player.batting) >= 78 && Number(player.temperament) <= 55) {
    return 'Aggressive';
  }
  if (Number(player.temperament) >= 74) {
    return 'Anchor';
  }
  if (Number(player.temperament) <= 45) {
    return 'Defensive';
  }
  return 'Balanced';
}

function bowlerStyle(player) {
  if (String(player.role || '').includes('BOWLER') && Number(player.bowling) >= 75 && Number(player.fitness) >= 70) {
    return 'Fast Bowler (Express Pace)';
  }
  if (Number(player.bowling) >= 70) {
    return 'Fast Bowler (Swing)';
  }
  if (Number(player.bowling) >= 62) {
    return 'Medium Fast (Seam)';
  }
  return 'Spin Bowler (Off Spin)';
}

function bowlerMentality(player, phase) {
  if (phase === 'DEATH') {
    return 'Aggressive';
  }
  if (Number(player.bowling) >= 78) {
    return 'Wicket Taker';
  }
  if (Number(player.temperament) >= 70) {
    return 'Economy';
  }
  return 'Balanced';
}

function mapPitchForMatch(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) {
    return 'good';
  }
  if (['good', 'green', 'flat', 'bouncy'].includes(normalized)) {
    return 'good';
  }
  if (['average', 'dusty', 'dry', 'damp'].includes(normalized)) {
    return 'average';
  }
  return 'poor';
}

function mapWeatherForMatch(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (['overcast', 'cloudy', 'drizzle', 'rainy'].includes(normalized)) {
    return 'overcast';
  }
  return 'clear';
}

function mapWindForMatch(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (['windy', 'strong', 'gusting'].includes(normalized)) {
    return 'windy';
  }
  if (normalized === 'none' || normalized === 'calm') {
    return 'calm';
  }
  return 'moderate';
}

function mapGroundForMatch(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'large' || normalized === 'long') {
    return 'Long';
  }
  return 'Short';
}

function deriveMatchBatsmanType(player) {
  const role = String(player.role || '').toUpperCase();
  const batting = Number(player.batting || 0);
  const temperament = Number(player.temperament || 50);

  if (role === 'BOWLER' && batting < 40) {
    return 'Tail ender';
  }
  if (batting >= 78 && temperament <= 58) {
    return 'Aggressive';
  }
  if (temperament >= 72) {
    return 'Accumulator';
  }
  if (batting <= 45) {
    return 'Defensive';
  }
  return 'Balanced';
}

function deriveMatchBowlerStyle(player) {
  const role = String(player.role || '').toUpperCase();
  const bowling = Number(player.bowling || 0);
  const fitness = Number(player.fitness || 50);
  const hand = deriveHandFromId(player.id);

  if (role !== 'BOWLER' && role !== 'ALL_ROUNDER' && bowling < 52) {
    return 'Medium Pace Bowler (Seam Bowler)';
  }
  if (bowling >= 80 && fitness >= 70) {
    return 'Fast Bowler (Express Pace)';
  }
  if (bowling >= 72 && fitness >= 65) {
    return 'Fast-Medium Bowler';
  }
  if (bowling >= 67) {
    return 'Swing Bowler';
  }
  if (bowling >= 62) {
    return hand === 'Left' ? 'Slow Left-Arm Orthodox' : 'Off-Spin Bowler';
  }
  if (bowling >= 56) {
    return hand === 'Left' ? 'Slow Left-Arm Orthodox' : 'Leg-Spin Bowler (including Chinaman)';
  }
  return 'Medium Pace Bowler (Seam Bowler)';
}

function deriveMatchBowlerMentality(player) {
  const bowling = Number(player.bowling || 0);
  const temperament = Number(player.temperament || 50);
  const fitness = Number(player.fitness || 50);
  if (bowling >= 78) {
    return 'Wicket Taker';
  }
  if (fitness >= 72 && bowling >= 64) {
    return 'Death Over Specialist';
  }
  if (temperament >= 70) {
    return 'Economical';
  }
  return 'Powerplay Specialist';
}

function capBowlerRatingByRole(player) {
  const role = String(player.role || '').toUpperCase();
  const bowling = clampInt(Number(player.bowling || 0), 0, 100, 50);

  if (role === 'WICKET_KEEPER') {
    return 0;
  }
  if (role === 'BATTER') {
    return Math.min(16, bowling);
  }
  if (role === 'ALL_ROUNDER') {
    return Math.min(88, Math.max(22, bowling));
  }

  return bowling;
}

function mapDismissal(wicketTypeRaw = '') {
  const wicketType = String(wicketTypeRaw || '').trim().toLowerCase();
  if (wicketType.includes('lbw')) {
    return 'lbw';
  }
  if (wicketType.includes('run')) {
    return 'run out';
  }
  if (wicketType.includes('catch')) {
    return 'caught';
  }
  return 'bowled';
}

function toApiPayload({ striker, bowler, context, strikerBalls }) {
  const battingPhase = context.phase || 'MIDDLE';
  const batsmanRating = Math.round(
    Number(striker.batting) * 0.64 + Number(striker.form) * 0.18 + Number(striker.temperament) * 0.1 + Number(striker.fitness) * 0.08
  );
  const bowlerRating = Math.round(
    Number(bowler.bowling) * 0.67 + Number(bowler.form) * 0.14 + Number(bowler.temperament) * 0.07 + Number(bowler.fitness) * 0.12
  );

  const batsmanFatigue = Math.min(100, Math.round(Math.max(0, 100 - Number(striker.fitness) + Number(strikerBalls || 0) * 0.8)));
  const bowlerFatigue = Math.min(100, Math.round(Math.max(0, 100 - Number(bowler.fitness) + Number(context.bowlerBalls || 0) * 1.1)));
  const resolvedBatsmanHand = normalizeAllowed(context.batsmanHand || deriveHandFromId(striker.id), VALID_HAND, 'Right');
  const resolvedBowlerHand = normalizeAllowed(context.bowlerHand || deriveHandFromId(bowler.id), VALID_HAND, 'Right');
  const resolvedBowlerStyle = normalizeAllowed(context.bowlerStyle || bowlerStyle(bowler), VALID_BOWLER_STYLE, 'Fast Bowler (Express Pace)');
  const resolvedBatsmanType = normalizeAllowed(context.batsmanType || batsmanType(striker, battingPhase), VALID_BATSMAN_TYPE, 'Balanced');
  const resolvedBowlerMentality = normalizeAllowed(
    context.bowlerMentality || bowlerMentality(bowler, battingPhase),
    VALID_BOWLER_MENTALITY,
    'Wicket Taker'
  );

  return {
    ball_number: clampInt(
      context.ballNumber != null ? context.ballNumber : Number(context.deliveriesBowled || 0) + 1,
      1,
      600,
      1
    ),
    batsman_name: sanitizeName(`${striker.first_name} ${striker.last_name}`, 'Batsman'),
    bowler_name: sanitizeName(`${bowler.first_name} ${bowler.last_name}`, 'Bowler'),
    batsman_rating: clampInt(batsmanRating, 0, 100, 50),
    bowler_rating: clampInt(bowlerRating, 0, 100, 50),
    batsman_fatigue: clampInt(batsmanFatigue, 0, 100, 0),
    bowler_fatigue: clampInt(bowlerFatigue, 0, 100, 0),
    pitch_conditions: normalizeAllowed(context.pitchConditions, VALID_PITCH, 'good'),
    weather_conditions: normalizeAllowed(context.weatherConditions, VALID_WEATHER, 'clear'),
    wind_conditions: normalizeAllowed(context.windConditions, VALID_WIND, 'moderate'),
    time_of_day: normalizeAllowed(context.timeOfDay, VALID_TIME, 'day'),
    ground_size: normalizeAllowed(context.groundSize, VALID_GROUND, 'Short'),
    chasing_target: Boolean(context.target != null),
    inning_part: normalizeAllowed(mapInningPart(battingPhase), VALID_INNING_PART, 'PowerPlay'),
    format_type: normalizeAllowed(context.formatType, VALID_FORMAT, 'T20'),
    wickets_left: clampInt(10 - Number(context.wickets || 0), 0, 10, 10),
    deliveries_bowled: clampInt(context.deliveriesBowled, 0, 600, 0),
    batsman_type: resolvedBatsmanType,
    batsman_hand: resolvedBatsmanHand,
    bowler_hand: resolvedBowlerHand,
    bowler_style: resolvedBowlerStyle,
    bowler_mentality: resolvedBowlerMentality,
    balls_faced_by_batsman: clampInt(strikerBalls, 0, 600, 0),
    dot_pressure: Math.max(0, Math.min(1, Number(context.dotPressure || 0))),
    boundary_momentum: Math.max(0, Math.min(1, Number(context.boundaryMomentum || 0))),
    target: context.target != null ? clampInt(Number(context.target) + 1, 1, 2000, 1) : null,
    total_runs: clampInt(context.totalRuns, 0, 2000, 0),
    total_overs: clampInt(context.totalOvers, 1, 100, 20),
    wickets_fallen: clampInt(context.wickets, 0, 10, 0),
    over_number: clampInt(context.overNumber, 1, 100, 1)
  };
}

function normalizeResponse({ response }) {
  const runs = Math.max(0, Number(response?.runs || 0));
  const isExtra = Boolean(response?.is_extra);
  const wicket = Boolean(response?.wicket);
  const batsmanRuns = Math.max(0, Number(response?.batsman_runs ?? runs));
  const dismissalType = wicket ? mapDismissal(response?.wicket_type || response?.outcome || '') : null;
  const commentary = String(response?.commentary || '').trim() || null;

  return {
    runs,
    batsmanRuns,
    wicket,
    dismissalType,
    eventType: isExtra ? 'EXTRA' : wicket ? 'WICKET' : 'RUN',
    commentary
  };
}

function normalizePlayerName(player, fallbackPrefix = 'Player') {
  return sanitizeName(`${player.first_name || ''} ${player.last_name || ''}`.trim(), fallbackPrefix);
}

function deriveTeamStrengthLabel(teamPlayers = []) {
  if (!Array.isArray(teamPlayers) || !teamPlayers.length) {
    return 'Batting';
  }

  const totals = teamPlayers.reduce(
    (acc, player) => {
      acc.batting += Number(player.batting || 0);
      acc.bowling += Number(player.bowling || 0);
      return acc;
    },
    { batting: 0, bowling: 0 }
  );

  return totals.batting >= totals.bowling ? 'Batting' : 'Bowling';
}

function buildMatchPlayerPayload(player, index = 0) {
  const role = String(player.role || '').toUpperCase();
  const batting = clampInt(Number(player.batting || 0), 0, 100, 50);
  const bowling = capBowlerRatingByRole(player);
  const hand = normalizeAllowed(deriveHandFromId(Number(player.id || index + 1)), VALID_HAND, 'Right');
  const bowlerStyle =
    role === 'WICKET_KEEPER'
      ? 'Off-Spin Bowler'
      : normalizeAllowed(deriveMatchBowlerStyle(player), VALID_MATCH_BOWLER_STYLE, 'Medium Pace Bowler (Seam Bowler)');
  const bowlerMentality =
    role === 'WICKET_KEEPER' || role === 'BATTER'
      ? 'Economical'
      : normalizeAllowed(deriveMatchBowlerMentality(player), VALID_MATCH_BOWLER_MENTALITY, 'Wicket Taker');

  return {
    name: normalizePlayerName(player, `Player ${index + 1}`),
    batsman_rating: batting,
    bowler_rating: bowling,
    batsman_type: normalizeAllowed(deriveMatchBatsmanType(player), VALID_MATCH_BATSMAN_TYPE, 'Balanced'),
    batsman_hand: hand,
    bowler_style: bowlerStyle,
    bowler_hand: hand,
    bowler_mentality: bowlerMentality
  };
}

function buildSimulateMatchPayload({ team1Name, team2Name, team1Players, team2Players, context = {} }) {
  const pitchConditions = normalizeAllowed(mapPitchForMatch(context.pitchConditions), VALID_MATCH_PITCH, 'good');
  const weatherConditions = normalizeAllowed(mapWeatherForMatch(context.weatherConditions), VALID_MATCH_WEATHER, 'clear');
  const windConditions = normalizeAllowed(mapWindForMatch(context.windConditions), VALID_MATCH_WIND, 'moderate');
  const groundSize = normalizeAllowed(mapGroundForMatch(context.groundSize), VALID_MATCH_GROUND, 'Short');
  const formatType = normalizeAllowed(context.formatType || 'T20', VALID_MATCH_FORMAT, 'T20');
  const overs = clampInt(context.totalOvers ?? context.overs ?? 20, 1, 100, 20);
  const maxSpell = clampInt(context.maxSpell ?? (overs >= 20 ? 4 : 2), 1, 10, overs >= 20 ? 4 : 2);

  const homePlayers = (team1Players || []).map((player, index) => buildMatchPlayerPayload(player, index)).slice(0, 11);
  const awayPlayers = (team2Players || []).map((player, index) => buildMatchPlayerPayload(player, index)).slice(0, 11);

  return {
    team1: {
      name: sanitizeName(team1Name, 'Team 1'),
      players: homePlayers
    },
    team2: {
      name: sanitizeName(team2Name, 'Team 2'),
      players: awayPlayers
    },
    match_settings: {
      overs,
      format_type: formatType,
      pitch_conditions: pitchConditions,
      weather_conditions: weatherConditions,
      wind_conditions: windConditions,
      time_of_day: normalizeAllowed(context.timeOfDay === 'night' ? 'night' : 'day', ['day', 'night'], 'day'),
      ground_size: groundSize,
      max_spell: maxSpell
    },
    toss: {
      // Runtime currently expects strength labels for toss logic (.lower() is called server-side).
      team1_strength: deriveTeamStrengthLabel(team1Players),
      team2_strength: deriveTeamStrengthLabel(team2Players),
      boundaries: groundSize,
      dew_factor: context.timeOfDay === 'night' || context.timeOfDay === 'day_night' ? 'Moderate' : 'None',
      pitch_condition: pitchConditions,
      weather_condition: weatherConditions
    }
  };
}

export async function simulateBallViaStreetApi({ striker, bowler, context, strikerBalls }) {
  if (!env.streetCricketBallApiEnabled) {
    return null;
  }

  if (!env.streetCricketApiBaseUrl || !env.streetCricketApiKeys.length) {
    return null;
  }

  const apiKey = env.streetCricketApiKeys[Number(context.deliveriesBowled || 0) % env.streetCricketApiKeys.length];
  if (!apiKey) {
    return null;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), env.streetCricketRequestTimeoutMs);

  try {
    const payload = toApiPayload({ striker, bowler, context, strikerBalls });
    const response = await fetch(`${env.streetCricketApiBaseUrl.replace(/\/+$/, '')}/simulate_ball`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': apiKey
      },
      body: JSON.stringify(payload),
      signal: controller.signal
    });

    if (!response.ok) {
      return null;
    }

    const data = await response.json();
    return normalizeResponse({ response: data });
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function simulateTossViaStreetApi({ team1Name, team2Name, context }) {
  if (!env.streetCricketBallApiEnabled) {
    return null;
  }

  if (!env.streetCricketApiBaseUrl || !env.streetCricketApiKeys.length) {
    return null;
  }

  const apiKey = env.streetCricketApiKeys[0];
  if (!apiKey) {
    return null;
  }

  const payload = {
    team1: sanitizeName(team1Name, 'Team 1'),
    team2: sanitizeName(team2Name, 'Team 2'),
    team1_strength: context.team1Strength || 'Batting',
    team2_strength: context.team2Strength || 'Bowling',
    boundaries: normalizeAllowed(context.groundSize, VALID_GROUND, 'Short'),
    dew_factor: context.timeOfDay === 'night' || context.timeOfDay === 'day_night' ? 'Yes' : 'No',
    pitch_condition: normalizeAllowed(context.pitchConditions, VALID_PITCH, 'good'),
    weather_condition: normalizeAllowed(context.weatherConditions, VALID_WEATHER, 'clear')
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), env.streetCricketRequestTimeoutMs);

  try {
    const response = await fetch(`${env.streetCricketApiBaseUrl.replace(/\/+$/, '')}/toss`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': apiKey
      },
      body: JSON.stringify(payload),
      signal: controller.signal
    });

    if (!response.ok) {
      return null;
    }

    const data = await response.json();
    const tossWon = String(data?.TossWon || '').trim();
    const decisionRaw = String(data?.TossDecision || '').trim().toLowerCase();
    const decision = decisionRaw.includes('bowl') || decisionRaw.includes('field') ? 'BOWL' : 'BAT';

    return {
      tossWinnerName: tossWon || null,
      tossDecision: decision,
      tossCommentary: String(data?.TossCommentary || '').trim() || null
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function simulateMatchViaStreetApi({
  team1Name,
  team2Name,
  team1Players = [],
  team2Players = [],
  context = {}
}) {
  if (!env.streetCricketFullMatchApiEnabled) {
    return null;
  }

  if (!env.streetCricketApiBaseUrl || !env.streetCricketApiKeys.length) {
    return null;
  }

  if (!team1Players.length || !team2Players.length) {
    return null;
  }

  const apiKey = env.streetCricketApiKeys[Number(context.roundSeed || 0) % env.streetCricketApiKeys.length] || env.streetCricketApiKeys[0];
  if (!apiKey) {
    return null;
  }

  const payload = buildSimulateMatchPayload({
    team1Name,
    team2Name,
    team1Players,
    team2Players,
    context
  });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(env.streetCricketRequestTimeoutMs, 12000));

  try {
    const endpoint = `${env.streetCricketApiBaseUrl.replace(/\/+$/, '')}/simulate_match`;
    console.log('[StreetCricket] /simulate_match payload\n', JSON.stringify(payload, null, 2));

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': apiKey
      },
      body: JSON.stringify(payload),
      signal: controller.signal
    });

    if (!response.ok) {
      let errorBody = '';
      try {
        errorBody = await response.text();
      } catch {
        errorBody = '';
      }
      console.error(`[StreetCricket] /simulate_match failed (${response.status}) ${response.statusText}${errorBody ? `: ${errorBody}` : ''}`);
      return null;
    }

    const data = await response.json();
    if (!data || !data.first_innings || !data.second_innings || !data.match_summary) {
      return null;
    }

    return data;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
