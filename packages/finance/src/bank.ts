import { createHash } from 'node:crypto';
import { unzipSync } from 'fflate';

import { parseCamt } from './camt';
import { decodeText, parseBankCsv } from './csv';
import { type BankEntry, type BankStatement } from './types';

const MAX_ZIP_ENTRIES = 500;
const MAX_ZIP_BYTES = 50 * 1024 * 1024;
const ZIP_EXTENSIONS = /\.(xml|csv|txt)$/i;

export interface BankFileResult {
  statements: BankStatement[];
  skipped: { name: string; reason: string }[];
}

const isZip = (bytes: Uint8Array) =>
  bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;

/**
 * Parses an uploaded bank file: a ZIP of camt XML or CSV files (as banks deliver camt.053
 * statements), a single camt XML file, or a CSV export. Files that cannot be read are listed in
 * `skipped` with the reason instead of failing the whole upload.
 */
export function parseBankFile(bytes: Uint8Array, filename: string): BankFileResult {
  const result: BankFileResult = { statements: [], skipped: [] };
  if (isZip(bytes) || /\.zip$/i.test(filename)) {
    let files: Record<string, Uint8Array>;
    try {
      files = unzipGuarded(bytes, result.skipped);
    } catch (error) {
      result.skipped.push({ name: filename, reason: `unreadable ZIP: ${messageOf(error)}` });
      return result;
    }
    for (const name of Object.keys(files).sort()) {
      parseOne(files[name] ?? new Uint8Array(), name, result);
    }
    return result;
  }
  parseOne(bytes, filename, result);
  return result;
}

/**
 * Unzips with limits against ZIP bombs: fflate sizes each output buffer from the declared size, so
 * capping the sum of declared sizes also caps what is allocated.
 */
function unzipGuarded(
  bytes: Uint8Array,
  skipped: BankFileResult['skipped'],
): Record<string, Uint8Array> {
  let entries = 0;
  let total = 0;
  let overflow = 0;
  const files = unzipSync(bytes, {
    filter: (file) => {
      if (file.name.endsWith('/')) return false;
      const base = file.name.split('/').pop() ?? '';
      if (file.name.startsWith('__MACOSX/') || base.startsWith('.')) return false;
      entries++;
      if (entries > MAX_ZIP_ENTRIES) {
        overflow++;
        return false;
      }
      if (!ZIP_EXTENSIONS.test(file.name)) {
        skipped.push({ name: file.name, reason: 'unsupported file type' });
        return false;
      }
      if (file.compression !== 0 && file.compression !== 8) {
        skipped.push({ name: file.name, reason: `unsupported compression ${file.compression}` });
        return false;
      }
      if (total + file.originalSize > MAX_ZIP_BYTES) {
        skipped.push({ name: file.name, reason: 'ZIP content exceeds 50 MB' });
        return false;
      }
      total += file.originalSize;
      return true;
    },
  });
  if (overflow) {
    skipped.push({
      name: `${overflow} more files`,
      reason: `ZIP holds more than ${MAX_ZIP_ENTRIES} files`,
    });
  }
  return files;
}

function parseOne(bytes: Uint8Array, name: string, result: BankFileResult): void {
  try {
    const text = decodeText(bytes);
    if (/^\s*</.test(text)) {
      const statements = parseCamt(text);
      if (!statements.length)
        result.skipped.push({ name, reason: 'camt document without statements' });
      result.statements.push(...statements);
      return;
    }
    result.statements.push(parseBankCsv(text));
  } catch (error) {
    result.skipped.push({ name, reason: messageOf(error) });
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Pending (vorgemerkt) entries are replaced by their booked version on a later import. */
export function isPending(entry: BankEntry): boolean {
  return entry.status === 'pending';
}

function normalizedPurpose(purpose: string): string {
  return purpose.replace(/\s+/g, ' ').trim().toLowerCase();
}

function baseKeyParts(accountIban: string | null, entry: BankEntry): string[] {
  const parts = [
    accountIban ?? '',
    entry.bookingDate,
    String(entry.amountCents),
    entry.counterpartyIban ?? '',
    normalizedPurpose(entry.purpose),
  ];
  if (entry.bankReference) parts.push(entry.bankReference);
  return parts;
}

/**
 * A stable key for one bank entry so a re-imported statement does not create duplicates. Two
 * genuinely identical entries on the same day (two equal coffees) differ by `occurrence`, their
 * position among identical entries in the file.
 */
export function dedupeKey(
  accountIban: string | null,
  entry: BankEntry,
  occurrence: number,
): string {
  const parts = [...baseKeyParts(accountIban, entry), String(occurrence)];
  return createHash('sha256').update(JSON.stringify(parts)).digest('hex').slice(0, 32);
}

/** Adds dedupe keys to entries, counting occurrences of identical entries in file order. */
export function dedupeEntries(
  accountIban: string | null,
  entries: BankEntry[],
): (BankEntry & { dedupeKey: string })[] {
  const seen = new Map<string, number>();
  return entries.map((entry) => {
    const base = JSON.stringify(baseKeyParts(accountIban, entry));
    const occurrence = seen.get(base) ?? 0;
    seen.set(base, occurrence + 1);
    return { ...entry, dedupeKey: dedupeKey(accountIban, entry, occurrence) };
  });
}
