import { weightedChoice } from '../utils/gameMath.js';

export const STORED_BATSMAN_TYPES = ['Aggressive', 'Defensive', 'Balanced', 'Accumulator', 'Tail ender'];
export const STORED_HANDS = ['Left', 'Right'];
export const STORED_BOWLER_STYLES = [
  'Fast Bowler (Express Pace)',
  'Fast-Medium Bowler',
  'Swing Bowler',
  'Medium Pace Bowler (Seam Bowler)',
  'Off-Spin Bowler',
  'Leg-Spin Bowler (including Chinaman)',
  'Slow Left-Arm Orthodox'
];
export const STORED_BOWLER_MENTALITIES = ['Wicket Taker', 'Economical', 'Powerplay Specialist', 'Death Over Specialist'];

const MATCH_BATSMAN_ALIASES = {
  anchor: 'Accumulator',
  finisher: 'Aggressive',
  accumulator: 'Accumulator',
  'tail ender': 'Tail ender',
  tailender: 'Tail ender'
};

const BALL_BATSMAN_TYPE_MAP = {
  Aggressive: 'Aggressive',
  Defensive: 'Defensive',
  Balanced: 'Balanced',
  Accumulator: 'Anchor',
  'Tail ender': 'Defensive'
};

const BALL_BOWLER_STYLE_MAP = {
  'Fast Bowler (Express Pace)': 'Fast Bowler (Express Pace)',
  'Fast-Medium Bowler': 'Medium Fast (Seam)',
  'Swing Bowler': 'Fast Bowler (Swing)',
  'Medium Pace Bowler (Seam Bowler)': 'Medium Fast (Seam)',
  'Off-Spin Bowler': 'Spin Bowler (Off Spin)',
  'Leg-Spin Bowler (including Chinaman)': 'Spin Bowler (Leg Spin)',
  'Slow Left-Arm Orthodox': 'Spin Bowler (Left-arm Orthodox)'
};

const BALL_BOWLER_MENTALITY_MAP = {
  'Wicket Taker': 'Wicket Taker',
  Economical: 'Economy',
  'Powerplay Specialist': 'Aggressive',
  'Death Over Specialist': 'Aggressive'
};

function normalizeAllowed(value, validValues, fallback) {
  if (value == null) {
    return fallback;
  }

  const raw = String(value).trim();
  if (!raw) {
    return fallback;
  }

  const exact = validValues.find((candidate) => candidate === raw);
  if (exact) {
    return exact;
  }

  const lower = raw.toLowerCase();
  const aliasValue = MATCH_BATSMAN_ALIASES[lower];
  if (aliasValue && validValues.includes(aliasValue)) {
    return aliasValue;
  }

  const loose = validValues.find((candidate) => candidate.toLowerCase() === lower);
  return loose || fallback;
}

function roleOf(player) {
  return String(player?.role || '').toUpperCase();
}

function handByPlayerId(player) {
  return Number(player?.id || 0) % 4 === 0 ? 'Left' : 'Right';
}

function oppositeHand(hand) {
  return hand === 'Left' ? 'Right' : 'Left';
}

function baseBatsmanType(player) {
  const role = roleOf(player);
  const batting = Number(player?.batting || 0);
  const temperament = Number(player?.temperament || 50);

  if (role === 'BOWLER') {
    if (batting <= 12) {
      return 'Tail ender';
    }
    if (batting <= 24) {
      return weightedChoice([
        { value: 'Tail ender', weight: 58 },
        { value: 'Defensive', weight: 30 },
        { value: 'Balanced', weight: 12 }
      ]);
    }
    return weightedChoice([
      { value: 'Defensive', weight: 38 },
      { value: 'Balanced', weight: 34 },
      { value: 'Tail ender', weight: 28 }
    ]);
  }

  if (role === 'WICKET_KEEPER') {
    const accWeight = 22 + Math.max(0, temperament - 35) * 0.8;
    const aggWeight = 16 + Math.max(0, batting - temperament) * 0.6;
    return weightedChoice([
      { value: 'Balanced', weight: 30 },
      { value: 'Accumulator', weight: Math.round(accWeight) },
      { value: 'Aggressive', weight: Math.round(aggWeight) },
      { value: 'Defensive', weight: 12 }
    ]);
  }

  // BATTER and ALL_ROUNDER: batting vs temperament shapes profile
  const aggWeight = 18 + Math.max(0, batting - temperament) * 0.7;
  const accWeight = 18 + Math.max(0, temperament - batting) * 0.7;
  const balWeight = 28;
  const defWeight = role === 'ALL_ROUNDER' ? 10 : 8;

  return weightedChoice([
    { value: 'Aggressive', weight: Math.round(aggWeight) },
    { value: 'Accumulator', weight: Math.round(accWeight) },
    { value: 'Balanced', weight: balWeight },
    { value: 'Defensive', weight: defWeight }
  ]);
}

