// A small RFC 4180 CSV parser. No dependencies.
// Handles quoted fields, commas and line breaks inside quotes, and "" as an escaped quote.

// Returns an array of rows; each row is an array of strings.
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  let i = 0;
  if (text.charCodeAt(0) === 0xfeff) i = 1; // skip a byte-order mark

  for (; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } // escaped quote
        else inQuotes = false;
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(field); field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      rows.push(row); row = [];
    } else {
      field += ch;
    }
  }
  // last field/row when the file does not end with a line break
  if (field !== '' || row.length > 0) { row.push(field); rows.push(row); }
  return rows;
}

// Turns rows into objects keyed by the header row. Blank lines are skipped.
export function csvToObjects(text) {
  const rows = parseCsv(text).filter((r) => !(r.length === 1 && r[0] === ''));
  if (rows.length === 0) return [];
  const header = rows[0].map((h) => h.trim());
  return rows.slice(1).map((r) => {
    const obj = {};
    header.forEach((name, idx) => { obj[name] = r[idx] ?? ''; });
    return obj;
  });
}
