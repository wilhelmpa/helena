import { setTimeout as sleep } from 'node:timers/promises';
import {
  agentUsage,
  aiAgent,
  db,
  getSetting,
  helenaProviderLimit,
  helenaProviderLimitAgent,
  setSetting,
  user,
} from '@repo/db';
import {
  consoleLogger,
  effectiveUsedPercent,
  normalizeUsageLimitSnapshot,
  snapshotState,
  windowState,
  worstState,
  type UsageLimitSnapshot,
  type UsageLimitState,
  type UsageLimitWindow,
} from '@helena/sdk';
import { and, asc, eq, gte, inArray, sql } from 'drizzle-orm';
import { HttpError } from '#shared/lib';
import { registries } from '#shared/helena';
import {
  getRuntimeRequest,
  onRuntimeAnswer,
  queueRuntimeRequest,
} from '#modules/agents/runtime-requests/service';

// How much of each subscription's limits is used (docs/helena-decisions/provider-limits.md).
// The numbers come from the usage-limit sources (@helena/sdk usage-limits.ts): the runners
// answer `limits.read` with what their runtimes' logins show, a run's output adds what the
// provider told it, and API-side sources (the spool the owner reporter writes into, a
// plugin's) are polled. This module keeps the newest snapshot per account, knows which
// agents work on it, and reads it back with the state of every window.

export interface ProviderLimitSettings {
  enabled: boolean;
  intervalMinutes: number;
  nearPercent: number;
}

const SETTINGS_KEY = 'providerLimits';
const SCHEDULE_KEY = 'providerLimitsSchedule';
const DEFAULTS: ProviderLimitSettings = { enabled: true, intervalMinutes: 10, nearPercent: 80 };
// Probed numbers this many intervals old count as stale.
const STALE_INTERVALS = 3;
// How long "Aktualisieren" waits for the runners.
const REFRESH_WAIT_MS = 30_000;

const clamp = (value: unknown, min: number, max: number, fallback: number) =>
  typeof value === 'number' && Number.isFinite(value)
    ? Math.min(max, Math.max(min, Math.round(value)))
    : fallback;

export async function getLimitSettings(): Promise<ProviderLimitSettings> {
  const stored = (await getSetting<Partial<ProviderLimitSettings>>(SETTINGS_KEY)) ?? {};
  return {
    enabled: typeof stored.enabled === 'boolean' ? stored.enabled : DEFAULTS.enabled,
    intervalMinutes: clamp(stored.intervalMinutes, 5, 60, DEFAULTS.intervalMinutes),
    nearPercent: clamp(stored.nearPercent, 50, 99, DEFAULTS.nearPercent),
  };
}

export async function setLimitSettings(
  patch: Partial<ProviderLimitSettings>,
): Promise<ProviderLimitSettings> {
  const current = await getLimitSettings();
  const next = {
    enabled: typeof patch.enabled === 'boolean' ? patch.enabled : current.enabled,
    intervalMinutes: clamp(patch.intervalMinutes, 5, 60, current.intervalMinutes),
    nearPercent: clamp(patch.nearPercent, 50, 99, current.nearPercent),
  };
  await setSetting(SETTINGS_KEY, next);
  return next;
}

// ── Storing ─────────────────────────────────────────────────────────────────────────────

// A run's output shows only the windows its responses carried: they update those and keep
// the others a probe measured.
function mergeWindows(known: UsageLimitWindow[], seen: UsageLimitWindow[]): UsageLimitWindow[] {
  const byId = new Map(known.map((window) => [window.id, window]));
  for (const window of seen) byId.set(window.id, window);
  return [...byId.values()];
}

// Stores what a source reported: one row per provider account, the newest numbers winning,
// and the agent that reported it linked to the account. Answers how many were stored.
export async function recordLimitSnapshots(
  agentId: number | null,
  values: unknown[],
): Promise<number> {
  let stored = 0;
  for (const value of values.slice(0, 32)) {
    const snapshot = normalizeUsageLimitSnapshot(value);
    if (!snapshot) continue;
    // Refused: numbers from a clock far ahead would pin a row until then.
    if (Date.parse(snapshot.observedAt) > Date.now() + 5 * 60_000) continue;
    const [known] = await db
      .select()
      .from(helenaProviderLimit)
      .where(
        and(
          eq(helenaProviderLimit.provider, snapshot.provider),
          eq(helenaProviderLimit.account, snapshot.account),
        ),
      );
    const older = known && known.observedAt.getTime() > Date.parse(snapshot.observedAt);
    let id = known?.id ?? null;
    if (!older) {
      const passive = snapshot.via === 'passive' && !!known;
      const row = {
        source: snapshot.source,
        login: snapshot.login ?? known?.login ?? null,
        plan: snapshot.plan ?? known?.plan ?? null,
        windows: passive ? mergeWindows(known.windows, snapshot.windows) : snapshot.windows,
        extra: snapshot.extra ?? (passive ? known.extra : null),
        resetCredits: snapshot.resetCredits ?? (passive ? known.resetCredits : null),
        allowed: snapshot.allowed,
        via: snapshot.via,
        unavailable: snapshot.unavailable,
        observedAt: new Date(snapshot.observedAt),
        updatedAt: new Date(),
      };
      const [saved] = await db
        .insert(helenaProviderLimit)
        .values({ provider: snapshot.provider, account: snapshot.account, ...row })
        .onConflictDoUpdate({
          target: [helenaProviderLimit.provider, helenaProviderLimit.account],
          set: row,
        })
        .returning({ id: helenaProviderLimit.id });
      id = saved!.id;
      stored++;
    }
    if (agentId !== null && id !== null) {
      await db
        .insert(helenaProviderLimitAgent)
        .values({ limitId: id, agentId })
        .onConflictDoUpdate({
          target: [helenaProviderLimitAgent.limitId, helenaProviderLimitAgent.agentId],
          set: { seenAt: new Date() },
        });
    }
  }
  return stored;
}