function baseBowlerStyle(player, bowlerHand) {
  const role = roleOf(player);
  const bowling = Number(player?.bowling || 0);
  const fitness = Number(player?.fitness || 50);
  const isLeft = bowlerHand === 'Left';

  if (role === 'WICKET_KEEPER') {
    return weightedChoice(
      [
        { value: 'Off-Spin Bowler', weight: 40 },
        { value: 'Medium Pace Bowler (Seam Bowler)', weight: 28 },
        { value: 'Leg-Spin Bowler (including Chinaman)', weight: 16 },
        { value: 'Slow Left-Arm Orthodox', weight: isLeft ? 16 : 0 }
      ].filter((w) => w.weight > 0)
    );
  }

  if (role === 'BATTER') {
    return weightedChoice(
      [
        { value: 'Medium Pace Bowler (Seam Bowler)', weight: 30 },
        { value: 'Off-Spin Bowler', weight: 26 },
        { value: 'Leg-Spin Bowler (including Chinaman)', weight: 18 },
        { value: 'Slow Left-Arm Orthodox', weight: isLeft ? 16 : 0 },
        { value: 'Fast-Medium Bowler', weight: 10 }
      ].filter((w) => w.weight > 0)
    );
  }

  // BOWLER and ALL_ROUNDER: fitness vs bowling shapes pace/spin aptitude
  const paceLeaning = fitness >= bowling;

  if (role === 'BOWLER') {
    if (paceLeaning) {
      return weightedChoice(
        [
          { value: 'Fast Bowler (Express Pace)', weight: 14 },
          { value: 'Fast-Medium Bowler', weight: 26 },
          { value: 'Swing Bowler', weight: 24 },
          { value: 'Medium Pace Bowler (Seam Bowler)', weight: 14 },
          { value: 'Off-Spin Bowler', weight: 9 },
          { value: 'Leg-Spin Bowler (including Chinaman)', weight: 8 },
          { value: 'Slow Left-Arm Orthodox', weight: isLeft ? 5 : 0 }
        ].filter((w) => w.weight > 0)
      );
    }
    return weightedChoice(
      [
        { value: 'Off-Spin Bowler', weight: isLeft ? 10 : 24 },
        { value: 'Leg-Spin Bowler (including Chinaman)', weight: 20 },
        { value: 'Slow Left-Arm Orthodox', weight: isLeft ? 26 : 0 },
        { value: 'Fast-Medium Bowler', weight: 14 },
        { value: 'Swing Bowler', weight: 12 },
        { value: 'Medium Pace Bowler (Seam Bowler)', weight: 10 },
        { value: 'Fast Bowler (Express Pace)', weight: 4 }
      ].filter((w) => w.weight > 0)
    );
  }

  // ALL_ROUNDER
  if (paceLeaning) {
    return weightedChoice(
      [
        { value: 'Fast-Medium Bowler', weight: 22 },
        { value: 'Medium Pace Bowler (Seam Bowler)', weight: 22 },
        { value: 'Swing Bowler', weight: 18 },
        { value: 'Off-Spin Bowler', weight: 14 },
        { value: 'Leg-Spin Bowler (including Chinaman)', weight: 10 },
        { value: 'Fast Bowler (Express Pace)', weight: 8 },
        { value: 'Slow Left-Arm Orthodox', weight: isLeft ? 6 : 0 }
      ].filter((w) => w.weight > 0)
    );
  }

  return weightedChoice(
    [
      { value: 'Off-Spin Bowler', weight: isLeft ? 10 : 24 },
      { value: 'Medium Pace Bowler (Seam Bowler)', weight: 18 },
      { value: 'Leg-Spin Bowler (including Chinaman)', weight: 18 },
      { value: 'Slow Left-Arm Orthodox', weight: isLeft ? 22 : 0 },
      { value: 'Swing Bowler', weight: 12 },
      { value: 'Fast-Medium Bowler', weight: 10 },
      { value: 'Fast Bowler (Express Pace)', weight: 2 }
    ].filter((w) => w.weight > 0)
  );
}

