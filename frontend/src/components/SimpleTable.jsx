export default function SimpleTable({ columns, rows, emptyMessage = 'No records found.' }) {
  if (!rows?.length) {
    return <div className="empty-state">{emptyMessage}</div>;
  }

  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column.key}>{column.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr key={row.id || rowIndex}>
              {columns.map((column) => (
                <td key={column.key}>
                  {column.render ? column.render(row[column.key], row) : row[column.key] ?? '-'}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
