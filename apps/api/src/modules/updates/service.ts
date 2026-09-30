import { createHash } from 'node:crypto';
import {
  createEvent,
  consoleLogger,
  normalizeUpdateCandidate,
  updatePriority,
  type LocalizedText,
  type UpdateCandidate,
  type UpdateCheckContext,
  type UpdateKind,
  type UpdateRisk,
  type UpdateSource,
} from '@helena/sdk';
import {
  agentRun,
  agentChatMessage,
  db,
  getDisplayName,
  getSetting,
  helenaUpdate,
  helenaUpdateAction,
  helenaSystemJob,
  user,
  setSetting,
  writeBackup,
} from '@repo/db';
import { and, desc, eq, inArray, isNotNull, notInArray, or, sql } from 'drizzle-orm';
import { HttpError, iso, pgErrorCode } from '#shared/lib';
import { events, host } from '#shared/helena';
import { systemHealth } from '#modules/god/system-health';
import { readChatCatalog } from '#modules/agents/chat/service';
import {
  DigestRefused,
  digestModelAvailable,
  digestPrompt,
  hermesAgents,
  digestRunState,
  isModelRefusal,
  parseDigest,
  pickDigestAgent,
  pickDigestModel,
  queueDigestRun,
  type DigestSubject,
} from './digest';
import { fetchVendorJson, fetchVendorText } from './fetch';
import { callHelper, helperInstalled } from './helper';
import { aptFreshness, readUpdateInventory, type AptFreshness } from './inventory';
import {
  getUpdateSettings,
  rememberRefusedModel,
  supportsAutomaticUpdate,
  updateMode,
} from './settings';
import { checkHermesUpdate } from '#modules/runtime-admin/hermes-update';
import { hermesSource, toCandidate as hermesCandidate } from './sources/hermes';

// The update center (docs/helena-decisions/update-center.md): every update source is asked
// what it knows, the answers are stored one row per component, the new versions are
// summarized by a digest run, and each update is followed to its end.

const log = consoleLogger('updates');
const CHECK_KEY = 'helenaUpdatesCheck';

type Row = typeof helenaUpdate.$inferSelect;

interface SourceState {
  checkedAt: string;
  error: string | null;
}

interface CheckState {
  checkedAt: string | null;
  helper: boolean;
  inventoryError: string | null;
  apt: AptFreshness | null;
  sources: Record<string, SourceState>;
}

async function checkState(): Promise<CheckState> {
  const stored = await getSetting<Partial<CheckState>>(CHECK_KEY);
  return {
    checkedAt: stored?.checkedAt ?? null,
    helper: stored?.helper ?? false,
    inventoryError: stored?.inventoryError ?? null,
    apt: stored?.apt ?? null,
    sources: stored?.sources ?? {},
  };
}

// ── Checking ────────────────────────────────────────────────────────────────────────────

// What every source of one check shares: the host inventory is asked of the helper once.
function checkContext(
  source: UpdateSource,
  inventory: () => Promise<Record<string, unknown> | null>,
  manual: boolean,
): UpdateCheckContext {
  const hosts = (source.hosts ?? []).map((name) => name.toLowerCase());
  return {
    now: new Date(),
    log: consoleLogger(`updates:${source.id}`),
    manual,
    fetchText: (url, options) => fetchVendorText(url, hosts, options),
    fetchJson: (url, options) => fetchVendorJson(url, hosts, options),
    inventory,
  };
}

function sources(): { source: UpdateSource; pluginId: string }[] {
  return host.updateSources
    .entriesList()
    .map((entry) => ({ source: entry.value, pluginId: entry.pluginId }))
    .sort((a, b) => (a.source.order ?? 1000) - (b.source.order ?? 1000));
}

