import { normalizeIban, parseAmountCents, parseDateAny } from './money';
import { isPaymentIntermediary } from './names';
import { FinanceParseError, type BankEntry, type BankStatement } from './types';
import { all, attr, child, children, firstText, parseXml, text, type XmlNode } from './xml';

export type { BankEntry, BankStatement } from './types';

const ARRAY_TAGS = ['Stmt', 'Rpt', 'Ntfctn', 'Bal', 'Ntry', 'NtryDtls', 'TxDtls', 'Ustrd'];

const CONTAINERS: { wrapper: string; item: string; format: BankStatement['format'] }[] = [
  { wrapper: 'BkToCstmrStmt', item: 'Stmt', format: 'camt053' },
  { wrapper: 'BkToCstmrAcctRpt', item: 'Rpt', format: 'camt052' },
  { wrapper: 'BkToCstmrDbtCdtNtfctn', item: 'Ntfctn', format: 'camt054' },
];

/**
 * Parses ISO 20022 cash management messages: camt.052 (intraday report), camt.053 (statement)
 * and camt.054 (debit/credit notification), versions .02 through .08. Differences between the
 * versions (status as text or code, parties with or without the Pty wrapper) are handled per
 * field. Informational entries (status INFO) are skipped.
 */
export function parseCamt(xml: string): BankStatement[] {
  const root = parseXml(xml, ARRAY_TAGS);
  const document = child(root, 'Document');
  const container = CONTAINERS.find((c) => child(document, c.wrapper) !== undefined);
  if (!document || !container) throw new FinanceParseError('not a camt.052/053/054 document');
  return all(document, container.wrapper, container.item).map((statement) =>
    parseStatement(statement, container.format),
  );
}

function parseStatement(node: XmlNode, format: BankStatement['format']): BankStatement {
  const warnings: string[] = [];
  const ibanText = text(node, 'Acct', 'Id', 'IBAN');
  const accountIban = ibanText ? (normalizeIban(ibanText) ?? ibanText) : null;
  const balances = children(node, 'Bal').map(parseBalance);
  const pick = (...codes: string[]) => {
    for (const code of codes) {
      const matches = balances.filter((b) => b.code === code && b.cents !== null);
      // Several interim balances are possible; the latest one is the closing view.
      const found = matches.sort((a, b) => (a.date ?? '').localeCompare(b.date ?? '')).at(-1);
      if (found) return found;
    }
    return null;
  };
  const opening = pick('OPBD', 'PRCD');
  const closing = pick('CLBD', 'ITBD');
  const currency = text(node, 'Acct', 'Ccy') ?? opening?.currency ?? closing?.currency ?? null;

  const entries = children(node, 'Ntry').flatMap((entry, index) =>
    parseEntry(entry, currency, warnings, index),
  );

  const bookingDates = entries.map((e) => e.bookingDate).sort();
  const from = dateOf(node, 'FrToDt', 'FrDtTm') ?? bookingDates[0] ?? null;
  const to = dateOf(node, 'FrToDt', 'ToDtTm') ?? bookingDates.at(-1) ?? null;

  const openingCents = opening?.cents ?? null;
  const closingCents = closing?.cents ?? null;
  if (openingCents !== null && closingCents !== null) {
    const booked = entries.filter((e) => e.status === 'booked');
    const sum = booked.reduce((total, e) => total + e.amountCents, 0);
    if (sum !== closingCents - openingCents) {
      warnings.push(
        `booked entries sum to ${sum} cents, but closing minus opening balance is ${closingCents - openingCents} cents`,
      );
    }
  }
  return {
    format,
    accountIban,
    currency,
    from,
    to,
    openingCents,
    closingCents,
    entries,
    warnings,
  };
}

function parseBalance(node: XmlNode) {
  const code = firstText(node, ['Tp', 'CdOrPrtry', 'Cd'], ['Tp', 'CdOrPrtry', 'Prtry']);
  return {
    code,
    cents: signedAmount(node, text(node, 'CdtDbtInd')),
    currency: attr(node, 'Ccy', 'Amt'),
    date: dateOf(node, 'Dt'),
  };
}

