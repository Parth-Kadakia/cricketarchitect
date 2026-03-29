import env from '../config/env.js';
import {
  resolveStoredBatsmanType,
  resolveStoredBowlerMentality,
  resolveStoredBowlerStyle,
  resolveStoredHand,
  toBallApiBatsmanType,
  toBallApiBowlerMentality,
  toBallApiBowlerStyle
} from './playerTacticsService.js';

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
  if (normalized === 'short') {
    return 'Short';
  }
  if (normalized === 'medium' || normalized === 'large' || normalized === 'long') {
    return 'Long';
  }
  return 'Long';
}

function tuneBattingRating(player) {
  const role = String(player.role || '').toUpperCase();
  const raw = clampInt(Number(player.batting || 0), 0, 100, 50);

  if (role === 'BOWLER') {
    return clampInt(Math.round(raw * 0.5), 0, 100, 50);
  }
  if (role === 'WICKET_KEEPER') {
    return clampInt(Math.round(raw * 0.74), 0, 100, 50);
  }
  if (role === 'ALL_ROUNDER') {
    return clampInt(Math.round(raw * 0.78), 0, 100, 50);
  }
  return clampInt(Math.round(raw * 0.82), 0, 100, 50);
}

function tuneBowlingRating(player) {
  const role = String(player.role || '').toUpperCase();
  const base = capBowlerRatingByRole(player);

  if (role === 'WICKET_KEEPER' || role === 'BATTER') {
    return 0;
  }
  if (role === 'ALL_ROUNDER') {
    return clampInt(Math.round(base * 1.14 + 6), 0, 100, 50);
  }
  return clampInt(Math.round(base * 1.24 + 10), 0, 100, 50);
}

function capBowlerRatingByRole(player) {
  const role = String(player.role || '').toUpperCase();
  const bowling = clampInt(Number(player.bowling || 0), 0, 100, 50);

  if (role === 'WICKET_KEEPER') {
    return 0;
  }
  if (role === 'BATTER') {
    return Math.min(1, bowling);
  }
  if (role === 'ALL_ROUNDER') {
    return Math.min(84, Math.max(20, bowling));
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
  const strikerStoredHand = resolveStoredHand(striker, 'batsman_hand');
  const bowlerStoredHand = resolveStoredHand(bowler, 'bowler_hand');
  const resolvedBatsmanHand = normalizeAllowed(context.batsmanHand || strikerStoredHand, VALID_HAND, 'Right');
  const resolvedBowlerHand = normalizeAllowed(context.bowlerHand || bowlerStoredHand, VALID_HAND, 'Right');
  const resolvedBowlerStyle = normalizeAllowed(
    context.bowlerStyle || toBallApiBowlerStyle(resolveStoredBowlerStyle(bowler)),
    VALID_BOWLER_STYLE,
    'Medium Fast (Seam)'
  );
  const resolvedBatsmanType = normalizeAllowed(
    context.batsmanType || toBallApiBatsmanType(resolveStoredBatsmanType(striker)),
    VALID_BATSMAN_TYPE,
    'Balanced'
  );
  const resolvedBowlerMentality = normalizeAllowed(
    context.bowlerMentality || toBallApiBowlerMentality(resolveStoredBowlerMentality(bowler)),
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
  const rawRuns = Math.max(0, Number(response?.runs || 0));
  const isExtra = Boolean(response?.is_extra);
  let wicket = Boolean(response?.wicket);
  const rawBatsmanRuns = Math.max(0, Number(response?.batsman_runs ?? rawRuns));
  // A wicket delivery cannot also score runs for the batsman (except run-outs
  // where the batters completed a run, but the API doesn't model that reliably).
  // When the API returns both wicket=true and runs>0 it is a data conflict —
  // force runs to 0 on a genuine wicket so the scorecard stays consistent.
  const runs = wicket ? 0 : rawRuns;
  const batsmanRuns = wicket ? 0 : rawBatsmanRuns;
  const dismissalType = wicket ? mapDismissal(response?.wicket_type || response?.outcome || '') : null;
  // Discard API commentary when it conflicts with the resolved outcome — the
  // engine will regenerate accurate commentary via buildCommentary().
  const commentary = wicket && rawRuns > 0 ? null : (String(response?.commentary || '').trim() || null);

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
  const batting = tuneBattingRating(player);
  const bowling = tuneBowlingRating(player);
  const batsmanHand = normalizeAllowed(resolveStoredHand(player, 'batsman_hand'), VALID_HAND, 'Right');
  const bowlerHand = normalizeAllowed(resolveStoredHand(player, 'bowler_hand'), VALID_HAND, batsmanHand);
  const bowlerStyle = normalizeAllowed(
    resolveStoredBowlerStyle(player),
    VALID_MATCH_BOWLER_STYLE,
    role === 'WICKET_KEEPER' ? 'Off-Spin Bowler' : 'Medium Pace Bowler (Seam Bowler)'
  );
  const bowlerMentality = normalizeAllowed(
    resolveStoredBowlerMentality(player),
    VALID_MATCH_BOWLER_MENTALITY,
    role === 'BATTER' || role === 'WICKET_KEEPER' ? 'Economical' : 'Wicket Taker'
  );

  return {
    name: normalizePlayerName(player, `Player ${index + 1}`),
    batsman_rating: batting,
    bowler_rating: bowling,
    batsman_type: normalizeAllowed(resolveStoredBatsmanType(player), VALID_MATCH_BATSMAN_TYPE, 'Balanced'),
    batsman_hand: batsmanHand,
    bowler_style: bowlerStyle,
    bowler_hand: bowlerHand,
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

  const allPlayers = [...homePlayers, ...awayPlayers];
  const avgBatting = allPlayers.length
    ? allPlayers.reduce((sum, player) => sum + Number(player.batsman_rating || 0), 0) / allPlayers.length
    : 50;
  const avgBowling = allPlayers.length
    ? allPlayers.reduce((sum, player) => sum + Number(player.bowler_rating || 0), 0) / allPlayers.length
    : 50;
  const battingAdvantage = avgBatting - avgBowling;

  const adjustedPitch =
    battingAdvantage >= 5 ? 'poor' : battingAdvantage >= 2 ? 'average' : pitchConditions;
  const adjustedGround =
    battingAdvantage >= 3 ? 'Long' : groundSize;
  const adjustedWeather =
    battingAdvantage >= 3 ? 'overcast' : weatherConditions;
  const adjustedWind =
    battingAdvantage >= 3 ? 'windy' : windConditions;

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
      pitch_conditions: adjustedPitch,
      weather_conditions: adjustedWeather,
      wind_conditions: adjustedWind,
      time_of_day: normalizeAllowed(context.timeOfDay === 'night' ? 'night' : 'day', ['day', 'night'], 'day'),
      ground_size: adjustedGround,
      max_spell: maxSpell
    },
    toss: {
      // Runtime currently expects strength labels for toss logic (.lower() is called server-side).
      team1_strength: deriveTeamStrengthLabel(team1Players),
      team2_strength: deriveTeamStrengthLabel(team2Players),
      boundaries: adjustedGround,
      dew_factor: context.timeOfDay === 'night' || context.timeOfDay === 'day_night' ? 'Moderate' : 'None',
      pitch_condition: adjustedPitch,
      weather_condition: adjustedWeather
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
