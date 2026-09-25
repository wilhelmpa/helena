import {
  consoleLogger,
  runtimeLoginNeedsOwner,
  type AlertItem,
  type AlertSource,
  type AlertText,
  type HostHealthItem,
} from '@helena/sdk';
import { hasPushMessage } from '@helena/locales/push';
import { db, helenaAlert, listModelServers, readLocalAiPolicy } from '@repo/db';
import { and, eq, isNull } from 'drizzle-orm';
import { systemHealth } from '#modules/god/system-health';
import { readAuditReport } from '#modules/edge-access/status';
import { serverOverview } from '#modules/server/service';
import { serverPath } from './paths';

// Helena's own alert sources (docs/helena-decisions/push.md): what is red on Start's "Braucht
// dich" and in Administrator → Server, read on the server every minute so it reaches the
// owner's phone while nobody has Helena open.
//
// Notfälle (emergencies): the machine (a degraded or rebuilding mirror, a failing disk, the
// serious mdadm/smartd reports, a failed backup, check or restore test, a CPU too hot, the
// thermal guard, EFI partitions that differ or are not mounted), a host helper that stopped
// answering, and Helena's own services that stopped reporting.
// Braucht dich (needs-you): a model login to sign in again, the host audit's important
// checks failing, a local model server that does not answer while local AI is on.

const text = (i18n: string, values: Record<string, string | number> = {}): AlertText => ({
  i18n,
  values,
});

// Two sources read the machine and two read the system health in one check: each is read
// once per check (the check's `now` names it), not once per source.
function perCheck<T>(load: () => Promise<T>): (now: Date) => Promise<T> {
  let hit: { at: number; value: Promise<T> } | null = null;
  return (now) => {
    if (hit && hit.at === now.getTime()) return hit.value;
    const value = load();
    hit = { at: now.getTime(), value };
    return value;
  };
}

const overview = perCheck(serverOverview);
const health = perCheck(systemHealth);

// ── The machine ───────────────────────────────────────────────────────────────────────────

// Red is always an emergency; these amber ones too: a mirror rebuilding still has one copy,
// the guard means the machine ran hot, EFI partitions that differ may not boot the spare.
const URGENT_ATTENTION = new Set(['raidRebuilding', 'fansRaised', 'espOutOfSync', 'espNotMounted']);
// EFI partitions are copied after every kernel update: a difference is only urgent once it
// lasted.
const SLOW_CODES: Record<string, number> = { espOutOfSync: 900, espNotMounted: 900 };

function hostSubject(item: HostHealthItem, capabilityLabel: AlertText): AlertText {
  const [kind, name] = [item.id.split(':')[0] ?? '', item.id.split(':').slice(1).join(':')];
  if (kind === 'raid') return text('subjects.raid', { name });
  if (kind === 'disk') return text('subjects.disk', { disk: name });
  if (kind === 'backup') return text('subjects.backup');
  if (kind === 'esp') return text('subjects.esp');
  if (kind === 'cpu') return text('subjects.cpu');
  if (kind === 'fans') return text('subjects.fans');
  if (kind === 'events') return text('subjects.events');
  return capabilityLabel;
}

function hostText(item: HostHealthItem): AlertText {
  if (item.text) return item.text;
  const values = { ...(item.values ?? {}) };
  if (typeof values.percent === 'number') values.percent = Math.round(values.percent);
  if (typeof values.temperature === 'number') values.temperature = Math.round(values.temperature);
  if (item.code && hasPushMessage(`health.${item.code}`))
    return text(`health.${item.code}`, values);
  return text('health.healthFailed');
}

// The tab of Administrator → Server a line is fixed on.
function hostTab(area: string): string {
  return serverPath(area);
}

// The keys (`<source>|<item key>`) of a source's problems that are open now.
async function openKeys(source: string): Promise<string[]> {
  const rows = await db
    .select({ key: helenaAlert.key })
    .from(helenaAlert)
    .where(and(eq(helenaAlert.source, source), isNull(helenaAlert.resolvedAt)));
  return rows.map((row) => row.key);
}

export const SERVER_SOURCE_ID = 'helena.server';

export const serverAlertSource: AlertSource = {
  id: SERVER_SOURCE_ID,
  category: 'emergencies',
  graceSeconds: 60,
  async collect({ now }) {
    const current = await overview(now);
    const open = await openKeys(SERVER_SOURCE_ID);
    const items: AlertItem[] = [];
    if (!current.helper.available) {
      // No helper on this host (a container, a development machine): nothing to watch. A
      // helper that answered before and stopped is an emergency of its own (hostd below),
      // and what it reported stays open: a helper that went away is not a recovery.
      if (open.length === 0) return [];
      throw new Error(`the host helper does not answer (${current.helper.reason ?? 'failed'})`);
    }
    for (const capability of current.capabilities) {
      // A capability whose state could not be read this time keeps its problems open.
      const unread =
        (!capability.available && capability.reason === 'failed') ||
        capability.health.some((item) => item.id === 'health' && item.state === 'unknown');
      if (unread && open.some((key) => key.startsWith(`${SERVER_SOURCE_ID}|${capability.id}/`))) {
        throw new Error(`${capability.id} could not be read`);
      }
      if (!capability.available) continue;
      for (const item of capability.health) {
        const urgent =
          item.state === 'critical' ||
          (item.state === 'attention' &&
            item.code !== undefined &&
            URGENT_ATTENTION.has(item.code));
        if (!urgent) continue;
        items.push({
          key: `${capability.id}/${item.id}`,
          subject: hostSubject(item, capability.label),
          text: hostText(item),
          href: hostTab(capability.area),
          since: item.since ?? null,
          ...(item.code && SLOW_CODES[item.code] ? { graceSeconds: SLOW_CODES[item.code] } : {}),
        });
      }
    }
    return items;
  },
};