/** Amt with its Ccy attribute; the amount is always positive and CdtDbtInd DBIT makes it negative. */
function signedAmount(node: XmlNode | undefined, indicator: string | null): number | null {
  const raw = text(node, 'Amt');
  if (raw === null) return null;
  const cents = parseAmountCents(raw, 'en');
  if (cents === null) return null;
  const magnitude = Math.abs(cents);
  return indicator === 'DBIT' ? -magnitude : magnitude;
}

/** A date element that holds either Dt or DtTm (or is itself a DtTm like FrDtTm). */
function dateOf(node: XmlNode | undefined, ...path: string[]): string | null {
  const target = child(node, ...path);
  if (target === undefined) return null;
  const raw = typeof target === 'string' ? text(target) : firstText(target, ['Dt'], ['DtTm']);
  return raw ? parseDateAny(raw) : null;
}

function statusOf(entry: XmlNode): 'booked' | 'pending' | 'skip' {
  const code = (firstText(entry, ['Sts', 'Cd'], ['Sts', 'Prtry'], ['Sts']) ?? 'BOOK').toUpperCase();
  if (code === 'INFO') return 'skip';
  if (code === 'PDNG' || code === 'FUTR') return 'pending';
  return 'booked';
}

function parseEntry(
  entry: XmlNode,
  statementCurrency: string | null,
  warnings: string[],
  index: number,
): BankEntry[] {
  const status = statusOf(entry);
  if (status === 'skip') return [];
  const indicator = text(entry, 'CdtDbtInd');
  const amountCents = signedAmount(entry, indicator);
  const bookingDate = dateOf(entry, 'BookgDt') ?? dateOf(entry, 'ValDt');
  if (amountCents === null || bookingDate === null) {
    warnings.push(`entry ${index + 1} skipped: missing amount or date`);
    return [];
  }
  const reversal = text(entry, 'RvslInd') === 'true';
  const base = {
    bookingDate,
    valueDate: dateOf(entry, 'ValDt'),
    currency: attr(entry, 'Ccy', 'Amt') ?? statementCurrency ?? 'EUR',
    bankReference: text(entry, 'AcctSvcrRef'),
    bankCode: bankCodeOf(entry),
    bookingText: withReversal(text(entry, 'AddtlNtryInf'), reversal),
    status,
  };
  const details = all(entry, 'NtryDtls', 'TxDtls');

  // A batch booking lists its single transactions with their own amounts: one entry each.
  const batch =
    details.length > 1 && details.every((d) => transactionAmount(d, indicator) !== null);
  if (batch) {
    return details.map((detail) => {
      const cents = transactionAmount(detail, indicator) ?? 0;
      return {
        ...base,
        ...detailFields(detail, cents, reversal),
        amountCents: cents,
        currency: transactionCurrency(detail) ?? base.currency,
        bankReference: text(detail, 'Refs', 'AcctSvcrRef') ?? base.bankReference,
        bankCode: bankCodeOf(detail) ?? base.bankCode,
        bookingText: withReversal(text(detail, 'AddtlTxInf'), reversal) ?? base.bookingText,
      };
    });
  }

  const first = details[0];
  const fields = detailFields(first, amountCents, reversal);
  // Several details without their own amounts still describe one booking: keep every purpose.
  const purpose = details
    .map((d) => purposeOf(d))
    .filter(Boolean)
    .join(' ');
  return [
    {
      ...base,
      ...fields,
      purpose: purpose || fields.purpose || (text(entry, 'AddtlNtryInf') ?? ''),
      amountCents,
      bankReference: base.bankReference ?? text(first, 'Refs', 'AcctSvcrRef'),
      bankCode: base.bankCode ?? bankCodeOf(first),
      bookingText: base.bookingText ?? withReversal(text(first, 'AddtlTxInf'), reversal),
    },
  ];
}

