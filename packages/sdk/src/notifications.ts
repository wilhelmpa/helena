import type { Logger } from './common';
import type { LocalizedText } from './text';

// What Helena tells people outside the app, on the phones and computers they carry: Web Push
// to Helena's own installed app (docs/helena-decisions/push.md). Two extension points:
//
// - A notification category is a kind of message a person switches on or off per device
//   ("Notfälle", "Freigaben", …). Helena's own: `emergencies`, `approvals`, `needs-you` and
//   `agent-replies`; a plugin adds its own under its id (`acme.ups`).
// - An alert source reports the problems that are red right now (a degraded RAID, a service
//   that stopped). Helena watches every source on the server, even while nobody has Helena
//   open, and pushes once when a problem appears, once when it is over, and at most a
//   reminder while it lasts. Nothing is pushed while the problem stays the same.

// RFC 8030 §5.3: how urgently the push service wakes the device for the message.
export type PushUrgency = 'very-low' | 'low' | 'normal' | 'high';

export const PUSH_URGENCIES: readonly PushUrgency[] = ['very-low', 'low', 'normal', 'high'];

// `owner`: only the instance owner (the Administrator) receives it; `everyone`: any person
// the message is about.
export type NotificationAudience = 'owner' | 'everyone';

// A notification category (registry `notificationCategories`, API process).
export interface NotificationCategory {
  id: string;
  label: LocalizedText;
  // One short sentence under the switch.
  description?: LocalizedText;
  // Whether a device that subscribes has it on before the person decides.
  defaultOn: boolean;
  audience: NotificationAudience;
  // Lower comes first on the settings page; built-ins leave gaps of 10.
  order?: number;
  urgency?: PushUrgency;
  // How long the push service keeps a message the device could not receive yet (RFC 8030
  // §5.2). Default one day.
  ttlSeconds?: number;
}

// Helena's own categories, in the order the settings page lists them.
export const BUILTIN_NOTIFICATION_CATEGORY_IDS = [
  'emergencies',
  'approvals',
  'needs-you',
  'agent-replies',
] as const;
export type BuiltinNotificationCategoryId = (typeof BUILTIN_NOTIFICATION_CATEGORY_IDS)[number];

// A text of an alert: a plugin brings it (LocalizedText); Helena's own sources name a message
// of Helena's push translations and its values.
export type AlertText = LocalizedText | { i18n: string; values: Record<string, string | number> };

// One red problem an alert source reports.
export interface AlertItem {
  // Stable while the problem lasts, within the source: `raid:helena-root`, `service:worker`.
  key: string;
  // What it is about, short: "Spiegel helena-root", "Dienst Worker". The recovery message
  // says it is fine again.
  subject: AlertText;
  // What is wrong, one sentence.
  text: AlertText;
  // Where in Helena it is shown and fixed: `/god/server/disks`.
  href?: string;
  // ISO 8601: since when it holds, where known.
  since?: string | null;
  // This problem's own grace period, where it differs from the source's.
  graceSeconds?: number;
}

export interface AlertSourceContext {
  now: Date;
  log: Logger;
  signal?: AbortSignal;
}

// An alert source (registry `alertSources`, API process).
export interface AlertSource {
  id: string;
  // The notification category its alerts belong to.
  category: string;
  // How long a problem must last before the first push: a service restarted by a deploy is
  // no emergency. Default 90 seconds.
  graceSeconds?: number;
  // Every problem of the source that is red now. Throws when the state cannot be read; the
  // problems it reported before then stay open (a failed read is never a recovery).
  collect(context: AlertSourceContext): Promise<AlertItem[]>;
}

const KEY = /^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,159}$/;
const TEXT_MAX = 300;

function normalizeText(value: unknown): AlertText | null {
  if (typeof value === 'string') return value.slice(0, TEXT_MAX) || null;
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  if (typeof record.i18n === 'string' && KEY.test(record.i18n)) {
    if (record.values === undefined) return { i18n: record.i18n };
    const values: Record<string, string | number> = {};
    if (record.values && typeof record.values === 'object') {
      for (const [name, entry] of Object.entries(record.values as Record<string, unknown>)) {
        if (typeof entry === 'string') values[name] = entry.slice(0, 200);
        else if (typeof entry === 'number' && Number.isFinite(entry)) values[name] = entry;
      }
    }
    return { i18n: record.i18n, values };
  }
  const entries = Object.entries(record).filter(
    (entry): entry is [string, string] => typeof entry[1] === 'string' && entry[0] !== 'i18n',
  );
  if (entries.length === 0) return null;
  return Object.fromEntries(entries.map(([locale, text]) => [locale, text.slice(0, TEXT_MAX)]));
}

// A source's problem as Helena keeps it: a bounded key, texts it can show, a path inside
// Helena (never another origin). Anything else is dropped rather than pushed.
export function normalizeAlertItem(value: unknown): AlertItem | null {
  if (!value || typeof value !== 'object') return null;
  const item = value as Record<string, unknown>;
  if (typeof item.key !== 'string' || !KEY.test(item.key)) return null;
  const subject = normalizeText(item.subject);
  const text = normalizeText(item.text);
  if (!subject || !text) return null;
  const href =
    typeof item.href === 'string' && item.href.startsWith('/') && !item.href.startsWith('//')
      ? item.href.slice(0, 500)
      : undefined;
  const grace =
    typeof item.graceSeconds === 'number' && Number.isFinite(item.graceSeconds)
      ? Math.min(Math.max(0, Math.round(item.graceSeconds)), 86_400)
      : undefined;
  return {
    key: item.key,
    subject,
    text,
    ...(href ? { href } : {}),
    since: typeof item.since === 'string' ? item.since : null,
    ...(grace !== undefined ? { graceSeconds: grace } : {}),
  };
}

export function isPushUrgency(value: unknown): value is PushUrgency {
  return typeof value === 'string' && (PUSH_URGENCIES as readonly string[]).includes(value);
}
