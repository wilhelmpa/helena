import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

import { parseCamt } from './camt';
import { FinanceParseError } from './types';

const fixture = (name: string) =>
  readFileSync(new URL(`./__fixtures__/${name}`, import.meta.url), 'utf8');

describe('camt.053.001.02', () => {
  const [statement] = parseCamt(fixture('camt053-v02.xml'));
  if (!statement) throw new Error('no statement');

  test('statement header and balances', () => {
    expect(statement.format).toBe('camt053');
    expect(statement.accountIban).toBe('DE89370400440532013000');
    expect(statement.currency).toBe('EUR');
    expect(statement.from).toBe('2026-08-01');
    expect(statement.to).toBe('2026-08-31');
    expect(statement.openingCents).toBe(100000);
    expect(statement.closingCents).toBe(184005);
    // The booked entries add up, so no warning; INFO is skipped and PDNG does not count.
    expect(statement.warnings).toEqual([]);
    expect(statement.entries).toHaveLength(7);
  });

  test('incoming transfer takes the debtor as counterparty and decodes entities', () => {
    const entry = statement.entries[0];
    expect(entry).toEqual({
      bookingDate: '2026-08-10',
      valueDate: '2026-08-10',
      amountCents: 119000,
      currency: 'EUR',
      counterpartyName: 'Beispiel Handel GmbH & Co. KG',
      counterpartyIban: 'DE17100500000123456789',
      purpose: 'Rechnung RE-2026-0815 vom 01.08.2026',
      endToEndId: 'RE-2026-0815',
      mandateId: null,
      creditorId: null,
      bankReference: 'REF-0001',
      bankCode: 'NTRF+166+00931',
      bookingText: 'SEPA-Gutschrift',
      status: 'booked',
    });
  });

  test('direct debit: creditor id, mandate, NOTPROVIDED, joined Ustrd lines', () => {
    const entry = statement.entries[1];
    expect(entry?.amountCents).toBe(-8990);
    expect(entry?.counterpartyName).toBe('Stadtwerke Musterstadt GmbH');
    expect(entry?.counterpartyIban).toBe('DE45120300001234567890');
    expect(entry?.endToEndId).toBeNull();
    expect(entry?.mandateId).toBe('M-4711');
    expect(entry?.creditorId).toBe('DE98ZZZ09999999999');
    expect(entry?.purpose).toBe('Abschlag 08/2026 Vertragskonto 123456');
    expect(entry?.bankCode).toBe('NDDT+105+00931');
  });

  test('batch booking becomes one entry per transaction', () => {
    const [one, two] = [statement.entries[2], statement.entries[3]];
    expect(one?.amountCents).toBe(-10000);
    expect(one?.counterpartyName).toBe('Lieferant Eins KG');
    expect(one?.endToEndId).toBe('LS-0001');
    expect(one?.bankReference).toBe('REF-0003');
    expect(two?.amountCents).toBe(-20000);
    expect(two?.counterpartyName).toBe('Lieferant Zwei UG');
    expect(two?.counterpartyIban).toBe('DE65200411330987654321');
    // A structured creditor reference counts as purpose text for matching.
    expect(two?.purpose).toBe('RF18539007547034');
  });

  test('reversal is signed by its indicator and keeps the original counterparty', () => {
    const entry = statement.entries[4];
    expect(entry?.amountCents).toBe(8990);
    expect(entry?.counterpartyName).toBe('Stadtwerke Musterstadt GmbH');
    expect(entry?.bookingText).toBe('Retoure SEPA-Lastschrift (Storno)');
  });

  test('PayPal entry names the merchant from the ultimate creditor', () => {
    const entry = statement.entries[5];
    expect(entry?.amountCents).toBe(-4995);
    expect(entry?.counterpartyName).toBe('Muster Shop GmbH');
    expect(entry?.counterpartyIban).toBe('LU120010001234567891');
    expect(entry?.creditorId).toBe('LU96ZZZ0000000000000000058');
    expect(entry?.purpose).toContain('Ihr Einkauf bei Muster Shop GmbH');
  });

  test('pending entry without booking date uses the value date', () => {
    const entry = statement.entries[6];
    expect(entry?.status).toBe('pending');
    expect(entry?.bookingDate).toBe('2026-08-31');
    expect(entry?.amountCents).toBe(-1200);
  });
});

