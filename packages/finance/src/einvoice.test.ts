import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

import { EINVOICE_ATTACHMENT_NAMES, parseEInvoiceXml, parseSkonto } from './einvoice';

const fixture = (name: string) =>
  readFileSync(new URL(`./__fixtures__/${name}`, import.meta.url), 'utf8');

describe('CII (Factur-X / ZUGFeRD 2.x EN 16931)', () => {
  test('all header facts', () => {
    expect(parseEInvoiceXml(fixture('factur-x-en16931.xml'))).toEqual({
      syntax: 'cii',
      profile: 'urn:cen.eu:en16931:2017',
      typeCode: '380',
      creditNote: false,
      invoiceNumber: 'MS-10023',
      issueDate: '2026-09-01',
      dueDate: '2026-10-01',
      sellerName: 'Muster Software GmbH',
      sellerVatId: 'DE123456789',
      buyerName: 'Musterfrau Consulting GmbH & Co. KG',
      currency: 'EUR',
      paymentMeansCode: '58',
      paymentReference: 'MS-10023',
      sellerIban: 'DE42500105175407324385',
      mandateId: null,
      creditorId: null,
      netCents: 15000,
      vatCents: 2250,
      grossCents: 17250,
      prepaidCents: 0,
      dueCents: 17250,
      vatRates: [19, 7],
      skonto: { days: 14, percent: 2 },
      paymentTerms: 'Zahlbar innerhalb von 30 Tagen netto.\n#SKONTO#TAGE=14#PROZENT=2.00#',
    });
  });

  test('direct debit credit note with the VAT total in two currencies', () => {
    const xml = `<?xml version="1.0"?>
      <rsm:CrossIndustryInvoice xmlns:rsm="urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100" xmlns:ram="urn:un:unece:uncefact:data:standard:ReusableAggregateBusinessInformationEntity:100" xmlns:udt="urn:un:unece:uncefact:data:standard:UnqualifiedDataType:100">
        <rsm:ExchangedDocumentContext><ram:GuidelineSpecifiedDocumentContextParameter><ram:ID>urn:cen.eu:en16931:2017#compliant#urn:xeinkauf.de:kosit:xrechnung_3.0</ram:ID></ram:GuidelineSpecifiedDocumentContextParameter></rsm:ExchangedDocumentContext>
        <rsm:ExchangedDocument><ram:ID>GS-1</ram:ID><ram:TypeCode>381</ram:TypeCode><ram:IssueDateTime><udt:DateTimeString format="102">20260910</udt:DateTimeString></ram:IssueDateTime></rsm:ExchangedDocument>
        <rsm:SupplyChainTradeTransaction>
          <ram:ApplicableHeaderTradeAgreement><ram:SellerTradeParty><ram:Name>Telefon AG</ram:Name></ram:SellerTradeParty></ram:ApplicableHeaderTradeAgreement>
          <ram:ApplicableHeaderTradeSettlement>
            <ram:CreditorReferenceID>DE98ZZZ09999999999</ram:CreditorReferenceID>
            <ram:InvoiceCurrencyCode>USD</ram:InvoiceCurrencyCode>
            <ram:TaxCurrencyCode>EUR</ram:TaxCurrencyCode>
            <ram:SpecifiedTradeSettlementPaymentMeans><ram:TypeCode>59</ram:TypeCode></ram:SpecifiedTradeSettlementPaymentMeans>
            <ram:SpecifiedTradePaymentTerms><ram:DirectDebitMandateID>MANDAT-1</ram:DirectDebitMandateID></ram:SpecifiedTradePaymentTerms>
            <ram:SpecifiedTradeSettlementHeaderMonetarySummation>
              <ram:TaxBasisTotalAmount>100</ram:TaxBasisTotalAmount>
              <ram:TaxTotalAmount currencyID="EUR">17.50</ram:TaxTotalAmount>
              <ram:TaxTotalAmount currencyID="USD">19.00</ram:TaxTotalAmount>
              <ram:GrandTotalAmount>119.0000</ram:GrandTotalAmount>
              <ram:DuePayableAmount>119</ram:DuePayableAmount>
            </ram:SpecifiedTradeSettlementHeaderMonetarySummation>
          </ram:ApplicableHeaderTradeSettlement>
        </rsm:SupplyChainTradeTransaction>
      </rsm:CrossIndustryInvoice>`;
    const facts = parseEInvoiceXml(xml);
    expect(facts?.creditNote).toBe(true);
    expect(facts?.vatCents).toBe(1900);
    expect(facts?.grossCents).toBe(11900);
    expect(facts?.paymentMeansCode).toBe('59');
    expect(facts?.mandateId).toBe('MANDAT-1');
    expect(facts?.creditorId).toBe('DE98ZZZ09999999999');
    expect(facts?.sellerIban).toBeNull();
    expect(facts?.skonto).toBeNull();
  });

  test('ZUGFeRD 1.0 best effort', () => {
    const xml = `<rsm:CrossIndustryDocument xmlns:rsm="urn:ferd:CrossIndustryDocument:invoice:1p0" xmlns:ram="urn:un:unece:uncefact:data:standard:ReusableAggregateBusinessInformationEntity:12" xmlns:udt="urn:un:unece:uncefact:data:standard:UnqualifiedDataType:15">
        <rsm:SpecifiedExchangedDocumentContext><ram:GuidelineSpecifiedDocumentContextParameter><ram:ID>urn:ferd:CrossIndustryDocument:invoice:1p0:comfort</ram:ID></ram:GuidelineSpecifiedDocumentContextParameter></rsm:SpecifiedExchangedDocumentContext>
        <rsm:HeaderExchangedDocument><ram:ID>R-1</ram:ID><ram:TypeCode>380</ram:TypeCode><ram:IssueDateTime><udt:DateTimeString format="102">20190301</udt:DateTimeString></ram:IssueDateTime></rsm:HeaderExchangedDocument>
        <rsm:SpecifiedSupplyChainTradeTransaction>
          <ram:ApplicableSupplyChainTradeAgreement><ram:SellerTradeParty><ram:Name>Alt GmbH</ram:Name></ram:SellerTradeParty></ram:ApplicableSupplyChainTradeAgreement>
          <ram:ApplicableSupplyChainTradeSettlement>
            <ram:InvoiceCurrencyCode>EUR</ram:InvoiceCurrencyCode>
            <ram:ApplicableTradeTax><ram:CalculatedAmount currencyID="EUR">1.90</ram:CalculatedAmount><ram:ApplicablePercent>19</ram:ApplicablePercent></ram:ApplicableTradeTax>
            <ram:SpecifiedTradeSettlementMonetarySummation>
              <ram:TaxBasisTotalAmount currencyID="EUR">10.00</ram:TaxBasisTotalAmount>
              <ram:TaxTotalAmount currencyID="EUR">1.90</ram:TaxTotalAmount>
              <ram:GrandTotalAmount currencyID="EUR">11.90</ram:GrandTotalAmount>
              <ram:DuePayableAmount currencyID="EUR">11.90</ram:DuePayableAmount>
            </ram:SpecifiedTradeSettlementMonetarySummation>
          </ram:ApplicableSupplyChainTradeSettlement>
        </rsm:SpecifiedSupplyChainTradeTransaction>
      </rsm:CrossIndustryDocument>`;
    const facts = parseEInvoiceXml(xml);
    expect(facts?.syntax).toBe('cii');
    expect(facts?.profile).toBe('urn:ferd:CrossIndustryDocument:invoice:1p0:comfort');
    expect(facts?.invoiceNumber).toBe('R-1');
    expect(facts?.issueDate).toBe('2019-03-01');
    expect(facts?.sellerName).toBe('Alt GmbH');
    expect(facts?.grossCents).toBe(1190);
    expect(facts?.vatCents).toBe(190);
    expect(facts?.vatRates).toEqual([19]);
  });
});

