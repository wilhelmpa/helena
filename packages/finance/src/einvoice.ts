import { normalizeIban, parseAmountCents, parseDateAny } from './money';
import { all, attr, child, firstText, parseXml, text, type XmlNode, type XmlObject } from './xml';

/** Facts of an EN 16931 e-invoice; BT numbers refer to the semantic model. */
export interface InvoiceFacts {
  syntax: 'cii' | 'ubl';
  profile: string | null;
  typeCode: string | null;
  creditNote: boolean;
  invoiceNumber: string | null;
  issueDate: string | null;
  dueDate: string | null;
  sellerName: string | null;
  sellerVatId: string | null;
  buyerName: string | null;
  currency: string | null;
  paymentMeansCode: string | null;
  paymentReference: string | null;
  sellerIban: string | null;
  mandateId: string | null;
  creditorId: string | null;
  netCents: number | null;
  vatCents: number | null;
  grossCents: number | null;
  prepaidCents: number | null;
  dueCents: number | null;
  vatRates: number[];
  skonto: { days: number; percent: number } | null;
  paymentTerms: string | null;
}

/** File names under which ZUGFeRD, Factur-X and XRechnung embed their XML in a PDF. */
export const EINVOICE_ATTACHMENT_NAMES = [
  'factur-x.xml',
  'zugferd-invoice.xml',
  'ZUGFeRD-invoice.xml',
  'xrechnung.xml',
];

/** UNTDID 1001 document types that are credit notes. */
const CREDIT_NOTE_CODES = new Set([
  '81',
  '83',
  '261',
  '262',
  '296',
  '308',
  '381',
  '396',
  '420',
  '458',
  '532',
]);

const ARRAY_TAGS = [
  'ApplicableTradeTax',
  'SpecifiedTradeSettlementPaymentMeans',
  'SpecifiedTradePaymentTerms',
  'SpecifiedTaxRegistration',
  'TaxTotalAmount',
  'IncludedNote',
  'PaymentMeans',
  'PaymentTerms',
  'TaxTotal',
  'TaxSubtotal',
  'PartyTaxScheme',
  'PartyIdentification',
  'Note',
];

/**
 * Reads CII (ZUGFeRD 2.x, Factur-X, XRechnung CII, best effort ZUGFeRD 1.0) and UBL (Invoice,
 * CreditNote) XML. Returns null when the document is neither.
 */
export function parseEInvoiceXml(xml: string): InvoiceFacts | null {
  let root: XmlObject;
  try {
    root = parseXml(xml, ARRAY_TAGS);
  } catch {
    return null;
  }
  const cii = child(root, 'CrossIndustryInvoice');
  if (cii) return parseCii(cii);
  const zugferd1 = child(root, 'CrossIndustryDocument');
  if (zugferd1) return parseZugferd1(zugferd1);
  for (const name of ['Invoice', 'CreditNote'] as const) {
    const ubl = child(root, name);
    // Invoice is a common root name; the UBL shape (IssueDate or monetary total) confirms it.
    if (ubl && (child(ubl, 'LegalMonetaryTotal') || child(ubl, 'IssueDate'))) {
      return parseUbl(ubl, name === 'CreditNote');
    }
  }
  return null;
}

const cents = (value: string | null) => (value === null ? null : parseAmountCents(value, 'en'));
const date = (value: string | null) => (value === null ? null : parseDateAny(value));
const iban = (value: string | null) => (value === null ? null : normalizeIban(value));

