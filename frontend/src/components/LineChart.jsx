function normalizePoints(data) {
  if (!data?.length) {
    return '';
  }

  const values = data.map((item) => Number(item.value || 0));
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;

  return data
    .map((point, index) => {
      const x = (index / Math.max(1, data.length - 1)) * 100;
      const y = 100 - ((Number(point.value || 0) - min) / range) * 100;
      return `${x},${y}`;
    })
    .join(' ');
}

export default function LineChart({ data, valueFormatter = (value) => value }) {
  if (!data?.length) {
    return <div className="empty-state">No chart data.</div>;
  }

  const points = normalizePoints(data);
  const last = data[data.length - 1];

  return (
    <div className="line-chart">
      <svg viewBox="0 0 100 100" preserveAspectRatio="none">
        <defs>
          <linearGradient id="chartGradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="rgba(255, 174, 71, 0.7)" />
            <stop offset="100%" stopColor="rgba(255, 174, 71, 0.05)" />
          </linearGradient>
        </defs>
        <polyline fill="none" stroke="var(--accent)" strokeWidth="2" points={points} />
        <polygon points={`${points} 100,100 0,100`} fill="url(#chartGradient)" opacity="0.5" />
      </svg>
      <div className="line-chart-footer">
        <span>Latest</span>
        <strong>{valueFormatter(last.value)}</strong>
      </div>
    </div>
  );
}
