// What "Braucht dich" lists, worked out from what the sources report (needsYouSources):
// problems of the machine and its services that are red right now (a service down, a
// login the provider rejected, a degraded RAID …), approvals and workflow approval steps
// waiting on a decision, and runs or chat answers that failed. A problem stays while it
// lasts, a decision until it is made (on the approvals page); neither is hidden here. A
// failure is a report: the owner can hide it ("Ausblenden"), and one older than a day
// stops being a row of its own and is only counted, with the way to the activity page —
// so an old failure nobody can fix any more does not sit on Start for ever.

export const AGED_AFTER_MS = 24 * 60 * 60 * 1000;

export type NeedsYouKind = 'problem' | 'approval' | 'step' | 'proposals' | 'failure';

export interface NeedsYouItem {
  // Stable across reloads: `approval:12`, `step:<run>:<step>:<iteration>`, `run:34`,
  // `chat:56` (the activity entry's id).
  key: string;
  kind: NeedsYouKind;
  // When it started waiting or failed (ISO 8601).
  at: string;
}

export interface NeedsYouSplit<T extends NeedsYouItem> {
  // Problems first (as their sources order them), then decisions (oldest waiting first),
  // then fresh failures (newest first).
  items: T[];
  // Failures older than AGED_AFTER_MS and not hidden.
  aged: number;
  // Failures the reader hid.
  hidden: number;
}

// Splits what is waiting into what shows as rows and what is only counted. `dismissed`
// holds the keys the reader hid; `now` is the reader's clock (null before hydration, when
// nothing counts as aged yet so the first render matches the server's).
export function splitNeedsYou<T extends NeedsYouItem>(
  sources: T[],
  dismissed: ReadonlySet<string>,
  now: number | null,
  agedAfterMs: number = AGED_AFTER_MS,
): NeedsYouSplit<T> {
  const problems: T[] = [];
  const decisions: T[] = [];
  const failures: T[] = [];
  let aged = 0;
  let hidden = 0;
  for (const source of sources) {
    if (source.kind === 'problem') {
      problems.push(source);
      continue;
    }
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
  return { items: [...problems, ...decisions, ...failures], aged, hidden };
}
