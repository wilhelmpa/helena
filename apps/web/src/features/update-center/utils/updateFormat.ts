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
export function splitItems(items: UpdateItem[]): {
  open: UpdateItem[];
  current: UpdateItem[];
  unknown: UpdateItem[];
} {
  const known = (item: UpdateItem) => !!item.installed && !!item.available && !item.error;
  return {
    open: items.filter((item) => item.updateAvailable),
    current: items.filter((item) => !item.updateAvailable && known(item)),
    unknown: items.filter((item) => !item.updateAvailable && !known(item)),
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
// An update that just finished is followed a little longer: the API then asks its source
// again in the background (what is installed now), and the list should show that result
// without waiting for the next slow poll (found live: the page kept "Aktualisieren" up).
export const JUST_FINISHED_MS = 2 * 60_000;

export function isBusy(center: UpdateCenter | undefined, now = Date.now()): boolean {
  if (!center) return false;
  return (
    center.job.lastStatus === 'running' ||
    center.items.some((item) => item.summaryPending) ||
    center.actions.some(
      (action) =>
        action.state === 'running' ||
        (action.finishedAt != null && now - Date.parse(action.finishedAt) < JUST_FINISHED_MS),
    )
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

// Whether a check was made less than a minute ago ("Gerade geprüft" rather than "vor 0 Min.").
export function justNow(iso: string, now: number = Date.now()): boolean {
  const at = Date.parse(iso);
  return Number.isFinite(at) && now - at < 60_000;
}

// Zero known updates is only reassuring after every enabled source completed its check.
export function checkIncomplete(center: UpdateCenter): boolean {
  return (
    !center.checkedAt ||
    !center.helper.installed ||
    !!center.helper.error ||
    center.job.lastStatus === 'failed' ||
    center.sources.some((source) => !!source.error || !source.checkedAt) ||
    (center.sources.some((source) => source.id === 'apt') &&
      (!center.apt?.refreshedAt || !!center.apt.refreshError)) ||
    center.items.some((item) => !!item.error || !item.installed || !item.available)
  );
}