function withReversal(value: string | null, reversal: boolean): string | null {
  if (!reversal) return value;
  return value ? `${value} (Storno)` : 'Storno';
}

/** TxDtls/AmtDtls/TxAmt (all versions) or TxDtls/Amt (from .04 on), signed by its own indicator. */
function transactionAmount(detail: XmlNode, entryIndicator: string | null): number | null {
  const indicator = text(detail, 'CdtDbtInd') ?? entryIndicator;
  return (
    signedAmount(child(detail, 'AmtDtls', 'TxAmt'), indicator) ?? signedAmount(detail, indicator)
  );
}

function transactionCurrency(detail: XmlNode): string | null {
  return attr(detail, 'Ccy', 'AmtDtls', 'TxAmt', 'Amt') ?? attr(detail, 'Ccy', 'Amt');
}

/**
 * The German GVC (BkTxCd/Prtry/Cd, e.g. "NTRF+105+...") is preferred because it names the
 * business case precisely; otherwise the ISO domain triple "PMNT-ICDT-ESCT".
 */
function bankCodeOf(node: XmlNode | undefined): string | null {
  const proprietary = text(node, 'BkTxCd', 'Prtry', 'Cd');
  if (proprietary) return proprietary;
  const domain = text(node, 'BkTxCd', 'Domn', 'Cd');
  if (!domain) return null;
  const family = text(node, 'BkTxCd', 'Domn', 'Fmly', 'Cd');
  const sub = text(node, 'BkTxCd', 'Domn', 'Fmly', 'SubFmlyCd');
  return [domain, family, sub].filter(Boolean).join('-');
}

/** The name of a party in .02 (Dbtr/Nm) or .08 (Dbtr/Pty/Nm) layout. */
function partyName(parties: XmlNode | undefined, role: string): string | null {
  return firstText(parties, [role, 'Pty', 'Nm'], [role, 'Nm']);
}

function purposeOf(detail: XmlNode | undefined): string {
  const unstructured = all(detail, 'RmtInf', 'Ustrd')
    .map((u) => text(u) ?? '')
    .filter(Boolean)
    .join(' ');
  const structured = all(detail, 'RmtInf', 'Strd')
    .map((s) => text(s, 'CdtrRefInf', 'Ref'))
    .filter((r): r is string => r !== null && !unstructured.includes(r));
  return [unstructured, ...structured].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
}

function detailFields(detail: XmlNode | undefined, amountCents: number, reversal: boolean) {
  const parties = child(detail, 'RltdPties');
  // A reversal keeps the parties of the original booking, so the other side sits in the opposite role.
  const incoming = amountCents >= 0 !== reversal;
  const role = incoming ? 'Dbtr' : 'Cdtr';
  const direct = partyName(parties, role);
  const ultimate = partyName(parties, incoming ? 'UltmtDbtr' : 'UltmtCdtr');
  // A payment provider in the direct role hides the real merchant; the ultimate party names it.
  const counterpartyName =
    ultimate && (!direct || isPaymentIntermediary(direct)) ? ultimate : (direct ?? ultimate ?? '');
  const ibanText = text(parties, `${role}Acct`, 'Id', 'IBAN');
  const endToEnd = text(detail, 'Refs', 'EndToEndId');
  // The SEPA creditor identifier travels as a private id of the creditor (DK convention).
  const creditorId = firstText(
    parties,
    ['Cdtr', 'Pty', 'Id', 'PrvtId', 'Othr', 'Id'],
    ['Cdtr', 'Id', 'PrvtId', 'Othr', 'Id'],
  );
  return {
    counterpartyName,
    counterpartyIban: ibanText ? normalizeIban(ibanText) : null,
    purpose: purposeOf(detail),
    endToEndId: endToEnd && endToEnd.toUpperCase() !== 'NOTPROVIDED' ? endToEnd : null,
    mandateId: text(detail, 'Refs', 'MndtId'),
    creditorId: creditorId ? creditorId.replace(/\s+/g, '').toUpperCase() : null,
  };
}
