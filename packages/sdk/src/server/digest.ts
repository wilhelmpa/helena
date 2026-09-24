import { createHash } from 'node:crypto';
import { canonicalJson } from '../runtime-profile';

// A short digest of a value that is neither empty nor a pure ${VAR} reference: enough to
// tell two values apart in a drift report, too short and one-way to give the value away.
export function maskValue(value: string): string {
  if (/^\$\{[A-Z0-9_]+\}$/.test(value)) return value;
  return `sha256:${createHash('sha256').update(value).digest('hex').slice(0, 16)}`;
}

export function profileDigest(value: unknown): string {
  return `sha256:${createHash('sha256').update(canonicalJson(value)).digest('hex')}`;
}