// Stores what one source answered: one row per component, a new version resetting when it
// was first seen, the summary kept (it names the version it is for). Components the source
// no longer reports are removed.
async function storeCandidates(
  source: UpdateSource,
  candidates: UpdateCandidate[],
  now: Date,
): Promise<void> {
  const existing = await db.select().from(helenaUpdate).where(eq(helenaUpdate.source, source.id));
  const byComponent = new Map(existing.map((row) => [row.component, row]));
  for (const candidate of candidates) {
    const before = byComponent.get(candidate.component);
    const values = {
      name: candidate.name,
      kind: source.kind,
      installed: candidate.installed,
      available: candidate.available,
      updateAvailable: candidate.updateAvailable,
      security: candidate.security,
      sourceUrl: candidate.sourceUrl ?? null,
      notesUrl: candidate.notesUrl ?? null,
      groupKey: candidate.group ?? null,
      applicable: candidate.applicable,
      hint: candidate.hint ?? null,
      detail: candidate.detail ?? null,
      error: candidate.error ?? null,
      data: candidate.data ?? null,
      checkedAt: now,
      availableSince:
        before && before.available === candidate.available ? before.availableSince : now,
    };
    if (before) {
      await db.update(helenaUpdate).set(values).where(eq(helenaUpdate.id, before.id));
    } else {
      await db
        .insert(helenaUpdate)
        .values({ source: source.id, component: candidate.component, ...values })
        .onConflictDoUpdate({
          target: [helenaUpdate.source, helenaUpdate.component],
          set: values,
        });
    }
  }
  const kept = candidates.map((candidate) => candidate.component);
  await db
    .delete(helenaUpdate)
    .where(
      and(
        eq(helenaUpdate.source, source.id),
        kept.length ? notInArray(helenaUpdate.component, kept) : undefined,
      ),
    );
}

export interface CheckOutcome {
  checkedAt: string;
  sources: number;
  failed: string[];
  updates: number;
}

// Asks every source (or the one named) and stores the answers. A source that fails keeps
// its rows from the last check and records the failure.
export async function runUpdateCheck(
  options: { manual?: boolean; only?: string } = {},
): Promise<CheckOutcome> {
  const now = new Date();
  const manual = options.manual ?? false;
  const state = await checkState();
  const helper = await helperInstalled();
  const picked = sources().filter(({ source }) => !options.only || source.id === options.only);
  let apt = state.apt;
  let inventoryError: string | null = null;
  let inventoryPromise: Promise<Record<string, unknown> | null> | null = null;
  const inventory = () => {
    inventoryPromise ??= helper
      ? readUpdateInventory(
          callHelper,
          picked.some(({ source }) => source.id === 'apt'),
        ).then(
          (inventory) => {
            apt = aptFreshness(inventory);
            return inventory;
          },
          (error: unknown) => {
            inventoryError = error instanceof Error ? error.message : String(error);
            return null;
          },
        )
      : Promise.resolve(null);
    return inventoryPromise;
  };
  const failed: string[] = [];
  // Side by side: the Hermes check waits for its runner's helper, the others for the web.
  await Promise.all(
    picked.map(async ({ source }) => {
      try {
        const answered = await source.check(checkContext(source, inventory, manual));
        const candidates = answered
          .map((candidate) => normalizeUpdateCandidate(candidate))
          .filter((candidate): candidate is UpdateCandidate => candidate !== null);
        await storeCandidates(source, candidates, now);
        state.sources[source.id] = { checkedAt: now.toISOString(), error: null };
      } catch (error) {
        const message = (error instanceof Error ? error.message : String(error)).slice(0, 500);
        log.warn(`${source.id} check failed: ${message}`);
        failed.push(source.id);
        state.sources[source.id] = { checkedAt: now.toISOString(), error: message };
      }
    }),
  );
  await setSetting(CHECK_KEY, {
    checkedAt: options.only ? state.checkedAt : now.toISOString(),
    helper,
    inventoryError,
    apt,
    sources: state.sources,
  } satisfies CheckState);
  const updates = await db
    .select({ id: helenaUpdate.id })
    .from(helenaUpdate)
    .where(eq(helenaUpdate.updateAvailable, true));
  return { checkedAt: now.toISOString(), sources: picked.length, failed, updates: updates.length };
}

// Reconcile an externally changed Hermes checkout without contacting the upstream. The
// runner asks the installed root helper for its cached Git refs; only the Hermes row and
// source timestamp change. A regular online check still determines upstream freshness.
export async function refreshHermesOffline(): Promise<CheckOutcome> {
  const now = new Date();
  const checked = await checkHermesUpdate(null, true);
  const candidate = normalizeUpdateCandidate(hermesCandidate(checked, null));
  if (!candidate) throw new HttpError(500, 'The local Hermes check returned no candidate');
  await storeCandidates(hermesSource, [candidate], now);
  const state = await checkState();
  state.sources.hermes = { checkedAt: now.toISOString(), error: null };
  await setSetting(CHECK_KEY, state);
  const updates = await db
    .select({ id: helenaUpdate.id })
    .from(helenaUpdate)
    .where(eq(helenaUpdate.updateAvailable, true));
  return { checkedAt: now.toISOString(), sources: 1, failed: [], updates: updates.length };
}

// ── Summaries ───────────────────────────────────────────────────────────────────────────

