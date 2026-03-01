export default function ScorecardTable({ rows, mode }) {
  if (!rows?.length) {
    return <div className="empty-state">No scorecard data.</div>;
  }

  const filteredRows = mode === 'bowling' ? rows.filter((row) => Number(row.bowling_balls || 0) > 0) : rows;

  if (!filteredRows.length) {
    return <div className="empty-state">No scorecard data.</div>;
  }

  const nameCounts = rows.reduce((map, row) => {
    const key = `${row.first_name} ${row.last_name}`.trim().toLowerCase();
    map.set(key, (map.get(key) || 0) + 1);
    return map;
  }, new Map());

  function oversFromBalls(balls) {
    const complete = Math.floor(Number(balls || 0) / 6);
    const rem = Number(balls || 0) % 6;
    return `${complete}.${rem}`;
  }

  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Player</th>
            {mode === 'batting' ? (
              <>
                <th>Dismissal</th>
                <th>R</th>
                <th>B</th>
                <th>SR</th>
                <th>4s</th>
                <th>6s</th>
              </>
            ) : (
              <>
                <th>Overs</th>
                <th>Runs</th>
                <th>Wkts</th>
                <th>Maidens</th>
                <th>Econ</th>
              </>
            )}
          </tr>
        </thead>
        <tbody>
          {filteredRows.map((row) => (
            <tr key={`${row.player_id}-${mode}`}>
              <td>
                {(() => {
                  const label = `${row.first_name} ${row.last_name}`;
                  const key = label.trim().toLowerCase();
                  return (nameCounts.get(key) || 0) > 1 ? `${label} #${row.player_id}` : label;
                })()}
              </td>
              {mode === 'batting' ? (
                <>
                  <td>{row.not_out ? (Number(row.batting_balls || 0) > 0 ? 'Not out' : 'DNB') : row.dismissal_text || 'Out'}</td>
                  <td>{row.batting_runs}</td>
                  <td>{row.batting_balls}</td>
                  <td>{row.batting_balls ? ((Number(row.batting_runs) / Number(row.batting_balls)) * 100).toFixed(2) : '-'}</td>
                  <td>{row.fours}</td>
                  <td>{row.sixes}</td>
                </>
              ) : (
                <>
                  <td>{oversFromBalls(row.bowling_balls)}</td>
                  <td>{row.bowling_runs}</td>
                  <td>{row.bowling_wickets}</td>
                  <td>{row.maiden_overs}</td>
                  <td>{row.bowling_balls ? ((row.bowling_runs / row.bowling_balls) * 6).toFixed(2) : '0.00'}</td>
                </>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
