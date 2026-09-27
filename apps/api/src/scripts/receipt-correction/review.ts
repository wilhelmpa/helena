import { createHash } from 'node:crypto';

export interface Facts {
  issuer: string | null;
  totalGrossCents: number | null;
  vatCents: number | null;
  currency: string;
}

export interface Correction {
  receiptId: number;
  projectId: number;
  projectKey: 'FAM' | 'PRIV';
  teamId: number;
  messageId: number;
  threadId: number;
  attachmentId: number | null;
  originalSha256: string;
  originalSize: number;
  before: Facts;
  changes: Partial<Facts>;
}

export interface Manifest {
  version: 1;
  release: string;
  corrections: Correction[];
}

export function requireCorrection(ok: unknown): asserts ok {
  if (!ok) throw new Error('Receipt correction guard failed');
}

export function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  return `{${Object.entries(value)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
    .join(',')}}`;
}

export function digest(value: unknown): string {
  return createHash('sha256').update(canonical(value)).digest('hex');
}

function object(value: unknown, keys: string[]): asserts value is Record<string, unknown> {
  requireCorrection(value && typeof value === 'object' && !Array.isArray(value));
  requireCorrection(Object.keys(value).every((key) => keys.includes(key)));
}

const FIELDS = ['issuer', 'totalGrossCents', 'vatCents', 'currency'];

function facts(value: unknown, partial = false): void {
  object(value, FIELDS);
  const keys = Object.keys(value);
  requireCorrection(partial ? keys.length > 0 : keys.length === FIELDS.length);
  for (const key of keys) {
    const field = value[key];
    if (key === 'issuer')
      requireCorrection(
        (!partial && field === null) ||
          (typeof field === 'string' &&
            field.length > 0 &&
            field.length <= 300 &&
            field.trim() === field),
      );
    else if (key === 'currency')
      requireCorrection(typeof field === 'string' && /^[A-Z]{3}$/.test(field));
    else
      requireCorrection(
        (!partial && field === null) ||
          (typeof field === 'number' &&
            Number.isSafeInteger(field) &&
            Math.abs(field) < 100_000_000_000_000),
      );
  }
}

export function parseManifest(value: unknown): Manifest {
  object(value, ['version', 'release', 'corrections']);
  requireCorrection(
    value.version === 1 &&
      typeof value.release === 'string' &&
      /^[a-f0-9]{40}$/.test(value.release),
  );
  requireCorrection(Array.isArray(value.corrections) && value.corrections.length === 9);
  for (const entry of value.corrections) {
    object(entry, [
      'receiptId',
      'projectId',
      'projectKey',
      'teamId',
      'messageId',
      'threadId',
      'attachmentId',
      'originalSha256',
      'originalSize',
      'before',
      'changes',
    ]);
    for (const key of ['receiptId', 'projectId', 'teamId', 'messageId', 'threadId', 'originalSize'])
      requireCorrection(
        typeof entry[key] === 'number' && Number.isSafeInteger(entry[key]) && entry[key] > 0,
      );
    requireCorrection(
      typeof entry.originalSha256 === 'string' && /^[a-f0-9]{64}$/.test(entry.originalSha256),
    );
    facts(entry.before);
    facts(entry.changes, true);
    requireCorrection((entry.before as Facts).currency === 'EUR');
    if (entry.projectKey === 'FAM') {
      requireCorrection(entry.receiptId === 6 && entry.attachmentId === 300);
      requireCorrection(Object.keys(entry.changes as object).join() === 'issuer');
    } else {
      requireCorrection(
        entry.projectKey === 'PRIV' &&
          entry.attachmentId === null &&
          typeof entry.receiptId === 'number' &&
          entry.receiptId >= 46 &&
          entry.receiptId <= 53,
      );
      requireCorrection(
        Object.keys(entry.changes as object)
          .sort()
          .join() === 'totalGrossCents,vatCents',
      );
    }
  }
  const manifest = value as unknown as Manifest;
  requireCorrection(new Set(manifest.corrections.map((entry) => entry.receiptId)).size === 9);
  requireCorrection(
    manifest.corrections.filter((entry) => entry.projectKey === 'FAM').length === 1,
  );
  return manifest;
}

export function checkFacts(entry: Correction, current: Facts, extracted: Facts): void {
  requireCorrection(canonical(current) === canonical(entry.before));
  for (const key of Object.keys(entry.changes) as (keyof Facts)[]) {
    requireCorrection(entry.changes[key] === extracted[key]);
    requireCorrection(entry.changes[key] !== current[key]);
  }
}

export interface Binding {
  receiptId: number;
  revision: string;
  rowSha256: string;
  sourceSha256: string;
  originalSha256: string;
  originalSize: number;
  changes: Partial<Facts>;
}

export function checkBinding(reviewed: Binding, current: Binding): void {
  requireCorrection(canonical(reviewed) === canonical(current));
}
