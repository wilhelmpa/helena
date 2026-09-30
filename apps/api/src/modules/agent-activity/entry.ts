import { HttpError } from '#shared/lib';
import type { ActivityKind } from './model';

export interface ActivityCursor {
  at: string;
  id: string;
}

export interface ActivityEntry {
  // Unique across the kinds; the second half of the sort key.
  id: string;
  kind: ActivityKind;
  // Milliseconds, UTC, so the string order is the time order.
  at: string;
  status: string;
  requiresAttention?: boolean;
  project: { id: number; key: string; name: string } | null;
  agent: { id: number; username: string; name: string } | null;
  issue: { id: number; identifier: string; sequenceNumber: number; title: string } | null;
  trigger: string | null;
  maxTurns: number | null;
  runBudgetSeconds: number | null;
  workflowId: string | null;
  workflowRunId: string | null;
  threadId: string | null;
  durationMs: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  trashCounts?: { chat: number; vault: number };
}

export type ActivityNotice = 'workflow-runs-unavailable' | 'workflow-runs-limited';

export interface ActivityPage {
  items: ActivityEntry[];
  nextCursor: ActivityCursor | null;
  notice: ActivityNotice | null;
}

export interface ActivityFilters {
  kind?: ActivityKind;
  agentId?: number;
  cursor: ActivityCursor | null;
  limit?: number;
}

export const emptyEntry = {
  project: null,
  agent: null,
  issue: null,
  trigger: null,
  maxTurns: null,
  runBudgetSeconds: null,
  workflowId: null,
  workflowRunId: null,
  threadId: null,
  durationMs: null,
  inputTokens: null,
  outputTokens: null,
} satisfies Partial<ActivityEntry>;

export function parseActivityCursor(value?: string): ActivityCursor | null {
  if (!value) return null;
  let parsed: Partial<ActivityCursor>;
  try {
    parsed = JSON.parse(value) as Partial<ActivityCursor>;
  } catch {
    throw new HttpError(400, 'Invalid cursor');
  }
  const at = typeof parsed?.at === 'string' ? new Date(parsed.at) : null;
  if (!at || !Number.isFinite(at.getTime()) || typeof parsed.id !== 'string')
    throw new HttpError(400, 'Invalid cursor');
  return { at: at.toISOString(), id: parsed.id };
}

// Newest first; entries of the same millisecond by id, compared by code unit as the
// "C" collation compares them in the queries.
export function compareEntries(a: ActivityCursor, b: ActivityCursor): number {
  if (a.at !== b.at) return a.at < b.at ? 1 : -1;
  return a.id === b.id ? 0 : a.id < b.id ? 1 : -1;
}

export function isBefore(entry: ActivityCursor, cursor: ActivityCursor | null): boolean {
  return !cursor || compareEntries(entry, cursor) > 0;
}
