'use client';

import { useState } from 'react';
import {
  sortedNeedsYouSources,
  type NeedsYouEntry,
  type NeedsYouSourceResult,
} from '@/extensions/needsYouSources';
import { useNow } from '@/features/provider-limits/hooks/useNow';
import { splitNeedsYou } from './needsYou';

export interface NeedsYouData {
  items: NeedsYouEntry[];
  aged: number;
  hidden: number;
  // Red problems of the system right now.
  problems: number;
  // Fresh failures, shown as rows.
  failures: number;
  // Every failure the sources report, hidden or aged included (to keep the hidden list short).
  failureKeys: string[];
  isPending: boolean;
}

// Calls every source's hook, in the order the registry had when this component mounted.
// The list never changes for the component's life, so the hooks run in a fixed order.
function useSourceResults(owner: boolean): NeedsYouSourceResult[] {
  const [sources] = useState(sortedNeedsYouSources);
  return sources.map((source) => source.useEntries({ owner }));
}

// "Braucht dich" from every source: red problems first, then the decisions, then the fresh
// failures, without the ones the reader hid and with the ones older than a day counted.
export function useNeedsYou(dismissed: ReadonlySet<string>, owner: boolean): NeedsYouData {
  const results = useSourceResults(owner);
  const now = useNow(60_000);
  const all = results.flatMap((result) => result.entries);
  const split = splitNeedsYou(all, dismissed, now);
  const shown = (kind: string) => split.items.filter((item) => item.kind === kind).length;
  return {
    ...split,
    problems: shown('problem'),
    failures: shown('failure'),
    failureKeys: all.filter((item) => item.kind === 'failure').map((item) => item.key),
    isPending: results.some((result) => result.isPending),
  };
}