function baseBowlerMentality(player) {
  const role = roleOf(player);
  const bowling = Number(player?.bowling || 0);
  const temperament = Number(player?.temperament || 50);
  const fitness = Number(player?.fitness || 50);

  if (role === 'BATTER' || role === 'WICKET_KEEPER') {
    return 'Economical';
  }

  // BOWLER and ALL_ROUNDER: attribute-weighted distribution
  // Higher bowling → Wicket Taker, higher fitness → Death Over Specialist,
  // higher temperament → Economical, baseline → Powerplay Specialist
  const wicketTakerWeight = 22 + Math.max(0, bowling - 28) * 0.5;
  const deathOverWeight = 20 + Math.max(0, fitness - 28) * 0.5;
  const economicalWeight = 20 + Math.max(0, temperament - 28) * 0.5;
  const powerplayWeight = 22;

  return weightedChoice([
    { value: 'Wicket Taker', weight: Math.round(wicketTakerWeight) },
    { value: 'Death Over Specialist', weight: Math.round(deathOverWeight) },
    { value: 'Economical', weight: Math.round(economicalWeight) },
    { value: 'Powerplay Specialist', weight: Math.round(powerplayWeight) }
  ]);
}

function maybeWeightedBatsmanType(baseType, role, player = {}) {
  const batting = Number(player?.batting || 0);

  if (role === 'BOWLER') {
    if (baseType === 'Tail ender') {
      return weightedChoice([
        { value: 'Tail ender', weight: 72 },
        { value: 'Defensive', weight: 20 },
        { value: 'Balanced', weight: 8 }
      ]);
    }

    return weightedChoice([
      { value: 'Defensive', weight: 48 },
      { value: 'Tail ender', weight: 28 },
      { value: 'Balanced', weight: 24 }
    ]);
  }

  if (role === 'BATTER') {
    if (baseType === 'Aggressive') {
      return weightedChoice([
        { value: 'Aggressive', weight: 52 },
        { value: 'Balanced', weight: 24 },
        { value: 'Accumulator', weight: 16 },
        { value: 'Defensive', weight: 8 }
      ]);
    }
    if (baseType === 'Accumulator') {
      return weightedChoice([
        { value: 'Accumulator', weight: 50 },
        { value: 'Balanced', weight: 26 },
        { value: 'Aggressive', weight: 14 },
        { value: 'Defensive', weight: 10 }
      ]);
    }
    if (baseType === 'Defensive') {
      if (batting <= 20) {
        return 'Defensive';
      }
      return weightedChoice([
        { value: 'Balanced', weight: 52 },
        { value: 'Accumulator', weight: 24 },
        { value: 'Aggressive', weight: 14 },
        { value: 'Defensive', weight: 10 }
      ]);
    }
    return weightedChoice([
      { value: 'Balanced', weight: 46 },
      { value: 'Aggressive', weight: 24 },
      { value: 'Accumulator', weight: 24 },
      { value: 'Defensive', weight: 6 }
    ]);
  }

  if (role === 'WICKET_KEEPER') {
    if (baseType === 'Aggressive') {
      return weightedChoice([
        { value: 'Aggressive', weight: 48 },
        { value: 'Balanced', weight: 28 },
        { value: 'Accumulator', weight: 16 },
        { value: 'Defensive', weight: 8 }
      ]);
    }
    if (baseType === 'Accumulator') {
      return weightedChoice([
        { value: 'Accumulator', weight: 50 },
        { value: 'Balanced', weight: 28 },
        { value: 'Aggressive', weight: 14 },
        { value: 'Defensive', weight: 8 }
      ]);
    }
    if (baseType === 'Defensive') {
      return weightedChoice([
        { value: 'Defensive', weight: 42 },
        { value: 'Balanced', weight: 34 },
        { value: 'Accumulator', weight: 18 },
        { value: 'Aggressive', weight: 6 }
      ]);
    }
    return weightedChoice([
      { value: 'Balanced', weight: 50 },
      { value: 'Accumulator', weight: 32 },
      { value: 'Aggressive', weight: 10 },
      { value: 'Defensive', weight: 8 }
    ]);
  }

  if (role === 'ALL_ROUNDER') {
    if (baseType === 'Aggressive') {
      return weightedChoice([
        { value: 'Aggressive', weight: 50 },
        { value: 'Balanced', weight: 26 },
        { value: 'Accumulator', weight: 14 },
        { value: 'Defensive', weight: 10 }
      ]);
    }
    if (baseType === 'Accumulator') {
      return weightedChoice([
        { value: 'Accumulator', weight: 48 },
        { value: 'Balanced', weight: 28 },
        { value: 'Aggressive', weight: 14 },
        { value: 'Defensive', weight: 10 }
      ]);
    }
    if (baseType === 'Defensive') {
      return weightedChoice([
        { value: 'Defensive', weight: 40 },
        { value: 'Balanced', weight: 34 },
        { value: 'Accumulator', weight: 16 },
        { value: 'Aggressive', weight: 10 }
      ]);
    }
    return weightedChoice([
      { value: 'Balanced', weight: 50 },
      { value: 'Accumulator', weight: 22 },
      { value: 'Aggressive', weight: 20 },
      { value: 'Defensive', weight: 8 }
    ]);
  }

  return baseType;
}