function percent(value: string | null): number | null {
  if (value === null) return null;
  const n = Number(value.replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

function unique(values: (number | null)[]): number[] {
  return [...new Set(values.filter((v): v is number => v !== null))];
}

/** The amount whose currencyID matches the invoice currency (BT-110 may repeat in BT-6). */
function amountInCurrency(nodes: XmlNode[], currency: string | null): number | null {
  const matching = nodes.find(
    (n) => !currency || !attr(n, 'currencyID') || attr(n, 'currencyID') === currency,
  );
  return cents(text(matching ?? nodes[0]));
}

/**
 * Skonto terms: the XRechnung convention "#SKONTO#TAGE=14#PROZENT=2.00#" first, then German and
 * English prose such as "2 % Skonto bei Zahlung innerhalb von 14 Tagen".
 */
export function parseSkonto(terms: string | null): { days: number; percent: number } | null {
  if (!terms) return null;
  const coded = /#SKONTO#TAGE=(\d+)#PROZENT=(\d+(?:[.,]\d+)?)#/i.exec(terms);
  if (coded) return { days: Number(coded[1]), percent: Number((coded[2] ?? '').replace(',', '.')) };
  const percentFirst =
    /(\d+(?:[.,]\d+)?)\s*%\s*(?:Skonto|discount)[^\d]{0,60}?(\d{1,3})\s*(?:Tage|Tagen|days)/i.exec(
      terms,
    );
  if (percentFirst) {
    return {
      days: Number(percentFirst[2]),
      percent: Number((percentFirst[1] ?? '').replace(',', '.')),
    };
  }
  const daysFirst =
    /(\d{1,3})\s*(?:Tage|Tagen|days)[^\d%]{0,40}?(\d+(?:[.,]\d+)?)\s*%\s*(?:Skonto|discount)/i.exec(
      terms,
    );
  if (daysFirst) {
    return { days: Number(daysFirst[1]), percent: Number((daysFirst[2] ?? '').replace(',', '.')) };
  }
  return null;
}

function parseCii(doc: XmlNode): InvoiceFacts {
  const exchanged = child(doc, 'ExchangedDocument');
  const transaction = child(doc, 'SupplyChainTradeTransaction');
  const agreement = child(transaction, 'ApplicableHeaderTradeAgreement');
  const settlement = child(transaction, 'ApplicableHeaderTradeSettlement');
  const seller = child(agreement, 'SellerTradeParty');
  const summation = child(settlement, 'SpecifiedTradeSettlementHeaderMonetarySummation');
  const means = all(settlement, 'SpecifiedTradeSettlementPaymentMeans');
  const terms = all(settlement, 'SpecifiedTradePaymentTerms');
  const currency = text(settlement, 'InvoiceCurrencyCode');
  const typeCode = text(exchanged, 'TypeCode');
  const paymentTerms = joinTexts(terms.map((t) => text(t, 'Description')));
  return {
    syntax: 'cii',
    profile: text(
      doc,
      'ExchangedDocumentContext',
      'GuidelineSpecifiedDocumentContextParameter',
      'ID',
    ),
    typeCode,
    creditNote: typeCode !== null && CREDIT_NOTE_CODES.has(typeCode),
    invoiceNumber: text(exchanged, 'ID'),
    issueDate: date(text(exchanged, 'IssueDateTime', 'DateTimeString')),
    dueDate: date(firstOf(terms.map((t) => text(t, 'DueDateDateTime', 'DateTimeString')))),
    sellerName:
      text(seller, 'Name') ?? text(seller, 'SpecifiedLegalOrganization', 'TradingBusinessName'),
    sellerVatId: vatRegistration(seller),
    buyerName: text(agreement, 'BuyerTradeParty', 'Name'),
    currency,
    paymentMeansCode: firstOf(means.map((m) => text(m, 'TypeCode'))),
    paymentReference: text(settlement, 'PaymentReference'),
    sellerIban: iban(
      firstOf(means.map((m) => text(m, 'PayeePartyCreditorFinancialAccount', 'IBANID'))),
    ),
    mandateId: firstOf(terms.map((t) => text(t, 'DirectDebitMandateID'))),
    creditorId: text(settlement, 'CreditorReferenceID'),
    netCents: cents(text(summation, 'TaxBasisTotalAmount')),
    vatCents: amountInCurrency(all(summation, 'TaxTotalAmount'), currency),
    grossCents: cents(text(summation, 'GrandTotalAmount')),
    prepaidCents: cents(text(summation, 'TotalPrepaidAmount')),
    dueCents: cents(text(summation, 'DuePayableAmount')),
    vatRates: unique(
      all(settlement, 'ApplicableTradeTax').map((t) => percent(text(t, 'RateApplicablePercent'))),
    ),
    skonto: parseSkonto(paymentTerms),
    paymentTerms,
  };
}

/** ZUGFeRD 1.0 uses the older CII D14 structure with different element names. */
function parseZugferd1(doc: XmlNode): InvoiceFacts {
  const header = child(doc, 'HeaderExchangedDocument');
  const transaction = child(doc, 'SpecifiedSupplyChainTradeTransaction');
  const agreement = child(transaction, 'ApplicableSupplyChainTradeAgreement');
  const settlement = child(transaction, 'ApplicableSupplyChainTradeSettlement');
  const seller = child(agreement, 'SellerTradeParty');
  const summation = child(settlement, 'SpecifiedTradeSettlementMonetarySummation');
  const means = all(settlement, 'SpecifiedTradeSettlementPaymentMeans');
  const terms = all(settlement, 'SpecifiedTradePaymentTerms');
  const currency = text(settlement, 'InvoiceCurrencyCode');
  const typeCode = text(header, 'TypeCode');
  const paymentTerms = joinTexts(terms.map((t) => text(t, 'Description')));
  return {
    syntax: 'cii',
    profile: text(
      doc,
      'SpecifiedExchangedDocumentContext',
      'GuidelineSpecifiedDocumentContextParameter',
      'ID',
    ),
    typeCode,
    creditNote: typeCode !== null && CREDIT_NOTE_CODES.has(typeCode),
    invoiceNumber: text(header, 'ID'),
    issueDate: date(text(header, 'IssueDateTime', 'DateTimeString')),
    dueDate: date(firstOf(terms.map((t) => text(t, 'DueDateDateTime', 'DateTimeString')))),
    sellerName: text(seller, 'Name'),
    sellerVatId: vatRegistration(seller),
    buyerName: text(agreement, 'BuyerTradeParty', 'Name'),
    currency,
    paymentMeansCode: firstOf(means.map((m) => text(m, 'TypeCode'))),
    paymentReference: text(settlement, 'PaymentReference'),
    sellerIban: iban(
      firstOf(means.map((m) => text(m, 'PayeePartyCreditorFinancialAccount', 'IBANID'))),
    ),
    mandateId: null,
    creditorId: text(settlement, 'CreditorReferenceID'),
    netCents: cents(text(summation, 'TaxBasisTotalAmount')),
    vatCents: amountInCurrency(all(summation, 'TaxTotalAmount'), currency),
    grossCents: cents(text(summation, 'GrandTotalAmount')),
    prepaidCents: cents(text(summation, 'TotalPrepaidAmount')),
    dueCents: cents(text(summation, 'DuePayableAmount')),
    vatRates: unique(
      all(settlement, 'ApplicableTradeTax').map((t) => percent(text(t, 'ApplicablePercent'))),
    ),
    skonto: parseSkonto(paymentTerms),
    paymentTerms,
  };
}

/** BT-31: the tax registration with scheme "VA" (VAT id), not "FC" (German tax number). */
function vatRegistration(party: XmlNode | undefined): string | null {
  const registrations = all(party, 'SpecifiedTaxRegistration');
  const vat = registrations.find((r) => attr(r, 'schemeID', 'ID') === 'VA');
  return text(vat, 'ID');
}

function parseUbl(doc: XmlNode, creditNoteRoot: boolean): InvoiceFacts {
  const supplier = child(doc, 'AccountingSupplierParty', 'Party');
  const customer = child(doc, 'AccountingCustomerParty', 'Party');
  const totals = child(doc, 'LegalMonetaryTotal');
  const means = all(doc, 'PaymentMeans');
  const currency = text(doc, 'DocumentCurrencyCode');
  const typeCode = firstText(doc, ['InvoiceTypeCode'], ['CreditNoteTypeCode']);
  const paymentTerms = joinTexts(
    all(doc, 'PaymentTerms').flatMap((t) => all(t, 'Note').map((n) => text(n))),
  );
  // Two TaxTotal elements are allowed (document and tax currency); the one with subtotals counts.
  const taxTotals = all(doc, 'TaxTotal');
  const mainTax =
    taxTotals.find(
      (t) => attr(t, 'currencyID', 'TaxAmount') === currency && all(t, 'TaxSubtotal').length,
    ) ??
    taxTotals.find((t) => attr(t, 'currencyID', 'TaxAmount') === currency) ??
    taxTotals[0];
  const vatScheme = all(supplier, 'PartyTaxScheme').find(
    (s) => text(s, 'TaxScheme', 'ID') === 'VAT',
  );
  const sepaId = [
    ...all(supplier, 'PartyIdentification'),
    ...all(doc, 'PayeeParty', 'PartyIdentification'),
  ].find((p) => attr(p, 'schemeID', 'ID') === 'SEPA');
  return {
    syntax: 'ubl',
    profile: text(doc, 'CustomizationID'),
    typeCode,
    creditNote: creditNoteRoot || (typeCode !== null && CREDIT_NOTE_CODES.has(typeCode)),
    invoiceNumber: text(doc, 'ID'),
    issueDate: date(text(doc, 'IssueDate')),
    dueDate: date(text(doc, 'DueDate') ?? firstOf(means.map((m) => text(m, 'PaymentDueDate')))),
    sellerName:
      text(supplier, 'PartyLegalEntity', 'RegistrationName') ?? text(supplier, 'PartyName', 'Name'),
    sellerVatId: text(vatScheme, 'CompanyID'),
    buyerName:
      text(customer, 'PartyLegalEntity', 'RegistrationName') ?? text(customer, 'PartyName', 'Name'),
    currency,
    paymentMeansCode: firstOf(means.map((m) => text(m, 'PaymentMeansCode'))),
    paymentReference: firstOf(means.map((m) => text(m, 'PaymentID'))),
    sellerIban: iban(firstOf(means.map((m) => text(m, 'PayeeFinancialAccount', 'ID')))),
    mandateId: firstOf(means.map((m) => text(m, 'PaymentMandate', 'ID'))),
    creditorId: text(sepaId, 'ID'),
    netCents: cents(text(totals, 'TaxExclusiveAmount')),
    vatCents: cents(text(mainTax, 'TaxAmount')),
    grossCents: cents(text(totals, 'TaxInclusiveAmount')),
    prepaidCents: cents(text(totals, 'PrepaidAmount')),
    dueCents: cents(text(totals, 'PayableAmount')),
    vatRates: unique(
      all(mainTax, 'TaxSubtotal').map((s) => percent(text(s, 'TaxCategory', 'Percent'))),
    ),
    skonto: parseSkonto(paymentTerms),
    paymentTerms,
  };
}

function firstOf(values: (string | null)[]): string | null {
  return values.find((v): v is string => v !== null) ?? null;
}

function joinTexts(values: (string | null)[]): string | null {
  const joined = values.filter((v): v is string => v !== null).join('\n');
  return joined || null;
}
