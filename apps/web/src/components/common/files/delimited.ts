// A CSV or TSV file as rows of cells (RFC 4180: quoted cells may hold the separator, quotes
// as "" and line breaks). The separator is a tab for a .tsv, otherwise the one of comma,
// semicolon and tab that the first lines use most.
export function detectDelimiter(text: string, name = ''): string {
  if (/\.tsv$/i.test(name)) return '\t';
  const sample = text.split(/\r?\n/).slice(0, 5).join('\n');
  const counts = [',', ';', '\t'].map((mark) => [mark, sample.split(mark).length - 1] as const);
  const [mark, count] = counts.sort((a, b) => b[1] - a[1])[0]!;
  return count > 0 ? mark : ',';
}

export function parseDelimited(text: string, delimiter = ','): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  // A byte order mark at the start is not part of the first cell.
  const source = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  for (let index = 0; index < source.length; index++) {
    const char = source[index]!;
    if (quoted) {
      if (char === '"') {
        if (source[index + 1] === '"') {
          cell += '"';
          index++;
        } else quoted = false;
      } else cell += char;
    } else if (char === '"' && cell === '') quoted = true;
    else if (char === delimiter) {
      row.push(cell);
      cell = '';
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && source[index + 1] === '\n') index++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += char;
  }
  if (cell !== '' || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}
