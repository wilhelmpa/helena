import { describe, expect, test } from 'bun:test';

import { parseBankCsv, parseSepaTags, splitCsv } from './csv';
import { FinanceParseError } from './types';

/** Windows-1252 bytes for the fixtures: Latin-1 plus the euro sign. */
function cp1252(text: string): Uint8Array {
  return Uint8Array.from([...text].map((c) => (c === '€' ? 0x80 : c.charCodeAt(0))));
}

function utf8Bom(text: string): Uint8Array {
  const body = new TextEncoder().encode(text);
  return Uint8Array.from([0xef, 0xbb, 0xbf, ...body]);
}

const OWN = 'DE89370400440532013000';

describe('Sparkasse CSV-CAMT (Windows-1252, all quoted)', () => {
  const csv = [
    '"Auftragskonto";"Buchungstag";"Valutadatum";"Buchungstext";"Verwendungszweck";"Glaeubiger ID";"Mandatsreferenz";"Kundenreferenz (End-to-End)";"Sammlerreferenz";"Lastschrift Ursprungsbetrag";"Auslagenersatz Ruecklastschrift";"Beguenstigter/Zahlungspflichtiger";"Kontonummer/IBAN";"BIC (SWIFT-Code)";"Betrag";"Waehrung";"Info"',
    `"${OWN}";"24.09.26";"24.09.26";"FOLGELASTSCHRIFT";"Abschlag 09/2026 Vertragskonto 123456";"DE98ZZZ09999999999";"M-4711";"E2E-0924-1";"";"";"";"Stadtwerke Musterstadt GmbH";"DE45120300001234567890";"BYLADEM1001";"-89,90";"EUR";"Umsatz gebucht"`,
    `"${OWN}";"23.09.26";"23.09.26";"GUTSCHR. UEBERWEISUNG";"Rechnung RE-2026-0815; Danke";"";"";"NOTPROVIDED";"";"";"";"Beispiel Handel GmbH";"DE17100500000123456789";"BELADEBEXXX";"1.190,00";"EUR";"Umsatz gebucht"`,
    `"${OWN}";"";"25.09.26";"KARTENZAHLUNG";"Bäckerei Müller Filiale 3";"";"";"";"";"";"";"Bäckerei Müller";"";"";"-4,20";"EUR";"Umsatz vorgemerkt"`,
    '',
  ].join('\r\n');
  const statement = parseBankCsv(cp1252(csv));

  test('maps the columns and the own account', () => {
    expect(statement.format).toBe('csv');
    expect(statement.accountIban).toBe(OWN);
    expect(statement.entries).toHaveLength(3);
    expect(statement.from).toBe('2026-09-23');
    expect(statement.to).toBe('2026-09-25');
    expect(statement.entries[0]).toEqual({
      bookingDate: '2026-09-24',
      valueDate: '2026-09-24',
      amountCents: -8990,
      currency: 'EUR',
      counterpartyName: 'Stadtwerke Musterstadt GmbH',
      counterpartyIban: 'DE45120300001234567890',
      purpose: 'Abschlag 09/2026 Vertragskonto 123456',
      endToEndId: 'E2E-0924-1',
      mandateId: 'M-4711',
      creditorId: 'DE98ZZZ09999999999',
      bankReference: null,
      bankCode: null,
      bookingText: 'FOLGELASTSCHRIFT',
      status: 'booked',
    });
  });

  test('NOTPROVIDED, quoted delimiters and decoding', () => {
    expect(statement.entries[1]?.endToEndId).toBeNull();
    expect(statement.entries[1]?.purpose).toBe('Rechnung RE-2026-0815; Danke');
    expect(statement.entries[1]?.amountCents).toBe(119000);
    expect(statement.entries[2]?.counterpartyName).toBe('Bäckerei Müller');
  });

  test('pending row without booking date', () => {
    const pending = statement.entries[2];
    expect(pending?.status).toBe('pending');
    expect(pending?.bookingDate).toBe('2026-09-25');
    expect(pending?.amountCents).toBe(-420);
  });
});

