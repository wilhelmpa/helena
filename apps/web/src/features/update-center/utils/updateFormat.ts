import type { Status } from '@/components/common/page/StatusBadge';
import type {
  UpdateAction,
  UpdateCenter,
  UpdateItem,
  UpdateRisk,
} from '@/lib/api/endpoints/updateCenter';

// How the update center reads: which update comes first, how a risk and an update's state
// look, and what is running. Pure, so the Start card and the Administrator page agree.

export const RISK_STATUS: Record<UpdateRisk, Status> = {
  low: 'success',
  medium: 'waiting',
  high: 'danger',
};

// The one update the Start card names: a security update first, then the highest risk,
// then the one waiting longest. The API already sorts; this picks from what it sent.
export function headlineUpdate(items: UpdateItem[]): UpdateItem | null {
  const rank = (item: UpdateItem) =>
    (item.security ? 100 : 0) +
    (item.risk === 'high' ? 3 : item.risk === 'medium' ? 2 : item.risk === 'low' ? 1 : 0);
  let best: UpdateItem | null = null;
  for (const item of items) {
    if (!item.updateAvailable) continue;
    if (!best || rank(item) > rank(best)) best = item;
  }
  return best;
}

// The components that have an update, and the ones that do not (shown folded).
export function splitItems(items: UpdateItem[]): { open: UpdateItem[]; current: UpdateItem[] } {
  return {
    open: items.filter((item) => item.updateAvailable),
    current: items.filter((item) => !item.updateAvailable),
  };
}

// Components of one group (the Debian packages) are shown together.
export function groupItems(items: UpdateItem[]): { key: string; items: UpdateItem[] }[] {
  const groups: { key: string; items: UpdateItem[] }[] = [];
  for (const item of items) {
    const key = item.group ? `${item.source}:${item.group}` : `item:${item.id}`;
    const found = groups.find((group) => group.key === key);
    if (found) found.items.push(item);
    else groups.push({ key, items: [item] });
  }
  return groups;
}

export function runningAction(
  center: UpdateCenter | undefined,
  item: UpdateItem,
): UpdateAction | null {
  return (
    center?.actions.find(
      (action) =>
        action.state === 'running' &&
        action.source === item.source &&
        (action.component === item.component || action.components.includes(item.component)),
    ) ?? null
  );
}

// Whether the page should look again soon: a check, a summary or an update is going.
export function isBusy(center: UpdateCenter | undefined): boolean {
  if (!center) return false;
  return (
    center.job.lastStatus === 'running' ||
    center.items.some((item) => item.summaryPending) ||
    center.actions.some((action) => action.state === 'running')
  );
}

// "2.1.281 → 2.1.290", or the one version known.
export function versionStep(
  item: Pick<UpdateItem, 'installed' | 'available' | 'updateAvailable'>,
): string {
  if (item.updateAvailable && item.installed && item.available) {
    return `${item.installed} → ${item.available}`;
  }
  return item.installed ?? item.available ?? '–';
}

// Five-field cron to the time of day a daily check runs at ("06:00"), or null for any other
// schedule.
export function dailyTime(cron: string): string | null {
  const match = /^(\d{1,2}) (\d{1,2}) \* \* \*$/.exec(cron.trim());
  if (!match) return null;
  const minute = Number(match[1]);
  const hour = Number(match[2]);
  if (minute > 59 || hour > 23) return null;
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}
