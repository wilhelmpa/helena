import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  EINVOICE_ATTACHMENT_NAMES,
  factsFromText,
  normalizeIban,
  parseEInvoiceXml,
  type InvoiceFacts,
} from '@helena/finance';
import { parseMessage } from '@repo/mail';
import { mailReceiptFacts } from './mail-facts';
import type { MailBodyProvenance } from './mail-body';
import { originalDocumentEvidence, type OriginalDocumentEvidence } from './original-pair';
import { extractText, hasProgram, runProgram } from '@repo/vault';

// What Helena reads from a receipt file (docs/helena-decisions/decisions.md §7): the
// e-invoice XML first (ZUGFeRD/Factur-X embedded in the PDF, or an XRechnung file), then the
// text of the PDF or the OCR of a scan, whose facts only fill what the XML left open. The file
// is only read; temporary files live below TMPDIR and are removed afterwards.

export type ExtractionMethod = 'zugferd' | 'xrechnung' | 'text' | 'ocr' | 'manual' | 'none';

export type EInvoiceSource = { kind: 'embedded'; name: string } | { kind: 'file' };

// The part of the facts the table has no column for; kept in helena_receipt.details.
// A type, not an interface: it must fit the route schema's record of unknown values.
export type ReceiptDetails = {
  mailBody?: MailBodyProvenance;
  mailSource?: { messageId: number; threadId: number; kind: 'attachment' | 'body' };
  profile?: string | null;
  typeCode?: string | null;
  creditNote?: boolean;
  directDebit?: boolean;
  paymentReference?: string | null;
  creditorId?: string | null;
  mandateId?: string | null;
  paymentMeansCode?: string | null;
  skonto?: { days: number; percent: number } | null;
  dueCents?: number | null;
  netCents?: number | null;
  sellerVatId?: string | null;
  buyerName?: string | null;
  vatRates?: number[];
  einvoice?: EInvoiceSource | null;
};

export interface ExtractedReceipt {
  /** Ephemeral native-text proof; never read back from mutable receipt facts. */
  originalEvidence?: OriginalDocumentEvidence | null;
  issuer: string | null;
  invoiceNumber: string | null;
  invoiceDate: string | null;
  dueDate: string | null;
  grossCents: number | null;
  vatCents: number | null;
  currency: string | null;
  iban: string | null;
  direction: 'incoming' | 'outgoing';
  extraction: ExtractionMethod;
  // Why a file gave nothing or less than expected: a code the page words ('not_einvoice',
  // 'no_facts', 'missing_programs: …') or the extraction tool's own message.
  extractionError: string | null;
  textExcerpt: string | null;
  details: ReceiptDetails;
}

export const RECEIPT_EXTENSIONS = ['.pdf', '.png', '.jpg', '.jpeg', '.xml'] as const;
const MAX_XML_BYTES = 10 * 1024 * 1024;
const EXCERPT_CHARS = 2000;
const TOOL_TIMEOUT_MS = 30_000;

export function isReceiptFile(filename: string): boolean {
  return (RECEIPT_EXTENSIONS as readonly string[]).includes(path.extname(filename).toLowerCase());
}

async function readXml(file: string): Promise<string | null> {
  const info = await stat(file);
  return info.size > MAX_XML_BYTES ? null : readFile(file, 'utf8');
}

// The PDF's embedded files, as pdfdetach -list numbers them ("1: factur-x.xml").
async function embeddedFiles(pdf: string): Promise<{ index: number; name: string }[]> {
  if (!hasProgram('pdfdetach')) return [];
  const listed = await runProgram(['pdfdetach', '-list', pdf], {
    timeoutMs: TOOL_TIMEOUT_MS,
    maxBytes: 256 * 1024,
  });
  if (listed.code !== 0) return [];
  return listed.stdout
    .split('\n')
    .map((line) => /^\s*(\d+):\s*(.+?)\s*$/.exec(line))
    .filter((match): match is RegExpExecArray => match !== null)
    .map((match) => ({ index: Number(match[1]), name: match[2] ?? '' }));
}

/**
 * The e-invoice XML embedded in a PDF: the standard attachment names first, then any other
 * .xml that parses as an invoice. Each file is saved under a fixed name of ours (pdfdetach
 * -save N -o), never under the name the PDF gives it, which could point outside the folder.
 */
