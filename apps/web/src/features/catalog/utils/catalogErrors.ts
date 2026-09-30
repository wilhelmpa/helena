import { ApiError } from '@/lib/api/core/client';

// The API answers in English; the catalog says what happened in the reader's language.
// Each pattern names the key under `catalog.errors`.
const PATTERNS: [RegExp, string][] = [
  [/blocking findings/i, 'blocked'],
  [/must be acknowledged/i, 'acknowledge'],
  [/source is disabled/i, 'sourceDisabled'],
  [/isolation must be enabled/i, 'isolation'],
  [/no previous version/i, 'noPrevious'],
  [/already decided/i, 'decided'],
  [/no longer present/i, 'gone'],
  [/immutable pin/i, 'noPin'],
  [/content changed since inspection/i, 'changed'],
  [/too large/i, 'tooLarge'],
  [/left the curated registry/i, 'registry'],
  [/integrity|digest|differ|does not match/i, 'integrity'],
  [/returned \d{3}|failed to fetch|unable to connect|fetch failed/i, 'unreachable'],
  [/one GitHub repository|invalid package name/i, 'invalidSource'],
];

export function catalogErrorKey(error: unknown): string {
  if (error instanceof ApiError) {
    for (const [pattern, key] of PATTERNS) if (pattern.test(error.message)) return key;
    if (error.status === 403) return 'forbidden';
    if (error.status === 409) return 'conflict';
    if (error.status === 502 || error.status === 504) return 'unreachable';
  } else if (error instanceof Error && /fetch|network/i.test(error.message)) {
    return 'unreachable';
  }
  return 'generic';
}