function maybeWeightedMentality(baseMentality, role) {
  if (role === 'BATTER' || role === 'WICKET_KEEPER') {
    return weightedChoice([
      { value: 'Economical', weight: 58 },
      { value: 'Powerplay Specialist', weight: 20 },
      { value: 'Wicket Taker', weight: 12 },
      { value: 'Death Over Specialist', weight: 10 }
    ]);
  }

  // Avoid duplicate entries by filtering base from the other mentalities
  const allMentalities = ['Wicket Taker', 'Economical', 'Powerplay Specialist', 'Death Over Specialist'];
  const others = allMentalities.filter((m) => m !== baseMentality);

  if (role === 'BOWLER') {
    return weightedChoice([
      { value: baseMentality, weight: 38 },
      { value: others[0], weight: 22 },
      { value: others[1], weight: 22 },
      { value: others[2], weight: 18 }
    ]);
  }

  if (role === 'ALL_ROUNDER') {
    return weightedChoice([
      { value: baseMentality, weight: 34 },
      { value: others[0], weight: 24 },
      { value: others[1], weight: 22 },
      { value: others[2], weight: 20 }
    ]);
  }

  return baseMentality;
}

export function createPlayerTacticsFromProfile(player = {}) {
  const role = roleOf(player);
  const batsmanHand = normalizeAllowed(
    player.batsman_hand || player.batsmanHand,
    STORED_HANDS,
    weightedChoice([
      { value: 'Right', weight: 72 },
      { value: 'Left', weight: 28 }
    ])
  );

  const baseBowlerHand = normalizeAllowed(player.bowler_hand || player.bowlerHand, STORED_HANDS, null);
  const defaultBowlerHand =
    role === 'BATTER' || role === 'WICKET_KEEPER'
      ? batsmanHand
      : weightedChoice([
          { value: batsmanHand, weight: 78 },
          { value: oppositeHand(batsmanHand), weight: 22 }
        ]);
  const bowlerHand = baseBowlerHand || defaultBowlerHand;

  const batsmanType = normalizeAllowed(
    player.batsman_type || player.batsmanType,
    STORED_BATSMAN_TYPES,
    maybeWeightedBatsmanType(baseBatsmanType(player), role, player)
  );
  const bowlerStyle = normalizeAllowed(
    player.bowler_style || player.bowlerStyle,
    STORED_BOWLER_STYLES,
    baseBowlerStyle(player, bowlerHand)
  );
  const bowlerMentality = normalizeAllowed(
    player.bowler_mentality || player.bowlerMentality,
    STORED_BOWLER_MENTALITIES,
    maybeWeightedMentality(baseBowlerMentality(player), role)
  );

  return {
    batsman_type: batsmanType,
    batsman_hand: batsmanHand,
    bowler_hand: bowlerHand,
    bowler_style: bowlerStyle,
    bowler_mentality: bowlerMentality
  };
}

export function resolveStoredHand(player, key) {
  const value = player?.[key];
  return normalizeAllowed(value, STORED_HANDS, handByPlayerId(player));
}

export function resolveStoredBatsmanType(player = {}) {
  return normalizeAllowed(player?.batsman_type, STORED_BATSMAN_TYPES, baseBatsmanType(player));
}

export function resolveStoredBowlerStyle(player = {}) {
  const bowlerHand = resolveStoredHand(player, 'bowler_hand');
  return normalizeAllowed(player?.bowler_style, STORED_BOWLER_STYLES, baseBowlerStyle(player, bowlerHand));
}

export function resolveStoredBowlerMentality(player = {}) {
  return normalizeAllowed(player?.bowler_mentality, STORED_BOWLER_MENTALITIES, baseBowlerMentality(player));
}

export function toBallApiBatsmanType(storedType) {
  const normalized = normalizeAllowed(storedType, STORED_BATSMAN_TYPES, 'Balanced');
  return BALL_BATSMAN_TYPE_MAP[normalized] || 'Balanced';
}

export function toBallApiBowlerStyle(storedStyle) {
  const normalized = normalizeAllowed(storedStyle, STORED_BOWLER_STYLES, 'Medium Pace Bowler (Seam Bowler)');
  return BALL_BOWLER_STYLE_MAP[normalized] || 'Medium Fast (Seam)';
}

export function toBallApiBowlerMentality(storedMentality) {
  const normalized = normalizeAllowed(storedMentality, STORED_BOWLER_MENTALITIES, 'Economical');
  return BALL_BOWLER_MENTALITY_MAP[normalized] || 'Economy';
}
