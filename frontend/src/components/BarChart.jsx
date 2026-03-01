function normalize(data) {
  const values = data.map((entry) => Number(entry.value || 0));
  const max = Math.max(1, ...values);
  return data.map((entry) => ({ ...entry, height: (Number(entry.value || 0) / max) * 100 }));
}

export default function BarChart({ data = [], color = 'var(--accent)' }) {
  if (!data.length) {
    return <div className="empty-state">No chart data available.</div>;
  }

  const bars = normalize(data.slice(-24));

  return (
    <div className="bar-chart">
      {bars.map((entry, index) => (
        <div key={`${entry.label}-${index}`} className="bar-item" title={`${entry.label}: ${entry.value}`}>
          <div className="bar-fill" style={{ height: `${entry.height}%`, background: color }} />
          <span>{entry.label}</span>
        </div>
      ))}
    </div>
  );
}
