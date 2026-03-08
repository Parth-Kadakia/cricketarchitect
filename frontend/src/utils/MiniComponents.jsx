/* ── Shared mini UI components ─────────────────────────── */

/**
 * Small stat bar with label, value, and colored fill track.
 */
export function StatMini({ label, value, max = 100 }) {
  const pct = Math.max(0, Math.min(100, (Number(value) / max) * 100));
  const color = pct >= 70 ? 'var(--leaf)' : pct >= 45 ? '#daa520' : 'var(--danger)';
  return (
    <div className="tm-stat-mini">
      <div className="tm-stat-mini-header">
        <span className="tm-stat-mini-label">{label}</span>
        <span className="tm-stat-mini-val" style={{ color }}>{value}</span>
      </div>
      <div className="tm-stat-mini-track">
        <div className="tm-stat-mini-fill" style={{ width: `${pct}%`, background: color }} />
      </div>
    </div>
  );
}

/**
 * Circular SVG ring showing an overall 0-100 rating.
 */
export function OvrRing({ value, size = 38 }) {
  const v = Number(value || 0);
  const r = (size - 4) / 2;
  const c = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(100, v));
  const offset = c * (1 - pct / 100);
  const color = pct >= 70 ? 'var(--leaf)' : pct >= 45 ? '#daa520' : 'var(--danger)';
  return (
    <svg width={size} height={size} className="tm-ovr-ring">
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--border)" strokeWidth={3} />
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={3}
        strokeDasharray={c} strokeDashoffset={offset} strokeLinecap="round"
        transform={`rotate(-90 ${size / 2} ${size / 2})`} />
      <text x="50%" y="50%" dominantBaseline="central" textAnchor="middle"
        fontSize={size * 0.32} fontWeight="700" fontFamily="'Space Grotesk', sans-serif" fill={color}>
        {v}
      </text>
    </svg>
  );
}