describe('UBL', () => {
  test('XRechnung invoice paid by direct debit', () => {
    const facts = parseEInvoiceXml(fixture('xrechnung-ubl-invoice.xml'));
    expect(facts).toMatchObject({
      syntax: 'ubl',
      profile: 'urn:cen.eu:en16931:2017#compliant#urn:xeinkauf.de:kosit:xrechnung_3.0',
      typeCode: '380',
      creditNote: false,
      invoiceNumber: '2026-0042',
      issueDate: '2026-09-05',
      dueDate: '2026-09-19',
      sellerName: 'Stadtwerke Musterstadt GmbH',
      sellerVatId: 'DE987654321',
      buyerName: 'Erika Musterfrau',
      currency: 'EUR',
      paymentMeansCode: '59',
      paymentReference: 'VK-123456',
      sellerIban: null,
      mandateId: 'M-4711',
      creditorId: 'DE98ZZZ09999999999',
      netCents: 7555,
      vatCents: 1435,
      grossCents: 8990,
      prepaidCents: 0,
      dueCents: 8990,
      vatRates: [19],
      skonto: null,
      paymentTerms: 'Der Betrag wird am 19.09.2026 per Lastschrift eingezogen.',
    });
  });

  test('credit note: root decides, VAT in the document currency, due date from payment means', () => {
    const facts = parseEInvoiceXml(fixture('ubl-credit-note.xml'));
    expect(facts).toMatchObject({
      syntax: 'ubl',
      typeCode: '381',
      creditNote: true,
      invoiceNumber: 'GS-2026-007',
      issueDate: '2026-09-10',
      dueDate: '2026-09-24',
      sellerName: 'Muster Software',
      currency: 'USD',
      sellerIban: 'DE89370400440532013000',
      vatCents: 380,
      grossCents: 2380,
      dueCents: 2380,
      prepaidCents: null,
      vatRates: [19],
    });
  });

  test('other XML is not an e-invoice', () => {
    expect(parseEInvoiceXml('<Invoice><Foo/></Invoice>')).toBeNull();
    expect(parseEInvoiceXml('<Document/>')).toBeNull();
    expect(parseEInvoiceXml('not xml at all <')).toBeNull();
  });
});

describe('Skonto terms', () => {
  test.each([
    ['#SKONTO#TAGE=10#PROZENT=3.00#BASISBETRAG=100.00#', { days: 10, percent: 3 }],
    ['2 % Skonto bei Zahlung innerhalb von 14 Tagen, 30 Tage netto', { days: 14, percent: 2 }],
    ['Innerhalb 8 Tagen abzüglich 2,5 % Skonto', { days: 8, percent: 2.5 }],
    ['30 Tage netto', null],
  ])('%s', (terms, expected) => {
    expect(parseSkonto(terms)).toEqual(expected);
  });

  test('attachment names', () => {
    expect(EINVOICE_ATTACHMENT_NAMES).toContain('factur-x.xml');
  });
});
