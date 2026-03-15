/* ── Shared formatting helpers ──────────────────────────── */

/**
 * Short money format: $1.2k for >= 1000, $123.45 otherwise.
 */
export function money(v) {
  const n = Number(v || 0);
  if (n >= 1000) return `$${(n / 1000).toFixed(1)}k`;
  return `$${n.toFixed(2)}`;
}

/**
 * Full money format with locale separators: $1,234.56
 */
export function moneyFull(v) {
  return `$${Number(v || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/**
 * Relative time string: "just now", "5m ago", "3h ago", "2d ago"
 */
export function timeAgo(ts) {
  if (!ts) return '—';
  const s = Math.floor((Date.now() - new Date(ts).getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

/**
 * Convert total balls bowled to cricket overs notation: "4.3"
 */
export function oversFromBalls(balls) {
  const b = Number(balls || 0);
  return `${Math.floor(b / 6)}.${b % 6}`;
}

/**
 * Formatted score label: "145/6 (18.3)"
 */
export function scoreLabel(runs, wickets, balls) {
  if (runs == null) return '-';
  return `${runs}/${wickets} (${oversFromBalls(balls)})`;
}

/**
 * Percentage helper: (part / whole * 100) with fixed decimals.
 */
export function pct(part, whole, digits = 1) {
  return whole ? ((part / whole) * 100).toFixed(digits) : '0';
}

/**
 * Calculate overall rating from a player object.
 */
export function overall(p) {
  return ((Number(p.batting || 0) + Number(p.bowling || 0) + Number(p.fielding || 0) + Number(p.fitness || 0) + Number(p.temperament || 0)) / 5).toFixed(0);
}

/**
 * Generate a unique operation ID for simulation tracking.
 */
export function opId(prefix = 'sim') {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Set the browser tab title with "| Cricket Architect" suffix.
 * Also updates meta description and canonical URL for SEO.
 */
const PAGE_META = {
  'Dashboard': 'Manage your T20 franchise — view standings, simulate rounds, and track your club from the Cricket Architect dashboard.',
  'Squad Management': 'Build your squad, set your starting XI, manage player roles and tactics in Cricket Architect.',
  'Stats': 'View batting and bowling leaderboards with 30+ stat columns across all seasons in Cricket Architect.',
  'Managers': 'Browse all managers, XP levels, career history, and reputation in Cricket Architect.',
  'Statbook': 'Deep-dive into match archives, head-to-head records, and season histories. Export to Excel.',
  'Youth Academy': 'Scout prospects, invest in growth cycles, upgrade your academy, and promote talent in Cricket Architect.',
  'League Table': 'Live league standings, promotion and relegation zones across the 4-tier Cricket Architect pyramid.',
  'Fixtures & Results': 'View upcoming fixtures, past results, and full round-by-round schedules in Cricket Architect.',
  'Match Center': 'Live ball-by-ball T20 simulation with scorecards, commentary, and AI match analysis.',
  'Transfer Market': 'Buy, sell, and loan players on the Cricket Architect auction market with salary cap management.',
  'Franchise Marketplace': 'Browse and buy T20 franchises from 1,200+ cities worldwide in Cricket Architect.',
  'Financials': 'Track club revenue, expenses, valuation, and financial projections in Cricket Architect.',
  'Trophy Room': 'View your trophy cabinet, championship history, and career achievements.',
  'Admin Console': 'Admin tools for managing your Cricket Architect league and game settings.',
  'Sign In': 'Sign in or create a free account to play Cricket Architect — the deepest cricket management game.',
};

export function setPageTitle(title, description) {
  document.title = title ? `${title} | Cricket Architect` : 'Cricket Architect — Global T20 Franchise Manager';

  const desc = description || PAGE_META[title] || 'Cricket Architect — free browser-based T20 cricket management game with ball-by-ball simulation, youth academies, transfers, and board pressure.';
  let metaDesc = document.querySelector('meta[name="description"]');
  if (metaDesc) {
    metaDesc.setAttribute('content', desc);
  }
}