describe('DKB 2023 (UTF-8 BOM, preamble, payer and payee columns)', () => {
  const csv = [
    `"Girokonto";"${OWN}"`,
    '""',
    '"Kontostand vom 24.09.2026:";"2.345,67 €"',
    '""',
    '"Buchungsdatum";"Wertstellung";"Status";"Zahlungspflichtige*r";"Zahlungsempfänger*in";"Verwendungszweck";"Umsatztyp";"IBAN";"Betrag (€)";"Gläubiger-ID";"Mandatsreferenz";"Kundenreferenz"',
    '"24.09.26";"24.09.26";"Gebucht";"Erika Musterfrau";"Muster Software GmbH";"Rechnung MS-10023";"Ausgang";"DE42500105175407324385";"-119,00 €";"";"";"MS-10023"',
    '"23.09.26";"23.09.26";"Gebucht";"Beispiel Handel GmbH";"Erika Musterfrau";"RE-2026-0815";"Eingang";"DE17100500000123456789";"1.190,00 €";"";"";""',
    '"25.09.26";"25.09.26";"Vorgemerkt";"Erika Musterfrau";"Telefon AG";"Kundennr 555";"Ausgang";"DE98700202700000012345";"-39,99 €";"DE98ZZZ09999999999";"MANDAT-1";""',
  ].join('\n');
  const statement = parseBankCsv(utf8Bom(csv));

  test('own IBAN from the preamble, counterparty picked by sign', () => {
    expect(statement.accountIban).toBe(OWN);
    const [out, income, pending] = statement.entries;
    expect(out?.counterpartyName).toBe('Muster Software GmbH');
    expect(out?.amountCents).toBe(-11900);
    expect(out?.endToEndId).toBe('MS-10023');
    expect(out?.bookingText).toBe('Ausgang');
    expect(income?.counterpartyName).toBe('Beispiel Handel GmbH');
    expect(income?.counterpartyIban).toBe('DE17100500000123456789');
    expect(income?.amountCents).toBe(119000);
    expect(pending?.status).toBe('pending');
    expect(pending?.creditorId).toBe('DE98ZZZ09999999999');
    expect(pending?.mandateId).toBe('MANDAT-1');
    expect(pending?.currency).toBe('EUR');
  });
});

describe('ING (Windows-1252, long preamble, two currency columns, VR-style tags)', () => {
  const csv = [
    'Umsatzanzeige;Datei erstellt am: 25.09.2026 10:00',
    '',
    'IBAN;DE89 3704 0044 0532 0130 00',
    'Kontoname;Girokonto',
    'Bank;ING',
    'Kunde;Erika Musterfrau',
    'Zeitraum;01.09.2026 - 25.09.2026',
    'Saldo;2.345,67;EUR',
    '',
    'Sortierung;Datum absteigend',
    '',
    'In der CSV-Datei finden Sie alle bereits gebuchten Umsätze. Die vorgemerkten Umsätze werden nicht aufgenommen, auch wenn sie in Ihrem Internetbanking angezeigt werden.',
    '',
    'Buchung;Wertstellungsdatum;Auftraggeber/Empfänger;Buchungstext;Verwendungszweck;Saldo;Währung;Betrag;Währung',
    '24.09.2026;24.09.2026;Muster Software GmbH;Lastschrift;Rechnung MS-10023 EREF: MS-10023 MREF: M-99 CRED: DE98ZZZ09999999999;2.345,67;EUR;-119,00;EUR',
    '20.09.2026;20.09.2026;Beispiel Handel GmbH;Gutschrift;RE-2026-0815;2.464,67;EUR;1.190,00;EUR',
  ].join('\r\n');
  const statement = parseBankCsv(cp1252(csv));

  test('header after the preamble, tags parsed out of the purpose', () => {
    expect(statement.accountIban).toBe(OWN);
    expect(statement.entries).toHaveLength(2);
    const [debit, credit] = statement.entries;
    expect(debit?.counterpartyName).toBe('Muster Software GmbH');
    expect(debit?.purpose).toBe('Rechnung MS-10023');
    expect(debit?.endToEndId).toBe('MS-10023');
    expect(debit?.mandateId).toBe('M-99');
    expect(debit?.creditorId).toBe('DE98ZZZ09999999999');
    expect(debit?.amountCents).toBe(-11900);
    expect(credit?.amountCents).toBe(119000);
    expect(credit?.currency).toBe('EUR');
  });

  test('balances from the running balance column, newest row first', () => {
    expect(statement.closingCents).toBe(234567);
    expect(statement.openingCents).toBe(127467);
  });
});