// What a summary is for: a component's new version, or the set of package versions of a
// group. A row whose `summaryFor` differs has no current summary.
export function summaryKey(rows: Pick<Row, 'component' | 'available'>[]): string {
  if (rows.length === 1) return rows[0]!.available ?? '';
  const joined = rows
    .map((row) => `${row.component}=${row.available ?? ''}`)
    .sort()
    .join('\n');
  return `group:${createHash('sha256').update(joined).digest('hex').slice(0, 16)}`;
}

export interface DigestTarget {
  source: string;
  group: string | null;
  rowIds: number[];
  key: string;
}

async function pendingRuns(runIds: number[]): Promise<Set<number>> {
  if (runIds.length === 0) return new Set();
  const rows = await db
    .select({ id: agentRun.id })
    .from(agentRun)
    .where(and(inArray(agentRun.id, runIds), eq(agentRun.status, 'pending')));
  return new Set(rows.map((row) => row.id));
}

// The components whose new version has no summary yet and none being written, one target
// per component or per group.
export async function digestTargets(): Promise<DigestTarget[]> {
  const rows = await db
    .select()
    .from(helenaUpdate)
    .where(or(eq(helenaUpdate.updateAvailable, true), isNotNull(helenaUpdate.summary)))
    .orderBy(helenaUpdate.source, helenaUpdate.component);
  const pending = await pendingRuns(
    rows.map((row) => row.summaryRunId).filter((id): id is number => id !== null),
  );
  const modelAvailable = await digestModelAvailable();
  const byTarget = new Map<string, Row[]>();
  for (const row of rows) {
    const id =
      row.groupKey && row.updateAvailable
        ? `${row.source}\0${row.groupKey}`
        : `${row.source}\0#${row.id}`;
    byTarget.set(id, [...(byTarget.get(id) ?? []), row]);
  }
  const targets: DigestTarget[] = [];
  for (const group of byTarget.values()) {
    const key = summaryKey(group);
    if (
      group.every(
        (row) => row.summaryFor === key && row.summary && modelAvailable(row.summaryModel),
      )
    )
      continue;
    // A run about exactly this is still going.
    if (
      group.every(
        (row) =>
          row.summaryRunFor === key && row.summaryRunId !== null && pending.has(row.summaryRunId),
      )
    )
      continue;
    targets.push({
      source: group[0]!.source,
      group: group[0]!.updateAvailable ? group[0]!.groupKey : null,
      rowIds: group.map((row) => row.id),
      key,
    });
  }
  return targets;
}

async function subjectOf(target: DigestTarget): Promise<DigestSubject | null> {
  const rows = await db.select().from(helenaUpdate).where(inArray(helenaUpdate.id, target.rowIds));
  if (rows.length === 0) return null;
  const source = host.updateSources.get(target.source);
  const notes: string[] = [];
  if (source?.releaseNotes) {
    const context = checkContext(source, async () => null, false);
    for (const row of rows) {
      try {
        const text = await source.releaseNotes(candidateOf(row), context);
        if (text?.trim())
          notes.push(rows.length > 1 ? `### ${row.name}\n${text.trim()}` : text.trim());
      } catch (error) {
        log.warn(`release notes of ${row.source}/${row.component}: ${String(error)}`);
      }
    }
  }
  return {
    title: target.group === 'apt' ? 'Debian-Pakete' : (target.group ?? rows[0]!.name),
    kind: rows[0]!.kind,
    items: rows.map((row) => ({
      name: row.name,
      installed: row.installed,
      available: row.available,
      security: row.security,
      detail: row.detail,
    })),
    notes: notes.length ? notes.join('\n\n') : null,
  };
}

// Queues one digest run per target and answers how many. A target that cannot be queued
// (no Hermes agent, the agent paused) records why on its rows and is tried again at the
// next check.
export async function queueDigests(): Promise<number> {
  const settings = await getUpdateSettings();
  if (!settings.summarize) return 0;
  const targets = await digestTargets();
  if (targets.length === 0) return 0;
  const agent = await pickDigestAgent(settings);
  let queued = 0;
  for (const target of targets) {
    try {
      if (!agent) throw new DigestRefused('No Hermes agent can write the summary');
      await db
        .update(helenaUpdate)
        .set({ summaryRunId: null, summaryRunFor: target.key, summaryError: null })
        .where(inArray(helenaUpdate.id, target.rowIds));
      const subject = await subjectOf(target);
      if (!subject) continue;
      const choice = await pickDigestModel(agent.id, settings);
      const runId = await queueDigestRun(agent, digestPrompt(subject), choice);
      await db
        .update(helenaUpdate)
        .set({ summaryRunId: runId, summaryRunFor: target.key, summaryError: null })
        .where(inArray(helenaUpdate.id, target.rowIds));
      queued += 1;
    } catch (error) {
      const message = (error instanceof Error ? error.message : String(error)).slice(0, 500);
      await db
        .update(helenaUpdate)
        .set({ summaryRunFor: null, summaryError: message })
        .where(inArray(helenaUpdate.id, target.rowIds));
    }
  }
  return queued;
}

