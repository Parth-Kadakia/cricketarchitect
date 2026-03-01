export default function StatCard({ label, value, hint, accent = 'var(--accent)' }) {
  return (
    <div className="stat-card" style={{ '--card-accent': accent }}>
      <p className="stat-label">{label}</p>
      <p className="stat-value">{value}</p>
      {hint ? <p className="stat-hint">{hint}</p> : null}
    </div>
  );
}
