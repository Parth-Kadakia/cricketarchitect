import { randomInt } from '../utils/gameMath.js';
import COUNTRY_NAMES from './cricketNames.js';

/* ── Case-insensitive lookup map for cricketNames keys ── */
const COUNTRY_KEY_MAP = new Map();
for (const key of Object.keys(COUNTRY_NAMES)) {
  COUNTRY_KEY_MAP.set(key.toLowerCase(), key);
}

/* ── Aliases: variant country names → canonical cricketNames key ── */
const COUNTRY_ALIASES = {
  // Zone.tab / Intl.DisplayNames variants
  'united states': 'United States of America',
  usa: 'United States of America',
  us: 'United States of America',

  // UK is not a cricket team; map to England
  'united kingdom': 'England',
  uk: 'England',
  'great britain': 'England',

  // Caribbean nations → West Indies pool
  bonaire: 'West Indies',
  'trinidad and tobago': 'West Indies',
  barbados: 'West Indies',
  jamaica: 'West Indies',
  guyana: 'West Indies',
  'antigua and barbuda': 'West Indies',
  dominica: 'West Indies',
  grenada: 'West Indies',
  'saint lucia': 'West Indies',
  'st lucia': 'West Indies',
  'saint kitts and nevis': 'West Indies',
  'st kitts and nevis': 'West Indies',
  'saint vincent and the grenadines': 'West Indies',
  'st vincent and the grenadines': 'West Indies',
  suriname: 'West Indies',

  // Other variants
  czechia: 'Czech Republic',
  'russian federation': 'England',
  'viet nam': 'Cambodia',
  'korea, republic of': 'South Korea',
};

const ALL_COUNTRY_KEYS = Object.keys(COUNTRY_NAMES);

/**
 * Resolve any country string to a canonical cricketNames key.
 * Returns the key or null if unresolvable.
 */
function resolveCountryKey(country) {
  const trimmed = String(country || '').trim();
  if (!trimmed) return null;

  const lower = trimmed.toLowerCase();

  // Direct match against cricketNames keys
  const direct = COUNTRY_KEY_MAP.get(lower);
  if (direct) return direct;

  // Alias match
  const aliased = COUNTRY_ALIASES[lower];
  if (aliased) {
    const aliasKey = COUNTRY_KEY_MAP.get(aliased.toLowerCase());
    if (aliasKey) return aliasKey;
  }

  return null;
}

/* ── Public name pool helpers ── */

export function getNamePoolForCountry(country) {
  const key = resolveCountryKey(country);
  if (key && COUNTRY_NAMES[key]) {
    return COUNTRY_NAMES[key];
  }
  // Fallback: pick a random country pool
  const fallbackKey = ALL_COUNTRY_KEYS[randomInt(0, ALL_COUNTRY_KEYS.length - 1)];
  return COUNTRY_NAMES[fallbackKey];
}

export function getAllCountryKeys() {
  return ALL_COUNTRY_KEYS;
}

/* ── Constants ── */

const ACADEMY_SUFFIXES = [
  'Youth Cricket Academy',
  'Regional Cricket Institute',
  'High Performance Academy',
  'Cricket Excellence Center',
  'National Cricket Academy',
  'Elite Cricket Development Center',
  'Future Stars Cricket Academy',
  'Premier Cricket Institute',
  'Cricket Talent Development Hub',
  'NextGen Cricket Academy',
  'Advanced Cricket Training Center',
  'Cricket Performance Institute',
  'Rising Stars Cricket Academy',
  'International Cricket Training Academy',
  'Cricket Leadership Academy',
  'Elite Youth Cricket Program',
  'Pro Cricket Development Center',
  'Cricket Skills Advancement Academy',
  'Champions Cricket Academy',
  'National Youth Cricket Center',
  'Cricket Pathway Institute',
  'High Performance Youth Center',
  'Premier Cricket Development Academy',
  'Future Elite Cricket Institute'
];
const REGION_LABELS = ['North District', 'Metro Central', 'South Corridor'];

