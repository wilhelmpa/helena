import { afterEach, describe, expect, it } from 'bun:test';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import ExcelJS from 'exceljs';
import { extractText } from '../extract';
import { has, pandocFile, scannedPage, scannedPdf, tempDir, textPdf } from './fixtures';

const LINES = ['Rechnung Nummer 4711', 'Betrag dreihundert Euro'];
const originalPath = process.env.PATH;

afterEach(() => {
  process.env.PATH = originalPath;
});

function expectText(result: Awaited<ReturnType<typeof extractText>>, ...words: string[]) {
  expect(result.status).toBe('done');
  const text = result.status === 'done' ? result.text : '';
  for (const word of words) expect(text).toContain(word);
}

describe('text extraction', () => {
  it.skipIf(!has('pdftotext'))('reads the text layer of a PDF', async () => {
    const file = path.join(tempDir('vault-extract-'), 'invoice.pdf');
    await writeFile(file, textPdf(LINES));
    expectText(await extractText(file), 'Rechnung', '4711', 'dreihundert');
  });

  it.skipIf(!has('pdftotext') || !has('pdftoppm') || !has('tesseract'))(
    'reads a scanned PDF by OCR',
    async () => {
      const dir = tempDir('vault-extract-');
      const file = path.join(dir, 'scan.pdf');
      await writeFile(file, await scannedPdf(dir, LINES));
      expectText(await extractText(file), 'Rechnung', '4711');
    },
    60_000,
  );

  it.skipIf(!has('pdftoppm') || !has('tesseract'))(
    'reads an image by OCR',
    async () => {
      const dir = tempDir('vault-extract-');
      expectText(await extractText(await scannedPage(dir, LINES, 'png')), 'Rechnung', '4711');
    },
    60_000,
  );

  for (const extension of ['docx', 'odt', 'rtf', 'epub', 'pptx']) {
    it.skipIf(!has('pandoc'))(`reads a .${extension} file`, async () => {
      const file = await pandocFile(
        tempDir('vault-extract-'),
        '# Protokoll\n\nBeschluss: Das Budget wird freigegeben.\n',
        extension,
      );
      expectText(await extractText(file), 'Beschluss', 'Budget');
    });
  }

  it('reads every sheet of a workbook', async () => {
    const workbook = new ExcelJS.Workbook();
    workbook.addWorksheet('Kosten').addRows([
      ['Posten', 'Betrag'],
      ['Server', 120],
    ]);
    workbook.addWorksheet('Termine').addRow(['Abnahme', new Date('2026-10-01T00:00:00Z')]);
    const file = path.join(tempDir('vault-extract-'), 'budget.xlsx');
    await writeFile(file, Buffer.from(await workbook.xlsx.writeBuffer()));
    const result = await extractText(file);
    expect(result).toEqual({
      status: 'done',
      text: '# Kosten\nPosten\tBetrag\nServer\t120\n\n# Termine\nAbnahme\t2026-10-01',
    });
  });

  it('reports a missing program instead of failing', async () => {
    const file = path.join(tempDir('vault-extract-'), 'invoice.pdf');
    await writeFile(file, textPdf(LINES));
    process.env.PATH = tempDir('vault-empty-path-');
    expect(await extractText(file)).toEqual({ status: 'unavailable', missing: ['pdftotext'] });
  });

  it('skips a type it cannot read', async () => {
    const file = path.join(tempDir('vault-extract-'), 'archive.zip');
    await writeFile(file, 'zip');
    expect(await extractText(file)).toEqual({ status: 'skipped', reason: 'unsupported type' });
  });
});
