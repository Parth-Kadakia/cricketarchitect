/**
 * Generate and download a multi-sheet Excel file using XML Spreadsheet 2003 format.
 * Supported natively by Excel, Google Sheets, and LibreOffice.
 *
 * @param {string} filename - e.g. "stats-export.xls"
 * @param {{ name: string, headers: string[], rows: (string|number)[][] }[]} sheets
 */
export function downloadExcel(filename, sheets) {
  const esc = (v) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  let xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
  xml += '<?mso-application progid="Excel.Sheet"?>\n';
  xml += '<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"\n';
  xml += '  xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">\n';

  // Styles
  xml += '  <Styles>\n';
  xml += '    <Style ss:ID="Default" ss:Name="Normal"><Font ss:Size="10"/></Style>\n';
  xml += '    <Style ss:ID="Header"><Font ss:Bold="1" ss:Size="10"/><Interior ss:Color="#E8E5DF" ss:Pattern="Solid"/></Style>\n';
  xml += '  </Styles>\n';

  for (const sheet of sheets) {
    if (!sheet.headers?.length && !sheet.rows?.length) continue;
    xml += `  <Worksheet ss:Name="${esc(sheet.name.slice(0, 31))}">\n`;
    xml += '    <Table>\n';

    // Header row
    if (sheet.headers?.length) {
      xml += '      <Row>\n';
      for (const h of sheet.headers) {
        xml += `        <Cell ss:StyleID="Header"><Data ss:Type="String">${esc(h)}</Data></Cell>\n`;
      }
      xml += '      </Row>\n';
    }

    // Data rows
    for (const row of sheet.rows || []) {
      xml += '      <Row>\n';
      for (const cell of row) {
        const val = cell ?? '';
        const isNum = typeof val === 'number' || (typeof val === 'string' && val !== '' && !isNaN(Number(val)) && val.trim() !== '');
        const type = isNum ? 'Number' : 'String';
        xml += `        <Cell><Data ss:Type="${type}">${esc(val)}</Data></Cell>\n`;
      }
      xml += '      </Row>\n';
    }

    xml += '    </Table>\n';
    xml += '  </Worksheet>\n';
  }

  xml += '</Workbook>';

  const blob = new Blob([xml], { type: 'application/vnd.ms-excel' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
