import type { Status } from '@/components/common/page/StatusBadge';
import type {
  LimitAccount,
  LimitState,
  LimitWindow,
  LimitWindowKind,
} from '@/lib/api/endpoints/providerLimits';
import { getDisplayLocale } from '@/utils/dates';

// How a plan limit reads: the status vocabulary the app shares (StatusBadge), the bar's
// fill, the window's name and the countdown to its reset.

export const STATE_STATUS: Record<LimitState, Status> = {
  ok: 'success',
  near: 'waiting',
  limited: 'danger',
  unknown: 'idle',
};

export const BAR_CLASS: Record<LimitState, string> = {
  ok: 'bg-status-success',
  near: 'bg-status-waiting',
  limited: 'bg-status-danger',
  unknown: 'bg-status-idle',
};

export const STATE_TEXT_CLASS: Record<LimitState, string> = {
  ok: 'text-muted-foreground',
  near: 'text-status-waiting',
  limited: 'text-status-danger',
  unknown: 'text-muted-foreground',
};

// The providers whose names come from the message files; any other keeps its id.
export const KNOWN_PROVIDERS = new Set(['openai-codex', 'anthropic', 'openrouter']);
// The logins and sources the message files name.
export const KNOWN_LOGINS = new Set(['hermes', 'codex', 'claude-code', 'owner']);

const KIND_ORDER: Record<LimitWindowKind, number> = {
  session: 0,
  weekly: 1,
  model: 2,
  monthly: 3,
  other: 4,
};

// Session first, then the week, the model windows, the rest; the provider's order within.
export function orderedWindows(windows: LimitWindow[]): LimitWindow[] {
  return windows
    .map((window, index) => ({ window, index }))
    .sort((a, b) => KIND_ORDER[a.window.kind] - KIND_ORDER[b.window.kind] || a.index - b.index)
    .map(({ window }) => window);
}

// The message key of a window's name and its values (providerLimits.window.*).
export function windowLabel(window: LimitWindow): {
  key: 'session' | 'weekly' | 'monthly' | 'model' | 'modelSession' | 'labelled' | 'other';
  values: Record<string, string | number>;
} {
  const hours = window.windowMinutes ? Math.max(1, Math.round(window.windowMinutes / 60)) : 5;
  const short = window.windowMinutes !== null && window.windowMinutes <= 24 * 60;
  switch (window.kind) {
    case 'session':
      return { key: 'session', values: { hours } };
    case 'weekly':
      return { key: 'weekly', values: {} };
    case 'monthly':
      return { key: 'monthly', values: {} };
    case 'model':
      return window.label
        ? { key: short ? 'modelSession' : 'model', values: { label: window.label, hours } }
        : { key: 'model', values: { label: '·' } };
    default:
      return window.label
        ? { key: 'labelled', values: { label: window.label } }
        : { key: 'other', values: {} };
  }
}

// The time until a reset, in two units at most: "1 Std. 26 Min.", "3 T 4 Std.", "5 Min.".
export function formatCountdown(ms: number, locale: string = getDisplayLocale()): string {
  const minutes = Math.max(0, Math.round(ms / 60_000));
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const rest = minutes % 60;
  const parts =
    days > 0 ? { days, hours } : hours > 0 ? { hours, minutes: rest } : { minutes: rest };
  return new Intl.DurationFormat(locale, {
    style: 'narrow',
    ...(minutes === 0 && { minutesDisplay: 'always' as const }),
  }).format(parts);
}

// The share the bar shows: the current one, 0–100.
export function barPercent(window: LimitWindow): number {
  const value = window.currentPercent ?? window.usedPercent ?? 0;
  return Math.max(0, Math.min(100, value));
}

// Accounts with something to say come first: limited, then near, then the rest.
export function orderedAccounts(accounts: LimitAccount[]): LimitAccount[] {
  const rank: Record<LimitState, number> = { limited: 0, near: 1, ok: 2, unknown: 3 };
  return [...accounts].sort(
    (a, b) => rank[a.state] - rank[b.state] || a.provider.localeCompare(b.provider) || a.id - b.id,
  );
}