// Stores what the finished digest runs wrote (the job's own and any a previous check left
// going) and answers how many are still going.
export async function collectDigests(): Promise<number> {
  const rows = await db
    .select()
    .from(helenaUpdate)
    .where(and(isNotNull(helenaUpdate.summaryRunId), isNotNull(helenaUpdate.summaryRunFor)));
  const byRun = new Map<number, Row[]>();
  for (const row of rows)
    byRun.set(row.summaryRunId!, [...(byRun.get(row.summaryRunId!) ?? []), row]);
  const settings = await getUpdateSettings();
  let open = 0;
  for (const [runId, group] of byRun) {
    const run = await digestRunState(runId);
    if (run.status === 'pending') {
      open += 1;
      continue;
    }
    const ids = group.map((row) => row.id);
    const key = group[0]!.summaryRunFor;
    if (run.status === 'success') {
      const parsed = parseDigest(run.output);
      await db
        .update(helenaUpdate)
        .set(
          parsed
            ? {
                summary: parsed.summary,
                highlights: parsed.highlights,
                risk: parsed.risk,
                breaking: parsed.breaking,
                summaryFor: key,
                summaryRunFor: null,
                summaryModel: run.usedModel ?? run.model,
                summaryError: null,
                summarizedAt: new Date(),
              }
            : { summaryRunFor: null, summaryError: 'The answer held no summary' },
        )
        .where(inArray(helenaUpdate.id, ids));
      continue;
    }
    const refused = run.failureCode === 'model-unavailable' || isModelRefusal(run.error);
    // A refusal of the local model says nothing about the one chosen for the summary.
    if (settings.model === null && run.model && refused && !run.local) {
      // The account does not serve the cheapest model: the next check takes the next one.
      await rememberRefusedModel(run.model);
    }
    await db
      .update(helenaUpdate)
      .set({
        summaryRunFor: null,
        summaryError: (run.error ?? `The summary run was ${run.status}`).slice(0, 500),
      })
      .where(inArray(helenaUpdate.id, ids));
  }
  return open;
}

// ── Applying ────────────────────────────────────────────────────────────────────────────

function candidateOf(row: Row): UpdateCandidate {
  return {
    component: row.component,
    name: row.name,
    installed: row.installed,
    available: row.available,
    updateAvailable: row.updateAvailable,
    security: row.security,
    sourceUrl: row.sourceUrl,
    notesUrl: row.notesUrl,
    group: row.groupKey,
    applicable: row.applicable,
    hint: row.hint,
    detail: row.detail,
    error: row.error,
    data: row.data,
  };
}

// Where the database dump before an update goes: the backups folder the migrations use.
function backupDir(): string {
  return (
    process.env.HELENA_UPDATE_BACKUP_DIR?.trim() ||
    process.env.BACKUP_DIR?.trim() ||
    '/var/lib/volition/plan/backups'
  );
}

export type ApplyScope = 'item' | 'group' | 'security';

const UNSTARTED_AFTER_MS = 10 * 60_000;
const UNFINISHED_AFTER_MS = 3 * 3_600_000;