// A runner's answer to `limits.read` is stored as soon as it arrives, whoever asked.
onRuntimeAnswer('limits.read', async (agentId, result) => {
  const snapshots = (result as { snapshots?: unknown } | null)?.snapshots;
  if (Array.isArray(snapshots)) await recordLimitSnapshots(agentId, snapshots);
});

// ── Reading ─────────────────────────────────────────────────────────────────────────────

export interface LimitWindowView extends UsageLimitWindow {
  currentPercent: number | null;
  state: UsageLimitState;
  agentTokens: number | null;
}

export interface ProviderLimitView {
  id: number;
  provider: string;
  account: string;
  source: string;
  login: string | null;
  plan: string | null;
  windows: LimitWindowView[];
  extra: UsageLimitSnapshot['extra'];
  resetCredits: number | null;
  allowed: boolean | null;
  via: string;
  unavailable: string | null;
  observedAt: string;
  state: UsageLimitState;
  stale: boolean;
  nextResetAt: string | null;
  agents: { id: number; name: string }[];
}

// Tokens the account's agents spent since the window started, from the usage ledger.
async function tokensSince(agentIds: number[], since: Date): Promise<number> {
  if (agentIds.length === 0) return 0;
  const [row] = await db
    .select({
      tokens: sql<string>`coalesce(sum(${agentUsage.inputTokens} + ${agentUsage.outputTokens}), 0)`,
    })
    .from(agentUsage)
    .where(and(inArray(agentUsage.agentId, agentIds), gte(agentUsage.occurredAt, since)));
  return Number(row?.tokens ?? 0);
}

function windowStart(window: UsageLimitWindow, now: number): Date | null {
  if (!window.resetsAt || !window.windowMinutes) return null;
  const reset = Date.parse(window.resetsAt);
  if (reset <= now) return null;
  return new Date(reset - window.windowMinutes * 60_000);
}

// The reset that ends the account's limit: the earliest reset of a window that is full, or
// of one that is close when none is full.
function nextReset(windows: LimitWindowView[], now: number): string | null {
  for (const state of ['limited', 'near'] as const) {
    const resets = windows
      .filter((window) => window.state === state && window.resetsAt)
      .map((window) => Date.parse(window.resetsAt!))
      .filter((time) => time > now);
    if (resets.length > 0) return new Date(Math.min(...resets)).toISOString();
  }
  return null;
}

export async function listProviderLimits(now: Date = new Date()): Promise<{
  accounts: ProviderLimitView[];
  settings: ProviderLimitSettings;
  probedAt: string | null;
  state: UsageLimitState;
}> {
  const settings = await getLimitSettings();
  const at = now.getTime();
  const rows = await db
    .select()
    .from(helenaProviderLimit)
    .orderBy(asc(helenaProviderLimit.provider), asc(helenaProviderLimit.id));
  const links = rows.length
    ? await db
        .select({
          limitId: helenaProviderLimitAgent.limitId,
          id: aiAgent.id,
          name: sql<string>`coalesce(${user.name}, ${aiAgent.username})`,
        })
        .from(helenaProviderLimitAgent)
        .innerJoin(aiAgent, eq(aiAgent.id, helenaProviderLimitAgent.agentId))
        .leftJoin(user, eq(user.id, aiAgent.userId))
        .where(
          inArray(
            helenaProviderLimitAgent.limitId,
            rows.map((row) => row.id),
          ),
        )
        .orderBy(asc(aiAgent.id))
    : [];
  const accounts: ProviderLimitView[] = [];
  for (const row of rows) {
    const agents = links
      .filter((link) => link.limitId === row.id)
      .map((link) => ({ id: link.id, name: link.name }));
    const agentIds = agents.map((agent) => agent.id);
    const windows: LimitWindowView[] = [];
    for (const window of row.windows) {
      const start = windowStart(window, at);
      windows.push({
        ...window,
        currentPercent: effectiveUsedPercent(window, at),
        state: windowState(window, settings.nearPercent, at),
        agentTokens: start && agentIds.length ? await tokensSince(agentIds, start) : null,
      });
    }
    const snapshot = { windows: row.windows, allowed: row.allowed, unavailable: row.unavailable };
    accounts.push({
      id: row.id,
      provider: row.provider,
      account: row.account,
      source: row.source,
      login: row.login,
      plan: row.plan,
      windows,
      extra: row.extra ?? null,
      resetCredits: row.resetCredits,
      allowed: row.allowed,
      via: row.via,
      unavailable: row.unavailable,
      observedAt: row.observedAt.toISOString(),
      state: snapshotState(
        snapshot as Pick<UsageLimitSnapshot, 'windows' | 'allowed' | 'unavailable'>,
        settings.nearPercent,
        at,
      ),
      stale:
        row.via === 'probe' &&
        at - row.observedAt.getTime() > STALE_INTERVALS * settings.intervalMinutes * 60_000,
      nextResetAt: nextReset(windows, at),
      agents,
    });
  }
  const schedule = await getSetting<{ lastAt?: string }>(SCHEDULE_KEY);
  return {
    accounts,
    settings,
    probedAt: schedule?.lastAt ?? null,
    state: worstState(accounts.map((account) => account.state)),
  };
}

