'use client';

import type { LucideIcon } from 'lucide-react';
import { Registry } from '@helena/sdk/web';
import type { NeedsYouKind } from '@/features/home/dashboard/needsYou';

// What feeds Start's "Braucht dich" (docs/helena-decisions/dashboard.md), as a registry: the
// approvals, the workflow approval steps, the proposals, the failed runs and chat answers,
// and the problems of the system that are red right now (a service down, a rejected login,
// a degraded RAID, a failed backup, the thermal guard). A feature adds its red problems
// here instead of a card of its own, so the owner sees them in the one list.
//
// A source is a hook. "Braucht dich" reads the registry once when it mounts and calls every
// source's hook in that fixed order on each render, so a source registers when its module
// loads (extensions/homeWidgets), never later.

export interface NeedsYouEntry {
  // Stable across reloads: `approval:12`, `run:34`, `problem:service:worker` …
  key: string;
  // `problem`: red, live, never hidden or aged. The decisions (approval, step, proposals):
  // amber, until decided. `failure`: red, hidden by the reader or aged after a day.
  kind: NeedsYouKind;
  // When it started waiting, failed or went wrong (ISO 8601); '' when unknown.
  at: string;
  title: string;
  detail: string;
  // Where its details are: a page, or (for what only Start shows) a dialog.
  href?: string;
  onSelect?: () => void;
  // Another icon than the kind's.
  icon?: LucideIcon;
}

export interface NeedsYouSourceResult {
  entries: NeedsYouEntry[];
  isPending: boolean;
}

export interface NeedsYouSource {
  id: string;
  // Lower comes first among entries of the same kind; built-ins leave gaps of 10.
  order: number;
  // Called on every render of "Braucht dich". `owner`: the reader is the Administrator, so
  // an owner-only source may read; otherwise it must return no entries (and not fetch).
  useEntries: (context: { owner: boolean }) => NeedsYouSourceResult;
}

export const needsYouSources = new Registry<NeedsYouSource>(
  'needs-you source',
  (source) => source.id,
);

export function sortedNeedsYouSources(): NeedsYouSource[] {
  return needsYouSources.list().sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
}