// Starts the update of one component (or, for a group, of every component of it, or of
// its security updates). The scheduled job uses this path for eligible low-risk updates.
export async function applyUpdate(
  userId: string,
  itemId: number,
  scope: ApplyScope = 'item',
  automatic = false,
  expectedVersion?: string,
): Promise<number> {
  const [row] = await db.select().from(helenaUpdate).where(eq(helenaUpdate.id, itemId));
  if (!row) throw new HttpError(404, 'Update nicht gefunden');
  if (automatic) {
    const settings = await getUpdateSettings();
    if (
      scope !== 'item' ||
      row.available !== expectedVersion ||
      !row.summary ||
      row.summaryFor !== summaryKey([row]) ||
      !(await digestModelAvailable())(row.summaryModel) ||
      row.risk !== 'low' ||
      row.breaking !== false ||
      !supportsAutomaticUpdate(row.source, row.component) ||
      updateMode(settings, row.source, row.component) !== 'auto'
    )
      throw new HttpError(409, 'The automatic update is no longer eligible');
  }
  const source = host.updateSources.get(row.source);
  if (!source?.apply)
    throw new HttpError(409, `This component cannot be updated from ${await getDisplayName()}`);
  let rows = [row];
  if (scope !== 'item') {
    if (!row.groupKey) throw new HttpError(400, 'This component has no group');
    rows = await db
      .select()
      .from(helenaUpdate)
      .where(
        and(
          eq(helenaUpdate.source, row.source),
          eq(helenaUpdate.groupKey, row.groupKey),
          eq(helenaUpdate.updateAvailable, true),
          scope === 'security' ? eq(helenaUpdate.security, true) : undefined,
        ),
      );
  }
  rows = rows.filter((entry) => entry.updateAvailable && entry.applicable && entry.available);
  if (rows.length === 0) throw new HttpError(409, 'Kein anwendbares Update vorhanden');
  if (!(await quietForUpdate()))
    throw new HttpError(409, 'Ein Agentenlauf, Chat oder anderes Update läuft noch');
  const component = scope === 'item' ? row.component : `${row.groupKey}:${scope}`;
  const [running] = await db
    .select({ id: helenaUpdateAction.id })
    .from(helenaUpdateAction)
    .where(and(eq(helenaUpdateAction.source, row.source), eq(helenaUpdateAction.state, 'running')));
  if (running) throw new HttpError(409, 'Ein Update dieser Quelle läuft bereits');
  let backupPath: string | null = null;
  if (source.backupFirst) {
    // An upgrade of the database server or a library it uses must have a way back.
    try {
      backupPath = (await writeBackup([], { dir: backupDir(), label: 'pre-update' })).path;
    } catch (error) {
      throw new HttpError(
        500,
        `The database dump before the update failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  let action: { id: number } | undefined;
  try {
    [action] = await db
      .insert(helenaUpdateAction)
      .values({
        source: row.source,
        component,
        name: scope === 'item' ? row.name : `${row.groupKey} (${rows.length})`,
        components: rows.map((entry) => entry.component),
        fromVersion: scope === 'item' ? row.installed : null,
        toVersion: scope === 'item' ? row.available : null,
        state: 'running',
        automatic,
        backupPath,
        requestedByUserId: userId,
      })
      .returning({ id: helenaUpdateAction.id });
  } catch (error) {
    if (pgErrorCode(error) === '23505')
      throw new HttpError(409, 'Ein Update dieser Quelle läuft bereits');
    throw error;
  }
  const actionId = action!.id;
  try {
    const started = await source.apply(
      {
        component: row.component,
        target: row.available!,
        candidate: candidateOf(row),
        components: scope === 'item' ? undefined : rows.map(candidateOf),
      },
      { log: consoleLogger(`updates:${source.id}`), userId },
    );
    await db
      .update(helenaUpdateAction)
      .set({ ref: started.ref })
      .where(eq(helenaUpdateAction.id, actionId));
    if (started.progress && started.progress.state !== 'running') {
      await finishAction(actionId, started.progress);
    }
  } catch (error) {
    await finishAction(actionId, {
      state: 'failed',
      error:
        `Update fehlgeschlagen: ${error instanceof Error ? error.message : String(error)}`.slice(
          0,
          500,
        ),
    });
  }
  return actionId;
}

async function quietForUpdate(): Promise<boolean> {
  const [runs, chats, actions] = await Promise.all([
    db
      .select({ id: agentRun.id })
      .from(agentRun)
      .where(inArray(agentRun.status, ['pending', 'running']))
      .limit(1),
    db
      .select({ id: agentChatMessage.id })
      .from(agentChatMessage)
      .where(inArray(agentChatMessage.status, ['pending', 'streaming']))
      .limit(1),
    db
      .select({ id: helenaUpdateAction.id })
      .from(helenaUpdateAction)
      .where(eq(helenaUpdateAction.state, 'running'))
      .limit(1),
  ]);
  return !runs.length && !chats.length && !actions.length;
}

export async function runAutoUpdates(sleep: (ms: number) => Promise<void>): Promise<void> {
  const [owner] = await db.select({ id: user.id }).from(user).where(eq(user.role, 'god')).limit(1);
  if (!owner) return;
  const settings = await getUpdateSettings();
  const rows = await db.select().from(helenaUpdate).where(eq(helenaUpdate.updateAvailable, true));
  const modelAvailable = await digestModelAvailable();
  const quietDeadline = Date.now() + 2 * 60 * 60_000;
  for (const row of rows) {
    if (
      !row.applicable ||
      !row.available ||
      !row.summary ||
      row.risk !== 'low' ||
      row.breaking !== false ||
      !supportsAutomaticUpdate(row.source, row.component) ||
      row.summaryFor !== summaryKey([row]) ||
      !modelAvailable(row.summaryModel) ||
      updateMode(settings, row.source, row.component) !== 'auto'
    )
      continue;
    await followActions();
    const attempts = await db
      .select({ state: helenaUpdateAction.state })
      .from(helenaUpdateAction)
      .where(
        and(
          eq(helenaUpdateAction.source, row.source),
          eq(helenaUpdateAction.toVersion, row.available),
          sql`${helenaUpdateAction.components} @> ${JSON.stringify([row.component])}::jsonb`,
        ),
      );
    if (attempts.length) continue;
    while (!(await quietForUpdate())) {
      if (Date.now() >= quietDeadline) return;
      await sleep(60_000);
    }
    let id: number;
    try {
      id = await applyUpdate(owner.id, row.id, 'item', true, row.available);
    } catch (error) {
      log.warn(`automatic update ${row.source}/${row.component} could not start: ${String(error)}`);
      return;
    }
    for (;;) {
      await followActions();
      const [action] = await db
        .select({ state: helenaUpdateAction.state, error: helenaUpdateAction.error })
        .from(helenaUpdateAction)
        .where(eq(helenaUpdateAction.id, id));
      if (!action) return;
      if (action.state === 'failed') {
        if (action.error?.includes('previous version restored')) break;
        return;
      }
      if (action.state === 'done') break;
      await sleep(5_000);
    }
  }
}

async function healthSnapshot(): Promise<Record<string, unknown>> {
  try {
    const health = await systemHealth();
    return {
      services: health.services.map((service) => ({
        service: service.service,
        state: service.state,
      })),
    };
  } catch {
    return {};
  }
}

async function finishAction(
  actionId: number,
  progress: {
    state: 'done' | 'failed' | 'running';
    log?: string | null;
    error?: string | null;
    result?: Record<string, unknown> | null;
  },
  recheck = true,
): Promise<void> {
  let recheckFailed: string[] = [];
  const [running] = await db
    .select({ source: helenaUpdateAction.source })
    .from(helenaUpdateAction)
    .where(and(eq(helenaUpdateAction.id, actionId), eq(helenaUpdateAction.state, 'running')));
  if (!running) return;
  if (recheck) {
    try {
      recheckFailed = (await runUpdateCheck({ only: running.source, manual: true })).failed;
    } catch (error) {
      log.warn(`recheck after update ${actionId}: ${String(error)}`);
      recheckFailed = [running.source];
    }
  }
  const [action] = await db
    .update(helenaUpdateAction)
    .set({
      state: progress.state === 'done' ? 'done' : 'failed',
      // A timeout names no log: the one the helper wrote so far stays.
      ...(progress.log != null && { log: progress.log.slice(-20_000) }),
      error:
        progress.state === 'done' ? null : (progress.error ?? 'The update failed').slice(0, 500),
      result: progress.result ?? null,
      health: await healthSnapshot(),
      finishedAt: new Date(),
    })
    .where(and(eq(helenaUpdateAction.id, actionId), eq(helenaUpdateAction.state, 'running')))
    .returning({ source: helenaUpdateAction.source });
  if (!action) return;
  const publish = async (phase: 'finished' | 'checked', failed: string[] = []) => {
    try {
      await events.publish(
        createEvent({
          type: 'helena.updates.status',
          subject: `actions/${actionId}`,
          data: { actionId, source: action.source, phase, state: progress.state, failed },
          actor: 'system',
        }),
      );
    } catch (error) {
      log.warn(`update status event ${actionId}: ${String(error)}`);
    }
  };
  await publish('finished');
  if (recheck) await publish('checked', recheckFailed);
}

// Follows every update that is running to its end. Called when the list is read and by the
// background loop.
export async function followActions(now = Date.now()): Promise<number> {
  const running = await db
    .select()
    .from(helenaUpdateAction)
    .where(eq(helenaUpdateAction.state, 'running'));
  let finished = 0;
  for (const action of running) {
    const age = now - action.requestedAt.getTime();
    // A helper that never took the request, or never finished it (its unit gives up after
    // two hours), would block every further update of the source.
    if ((!action.ref && age > UNSTARTED_AFTER_MS) || age > UNFINISHED_AFTER_MS) {
      await finishAction(
        action.id,
        {
          state: 'failed',
          error: action.ref
            ? 'The update did not finish in time; look at the helper (journalctl -u helena-update)'
            : 'The update did not start',
        },
        false,
      );
      finished += 1;
      continue;
    }
    const source = host.updateSources.get(action.source);
    if (!action.ref || !source?.progress) continue;
    try {
      const progress = await source.progress(action.ref!, {
        log: consoleLogger(`updates:${source.id}`),
        userId: action.requestedByUserId ?? '',
      });
      if (progress.state === 'running') {
        if (progress.log) {
          await db
            .update(helenaUpdateAction)
            .set({ log: progress.log.slice(-20_000) })
            .where(eq(helenaUpdateAction.id, action.id));
        }
        continue;
      }
      await finishAction(action.id, progress);
      finished += 1;
    } catch (error) {
      log.warn(`following update ${action.id}: ${String(error)}`);
    }
  }
  return finished;
}

// ── Reading ─────────────────────────────────────────────────────────────────────────────

export interface UpdateItemView {
  id: number;
  source: string;
  sourceLabel: LocalizedText;
  kind: UpdateKind;
  component: string;
  name: string;
  installed: string | null;
  available: string | null;
  updateAvailable: boolean;
  security: boolean;
  risk: UpdateRisk | null;
  mode: 'auto' | 'manual';
  autoAllowed: boolean;
  breaking: boolean | null;
  summary: string | null;
  highlights: string[];
  summaryCurrent: boolean;
  summaryPending: boolean;
  summaryModel: string | null;
  summaryRunId: number | null;
  summaryError: string | null;
  summarizedAt: string | null;
  sourceUrl: string | null;
  notesUrl: string | null;
  group: string | null;
  applicable: boolean;
  hint: LocalizedText | null;
  detail: string | null;
  error: string | null;
  availableSince: string | null;
  checkedAt: string;
}

export interface UpdateActionView {
  id: number;
  source: string;
  component: string;
  name: string;
  components: string[];
  fromVersion: string | null;
  toVersion: string | null;
  state: 'running' | 'done' | 'failed';
  automatic: boolean;
  backupPath: string | null;
  log: string | null;
  error: string | null;
  result: Record<string, unknown> | null;
  health: Record<string, unknown> | null;
  requestedAt: string;
  finishedAt: string | null;
}

function actionView(row: typeof helenaUpdateAction.$inferSelect): UpdateActionView {
  return {
    id: row.id,
    source: row.source,
    component: row.component,
    name: row.name,
    components: row.components,
    fromVersion: row.fromVersion,
    toVersion: row.toVersion,
    state: row.state as UpdateActionView['state'],
    automatic: row.automatic,
    backupPath: row.backupPath,
    log: row.log,
    error: row.error,
    result: row.result,
    health: row.health,
    requestedAt: iso(row.requestedAt),
    finishedAt: row.finishedAt ? iso(row.finishedAt) : null,
  };
}

export async function listUpdateActions(limit = 20): Promise<UpdateActionView[]> {
  const rows = await db
    .select()
    .from(helenaUpdateAction)
    .orderBy(desc(helenaUpdateAction.id))
    .limit(limit);
  return rows.map(actionView);
}

export async function getUpdateAction(actionId: number): Promise<UpdateActionView> {
  await followActions();
  const [row] = await db
    .select()
    .from(helenaUpdateAction)
    .where(eq(helenaUpdateAction.id, actionId));
  if (!row) throw new HttpError(404, 'Update not found');
  return actionView(row);
}

export async function listUpdateItems(
  settings?: Awaited<ReturnType<typeof getUpdateSettings>>,
): Promise<UpdateItemView[]> {
  settings ??= await getUpdateSettings();
  const rows = await db.select().from(helenaUpdate);
  const modelAvailable = await digestModelAvailable();
  const [job] = await db
    .select()
    .from(helenaSystemJob)
    .where(eq(helenaSystemJob.id, 'helena.updates'));
  const checking =
    job?.lastStatus === 'running' &&
    job.lastStartedAt !== null &&
    Date.now() - job.lastStartedAt.getTime() < 60 * 60_000;
  const pending = await pendingRuns(
    rows.map((row) => row.summaryRunId).filter((id): id is number => id !== null),
  );
  // Keys of the groups, so a row knows whether its summary is about its current version.
  const groups = new Map<string, Row[]>();
  for (const row of rows) {
    if (!row.groupKey || !row.updateAvailable) continue;
    const id = `${row.source}\0${row.groupKey}`;
    groups.set(id, [...(groups.get(id) ?? []), row]);
  }
  const keyOf = (row: Row) =>
    row.groupKey && row.updateAvailable
      ? summaryKey(groups.get(`${row.source}\0${row.groupKey}`) ?? [row])
      : summaryKey([row]);
  const labels = new Map(sources().map(({ source }) => [source.id, source]));
  return rows
    .map((row): UpdateItemView => {
      const current =
        row.summaryFor === keyOf(row) && row.summary !== null && modelAvailable(row.summaryModel);
      const autoAllowed =
        current &&
        row.applicable &&
        row.risk === 'low' &&
        row.breaking === false &&
        supportsAutomaticUpdate(row.source, row.component);
      return {
        id: row.id,
        source: row.source,
        sourceLabel: labels.get(row.source)?.label ?? row.source,
        kind: row.kind as UpdateKind,
        component: row.component,
        name: row.name,
        installed: row.installed,
        available: row.available,
        updateAvailable: row.updateAvailable,
        security: row.security,
        risk: current ? ((row.risk as UpdateRisk | null) ?? null) : null,
        autoAllowed,
        mode: autoAllowed ? updateMode(settings, row.source, row.component) : 'manual',
        breaking: current ? row.breaking : null,
        summary: current ? row.summary : null,
        highlights: current ? (row.highlights ?? []) : [],
        summaryCurrent: current,
        summaryPending:
          (row.summaryRunFor === keyOf(row) &&
            (row.summaryRunId === null || pending.has(row.summaryRunId))) ||
          (!current && settings.summarize && row.updateAvailable && !row.summaryError && checking),
        summaryModel: current ? row.summaryModel : null,
        summaryRunId: row.summaryRunId,
        summaryError: row.summaryError,
        summarizedAt: current && row.summarizedAt ? iso(row.summarizedAt) : null,
        sourceUrl: row.sourceUrl,
        notesUrl: row.notesUrl,
        group: row.groupKey,
        applicable: row.applicable,
        hint: row.hint,
        detail: row.detail,
        error: row.error,
        availableSince: row.availableSince ? iso(row.availableSince) : null,
        checkedAt: iso(row.checkedAt),
      };
    })
    .sort(
      (a, b) =>
        updatePriority(b) - updatePriority(a) ||
        (labels.get(a.source)?.order ?? 1000) - (labels.get(b.source)?.order ?? 1000) ||
        a.name.localeCompare(b.name),
    );
}

// Who writes the summaries and on which model, as the settings resolve today ("Automatisch"
// included), and what the pickers offer.
async function digestView(settings: Awaited<ReturnType<typeof getUpdateSettings>>) {
  const [agent, agents] = await Promise.all([pickDigestAgent(settings), hermesAgents()]);
  const catalog = agent ? (await readChatCatalog(agent.id)).models : [];
  const choice = agent
    ? await pickDigestModel(agent.id, settings)
    : { model: null, reasoning: settings.reasoning };
  return {
    agentId: agent?.id ?? null,
    agentName: agent
      ? (agents.find((entry) => entry.id === agent.id)?.name ?? agent.username)
      : null,
    model: choice.model,
    reasoning: choice.reasoning,
    agents,
    models: catalog.map((entry) => ({
      id: entry.id,
      name: entry.name,
      thinkingLevels: entry.thinkingLevels,
    })),
  };
}

export async function updateCenterState() {
  await followActions();
  await collectDigests();
  const [items, actions, state, settings] = await Promise.all([
    listUpdateItems(),
    listUpdateActions(),
    checkState(),
    getUpdateSettings(),
  ]);
  const withUpdate = items.filter((item) => item.updateAvailable);
  return {
    checkedAt: state.checkedAt,
    helper: { installed: await helperInstalled(), error: state.inventoryError },
    apt: state.apt,
    counts: {
      updates: withUpdate.length,
      security: withUpdate.filter((item) => item.security).length,
      applicable: withUpdate.filter((item) => item.applicable).length,
    },
    sources: sources().map(({ source, pluginId }) => ({
      id: source.id,
      label: source.label,
      kind: source.kind,
      pluginId,
      checkedAt: state.sources[source.id]?.checkedAt ?? null,
      error: state.sources[source.id]?.error ?? null,
    })),
    items,
    actions,
    settings,
    digest: await digestView(settings),
  };
}
