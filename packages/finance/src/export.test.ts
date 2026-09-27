import { describe, expect, test } from 'bun:test';
import { strFromU8, strToU8, unzipSync } from 'fflate';

import {
  buildMonthExport,
  EXPORT_COLUMNS,
  exportFileName,
  type ExportReceipt,
  type ExportRow,
} from './export';

function receipt(overrides: Partial<ExportReceipt>): ExportReceipt {
  return {
    id: 1,
    filename: 'rechnung.pdf',
    vaultPath: 'Projects/PRIV/Files/Belege/rechnung.pdf',
    issuer: 'Muster Software GmbH',
    invoiceNumber: 'MS-10023',
    invoiceDate: '2026-09-01',
    grossCents: 17250,
    vatCents: 2250,
    einvoice: false,
    ...overrides,
  };
}

function row(overrides: Partial<ExportRow>): ExportRow {
  return {
    bookingDate: '2026-09-20',
    valueDate: '2026-09-20',
    amountCents: -17250,
    currency: 'EUR',
    counterpartyName: 'MUSTER SOFTWARE GMBH',
    counterpartyIban: 'DE42500105175407324385',
    purpose: 'Rechnung MS-10023',
    accountIban: 'DE89370400440532013000',
    status: 'matched',
    assignment: 'auto',
    confidence: 0.97,
    note: null,
    receipts: [],
    ...overrides,
  };
}