describe('camt.053.001.08', () => {
  const [statement] = parseCamt(fixture('camt053-v08.xml'));
  if (!statement) throw new Error('no statement');

  test('coded status, Pty wrappers, DtTm dates and TxDtls/Amt', () => {
    expect(statement.accountIban).toBe('DE42500105175407324385');
    expect(statement.openingCents).toBe(-25000);
    expect(statement.closingCents).toBe(81200);
    expect(statement.from).toBe('2026-09-24');
    expect(statement.to).toBe('2026-09-25');
    const [credit, debit, pending] = statement.entries;
    expect(credit?.bookingDate).toBe('2026-09-24');
    expect(credit?.amountCents).toBe(119000);
    // The direct debtor is a company, not a payment provider, so it stays the counterparty.
    expect(credit?.counterpartyName).toBe('Beispiel Handel GmbH');
    expect(credit?.bankCode).toBe('PMNT-RCDT-ESCT');
    expect(credit?.bookingText).toBe('Gutschrift');
    expect(debit?.amountCents).toBe(-12900);
    expect(debit?.counterpartyName).toBe('Telefon AG');
    expect(debit?.creditorId).toBe('DE98ZZZ09999999999');
    expect(debit?.mandateId).toBe('MANDAT-1');
    expect(pending?.status).toBe('pending');
  });

  test('warns when the booked entries do not explain the balances', () => {
    expect(statement.warnings).toHaveLength(1);
    expect(statement.warnings[0]).toContain('106100');
    expect(statement.warnings[0]).toContain('106200');
  });
});

describe('camt.052 and camt.054', () => {
  const entry = (sts: string) => `
    <Ntry>
      <Amt Ccy="EUR">10.00</Amt><CdtDbtInd>DBIT</CdtDbtInd>${sts}
      <BookgDt><Dt>2026-09-24</Dt></BookgDt>
      <NtryDtls><TxDtls><RltdPties><Cdtr><Nm>Kiosk</Nm></Cdtr></RltdPties></TxDtls></NtryDtls>
    </Ntry>`;

  test('intraday report', () => {
    const xml = `<?xml version="1.0"?>
      <Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.052.001.08"><BkToCstmrAcctRpt>
        <Rpt><Acct><Id><IBAN>DE89 3704 0044 0532 0130 00</IBAN></Id></Acct>${entry('<Sts><Cd>BOOK</Cd></Sts>')}</Rpt>
      </BkToCstmrAcctRpt></Document>`;
    const [report] = parseCamt(xml);
    expect(report?.format).toBe('camt052');
    expect(report?.accountIban).toBe('DE89370400440532013000');
    expect(report?.entries[0]?.counterpartyName).toBe('Kiosk');
    expect(report?.entries[0]?.currency).toBe('EUR');
  });

  test('debit/credit notification with two notifications', () => {
    const xml = `<Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.054.001.02"><BkToCstmrDbtCdtNtfctn>
        <Ntfctn>${entry('<Sts>BOOK</Sts>')}</Ntfctn>
        <Ntfctn>${entry('<Sts>BOOK</Sts>')}${entry('<Sts>INFO</Sts>')}</Ntfctn>
      </BkToCstmrDbtCdtNtfctn></Document>`;
    const notifications = parseCamt(xml);
    expect(notifications.map((n) => n.format)).toEqual(['camt054', 'camt054']);
    expect(notifications.map((n) => n.entries.length)).toEqual([1, 1]);
  });

  test('rejects other XML', () => {
    expect(() => parseCamt('<Document><pain.001/></Document>')).toThrow(FinanceParseError);
    expect(() => parseCamt('<Invoice/>')).toThrow(FinanceParseError);
  });
});
