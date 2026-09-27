import { describe, expect, test } from 'bun:test';

import { factsFromText } from './receipt-text';

const OWN = 'DE89370400440532013000';

describe('factsFromText', () => {
  test('software invoice (pdftotext layout)', () => {
    const text = `Muster Software GmbH · Hauptstraße 1 · 10115 Berlin

Musterfrau Consulting
Beispielweg 5
80331 München

Rechnung
Rechnungsnummer: MS-10023
Rechnungsdatum: 01.09.2026
Kundennummer: 4711

Pos. Beschreibung Menge Einzelpreis Gesamt
1 Softwarelizenz Pro 1 100,00 € 100,00 €
2 Fachbuch 1 50,00 € 50,00 €

Zwischensumme netto 150,00 €
zzgl. 19 % USt auf 100,00 € 19,00 €
zzgl. 7 % USt auf 50,00 € 3,50 €
Gesamtbetrag 172,50 €

Zahlbar innerhalb von 30 Tagen ohne Abzug. Bei Zahlung innerhalb von 14 Tagen 2 % Skonto.
Bankverbindung: Musterbank, IBAN: DE42 5001 0517 5407 3243 85, BIC: MUSTDEFFXXX
Muster Software GmbH · Geschäftsführer: Max Muster · Amtsgericht Berlin HRB 12345 · USt-IdNr. DE123456789`;
    expect(factsFromText(text, [OWN])).toEqual({
      invoiceNumber: 'MS-10023',
      invoiceDate: '2026-09-01',
      dueDate: '2026-10-01',
      grossCents: 17250,
      vatCents: 2250,
      currency: 'EUR',
      iban: 'DE42500105175407324385',
      issuer: 'Muster Software GmbH',
      creditNote: false,
      directDebit: false,
      direction: 'incoming',
    });
  });

  test('supermarket receipt (OCR) with a tax table', () => {
    const text = `REWE Markt GmbH
Musterstraße 12
50667 Köln
UID Nr.: DE812706034

BIO BANANEN 1,99 B
VOLLMILCH 1,19 B
WEIN ROT 6,99 A
--------------------------------
SUMME EUR 10,17
Geg. BAR EUR 20,00
Rückgeld BAR EUR 9,83

Steuer % Netto Steuer Brutto
A= 19,0% 5,87 1,12 6,99
B= 7,0% 2,97 0,21 3,18
Gesamtbetrag 8,84 1,33 10,17

24.09.2026 18:42 Bon-Nr.: 4711 Markt: 1234`;
    expect(factsFromText(text)).toEqual({
      invoiceNumber: '4711',
      invoiceDate: '2026-09-24',
      dueDate: null,
      grossCents: 1017,
      vatCents: 133,
      currency: 'EUR',
      iban: null,
      issuer: 'REWE Markt GmbH',
      creditNote: false,
      directDebit: false,
      direction: null,
    });
  });

  test('telecom bill collected by direct debit from the own account', () => {
    const text = `Telefon AG
Kundenservice, 53113 Bonn

Frau Erika Musterfrau
Beispielweg 5
80331 München

Ihre Rechnung für September 2026
Rechnung Nr. 2026-TK-778899
Datum 05.09.2026
Kundennummer 555

Monatlicher Grundpreis 33,61 €
Summe netto 33,61 €
Umsatzsteuer 19 % 6,39 €
Rechnungsbetrag
39,99 €

Der Rechnungsbetrag wird am 15.09.2026 von Ihrem Konto DE89 3704 0044 0532 0130 00 abgebucht.
Gläubiger-ID DE98ZZZ09999999999, Mandatsreferenz MANDAT-1`;
    expect(factsFromText(text, [OWN])).toEqual({
      invoiceNumber: '2026-TK-778899',
      invoiceDate: '2026-09-05',
      dueDate: '2026-09-15',
      grossCents: 3999,
      vatCents: 639,
      currency: 'EUR',
      iban: null,
      issuer: 'Telefon AG',
      creditNote: false,
      directDebit: true,
      direction: 'incoming',
    });
  });

  test('English invoice', () => {
    const text = `Acme Software Inc.
123 Main Street, Springfield
Invoice Number: INV-2026-001
Invoice Date: Sep 1, 2026
Due Date: Oct 1, 2026
Subtotal 940.34
VAT 19% 178.66
Total due USD 1,119.00`;
    expect(factsFromText(text)).toMatchObject({
      invoiceNumber: 'INV-2026-001',
      invoiceDate: '2026-09-01',
      dueDate: '2026-10-01',
      grossCents: 111900,
      vatCents: 17866,
      currency: 'USD',
      issuer: 'Acme Software Inc.',
    });
  });

  test('does not infer the issuer from a labeled recipient address', () => {
    const text = `Rechnung
Rechnungsempfänger:
Familie Mustermann
Beispielweg 5
80331 München
Rechnungsnummer: R-2026-123
Gesamtbetrag 119,00 EUR
Aussteller: Muster Praxis`;
    expect(factsFromText(text).issuer).toBeNull();
  });

  test('does not infer the issuer from a recipient on the first line', () => {
    expect(factsFromText('Bill to: Jane Example\nInvoice R-123').issuer).toBeNull();
  });

  test('excludes a recipient name when its postal code follows the skipped block', () => {
    const text = `Muster Services Limited
Rechnung Nr. R-2026-123

Rechnungsempfänger
Adresszusatz
Familie Mustermann
Beispielweg 5
80331 München

Gesamtbetrag 119,00 EUR`;
    expect(factsFromText(text).issuer).toBe('Muster Services Limited');
  });

  test('finds an issuer address after a labeled recipient address', () => {
    const text = `Rechnung
Rechnungsadresse:
Empfänger GmbH
Beispielweg 5
80331 München
Rechnungsnummer: R-2026-123
Muster Praxis
Musterstraße 7
10115 Berlin`;
    expect(factsFromText(text).issuer).toBe('Muster Praxis');
  });

  test('finds an issuer with a legal form after a labeled recipient address', () => {
    const text = `Rechnung
Rechnungsadresse:
Empfänger GmbH
Beispielweg 5
80331 München
Muster Software GmbH`;
    expect(factsFromText(text).issuer).toBe('Muster Software GmbH');
  });

  test('preserves an issuer address without a legal form', () => {
    expect(factsFromText('Muster Praxis\nMusterstraße 7\n10115 Berlin').issuer).toBe(
      'Muster Praxis',
    );
  });

  test('own invoice and credit note hints', () => {
    const outgoing = factsFromText(
      `Erika Musterfrau Consulting e.K.\nRechnung RE-2026-0815\nDatum: 01.08.2026\nZu zahlen: 1.190,00 EUR\nzahlbar bis 15.08.2026 auf ${OWN}`,
      [OWN],
    );
    expect(outgoing.direction).toBe('outgoing');
    expect(outgoing.invoiceNumber).toBe('RE-2026-0815');
    expect(outgoing.dueDate).toBe('2026-08-15');
    expect(outgoing.grossCents).toBe(119000);
    expect(outgoing.issuer).toBe('Erika Musterfrau Consulting e.K.');

    const credit = factsFromText(
      'Muster Software GmbH\nGutschrift\nGutschrift-Nr. GS-2026-007\nBetrag: -23,80 €',
    );
    expect(credit.creditNote).toBe(true);
    expect(credit.invoiceNumber).toBe('GS-2026-007');
    expect(credit.grossCents).toBe(2380);
  });
});