describe('N26 (comma, decimal point, ISO dates)', () => {
  const csv = [
    '"Booking Date","Value Date","Partner Name","Partner Iban","Type","Payment Reference","Account Name","Amount (EUR)","Original Amount","Original Currency","Exchange Rate"',
    '"2026-09-24","2026-09-24","Muster Software GmbH","DE42500105175407324385","Debit Transfer","Rechnung MS-10023","Main Account","-119.00","","",""',
    '"2026-09-22","2026-09-22","Coffee Roasters Ltd","","Presentment","","Main Account","-4.50","-5.00","USD","1.11"',
    '"2026-09-20","2026-09-20","Beispiel Handel GmbH","DE17100500000123456789","Credit Transfer","RE-2026-0815","Main Account","1190.00","","",""',
  ].join('\n');
  const statement = parseBankCsv(csv);

  test('English amounts, currency from the amount header, not the original currency', () => {
    const [transfer, card, credit] = statement.entries;
    expect(transfer?.amountCents).toBe(-11900);
    expect(transfer?.counterpartyIban).toBe('DE42500105175407324385');
    expect(transfer?.bookingText).toBe('Debit Transfer');
    expect(card?.amountCents).toBe(-450);
    expect(card?.currency).toBe('EUR');
    expect(card?.counterpartyIban).toBeNull();
    expect(credit?.amountCents).toBe(119000);
    expect(credit?.purpose).toBe('RE-2026-0815');
    expect(statement.accountIban).toBeNull();
  });
});

describe('VR / Atruvia', () => {
  const csv = [
    'Bezeichnung Auftragskonto;IBAN Auftragskonto;BIC Auftragskonto;Bankname Auftragskonto;Buchungstag;Valutadatum;Name Zahlungsbeteiligter;IBAN Zahlungsbeteiligter;BIC (SWIFT-Code) Zahlungsbeteiligter;Buchungstext;Verwendungszweck;Betrag;Waehrung;Saldo nach Buchung;Bemerkung;Gekennzeichneter Umsatz;Glaeubiger ID;Mandatsreferenz',
    `Girokonto;${OWN};GENODEF1XXX;Volksbank Beispiel eG;24.09.2026;24.09.2026;Muster Software GmbH;DE42500105175407324385;COBADEFFXXX;Basislastschrift;Rechnung MS-10023 EREF: MS-10023 MREF: M-99 CRED: DE98ZZZ09999999999;-119,00;EUR;2.345,67;;;DE98ZZZ09999999999;M-99`,
    `Girokonto;${OWN};GENODEF1XXX;Volksbank Beispiel eG;22.09.2026;22.09.2026;PayPal Europe S.a.r.l. et Cie S.C.A;LU120010001234567891;PPLXLUL2;Basislastschrift;1040000123456 PP.1234.PP . Muster Shop GmbH, Ihr Einkauf bei Muster Shop GmbH EREF: 1040000123456 MREF: 4XXJ224 CRED: LU96ZZZ0000000000000000058;-49,95;EUR;2.464,67;;;LU96ZZZ0000000000000000058;4XXJ224`,
  ].join('\r\n');
  const statement = parseBankCsv(csv);

  test('own account from its column, not mistaken for the counterparty', () => {
    expect(statement.accountIban).toBe(OWN);
    const [first, paypal] = statement.entries;
    expect(first?.counterpartyIban).toBe('DE42500105175407324385');
    expect(first?.counterpartyName).toBe('Muster Software GmbH');
    expect(first?.mandateId).toBe('M-99');
    expect(first?.bookingText).toBe('Basislastschrift');
    expect(paypal?.counterpartyName).toBe('PayPal Europe S.a.r.l. et Cie S.C.A');
    expect(paypal?.purpose).toBe(
      '1040000123456 PP.1234.PP . Muster Shop GmbH, Ihr Einkauf bei Muster Shop GmbH',
    );
    expect(paypal?.endToEndId).toBe('1040000123456');
    expect(statement.closingCents).toBe(234567);
    expect(statement.openingCents).toBe(251462);
  });
});