export async function deleteProviderLimit(id: number): Promise<void> {
  const rows = await db
    .delete(helenaProviderLimit)
    .where(eq(helenaProviderLimit.id, id))
    .returning({ id: helenaProviderLimit.id });
  if (rows.length === 0) throw new HttpError(404, 'Limit account not found');
}

// The worst state of the accounts an agent works on, for a policy that holds non-urgent work
// back while its account is at its limit (hub/autopilot; optional, proposed in the decision).
export async function agentLimitState(agentId: number, now = new Date()): Promise<UsageLimitState> {
  const ids = await db
    .select({ id: helenaProviderLimitAgent.limitId })
    .from(helenaProviderLimitAgent)
    .where(eq(helenaProviderLimitAgent.agentId, agentId));
  if (ids.length === 0) return 'unknown';
  const { accounts } = await listProviderLimits(now);
  const mine = new Set(ids.map((row) => row.id));
  return worstState(accounts.filter((account) => mine.has(account.id)).map((a) => a.state));
}

// ── Asking ──────────────────────────────────────────────────────────────────────────────

// The agents whose runner answers `limits.read` and was seen lately.
async function probeAgents(): Promise<number[]> {
  const rows = await db
    .select({ id: aiAgent.id })
    .from(aiAgent)
    .where(
      and(
        eq(aiAgent.kind, 'external'),
        eq(aiAgent.template, false),
        sql`${aiAgent.runtimeState}->'capabilities' ? 'limits'`,
        sql`${aiAgent.lastSeenAt} > now() - interval '2 minutes'`,
      ),
    )
    .orderBy(asc(aiAgent.id));
  return rows.map((row) => row.id);
}

async function queueReads(force: boolean): Promise<{ agentId: number; requestId: number }[]> {
  const queued: { agentId: number; requestId: number }[] = [];
  for (const agentId of await probeAgents()) {
    try {
      const requestId = await queueRuntimeRequest(agentId, { op: 'limits.read', force }, null);
      queued.push({ agentId, requestId });
    } catch {
      // Its runner went away since the query; the next pass asks again.
    }
  }
  return queued;
}

// The API-side sources (the spool of the owner reporter, a plugin's): polled here, stored
// without an agent.
export async function pollServerSources(now = new Date()): Promise<number> {
  let stored = 0;
  for (const entry of registries.usageLimitSources.entriesList()) {
    if (!entry.value.poll) continue;
    try {
      const snapshots = await entry.value.poll({
        now,
        log: consoleLogger(`limits ${entry.id}`),
      });
      stored += await recordLimitSnapshots(null, snapshots);
    } catch (error) {
      console.error(`[provider-limits] ${entry.id} failed:`, error);
    }
  }
  return stored;
}

// The background loop: asks the runners once per interval and polls the API-side sources
// every tick (a spool file is read only when it changed). Answers how many reads it queued.
export async function scheduleLimitProbes(now = new Date()): Promise<number> {
  await pollServerSources(now);
  const settings = await getLimitSettings();
  if (!settings.enabled) return 0;
  const schedule = (await getSetting<{ lastAt?: string }>(SCHEDULE_KEY)) ?? {};
  const last = schedule.lastAt ? Date.parse(schedule.lastAt) : 0;
  if (now.getTime() - last < settings.intervalMinutes * 60_000) return 0;
  const queued = await queueReads(false);
  await setSetting(SCHEDULE_KEY, { lastAt: now.toISOString() });
  return queued.length;
}

// "Aktualisieren": every runner probes again now (at most once a minute per login), and the
// answer waits for them, at most half a minute.
export async function refreshProviderLimits() {
  let open = await queueReads(true);
  const deadline = Date.now() + REFRESH_WAIT_MS;
  while (open.length > 0 && Date.now() < deadline) {
    await sleep(500);
    const waiting = [];
    for (const read of open) {
      const state = await getRuntimeRequest(read.agentId, read.requestId);
      if (state && state.status !== 'answered' && state.status !== 'failed') waiting.push(read);
    }
    open = waiting;
  }
  await pollServerSources();
  return listProviderLimits();
}