// The host helper itself: installed and answering before, silent now. Kept apart from the
// machine's source, whose problems stay open meanwhile.
export const HOSTD_SOURCE_ID = 'helena.hostd';

let helperSeen = false;

// Test helper: forget that the helper answered before.
export function forgetHostdSeen(): void {
  helperSeen = false;
}

export const hostdAlertSource: AlertSource = {
  id: HOSTD_SOURCE_ID,
  category: 'emergencies',
  graceSeconds: 180,
  async collect({ now }) {
    const current = await overview(now);
    if (current.helper.available) {
      helperSeen = true;
      return [];
    }
    // A host without the helper is normal (a container, a development machine): only a
    // helper this api saw answer, or one whose problems are still open, is missed.
    const open = [...(await openKeys(SERVER_SOURCE_ID)), ...(await openKeys(HOSTD_SOURCE_ID))];
    if (!helperSeen && open.length === 0) return [];
    return [
      {
        key: 'hostd',
        subject: text('subjects.hostd'),
        text: text('problems.hostdDown'),
        href: serverPath(),
      },
    ];
  },
};

// ── Helena's services ─────────────────────────────────────────────────────────────────────

export const SERVICES_SOURCE_ID = 'helena.services';

export const servicesAlertSource: AlertSource = {
  id: SERVICES_SOURCE_ID,
  category: 'emergencies',
  // A deploy restarts every service; only one that stays away is an emergency.
  graceSeconds: 240,
  async collect({ now }) {
    const system = await health(now);
    return system.services
      .filter((service) => service.state === 'down')
      .map((service) => ({
        key: `service:${service.service}`,
        subject: text('subjects.service', {
          service: service.service.charAt(0).toUpperCase() + service.service.slice(1),
        }),
        text: text('problems.serviceDown'),
        href: '/',
        since: service.lastSeenAt ? new Date(service.lastSeenAt).toISOString() : null,
      }));
  },
};

// ── Braucht dich ──────────────────────────────────────────────────────────────────────────

const PROVIDER_NAMES: Record<string, string> = {
  anthropic: 'Claude',
  'openai-codex': 'ChatGPT',
  openai: 'OpenAI',
};

export const LOGINS_SOURCE_ID = 'helena.logins';

export const loginsAlertSource: AlertSource = {
  id: LOGINS_SOURCE_ID,
  category: 'needs-you',
  graceSeconds: 300,
  async collect({ now }) {
    const system = await health(now);
    const items: AlertItem[] = [];
    for (const report of system.logins.reports) {
      if (report.stale) continue;
      for (const login of report.logins) {
        if (!runtimeLoginNeedsOwner(login)) continue;
        items.push({
          key: `login:${report.source}:${login.store}:${login.provider}:${login.id}`.slice(0, 160),
          subject: text('subjects.login', {
            provider: PROVIDER_NAMES[login.provider] ?? login.provider,
          }),
          text: text(login.state === 'invalid' ? 'problems.loginRejected' : 'problems.loginRanOut'),
          href: '/',
        });
      }
    }
    return items;
  },
};

export const SECURITY_SOURCE_ID = 'helena.security';

export const securityAlertSource: AlertSource = {
  id: SECURITY_SOURCE_ID,
  category: 'needs-you',
  graceSeconds: 0,
  async collect() {
    const audit = await readAuditReport();
    if (!audit || audit.stale) return [];
    const severe = audit.checks.filter(
      (check) =>
        check.state === 'fail' && (check.severity === 'critical' || check.severity === 'high'),
    );
    if (severe.length === 0) return [];
    // One alert while any important check fails, as on Start: a fresh install with the
    // hardening still to do rings once, not once per check.
    return [
      {
        key: 'audit',
        subject: text('subjects.security'),
        text: text('problems.securityChecks', { count: severe.length }),
        href: '/god/security',
      },
    ];
  },
};

export const LOCAL_AI_SOURCE_ID = 'helena.local-ai';

export const localAiAlertSource: AlertSource = {
  id: LOCAL_AI_SOURCE_ID,
  category: 'needs-you',
  graceSeconds: 300,
  async collect() {
    const policy = await readLocalAiPolicy();
    if (!policy.enabled) return [];
    const servers = await listModelServers();
    return servers
      .filter((server) => server.enabled && server.checkedAt && server.status?.reachable === false)
      .map((server) => ({
        key: `server:${server.id}`,
        subject: text('subjects.localAi', { name: server.name }),
        text: text('problems.localAiDown'),
        href: '/god/local-ai',
      }));
  },
};

export const BUILTIN_ALERT_SOURCES: AlertSource[] = [
  serverAlertSource,
  hostdAlertSource,
  servicesAlertSource,
  loginsAlertSource,
  securityAlertSource,
  localAiAlertSource,
];

export const alertLog = consoleLogger('push alerts');
