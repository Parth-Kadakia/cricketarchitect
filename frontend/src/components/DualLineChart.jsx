function normalizeSeries(series, maxLabel) {
  if (!series.length || maxLabel <= 0) {
    return '';
  }

  const maxValue = Math.max(1, ...series.map((item) => Number(item.value || 0)));

  return series
    .map((point) => {
      const x = ((Number(point.label || 0) - 1) / Math.max(1, maxLabel - 1)) * 100;
      const y = 100 - (Number(point.value || 0) / maxValue) * 100;
      return `${x},${y}`;
    })
    .join(' ');
}

export default function DualLineChart({ innings1 = [], innings2 = [] }) {
  if (!innings1.length && !innings2.length) {
    return <div className="empty-state">No over-by-over data available.</div>;
  }

  const maxLabel = Math.max(
    1,
    ...innings1.map((entry) => Number(entry.label || 0)),
    ...innings2.map((entry) => Number(entry.label || 0))
  );

  const series1Points = normalizeSeries(innings1, maxLabel);
  const series2Points = normalizeSeries(innings2, maxLabel);

  return (
    <div className="line-chart dual-line-chart">
      <svg viewBox="0 0 100 100" preserveAspectRatio="none">
        {series1Points ? <polyline fill="none" stroke="var(--leaf)" strokeWidth="2.4" points={series1Points} /> : null}
        {series2Points ? <polyline fill="none" stroke="var(--accent)" strokeWidth="2.4" points={series2Points} /> : null}
      </svg>
      <div className="dual-line-legend">
        <span>
          <i className="legend-dot legend-home" />
          Innings 1
        </span>
        <span>
          <i className="legend-dot legend-away" />
          Innings 2
        </span>
      </div>
    </div>
  );
}

