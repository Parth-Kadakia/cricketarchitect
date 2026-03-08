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
 */
export function setPageTitle(title) {
  document.title = title ? `${title} | Cricket Architect` : 'Cricket Architect — Global T20 Franchise Manager';
}
