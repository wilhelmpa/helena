// What "Braucht dich" lists, worked out from what the API reports: approvals and workflow
// approval steps waiting on a decision, and runs or chat answers that failed. A decision
// stays until it is made (it is decided on the approvals page, never hidden here). A
// failure is a report: the owner can hide it ("Ausblenden"), and one older than a day
// stops being a row of its own and is only counted, with the way to the activity page —
// so an old failure nobody can fix any more does not sit on Start for ever.

export const AGED_AFTER_MS = 24 * 60 * 60 * 1000;

export type NeedsYouKind = 'approval' | 'step' | 'proposals' | 'failure';

export interface NeedsYouSource {
  // Stable across reloads: `approval:12`, `step:<run>:<step>:<iteration>`, `run:34`,
  // `chat:56` (the activity entry's id).
  key: string;
  kind: NeedsYouKind;
  // When it started waiting or failed (ISO 8601).
  at: string;
}

export interface NeedsYouSplit<T extends NeedsYouSource> {
  // Decisions first (oldest waiting first), then fresh failures (newest first).
  items: T[];
  // Failures older than AGED_AFTER_MS and not hidden.
  aged: number;
  // Failures the reader hid.
  hidden: number;
}

// Splits what is waiting into what shows as rows and what is only counted. `dismissed`
// holds the keys the reader hid; `now` is the reader's clock (null before hydration, when
// nothing counts as aged yet so the first render matches the server's).
export function splitNeedsYou<T extends NeedsYouSource>(
  sources: T[],
  dismissed: ReadonlySet<string>,
  now: number | null,
  agedAfterMs: number = AGED_AFTER_MS,
): NeedsYouSplit<T> {
  const decisions: T[] = [];
  const failures: T[] = [];
  let aged = 0;
  let hidden = 0;
  for (const source of sources) {
    if (source.kind !== 'failure') {
      decisions.push(source);
      continue;
    }
    if (dismissed.has(source.key)) {
      hidden++;
      continue;
    }
    const at = Date.parse(source.at);
    if (now !== null && !Number.isNaN(at) && now - at > agedAfterMs) {
      aged++;
      continue;
    }
    failures.push(source);
  }
  decisions.sort((a, b) => a.at.localeCompare(b.at));
  failures.sort((a, b) => b.at.localeCompare(a.at));
  return { items: [...decisions, ...failures], aged, hidden };
}

// The hidden keys worth keeping: only those of failures still reported, so the list the
// preferences hold never grows past what the activity window returns.
export function pruneDismissed(dismissed: readonly string[], present: readonly string[]): string[] {
  const live = new Set(present);
  return dismissed.filter((key) => live.has(key));
}