describe('buildMonthExport', () => {
  const software = receipt({ id: 1, einvoice: true });
  const photo = receipt({
    id: 2,
    filename: 'Quittung Café.JPG',
    issuer: 'Café Übersee',
    invoiceNumber: null,
    invoiceDate: '2026-09-03',
    grossCents: 1250,
    vatCents: 200,
  });
  const twin = receipt({
    id: 3,
    issuer: 'Café Übersee',
    invoiceNumber: null,
    filename: 'b.pdf',
    grossCents: 1700,
    vatCents: 200,
  });
  const lonely = receipt({
    id: 4,
    issuer: 'Hotel am See',
    invoiceNumber: 'H/77',
    invoiceDate: '2026-09-28',
    grossCents: 23900,
    vatCents: 1564,
  });
  const rows: ExportRow[] = [
    row({ receipts: [software] }),
    row({
      bookingDate: '2026-09-03',
      valueDate: null,
      amountCents: 1250,
      counterpartyName: 'Café Übersee',
      counterpartyIban: null,
      purpose: '=HYPERLINK("http://x");"a"',
      status: 'matched',
      assignment: 'manual',
      confidence: null,
      note: 'Bewirtung; Kunde X',
      receipts: [photo, twin],
    }),
    row({
      bookingDate: '2026-09-15',
      amountCents: -1.5e3,
      counterpartyName: 'Bank',
      counterpartyIban: null,
      purpose: 'Kontoführung',
      status: 'no-receipt-needed',
      assignment: null,
      confidence: null,
      receipts: [],
      accountLabel: 'Geschäftskonto',
    }),
  ];
  const files: Record<number, string> = { 1: '%PDF-1', 2: 'JPEGDATA', 3: '%PDF-3', 4: '%PDF-4' };
  const result = buildMonthExport({
    month: '2026-09',
    label: 'Musterfrau Consulting',
    rows,
    receiptsWithoutPayment: [lonely],
    fileOf: (r) => strToU8(files[r.id] ?? ''),
    xmlOf: (r) => (r.einvoice ? strToU8('<rsm:CrossIndustryInvoice/>') : null),
  });
  const unzipped = unzipSync(result.zip);

  test('ZIP layout', () => {
    expect(Object.keys(unzipped).sort()).toEqual([
      '2026-09/Ausgaben/2026-09-20_Muster-Software-GmbH_172,50EUR_MS-10023.pdf',
      '2026-09/Ausgaben/2026-09-20_Muster-Software-GmbH_172,50EUR_MS-10023.xml',
      '2026-09/Belege-ohne-Zahlung.csv',
      '2026-09/Belege-ohne-Zahlung/2026-09-28_Hotel-am-See_239,00EUR_H-77.pdf',
      '2026-09/Buchungen_2026-09.csv',
      '2026-09/Einnahmen/2026-09-03_Cafe-Uebersee_12,50EUR.jpg',
      '2026-09/Einnahmen/2026-09-03_Cafe-Uebersee_17,00EUR.pdf',
    ]);
    expect(result.files).toBe(7);
    expect(
      strFromU8(
        unzipped['2026-09/Einnahmen/2026-09-03_Cafe-Uebersee_12,50EUR.jpg'] ?? new Uint8Array(),
      ),
    ).toBe('JPEGDATA');
  });

  test('booking CSV: BOM, CRLF, header, German numbers and dates, quoting', () => {
    expect(result.csv.startsWith('\uFEFF')).toBe(true);
    const lines = result.csv.slice(1).split('\r\n');
    expect(lines[0]).toBe(EXPORT_COLUMNS.join(';'));
    expect(lines).toHaveLength(5);
    expect(lines[4]).toBe('');
    // Sorted by booking date.
    expect(lines[1]?.startsWith('03.09.2026;;12,50;EUR;Café Übersee;;')).toBe(true);
    expect(lines[1]).toContain(`"'=HYPERLINK(""http://x"");""a"""`);
    expect(lines[1]).toContain(
      'Einnahmen/2026-09-03_Cafe-Uebersee_12,50EUR.jpg | Einnahmen/2026-09-03_Cafe-Uebersee_17,00EUR.pdf',
    );
    expect(lines[1]).toContain(';29,50;4,00;nein;manuell;;"Bewirtung; Kunde X"');
    expect(lines[2]).toBe(
      '15.09.2026;20.09.2026;-15,00;EUR;Bank;;Kontoführung;Geschäftskonto;kein Beleg nötig;;;;;;;;;;',
    );
    expect(lines[3]).toBe(
      '20.09.2026;20.09.2026;-172,50;EUR;MUSTER SOFTWARE GMBH;DE42500105175407324385;Rechnung MS-10023;DE89370400440532013000;zugeordnet;Ausgaben/2026-09-20_Muster-Software-GmbH_172,50EUR_MS-10023.pdf;MS-10023;01.09.2026;Muster Software GmbH;172,50;22,50;ja;auto;0,97;',
    );
    const inZip = unzipped['2026-09/Buchungen_2026-09.csv'] ?? new Uint8Array();
    expect([...inZip.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    // TextDecoder drops the BOM, so the decoded file equals the CSV without it.
    expect(strFromU8(inZip)).toBe(result.csv.slice(1));
  });

  test('receipts without payment CSV', () => {
    const bytes = unzipped['2026-09/Belege-ohne-Zahlung.csv'] ?? new Uint8Array();
    expect([...bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    expect(strFromU8(bytes)).toBe(
      'Beleg-Datei;Belegnummer;Belegdatum;Rechnungssteller;Brutto;USt-Betrag;Währung;E-Rechnung\r\n' +
        'Belege-ohne-Zahlung/2026-09-28_Hotel-am-See_239,00EUR_H-77.pdf;H/77;28.09.2026;Hotel am See;239,00;15,64;EUR;nein\r\n',
    );
  });
});

test('rejects a malformed month', () => {
  expect(() =>
    buildMonthExport({
      month: '2026-13',
      label: '',
      rows: [],
      receiptsWithoutPayment: [],
      fileOf: () => null,
    }),
  ).toThrow(RangeError);
});

describe('exportFileName', () => {
  test('transliterates, limits the length and numbers collisions', () => {
    const taken = new Set<string>();
    expect(exportFileName('2026-09-01_Müller & Söhne GmbH_1.234,56EUR_R/1', 'PDF', taken)).toBe(
      '2026-09-01_Mueller-Soehne-GmbH_1.234,56EUR_R-1.pdf',
    );
    expect(exportFileName('2026-09-01_Müller & Söhne GmbH_1.234,56EUR_R/1', 'pdf', taken)).toBe(
      '2026-09-01_Mueller-Soehne-GmbH_1.234,56EUR_R-1_2.pdf',
    );
    const long = exportFileName('x'.repeat(300), 'pdf', taken);
    expect(long).toHaveLength(100);
    const longTwin = exportFileName('x'.repeat(300), 'pdf', taken);
    expect(longTwin).toHaveLength(100);
    expect(longTwin.endsWith('_2.pdf')).toBe(true);
    expect(exportFileName('', 'pdf', taken)).toBe('Beleg.pdf');
  });
});

describe('explicit supplementary originals', () => {
  const invoice = receipt({
    id: 81,
    grossCents: 11900,
    vatCents: 1900,
    invoiceNumber: 'FICTION-81',
    currency: 'EUR',
  });
  const payment = receipt({
    ...invoice,
    id: 82,
    filename: 'paid.pdf',
    vaultPath: 'Projects/TEST/paid.pdf',
  });
  const grouped = { ...invoice, supplementaryOriginals: [payment] };
  const build = (receipts: ExportReceipt[], unpaid = false) =>
    buildMonthExport({
      month: '2026-09',
      label: 'Fiction',
      rows: unpaid ? [] : [row({ amountCents: -11900, receipts })],
      receiptsWithoutPayment: unpaid ? receipts : [],
      fileOf: (r) => strToU8(`original-${r.id}`),
    });
  test('one bank amount and one economic gross/VAT, with both distinct original bytes in ZIP', () => {
    const result = build([grouped]);
    const cells = result.csv.split('\r\n')[1]!.split(';');
    expect(cells[2]).toBe('-119,00');
    expect(cells[13]).toBe('119,00');
    expect(cells[14]).toBe('19,00');
    const files = Object.entries(unzipSync(result.zip)).filter(([p]) => p.endsWith('.pdf'));
    expect(files).toHaveLength(2);
    expect(files.map(([, b]) => strFromU8(b)).sort()).toEqual(['original-81', 'original-82']);
  });
  test('without any bank transaction, one CSV record still includes both originals', () => {
    const files = unzipSync(build([grouped], true).zip);
    const csv = strFromU8(files['2026-09/Belege-ohne-Zahlung.csv']!);
    expect(csv.split('\r\n').filter(Boolean)).toHaveLength(2);
    expect(csv.split('\r\n')[1]).toContain(';119,00;19,00;EUR;');
    expect(Object.keys(files).filter((p) => p.endsWith('.pdf'))).toHaveLength(2);
  });
  test('equal amounts remain separate without an explicit relation; detaching restores both records', () => {
    const second = { ...payment, invoiceNumber: 'FICTION-82' };
    for (const independent of [
      [invoice, second],
      [invoice, payment],
    ]) {
      const files = unzipSync(build(independent, true).zip);
      expect(
        strFromU8(files['2026-09/Belege-ohne-Zahlung.csv']!).split('\r\n').filter(Boolean),
      ).toHaveLength(3);
    }
    const cells = build([invoice, second]).csv.split('\r\n')[1]!.split(';');
    expect(cells[13]).toBe('238,00');
    expect(cells[14]).toBe('38,00');
  });
  test('an unprinted primary VAT remains null despite tax printed on a supplementary original', () => {
    const cells = build([{ ...grouped, vatCents: null }])
      .csv.split('\r\n')[1]!
      .split(';');
    expect(cells[14]).toBe('');
  });
});