describe('Deutsche Bank (preamble, Soll/Haben, d.M.yyyy, footer)', () => {
  const csv = [
    'Umsätze Girokonto;Zeitraum: 01.09.2026 - 25.09.2026;',
    'Neuer Kontostand;2.345,67 EUR',
    ';',
    'Kontoinhaber;Erika Musterfrau',
    `IBAN;${OWN}`,
    ';',
    ';',
    'Buchungstag;Wert;Umsatzart;Begünstigter / Auftraggeber;Verwendungszweck;IBAN / Kontonummer;BIC;Kundenreferenz;Mandatsreferenz;Gläubiger ID;Fremde Gebühren;Betrag;Abweichender Empfänger;Anzahl der Aufträge;Anzahl der Schecks;Soll;Haben;Währung',
    '24.9.2026;24.9.2026;SEPA-Lastschrift;Muster Software GmbH;Rechnung MS-10023;DE42500105175407324385;COBADEFFXXX;MS-10023;M-99;DE98ZZZ09999999999;;;;;;-119,00;;EUR',
    '3.9.2026;3.9.2026;SEPA-Überweisung an;Vermieter GbR;Miete September 2026;DE65200411330987654321;COBADEFFXXX;;;;;;;;;-1.250,00;;EUR',
    '2.9.2026;2.9.2026;SEPA-Gutschrift;Beispiel Handel GmbH;RE-2026-0815;DE17100500000123456789;BELADEBEXXX;;;;;;;;;;1.190,00;EUR',
    'Kontostand;25.09.2026;;;2.345,67;EUR',
  ].join('\r\n');
  const statement = parseBankCsv(cp1252(csv));

  test('debit and credit columns, footer ignored', () => {
    expect(statement.accountIban).toBe(OWN);
    expect(statement.entries.map((e) => e.amountCents)).toEqual([-11900, -125000, 119000]);
    expect(statement.entries.map((e) => e.bookingDate)).toEqual([
      '2026-09-24',
      '2026-09-03',
      '2026-09-02',
    ]);
    const [debit, , credit] = statement.entries;
    expect(debit?.counterpartyName).toBe('Muster Software GmbH');
    expect(debit?.counterpartyIban).toBe('DE42500105175407324385');
    expect(debit?.endToEndId).toBe('MS-10023');
    expect(debit?.creditorId).toBe('DE98ZZZ09999999999');
    expect(debit?.bookingText).toBe('SEPA-Lastschrift');
    expect(credit?.counterpartyName).toBe('Beispiel Handel GmbH');
    expect(statement.warnings).toEqual([]);
  });
});