export async function readEmbeddedInvoice(
  pdf: string,
  onlyName?: string,
): Promise<{ name: string; xml: string; facts: InvoiceFacts } | null> {
  const preferred = EINVOICE_ATTACHMENT_NAMES.map((name) => name.toLowerCase());
  const rank = (name: string) => {
    const at = preferred.indexOf(name.toLowerCase());
    return at < 0 ? preferred.length : at;
  };
  const files = (await embeddedFiles(pdf))
    .filter((file) => (onlyName ? file.name === onlyName : /\.xml$/i.test(file.name)))
    .sort((a, b) => rank(a.name) - rank(b.name));
  if (!files.length) return null;
  const dir = await mkdtemp(path.join(tmpdir(), 'helena-receipt-'));
  try {
    for (const file of files.slice(0, 5)) {
      const target = path.join(dir, `attachment-${file.index}.xml`);
      const saved = await runProgram(
        ['pdfdetach', '-save', String(file.index), '-o', target, pdf],
        { timeoutMs: TOOL_TIMEOUT_MS },
      );
      if (saved.code !== 0) continue;
      const xml = await readXml(target).catch(() => null);
      const facts = xml ? parseEInvoiceXml(xml) : null;
      if (xml && facts) return { name: file.name, xml, facts };
    }
    return null;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function fromInvoice(facts: InvoiceFacts, source: EInvoiceSource, ownIbans: Set<string>) {
  return {
    issuer: facts.sellerName,
    invoiceNumber: facts.invoiceNumber,
    invoiceDate: facts.issueDate,
    dueDate: facts.dueDate,
    grossCents: facts.grossCents,
    vatCents: facts.vatCents,
    currency: facts.currency,
    iban: facts.sellerIban,
    // An invoice that asks to be paid into one of the project's own accounts was written by it.
    direction:
      facts.sellerIban && ownIbans.has(facts.sellerIban)
        ? ('outgoing' as const)
        : ('incoming' as const),
    details: {
      profile: facts.profile,
      typeCode: facts.typeCode,
      creditNote: facts.creditNote,
      directDebit: facts.paymentMeansCode === '59' || !!facts.mandateId,
      paymentReference: facts.paymentReference,
      creditorId: facts.creditorId,
      mandateId: facts.mandateId,
      paymentMeansCode: facts.paymentMeansCode,
      skonto: facts.skonto,
      dueCents: facts.dueCents,
      netCents: facts.netCents,
      sellerVatId: facts.sellerVatId,
      buyerName: facts.buyerName,
      vatRates: facts.vatRates,
      einvoice: source,
    } satisfies ReceiptDetails,
  };
}

/**
 * Reads one receipt file. `ownIbans` are the project's accounts: an IBAN of theirs printed on
 * the receipt is not the payee's, and marks an invoice the project wrote itself.
 */
export async function extractReceiptFile(
  file: string,
  filename: string,
  ownIbanList: string[],
): Promise<ExtractedReceipt> {
  const ownIbans = new Set(
    ownIbanList.map((iban) => normalizeIban(iban)).filter((iban): iban is string => !!iban),
  );
  const extension = path.extname(filename).toLowerCase();
  if (extension === '.eml') {
    const parsed = await parseMessage(await readFile(file));
    return mailReceiptFacts(
      {
        subject: parsed.subject,
        textBody: parsed.text,
        htmlBody: parsed.html,
        fromName: parsed.from?.name ?? '',
        fromAddress: parsed.from?.address ?? '',
        sentAt: parsed.date,
      },
      ownIbanList,
    );
  }
  const problems: string[] = [];

  let invoice: ReturnType<typeof fromInvoice> | null = null;
  let method: ExtractionMethod = 'none';
  if (extension === '.xml') {
    const xml = await readXml(file).catch(() => null);
    const facts = xml ? parseEInvoiceXml(xml) : null;
    if (facts) {
      invoice = fromInvoice(facts, { kind: 'file' }, ownIbans);
      method = 'xrechnung';
    } else problems.push('not_einvoice');
  } else if (extension === '.pdf') {
    const embedded = await readEmbeddedInvoice(file).catch(() => null);
    if (embedded) {
      invoice = fromInvoice(embedded.facts, { kind: 'embedded', name: embedded.name }, ownIbans);
      method = 'zugferd';
    }
  }

  let text: string | null = null;
  let completeNativePdf = false;
  if (extension !== '.xml') {
    const extraction = await extractText(file).catch((error: unknown) => ({
      status: 'failed' as const,
      error: error instanceof Error ? error.message : String(error),
    }));
    if (extraction.status === 'done') {
      text = extraction.text;
      completeNativePdf = extraction.nativePdfComplete === true;
    } else if (extraction.status === 'unavailable')
      problems.push(`missing_programs: ${extraction.missing.join(', ')}`);
    else if (extraction.status === 'failed') problems.push(extraction.error);
    else problems.push(extraction.reason);
  }
  const fromText = text ? factsFromText(text, [...ownIbans]) : null;
  if (method === 'none' && text?.trim()) method = extension === '.pdf' ? 'text' : 'ocr';

  const details: ReceiptDetails = invoice?.details ?? {
    creditNote: fromText?.creditNote ?? false,
    directDebit: fromText?.directDebit ?? false,
    // The text says the amount is collected by direct debit: match it like SEPA code 59.
    paymentMeansCode: fromText?.directDebit ? '59' : null,
    einvoice: null,
  };
  const noFacts = !invoice && !fromText?.grossCents && !fromText?.invoiceNumber;
  if (noFacts && method !== 'none' && !problems.length) problems.push('no_facts');
  return {
    originalEvidence: completeNativePdf && text ? originalDocumentEvidence(text) : null,
    issuer: invoice?.issuer ?? fromText?.issuer ?? null,
    invoiceNumber: invoice?.invoiceNumber ?? fromText?.invoiceNumber ?? null,
    invoiceDate: invoice?.invoiceDate ?? fromText?.invoiceDate ?? null,
    dueDate: invoice?.dueDate ?? fromText?.dueDate ?? null,
    grossCents: invoice?.grossCents ?? fromText?.grossCents ?? null,
    vatCents: invoice?.vatCents ?? fromText?.vatCents ?? null,
    currency: invoice?.currency ?? fromText?.currency ?? null,
    iban: invoice?.iban ?? fromText?.iban ?? null,
    direction: invoice?.direction ?? fromText?.direction ?? 'incoming',
    extraction: method,
    extractionError: problems.length ? problems.join(' ').slice(0, 500) : null,
    textExcerpt: text ? text.slice(0, EXCERPT_CHARS) : null,
    details,
  };
}
