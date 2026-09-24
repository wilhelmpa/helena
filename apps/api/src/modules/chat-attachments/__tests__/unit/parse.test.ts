import { describe, it, expect } from 'bun:test';
import { decodeCsv, isTableFilename, parseCsv, parseImportFile } from '../../parse';

describe('csv parser', () => {
  it('reads quoted fields, escaped quotes, and blank lines', () => {
    const rows = parseCsv('a,b\r\n"1,5","say ""hi"""\r\n\r\n   , \r\nx,y\n');
    expect(rows).toEqual([
      ['a', 'b'],
      ['1,5', 'say "hi"'],
      ['x', 'y'],
    ]);
  });

  it('sniffs a semicolon delimiter', () => {
    expect(parseCsv('a;b\n1;2')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  it('reads a quoted header behind a byte-order mark', () => {
    expect(parseCsv('\uFEFF"Titel";"Notiz"\n"A";"B"')).toEqual([
      ['Titel', 'Notiz'],
      ['A', 'B'],
    ]);
  });

  it('sniffs a tab delimiter', () => {
    expect(parseCsv('Task\tNotes\nA, with comma\tB')).toEqual([
      ['Task', 'Notes'],
      ['A, with comma', 'B'],
    ]);
  });

  it('takes the delimiter the rows agree on, not the one the header counts most', () => {
    expect(parseCsv('Titel;Beschreibung, lang\nA;x, y\nB;z')).toEqual([
      ['Titel', 'Beschreibung, lang'],
      ['A', 'x, y'],
      ['B', 'z'],
    ]);
  });
});

describe('csv decoding', () => {
  it('reads UTF-8, with or without a byte-order mark', () => {
    expect(decodeCsv(Buffer.from('Müller;Größe', 'utf8'))).toBe('Müller;Größe');
    expect(decodeCsv(Buffer.from('\uFEFFMüller', 'utf8'))).toBe('Müller');
  });

  it('falls back to Windows-1252 for a German Excel export', () => {
    // "Müller;Größe;5 €" as Excel on Windows writes it.
    const bytes = Uint8Array.from([
      0x4d, 0xfc, 0x6c, 0x6c, 0x65, 0x72, 0x3b, 0x47, 0x72, 0xf6, 0xdf, 0x65, 0x3b, 0x35, 0x20,
      0x80,
    ]);
    expect(decodeCsv(bytes)).toBe('Müller;Größe;5 €');
  });

  it('reads UTF-16 with its byte-order mark', () => {
    expect(decodeCsv(Buffer.from('\uFEFFa;b', 'utf16le'))).toBe('a;b');
  });
});

describe('import file routing', () => {
  it('refuses an unsupported extension', async () => {
    await expect(parseImportFile(Buffer.from('x'), 'file.xls')).rejects.toThrow('Unsupported');
  });

  it('parses a Windows-1252 csv end to end', async () => {
    const bytes = Buffer.from([
      ...Buffer.from('Aufgabe;Notiz\r\nK', 'latin1'),
      0xfc,
      ...Buffer.from('che;', 'latin1'),
      0x80,
      0x0d,
      0x0a,
    ]);
    const parsed = await parseImportFile(bytes, 'export.csv');
    expect(parsed.headers).toEqual(['Aufgabe', 'Notiz']);
    expect(parsed.rows).toEqual([['Küche', '€']]);
  });

  it('parses a csv buffer end to end', async () => {
    const parsed = await parseImportFile(Buffer.from('Task,Notes\nA,B'), 't.csv');
    expect(parsed.headers).toEqual(['Task', 'Notes']);
    expect(parsed.totalRows).toBe(1);
  });

  it('knows which filenames parse into a table', () => {
    expect(isTableFilename('tasks.xlsx')).toBe(true);
    expect(isTableFilename('JIRA.CSV')).toBe(true);
    expect(isTableFilename('spec.docx')).toBe(true);
    expect(isTableFilename('server.log')).toBe(false);
  });
});