const TEAM_SUFFIXES = [
  'Warriors', 'Titans', 'Royals', 'Knights', 'Kings',
  'Challengers', 'Strikers', 'Chargers', 'Riders', 'Lions',
  'Eagles', 'Thunderbolts', 'Legends', 'Hurricanes', 'Gladiators',
  'Panthers', 'Falcons', 'Wolves', 'Spartans', 'Blazers',
  'Rising Stars', 'Mavericks', 'Stallions', 'Trailblazers', 'Superstars',
  'Vipers', 'Scorchers', 'Daredevils', 'Sunrisers', 'Rangers',
  'Crusaders', 'Raiders', 'Dynamos', 'Wanderers', 'United',
  'Phoenix', 'Centurions', 'Renegades', 'Storm', 'Capitals',
  'Braves', 'Avengers', 'Defenders', 'Invincibles', 'Phantoms',
  'Rockets', 'Comets', 'Sharks', 'Cobras', 'Jaguars'
];

/* ── Exported helpers (unchanged API) ── */

export function generateRegionalName(cityName, label) {
  return `${cityName} ${label}`;
}

export function buildAcademyName(cityName) {
  const suffix = ACADEMY_SUFFIXES[Math.abs(cityName.length) % ACADEMY_SUFFIXES.length];
  return `${cityName} ${suffix}`;
}

export function buildTeamName(cityName) {
  const suffix = TEAM_SUFFIXES[randomInt(0, TEAM_SUFFIXES.length - 1)];
  return `${cityName} ${suffix}`;
}

export function pickPlayerName(country) {
  const pool = getNamePoolForCountry(country);
  return {
    firstName: pool.first[randomInt(0, pool.first.length - 1)],
    lastName: pool.last[randomInt(0, pool.last.length - 1)]
  };
}

export function buildNameKey(firstName, lastName) {
  return `${String(firstName || '').trim().toLowerCase()}|${String(lastName || '').trim().toLowerCase()}`;
}

function buildFirstNameKey(firstName) {
  return String(firstName || '').trim().toLowerCase();
}

export function pickUniquePlayerName(country, usedNameKeys = new Set(), options = {}) {
  const pool = getNamePoolForCountry(country);
  const maxCombinations = pool.first.length * pool.last.length;
  const maxAttempts = Math.min(200, Math.max(40, maxCombinations));
  const usedFirstNames = options.usedFirstNames || null;
  const protectFirstNameDiversity = usedFirstNames instanceof Set;

  function tryPick({ avoidUsedFirstName }) {
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      const { firstName, lastName } = pickPlayerName(country);
      const key = buildNameKey(firstName, lastName);

      if (usedNameKeys.has(key)) {
        continue;
      }

      const firstKey = buildFirstNameKey(firstName);
      if (avoidUsedFirstName && usedFirstNames?.has(firstKey)) {
        continue;
      }

      usedNameKeys.add(key);
      if (protectFirstNameDiversity) {
        usedFirstNames.add(firstKey);
      }

      return { firstName, lastName };
    }

    return null;
  }

  if (protectFirstNameDiversity) {
    const strict = tryPick({ avoidUsedFirstName: true });
    if (strict) {
      return strict;
    }
  }

  const relaxed = tryPick({ avoidUsedFirstName: false });
  if (relaxed) {
    return relaxed;
  }

  // Fallback if pool combinations exhausted
  const fallback = pickPlayerName(country);
  usedNameKeys.add(buildNameKey(fallback.firstName, fallback.lastName));
  if (protectFirstNameDiversity) {
    usedFirstNames.add(buildFirstNameKey(fallback.firstName));
  }
  return fallback;
}

export function getDefaultRegionLabels(cityName) {
  return REGION_LABELS.map((label) => generateRegionalName(cityName, label));
}