describe('Commerzbank (purpose only in Buchungstext)', () => {
  const csv = [
    'Buchungstag;Wertstellung;Umsatzart;Buchungstext;Betrag;Währung;IBAN Kontoinhaber;Kategorie',
    `24.09.2026;24.09.2026;Lastschrift;Muster Software GmbH Rechnung MS-10023 End-to-End-Ref.: MS-10023 Mandatsref: M-99 Gläubiger-ID: DE98ZZZ09999999999 SEPA-BASISLASTSCHRIFT wiederholend;-119,00;EUR;${OWN};Software`,
    `20.09.2026;20.09.2026;Gutschrift;Beispiel Handel GmbH RE-2026-0815 End-to-End-Ref.: NOTPROVIDED;1190,00;EUR;${OWN};Einnahmen`,
  ].join('\r\n');
  const statement = parseBankCsv(cp1252(csv));

  test('references parsed out of the booking text', () => {
    expect(statement.accountIban).toBe(OWN);
    const [debit, credit] = statement.entries;
    expect(debit?.purpose).toBe(
      'Muster Software GmbH Rechnung MS-10023 SEPA-BASISLASTSCHRIFT wiederholend',
    );
    expect(debit?.endToEndId).toBe('MS-10023');
    expect(debit?.mandateId).toBe('M-99');
    expect(debit?.creditorId).toBe('DE98ZZZ09999999999');
    expect(debit?.bookingText).toBe('Lastschrift');
    expect(debit?.counterpartyName).toBe('');
    expect(credit?.amountCents).toBe(119000);
    expect(credit?.endToEndId).toBeNull();
    expect(credit?.purpose).toBe('Beispiel Handel GmbH RE-2026-0815');
  });
});

describe('helpers and edge cases', () => {
  test('MT940-style SEPA tags', () => {
    expect(
      parseSepaTags(
        'EREF+ABC123 KREF+K-1 MREF+M-1 CRED+DE98ZZZ09999999999 SVWZ+Rechnung 4711 vom 01.09. ABWA+Muster Shop GmbH',
      ),
    ).toEqual({
      purpose: 'Rechnung 4711 vom 01.09.',
      endToEndId: 'ABC123',
      mandateId: 'M-1',
      creditorId: 'DE98ZZZ09999999999',
      iban: null,
      ultimateName: 'Muster Shop GmbH',
    });
    expect(parseSepaTags('Miete Oktober').purpose).toBe('Miete Oktober');
  });

  test('ultimate party from ABWA replaces a payment provider', () => {
    const csv = [
      'Buchungstag;Betrag;Name;Verwendungszweck',
      '01.09.2026;-10,00;PayPal (Europe) S.a r.l. et Cie, S.C.A.;EREF+1 SVWZ+Einkauf ABWA+Muster Shop GmbH',
    ].join('\n');
    expect(parseBankCsv(csv).entries[0]?.counterpartyName).toBe('Muster Shop GmbH');
  });

  test('S/H indicator and US month-first dates', () => {
    const csv = [
      'Date;Amount;S/H;Payee;Reference',
      '09/24/2026;12.50;S;Kiosk;Coffee',
      '09/13/2026;100.00;H;Kunde;Invoice 7',
    ].join('\n');
    const { entries } = parseBankCsv(csv);
    expect(entries.map((e) => e.amountCents)).toEqual([-1250, 10000]);
    expect(entries.map((e) => e.bookingDate)).toEqual(['2026-09-24', '2026-09-13']);
  });

  test('sign letter after the amount', () => {
    const csv = [
      'Buchungstag;Umsatz;Empfaenger;Verwendungszweck',
      '01.09.2026;119,00 S;Kiosk;A',
      '02.09.2026;5,00 H;Kiosk;B',
    ].join('\n');
    expect(parseBankCsv(csv).entries.map((e) => e.amountCents)).toEqual([-11900, 500]);
  });

  test('quoted fields with line breaks', () => {
    expect(splitCsv('a;"b\r\nc";"d ""e"""\nf;g;h', ';')).toEqual([
      ['a', 'b\r\nc', 'd "e"'],
      ['f', 'g', 'h'],
    ]);
  });

  test('warns about rows after an early end of the table', () => {
    const csv = [
      'Buchungstag;Betrag;Name;Verwendungszweck',
      '01.09.2026;-10,00;Kiosk;A',
      'Zwischensumme;-10,00;;',
      '02.09.2026;-5,00;Kiosk;B',
    ].join('\n');
    const statement = parseBankCsv(csv);
    expect(statement.entries).toHaveLength(1);
    expect(statement.warnings[0]).toContain('1 later rows');
  });

  test('rejects files without a recognizable header', () => {
    expect(() => parseBankCsv('foo;bar\n1;2\n')).toThrow(FinanceParseError);
  });
});
