import { access, readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { agentUsage, db, helenaLocalAiEval, helenaModelServer, writeSecret } from '@repo/db';
import {
  LOCAL_AI_KEY_DIR,
  allowedKeyFile,
  failedEvalModels,
  listModelServers,
  localAiServerSecretKey,
  pickModel,
  readLocalAiPolicy,
  readModelServerKey,
  resolveLocalRoute,
  routeFor,
  writeLocalAiPolicy,
  type LocalAiPolicy,
  type ModelServerRow,
} from '@repo/db';
import { and, desc, eq, gte, sql } from 'drizzle-orm';
import {
  CONFIGURABLE_CAPABILITIES,
  LOCAL_AI_UNITS,
  classEvalVersion,
  classModes,
  isLocalProvider,
  isLocalHalogenUrl,
  isModelServerSlug,
  localModelId,
  localProviderName,
  median,
  normalizeHalogenPriority,
  parseLocalModelId,
  priorityProxyBaseUrl,
  type LocalAiMode,
  type LocalAiTaskClass,
  type LocalAiUnit,
  type LocalModel,
  type ModelServerContext,
  type ModelServerOptions,
  type ModelServerStatus,
  type ModelServerType,
  type PriorityConfig,
  type RuntimeLocalAi,
  withConfiguredCapabilities,
} from '@helena/sdk';
import { host } from '#shared/helena';
import { HttpError, iso } from '#shared/lib';
import { joinUrl, openAiEvalContext } from './eval-context';
import { LEMONADE, LEMONADE_DEFAULT_BASE_URL, allowedTokenizerFile } from './server-types';
import { localAiGuard } from './guard';
import { currentJudge } from './judge';
import {
  readModelOptions,
  saveModelOptions,
  validateModelOptions,
  type LocalModelOptions,
} from './model-options';
import { CODING_TASKS } from '../../scripts/agentic-coding/tasks';
import { evaluateCodingTask } from '../../scripts/agentic-coding/run';

// Local AI in the API (docs/helena-decisions/local-ai-platform.md): the model servers, their
// status and models, the policy (master switch, units, task classes), the evals that gate a
// class, what the runners and the pickers get, and the status the "Lokale KI" card shows.

export const DEFAULT_SERVER_SLUG = 'local';
// The file native/local-ai/install.sh writes (lemond loads it as its `api-key` credential).
export const DEFAULT_KEY_FILE = `${LOCAL_AI_KEY_DIR}/local-ai.key`;
// Hermes refuses a local endpoint that serves less than this (its providers docs).
export const HERMES_MIN_CONTEXT = 65_536;
const STATUS_TIMEOUT_MS = 5_000;
const MODELS_TIMEOUT_MS = 15_000;

// ── Registries ─────────────────────────────────────────────────────────────────────────

export function serverTypes(): readonly ModelServerType[] {
  return host.modelServers.list();
}

export function serverType(kind: string): ModelServerType | null {
  return host.modelServers.get(kind) ?? null;
}

export function taskClasses(): readonly LocalAiTaskClass[] {
  return host.localAiTaskClasses.list();
}

export function taskClass(id: string): LocalAiTaskClass | null {
  return host.localAiTaskClasses.get(id) ?? null;
}

// ── Reaching a server ──────────────────────────────────────────────────────────────────

// Only http(s) to the address the Administrator configured; the path is appended to it.
export { joinUrl };

export function validBaseUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new HttpError(400, 'The address is not a URL');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:')
    throw new HttpError(400, 'The address must start with http:// or https://');
  if (url.username || url.password) throw new HttpError(400, 'The address must not carry a login');
  if (url.search || url.hash) throw new HttpError(400, 'The address must not carry a query');
  return url.toString().replace(/\/+$/, '');
}

// A path starting with `//` is taken from the server's root (Halogen's `/health` next to its
// `/v1`), any other is appended to the base URL.
export function serverUrl(baseUrl: string, path: string): string {
  const routed = priorityProxyBaseUrl(baseUrl);
  if (!path.startsWith('//')) return joinUrl(routed, path);
  return `${new URL(routed).origin}/${path.replace(/^\/+/, '')}`;
}

export function serverContext(
  server: Pick<ModelServerRow, 'baseUrl'> & { options?: ModelServerRow['options'] },
  key: string | null,
  timeoutMs: number,
): ModelServerContext {
  return {
    baseUrl: server.baseUrl,
    hasKey: key !== null,
    options: server.options ?? {},
    fetch: (path, init) =>
      fetch(serverUrl(server.baseUrl, path), {
        method: init?.method ?? 'GET',
        headers: {
          accept: 'application/json',
          ...(init?.body !== undefined ? { 'content-type': 'application/json' } : {}),
          ...(key ? { authorization: `Bearer ${key}` } : {}),
          ...(init?.method === 'POST' && isLocalHalogenUrl(server.baseUrl)
            ? { 'x-volition-halogen-priority': 'background' }
            : {}),
        },
        ...(init?.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
        redirect: 'error',
        signal: AbortSignal.timeout(timeoutMs),
      }),
  };
}

// The server's token ids for `logit_bias`, where its type needs ids (Halogen); undefined where
// the server takes the text itself.
export function serverTokenIds(
  server: ModelServerRow,
  key: string | null,
): ((texts: string[]) => Promise<(number | null)[]>) | undefined {
  const type = serverType(server.kind);
  if (!type?.tokenIds) return undefined;
  return (texts) => type.tokenIds!(serverContext(server, key, STATUS_TIMEOUT_MS), texts);
}

// Reads the server's status and models now and keeps them. A server that does not answer
// keeps the models it listed last, marked as not loaded.
export async function checkServer(server: ModelServerRow): Promise<ModelServerRow> {
  const type = serverType(server.kind);
  const key = await readModelServerKey(server);
  let status: ModelServerStatus;
  let models: LocalModel[] = server.models.map((model) => ({ ...model, loaded: false }));
  if (!type) {
    status = {
      reachable: false,
      version: null,
      latencyMs: null,
      error: `Unknown server type ${server.kind}`,
      loaded: [],
    };
  } else {
    status = await type.status(serverContext(server, key, STATUS_TIMEOUT_MS));
    if (status.reachable) {
      try {
        models = await type.models(serverContext(server, key, MODELS_TIMEOUT_MS));
      } catch (error) {
        status = {
          ...status,
          error:
            `Listing the models failed: ${error instanceof Error ? error.message : String(error)}`.slice(
              0,
              200,
            ),
        };
      }
    }
  }
  // A server that answers without saying its version this time (Halogen while its engine is
  // busy) keeps the version it said before.
  if (status.reachable && !status.version && server.status?.version) {
    status = { ...status, version: server.status.version };
  }
  // What the Administrator said its chat models can do, over what Helena derived (also for the
  // models it keeps while the server does not answer).
  if (type?.capabilitiesConfigurable) {
    models = models.map((model) => withConfiguredCapabilities(model, server.options?.capabilities));
  }
  const [row] = await db
    .update(helenaModelServer)
    .set({ status, models, checkedAt: new Date() })
    .where(eq(helenaModelServer.id, server.id))
    .returning();
  return row ?? server;
}

export async function checkAllServers(): Promise<void> {
  for (const server of await listModelServers()) {
    if (!server.enabled) continue;
    try {
      await checkServer(server);
    } catch (error) {
      console.error(`[local-ai] checking ${server.slug} failed`, error);
    }
  }
}

// ── Servers ────────────────────────────────────────────────────────────────────────────

export interface ServerInput {
  slug?: string;
  kind?: string;
  name?: string;
  baseUrl?: string;
  keySource?: 'file' | 'stored' | 'none';
  keyFile?: string | null;
  // Written to app_secret for keySource 'stored'; never read back.
  key?: string | null;
  enabled?: boolean;
  contextLength?: number;
  options?: ModelServerOptions;
}

// The options as Helena keeps them: known capabilities only, a tokenizer file Helena may read.
export function checkOptions(
  value: ModelServerOptions | undefined,
): ModelServerOptions | undefined {
  if (value === undefined) return undefined;
  const out: ModelServerOptions = {};
  if (value.capabilities !== undefined) {
    if (value.capabilities === null) out.capabilities = null;
    else {
      const unknown = value.capabilities.filter(
        (entry) => !CONFIGURABLE_CAPABILITIES.includes(entry),
      );
      if (unknown.length > 0)
        throw new HttpError(400, `Only ${CONFIGURABLE_CAPABILITIES.join(', ')} can be set`);
      out.capabilities = CONFIGURABLE_CAPABILITIES.filter((entry) =>
        value.capabilities!.includes(entry),
      );
    }
  }
  if (value.tokenizerFile !== undefined) {
    if (value.tokenizerFile !== null && !allowedTokenizerFile(value.tokenizerFile))
      throw new HttpError(400, 'The tokenizer file must be a .json file below /var/lib/');
    out.tokenizerFile = value.tokenizerFile;
  }
  return out;
}

const CONFIGURABLE = ['tools', 'reasoning', 'vision'] as const;

function serverView(row: ModelServerRow, options: Record<string, LocalModelOptions> = {}) {
  const key: 'file' | 'stored' | 'none' | 'invalid' =
    row.keySource === 'none'
      ? 'none'
      : row.keySource === 'file'
        ? allowedKeyFile(row.keyFile)
          ? 'file'
          : 'invalid'
        : 'stored';
  return {
    id: row.id,
    slug: row.slug,
    kind: row.kind,
    name: row.name,
    baseUrl: row.baseUrl,
    keySource: row.keySource as 'file' | 'stored' | 'none',
    keyFile: row.keyFile,
    key,
    enabled: row.enabled,
    contextLength: row.contextLength,
    options: {
      capabilities: row.options?.capabilities
        ? CONFIGURABLE.filter((entry) => row.options.capabilities!.includes(entry))
        : null,
      tokenizerFile: row.options?.tokenizerFile ?? null,
    },
    provider: localProviderName(row.slug),
    models: row.models.map((model) => ({
      ...model,
      modelId: localModelId(row.slug, model.id),
      startOptions: row.kind === LEMONADE ? (options[model.id] ?? null) : null,
    })),
    status: row.status,
    checkedAt: row.checkedAt ? iso(row.checkedAt) : null,
  };
}

export type ServerView = ReturnType<typeof serverView>;

export async function listServers(): Promise<ServerView[]> {
  const [servers, options] = await Promise.all([listModelServers(), readModelOptions()]);
  return servers.map((server) => serverView(server, options));
}

export async function updateModelOptions(
  serverId: number,
  modelName: string,
  options: LocalModelOptions,
) {
  const server = (await listModelServers()).find((row) => row.id === serverId);
  if (!server || server.kind !== LEMONADE) throw new HttpError(404, 'No Lemonade server');
  if (!server.models.some((model) => model.id === modelName))
    throw new HttpError(404, 'The server does not list this model');
  try {
    validateModelOptions(options);
  } catch (error) {
    throw new HttpError(400, error instanceof Error ? error.message : String(error));
  }
  await saveModelOptions(modelName, options);
  return options;
}

function checkContext(value: number | undefined): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isInteger(value) || value < HERMES_MIN_CONTEXT || value > 1_048_576)
    throw new HttpError(
      400,
      `The context window must be between ${HERMES_MIN_CONTEXT} and 1048576`,
    );
  return value;
}

function checkKeyFile(source: string | undefined, file: string | null | undefined) {
  if (source !== 'file') return;
  if (!allowedKeyFile(file ?? DEFAULT_KEY_FILE))
    throw new HttpError(400, `The key file must be below ${LOCAL_AI_KEY_DIR}/`);
}

export async function createServer(input: ServerInput): Promise<ServerView> {
  const slug = (input.slug ?? DEFAULT_SERVER_SLUG).trim().toLowerCase();
  if (!isModelServerSlug(slug)) throw new HttpError(400, 'The short name may use a–z, 0–9 and -');
  const kind = input.kind ?? LEMONADE;
  const type = serverType(kind);
  if (!type) throw new HttpError(400, `Unknown server type ${kind}`);
  const baseUrl = validBaseUrl(input.baseUrl ?? type.defaultBaseUrl ?? LEMONADE_DEFAULT_BASE_URL);
  const keySource = input.keySource ?? type.defaultKeySource ?? 'file';
  const keyFile = keySource === 'file' ? (input.keyFile ?? DEFAULT_KEY_FILE) : null;
  checkKeyFile(keySource, keyFile);
  const options = checkOptions(input.options) ?? {};
  const [existing] = await db
    .select({ id: helenaModelServer.id })
    .from(helenaModelServer)
    .where(eq(helenaModelServer.slug, slug));
  if (existing) throw new HttpError(409, 'A server with this short name exists');
  if (keySource === 'stored' && input.key?.trim()) {
    await writeSecret(localAiServerSecretKey(slug), { key: input.key.trim() }, { key: true });
  }
  const [row] = await db
    .insert(helenaModelServer)
    .values({
      slug,
      kind,
      name: input.name?.trim() || 'Lokale KI',
      baseUrl,
      keySource,
      keyFile,
      enabled: input.enabled ?? true,
      contextLength: checkContext(input.contextLength) ?? HERMES_MIN_CONTEXT,
      options,
    })
    .returning();
  return serverView(await checkServer(row!));
}

export async function updateServer(id: number, input: ServerInput): Promise<ServerView> {
  const [row] = await db.select().from(helenaModelServer).where(eq(helenaModelServer.id, id));
  if (!row) throw new HttpError(404, 'No such server');
  if (input.slug !== undefined && input.slug !== row.slug)
    throw new HttpError(400, 'The short name of a server does not change');
  if (input.kind !== undefined && !serverType(input.kind))
    throw new HttpError(400, `Unknown server type ${input.kind}`);
  const keySource = input.keySource ?? (row.keySource as 'file' | 'stored' | 'none');
  const keyFile = keySource === 'file' ? (input.keyFile ?? row.keyFile ?? DEFAULT_KEY_FILE) : null;
  checkKeyFile(keySource, keyFile);
  const options = checkOptions(input.options);
  if (keySource === 'stored' && input.key?.trim()) {
    await writeSecret(localAiServerSecretKey(row.slug), { key: input.key.trim() }, { key: true });
  }
  const [updated] = await db
    .update(helenaModelServer)
    .set({
      ...(input.kind !== undefined && { kind: input.kind }),
      ...(input.name !== undefined && { name: input.name.trim() || row.name }),
      ...(input.baseUrl !== undefined && { baseUrl: validBaseUrl(input.baseUrl) }),
      keySource,
      keyFile,
      ...(input.enabled !== undefined && { enabled: input.enabled }),
      ...(input.contextLength !== undefined && {
        contextLength: checkContext(input.contextLength),
      }),
      // A field the request leaves out stays as it was.
      ...(options !== undefined && { options: { ...row.options, ...options } }),
      updatedAt: new Date(),
    })
    .where(eq(helenaModelServer.id, id))
    .returning();
  return serverView(await checkServer(updated!));
}

export async function deleteServer(id: number): Promise<boolean> {
  const rows = await db
    .delete(helenaModelServer)
    .where(eq(helenaModelServer.id, id))
    .returning({ id: helenaModelServer.id });
  return rows.length > 0;
}

export async function refreshServer(id: number): Promise<ServerView> {
  const [row] = await db.select().from(helenaModelServer).where(eq(helenaModelServer.id, id));
  if (!row) throw new HttpError(404, 'No such server');
  return serverView(await checkServer(row));
}

// ── Evals ──────────────────────────────────────────────────────────────────────────────

// An eval asks its cases one after the other; on a local model a class takes minutes (the
// reflection with thinking: 6 × 68 s), longer than a request may stay open behind nginx
// (60 s). So it runs in the background, like the decision evals: the request answers 202 with
// the eval's row, `running`, and its score comes in on the row. An eval that has not finished
// after this long was cut off (the API restarted) and no longer holds its class and model.
export const EVAL_STALE_MS = 90 * 60_000;

export type EvalStatus = 'running' | 'done' | 'stale';

// The evals running in this process, so a test (or a shutdown) can wait for them.
const runningEvals = new Map<number, Promise<void>>();

async function evaluateInto(
  rowId: number,
  entry: LocalAiTaskClass,
  server: ModelServerRow,
  model: LocalModel,
  threshold: number,
): Promise<void> {
  let values: Partial<typeof helenaLocalAiEval.$inferInsert>;
  try {
    const key = await readModelServerKey(server);
    // The judge of the evals a program cannot check (Deutsch-Texte), as set in Lokale KI; a
    // class that never asks it costs nothing (a run judge queues only when asked).
    const judge = await currentJudge();
    const result = await entry.evaluate!(
      openAiEvalContext({
        baseUrl: server.baseUrl,
        key,
        model: model.id,
        thinking: entry.thinking ?? 'off',
        judge: judge ?? undefined,
        runCodingTask:
          entry.id === 'agentic-coding'
            ? async (id) => {
                const task = CODING_TASKS.find((item) => item.id === id);
                if (!task) throw new Error(`Unknown coding task ${id}`);
                return evaluateCodingTask(
                  task,
                  model.id,
                  localProviderName(server.slug),
                  process.env.LOCAL_AI_EVAL_HERMES_BIN ?? 'hermes',
                );
              }
            : undefined,
      }),
    );
    values = {
      score: result.score,
      passed: result.score >= threshold,
      cases: result.cases.length,
      details: result.cases
        .filter((item) => entry.id === 'agentic-coding' || !item.passed)
        .slice(0, 20)
        .map((item) => ({ id: item.id, detail: item.detail?.slice(0, 200) ?? null })),
      latencyMsP50: result.latencyMsP50 === null ? null : Math.round(result.latencyMsP50),
      tokensPerSecond: result.tokensPerSecond,
    };
  } catch (error) {
    values = {
      score: 0,
      passed: false,
      cases: 0,
      error: (error instanceof Error ? error.message : String(error)).slice(0, 300),
    };
  }
  await db
    .update(helenaLocalAiEval)
    .set({ ...values, status: 'done', finishedAt: new Date() })
    .where(eq(helenaLocalAiEval.id, rowId));
}

// Starts the eval of a class on a local model and answers its row, still `running`. One eval
// of a class and model at a time.
export async function startEval(input: {
  classId: string;
  modelId: string;
  // Who asked; null for a maintenance script.
  userId: string | null;
}) {
  const entry = taskClass(input.classId);
  if (!entry) throw new HttpError(404, 'No such task class');
  if (!entry.evaluate) throw new HttpError(400, 'This task class has no eval yet');
  const parsed = parseLocalModelId(input.modelId);
  if (!parsed) throw new HttpError(400, 'Not a local model');
  const [server] = await db
    .select()
    .from(helenaModelServer)
    .where(eq(helenaModelServer.slug, parsed.slug));
  if (!server) throw new HttpError(404, 'No such server');
  const model = server.models.find((item) => item.id === parsed.model);
  if (!model) throw new HttpError(400, 'The server does not list this model');
  if (!model.capabilities.includes(entry.capability))
    throw new HttpError(400, `The model cannot do what the class needs (${entry.capability})`);
  const [busy] = await db
    .select({ id: helenaLocalAiEval.id })
    .from(helenaLocalAiEval)
    .where(
      and(
        eq(helenaLocalAiEval.classId, entry.id),
        eq(helenaLocalAiEval.serverId, server.id),
        eq(helenaLocalAiEval.model, model.id),
        eq(helenaLocalAiEval.status, 'running'),
        gte(helenaLocalAiEval.ranAt, new Date(Date.now() - EVAL_STALE_MS)),
      ),
    )
    .limit(1);
  if (busy) throw new HttpError(409, 'An eval of this kind of work on this model is running');
  const threshold = entry.threshold ?? 0.8;
  const [row] = await db
    .insert(helenaLocalAiEval)
    .values({
      classId: entry.id,
      serverId: server.id,
      model: model.id,
      score: 0,
      threshold,
      passed: false,
      cases: 0,
      evalVersion: classEvalVersion(entry),
      status: 'running',
      ranBy: input.userId,
    })
    .returning();
  const running = evaluateInto(row!.id, entry, server, model, threshold)
    .catch((error: unknown) => console.error('[local-ai] eval result not stored', error))
    .finally(() => runningEvals.delete(row!.id));
  runningEvals.set(row!.id, running);
  return evalView(row!, server.slug);
}

// Waits for the evals this process runs (tests).
export async function settleEvals(): Promise<void> {
  await Promise.all(runningEvals.values());
}

export async function evalById(id: number): Promise<EvalView | null> {
  const [found] = await db
    .select({ row: helenaLocalAiEval, slug: helenaModelServer.slug })
    .from(helenaLocalAiEval)
    .innerJoin(helenaModelServer, eq(helenaModelServer.id, helenaLocalAiEval.serverId))
    .where(eq(helenaLocalAiEval.id, id));
  return found ? evalView(found.row, found.slug) : null;
}

function evalView(row: typeof helenaLocalAiEval.$inferSelect, slug: string, now = Date.now()) {
  const status: EvalStatus =
    row.status === 'done'
      ? 'done'
      : now - row.ranAt.getTime() > EVAL_STALE_MS
        ? 'stale'
        : 'running';
  return {
    id: row.id,
    classId: row.classId,
    modelId: localModelId(slug, row.model),
    status,
    score: row.score,
    score100: row.classId === 'deutsch-texte' ? Math.round(row.score * 100) : null,
    threshold: row.threshold,
    passed: row.passed,
    cases: row.cases,
    details: (row.details as { id: string; detail: string | null }[]) ?? [],
    latencyMsP50: row.latencyMsP50,
    tokensPerSecond: row.tokensPerSecond,
    error: row.error,
    evalVersion: row.evalVersion,
    ranAt: iso(row.ranAt),
    finishedAt: row.finishedAt ? iso(row.finishedAt) : null,
  };
}

export type EvalView = ReturnType<typeof evalView>;

// The newest finished eval of each class and model: what gates the classes.
export async function latestEvals(): Promise<EvalView[]> {
  const rows = await db
    .select({ row: helenaLocalAiEval, slug: helenaModelServer.slug })
    .from(helenaLocalAiEval)
    .innerJoin(helenaModelServer, eq(helenaModelServer.id, helenaLocalAiEval.serverId))
    .where(eq(helenaLocalAiEval.status, 'done'))
    .orderBy(desc(helenaLocalAiEval.ranAt))
    .limit(500);
  const seen = new Set<string>();
  const result: EvalView[] = [];
  for (const { row, slug } of rows) {
    const key = `${row.classId}\0${slug}\0${row.model}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(evalView(row, slug));
  }
  return result;
}

// The evals still asking their cases, for the settings page to show and follow.
export async function evalsInProgress(): Promise<EvalView[]> {
  const rows = await db
    .select({ row: helenaLocalAiEval, slug: helenaModelServer.slug })
    .from(helenaLocalAiEval)
    .innerJoin(helenaModelServer, eq(helenaModelServer.id, helenaLocalAiEval.serverId))
    .where(
      and(
        eq(helenaLocalAiEval.status, 'running'),
        gte(helenaLocalAiEval.ranAt, new Date(Date.now() - EVAL_STALE_MS)),
      ),
    )
    .orderBy(desc(helenaLocalAiEval.ranAt));
  return rows.map(({ row, slug }) => evalView(row, slug));
}

// ── Policy ─────────────────────────────────────────────────────────────────────────────

// The model a class would use now: its own choice, or the first model able to do the work.
export function classModel(
  entry: LocalAiTaskClass,
  chosen: string | null,
  servers: ModelServerRow[],
): string | null {
  const wanted = parseLocalModelId(chosen);
  for (const server of servers) {
    if (!server.enabled || (wanted && wanted.slug !== server.slug)) continue;
    const model = pickModel(server.models, entry.capability, wanted?.model ?? null);
    if (model) return localModelId(server.slug, model.id);
  }
  return null;
}

// Why a class cannot leave `off` now, or null when it can.
export function classBlocker(
  entry: LocalAiTaskClass,
  modelId: string | null,
  evals: EvalView[],
): 'not-wired' | 'no-model' | 'eval-missing' | 'eval-failed' | null {
  if (!entry.wired) return 'not-wired';
  if (!modelId) return 'no-model';
  if (!entry.evaluate) return null;
  const latest = evals.find((item) => item.classId === entry.id && item.modelId === modelId);
  // An eval of an older version measured something the class no longer does.
  if (!latest || latest.evalVersion < classEvalVersion(entry)) return 'eval-missing';
  return latest.passed ? null : 'eval-failed';
}

export interface PolicyPatch {
  enabled?: boolean;
  units?: Partial<Record<LocalAiUnit, boolean>>;
  classes?: Record<string, { mode?: LocalAiMode; model?: string | null }>;
  preset?: LocalAiPolicy['preset'];
  halogenPriority?: Partial<LocalAiPolicy['halogenPriority']>;
}

// The classes each preset puts in `prefer` (only those whose eval passed; the rest stay off).
export const PRESET_CLASSES: Record<'sparsam' | 'ausgewogen' | 'qualitaet', string[]> = {
  // Save the subscriptions: everything that passed runs locally first.
  sparsam: [
    'embeddings',
    'hermes-helpers',
    'summaries',
    'triage',
    'transcription',
    'routines',
    'reflection',
    'coordinator-triage',
  ],
  // The helpers and the background digests.
  ausgewogen: ['embeddings', 'hermes-helpers', 'summaries', 'triage', 'transcription'],
  // Only what does not touch answer quality: embeddings and transcription.
  qualitaet: ['embeddings', 'transcription'],
};

export async function updatePolicy(patch: PolicyPatch): Promise<LocalAiPolicy> {
  const [policy, servers, evals] = await Promise.all([
    readLocalAiPolicy(),
    listModelServers(),
    latestEvals(),
  ]);
  const next: LocalAiPolicy = {
    ...policy,
    units: { ...policy.units },
    classes: { ...policy.classes },
  };
  if (patch.halogenPriority)
    next.halogenPriority = normalizeHalogenPriority({
      ...policy.halogenPriority,
      ...patch.halogenPriority,
    });
  if (patch.units) {
    for (const unit of LOCAL_AI_UNITS) {
      const flag = patch.units[unit];
      if (typeof flag === 'boolean') next.units[unit] = flag;
    }
  }
  const setClass = (id: string, mode: LocalAiMode, model: string | null, strict: boolean) => {
    const entry = taskClass(id);
    if (!entry) {
      if (strict) throw new HttpError(400, `Unknown task class ${id}`);
      return;
    }
    if (model !== null && !parseLocalModelId(model))
      throw new HttpError(400, `${model} is not a local model`);
    if (!classModes(entry).includes(mode)) {
      if (strict) throw new HttpError(400, `${id} does not offer the mode ${mode}`);
      return;
    }
    const resolved = classModel(entry, model, servers);
    if (mode !== 'off') {
      const blocker = classBlocker(entry, resolved, evals);
      if (blocker) {
        if (strict) throw new HttpError(409, `${id} cannot run locally yet: ${blocker}`);
        return;
      }
    }
    next.classes[id] = { mode, model };
  };
  if (patch.preset && patch.preset !== 'eigene') {
    const wanted = new Set(PRESET_CLASSES[patch.preset]);
    for (const entry of taskClasses()) {
      const current = next.classes[entry.id];
      setClass(entry.id, wanted.has(entry.id) ? 'prefer' : 'off', current?.model ?? null, false);
    }
    next.preset = patch.preset;
  }
  if (patch.classes) {
    for (const [id, change] of Object.entries(patch.classes)) {
      const current = next.classes[id] ?? { mode: 'off' as LocalAiMode, model: null };
      setClass(
        id,
        change.mode ?? current.mode,
        change.model === undefined ? current.model : change.model,
        true,
      );
    }
    if (!patch.preset) next.preset = 'eigene';
  }
  if (patch.enabled !== undefined) {
    next.enabled = patch.enabled;
    // The first time on: the default set, as far as its evals passed.
    if (patch.enabled && !policy.initialized) {
      for (const entry of taskClasses()) {
        if (!entry.inMasterDefault || entry.experimental || next.classes[entry.id]) continue;
        setClass(entry.id, 'prefer', null, false);
      }
      next.initialized = true;
    }
  }
  return writeLocalAiPolicy(next);
}

// ── What the runners and the pickers get ────────────────────────────────────────────────

// The environment variable a server's key reaches an agent in (Hermes' key_env).
export function keyVariable(slug: string): string {
  return `HELENA_MODEL_SERVER_KEY_${slug.toUpperCase().replace(/-/g, '_')}`;
}

function chatModels(server: ModelServerRow, policy: LocalAiPolicy): LocalModel[] {
  return server.models.filter(
    (model) =>
      model.capabilities.includes('chat') &&
      model.downloaded !== false &&
      // Plain compatible servers may not identify their hardware. Keep those usable while
      // any device is enabled; never guess a GPU/NPU assignment from the model's name.
      (model.unit === null ? Object.values(policy.units).some(Boolean) : policy.units[model.unit]),
  );
}

// The server's second address for agent turns without thinking, where its type has one.
export function noThinkingBaseUrl(server: Pick<ModelServerRow, 'kind' | 'baseUrl'>): string | null {
  return serverType(server.kind)?.noThinkingBaseUrl?.(server.baseUrl) ?? null;
}

// What an agent's runner writes into its Hermes profile: the local servers (only while the
// master switch is on) and the helper calls Hermes sends there first. Null while local AI is
// off, so nothing of it is left in any profile.
export function runtimeLocalAi(
  policy: LocalAiPolicy,
  servers: ModelServerRow[],
  // The models whose newest eval of the helper class failed (`failedEvalModels`).
  failedHelpers?: ReadonlySet<string>,
): RuntimeLocalAi | null {
  if (!policy.enabled) return null;
  const enabled = servers.filter(
    (server) => server.enabled && chatModels(server, policy).length > 0,
  );
  if (enabled.length === 0) return null;
  const helpers: RuntimeLocalAi['helpers'] = [];
  const helperClass = taskClass('hermes-helpers');
  if (helperClass) {
    const result = routeFor({
      classId: helperClass.id,
      unit: helperClass.unit,
      capability: helperClass.capability,
      policy,
      servers: enabled,
      // Hermes falls back to the main model itself when the server does not answer.
      requireUp: false,
      failed: failedHelpers,
    });
    if ('route' in result) {
      const provider = localProviderName(result.route.server.slug);
      // Session titles stay off (learning.ts: Helena never shows them); compression and, with
      // a vision model, image descriptions go local first.
      helpers.push({ task: 'compression', provider, model: result.route.model });
      const vision = pickModel(chatModels(result.route.server, policy), 'vision', null);
      if (vision) helpers.push({ task: 'vision', provider, model: vision.id });
    }
  }
  return {
    servers: enabled.map((server) => ({
      provider: localProviderName(server.slug),
      baseUrl: server.baseUrl,
      noThinkingBaseUrl: noThinkingBaseUrl(server),
      keyEnv: server.keySource === 'none' ? null : keyVariable(server.slug),
      contextLength: Math.max(server.contextLength, HERMES_MIN_CONTEXT),
      models: chatModels(server, policy).map((model) => ({
        id: model.id,
        contextLength: model.contextLength,
        vision: model.capabilities.includes('vision'),
      })),
    })),
    helpers,
  };
}

export async function runtimeLocalAiNow(): Promise<RuntimeLocalAi | null> {
  const [policy, servers, failed] = await Promise.all([
    readLocalAiPolicy(),
    listModelServers(),
    failedEvalModels('hermes-helpers'),
  ]);
  return runtimeLocalAi(policy, servers, failed);
}

// The keys an agent's runner puts into the environment for the servers its profile names.
export async function runtimeServerKeys(): Promise<Record<string, string>> {
  const local = await runtimeLocalAiNow();
  if (!local) return {};
  const keys: Record<string, string> = {};
  for (const server of await listModelServers()) {
    const entry = local.servers.find((item) => item.provider === localProviderName(server.slug));
    if (!entry?.keyEnv) continue;
    const key = await readModelServerKey(server);
    if (key) keys[entry.keyEnv] = key;
  }
  return keys;
}

// The local models every Hermes agent's picker offers, while local AI is on.
export interface LocalCatalogModel {
  id: string;
  name: string;
  reasoning: boolean;
  thinkingLevels: string[];
  thinkingDefault: string | null;
  provider: string;
  local: true;
  verified?: boolean;
}

export function localCatalogModels(
  policy: LocalAiPolicy,
  servers: ModelServerRow[],
): LocalCatalogModel[] {
  const local = runtimeLocalAi(policy, servers);
  if (!local) return [];
  return servers.flatMap((server) =>
    local.servers.some((entry) => entry.provider === localProviderName(server.slug))
      ? chatModels(server, policy).map((model) => {
          const reasoning = model.capabilities.includes('reasoning');
          return {
            id: localModelId(server.slug, model.id),
            name: model.name,
            reasoning,
            thinkingLevels: reasoning ? ['low', 'medium', 'high'] : [],
            thinkingDefault: null,
            provider: localProviderName(server.slug),
            local: true as const,
            // The server lists it and has it on disk: nothing to confirm by use.
            verified: server.status?.reachable === true,
          };
        })
      : [],
  );
}

export async function localCatalogModelsNow(): Promise<LocalCatalogModel[]> {
  const [policy, servers] = await Promise.all([readLocalAiPolicy(), listModelServers()]);
  return localCatalogModels(policy, servers);
}

// The model a run or chat answer is handed: a local model only while local AI is on and its
// server and model's device are enabled and the chat model is downloaded; otherwise the
// agent's default runs, exactly as without local AI.
export function effectiveModel(
  model: string | null,
  policy: LocalAiPolicy,
  servers: ModelServerRow[],
): string | null {
  const parsed = parseLocalModelId(model);
  if (!parsed) return model;
  if (!policy.enabled) return null;
  const server = servers.find((item) => item.slug === parsed.slug);
  if (!server?.enabled) return null;
  return chatModels(server, policy).some((item) => item.id === parsed.model) ? model : null;
}

// ── Falling back to the configured model ───────────────────────────────────────────────

// Why a run or chat answer that asked for a local model ran on another: local AI (or the
// server, or the model) was off, the server did not answer when it started, or Hermes
// switched to its fallback while it ran (the model check sees that, model-check.ts).
export type LocalFallbackReason = 'off' | 'down' | 'failed';

export interface LocalFallback {
  // The local model that was asked for (`helena-<slug>/<id>`).
  from: string;
  reason: LocalFallbackReason;
}

export interface LocalModelChoice {
  model: string | null;
  fallback: LocalFallback | null;
}

// A server's last status counts while it is this fresh; otherwise a run or chat answer asks
// it once, and waits no longer than the timeout before its configured model takes over.
const ANSWER_FRESH_MS = 15_000;
const ANSWER_TIMEOUT_MS = 2_000;
const VOICE_START_TIMEOUT_MS = 300_000;
const answers = new Map<number, { up: boolean; at: number }>();

export async function serverAnswers(server: ModelServerRow, now = Date.now()): Promise<boolean> {
  if (server.status && server.checkedAt && now - server.checkedAt.getTime() <= ANSWER_FRESH_MS)
    return server.status.reachable;
  const asked = answers.get(server.id);
  if (asked && now - asked.at <= ANSWER_FRESH_MS) return asked.up;
  const type = serverType(server.kind);
  let up = false;
  if (type) {
    try {
      const key = await readModelServerKey(server);
      const timeout = ['whisper-cpp', 'qwentts-cpp'].includes(server.kind)
        ? VOICE_START_TIMEOUT_MS
        : ANSWER_TIMEOUT_MS;
      up = (await type.status(serverContext(server, key, timeout))).reachable;
    } catch {
      up = false;
    }
  }
  answers.set(server.id, { up, at: Date.now() });
  return up;
}

// Forgets what the servers answered (tests).
export function forgetServerAnswers(): void {
  answers.clear();
}

// The model a run or chat answer runs on. A local model only while local AI is on, its server
// enabled, listing it and answering; otherwise `instead`, the model the agent runs on without
// local AI (its own model, or null for the runtime's default when that is local too), with
// the reason, which the run's or answer's model check shows. Any other model is kept.
export async function chooseModelNow(
  model: string | null,
  instead: string | null,
): Promise<LocalModelChoice> {
  const parsed = parseLocalModelId(model);
  if (!model || !parsed) return { model, fallback: null };
  const configured = parseLocalModelId(instead) ? null : instead;
  const [policy, servers] = await Promise.all([readLocalAiPolicy(), listModelServers()]);
  if (effectiveModel(model, policy, servers) === null)
    return { model: configured, fallback: { from: model, reason: 'off' } };
  const server = servers.find((item) => item.slug === parsed.slug)!;
  if (!(await serverAnswers(server)))
    return { model: configured, fallback: { from: model, reason: 'down' } };
  return { model, fallback: null };
}

export async function effectiveModelNow(model: string | null): Promise<string | null> {
  return (await chooseModelNow(model, null)).model;
}

// ── Work Helena hands to local AI by its kind ──────────────────────────────────────────

// The local model a kind of work runs on now that runs as an agent's turn (a digest, a
// routine's task, a coordinator's first plan, a reflection): the class's model while the
// master switch and the class are on, its unit allowed, its eval passed in its current
// version, and its server answering (its last status when younger than 15 s, else one status
// call of at most 2 s, as for a run on a local model). Otherwise null: the work runs on the
// model it runs on without local AI. A server that does not answer is named, so the run's
// model check says why its configured model ran.
export interface ClassModelChoice {
  // `helena-<slug>/<id>`, or null for the configured model.
  model: string | null;
  // The reasoning the run is handed with a local model: `none` for a class that does not think
  // (its run starts on the server's provider without thinking), else null (the local
  // provider's turns think).
  thinkingLevel: string | null;
  fallback: LocalFallback | null;
}

export async function classModelNow(classId: string): Promise<ClassModelChoice> {
  const none: ClassModelChoice = { model: null, thinkingLevel: null, fallback: null };
  const entry = taskClass(classId);
  if (!entry?.wired) return none;
  const result = await resolveLocalRoute({
    classId: entry.id,
    unit: entry.unit,
    capability: entry.capability,
    // The server is asked below, the same way as for a run on a local model.
    requireUp: false,
    evalVersion: classEvalVersion(entry),
  });
  if (!('route' in result)) return none;
  const { server, model, modelId } = result.route;
  // An agent's turn runs on the models its profile lists: the server's chat models on disk.
  const listed = server.models.find((item) => item.id === model);
  if (!listed?.capabilities.includes('chat') || listed.downloaded === false) return none;
  if (!(await serverAnswers(server)))
    return { ...none, fallback: { from: modelId, reason: 'down' } };
  // A class whose eval ran without thinking runs so, where the server has the address for it.
  const quiet = (entry.thinking ?? 'off') === 'off' && noThinkingBaseUrl(server) !== null;
  return { model: modelId, thinkingLevel: quiet ? 'none' : null, fallback: null };
}

// Local models cost nothing per token (the price table's `price` asks this first).
export function isFreeModel(model: string | null | undefined, provider: string | null | undefined) {
  return isLocalProvider(provider) || parseLocalModelId(model) !== null;
}

// ── The machine ────────────────────────────────────────────────────────────────────────

const DRM = '/sys/class/drm';

async function readNumber(path: string): Promise<number | null> {
  try {
    const value = Number((await readFile(path, 'utf8')).trim());
    return Number.isFinite(value) ? value : null;
  } catch {
    return null;
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export interface GpuReading {
  present: boolean;
  busyPercent: number | null;
  vramUsedBytes: number | null;
  vramTotalBytes: number | null;
  gttUsedBytes: number | null;
  gttTotalBytes: number | null;
}

// The AMD GPU's own counters (amdgpu, world-readable in sysfs).
export async function readGpu(root = DRM): Promise<GpuReading> {
  const none: GpuReading = {
    present: false,
    busyPercent: null,
    vramUsedBytes: null,
    vramTotalBytes: null,
    gttUsedBytes: null,
    gttTotalBytes: null,
  };
  let cards: string[];
  try {
    cards = (await readdir(root)).filter((name) => /^card\d+$/.test(name));
  } catch {
    return none;
  }
  for (const card of cards) {
    const device = join(root, card, 'device');
    let vendor = '';
    try {
      vendor = (await readFile(join(device, 'vendor'), 'utf8')).trim();
    } catch {
      continue;
    }
    if (vendor !== '0x1002') continue;
    return {
      present: true,
      busyPercent: await readNumber(join(device, 'gpu_busy_percent')),
      vramUsedBytes: await readNumber(join(device, 'mem_info_vram_used')),
      vramTotalBytes: await readNumber(join(device, 'mem_info_vram_total')),
      gttUsedBytes: await readNumber(join(device, 'mem_info_gtt_used')),
      gttTotalBytes: await readNumber(join(device, 'mem_info_gtt_total')),
    };
  }
  return none;
}

// The NPU is there once the amdxdna driver bound it (kernel 7.x): /dev/accel/accel0.
export async function npuPresent(): Promise<boolean> {
  return exists('/dev/accel/accel0');
}

// ── Usage ──────────────────────────────────────────────────────────────────────────────

// What the agents' runs and chats spent in the last days, local next to the subscriptions.
export async function usageShare(days = 7) {
  const since = new Date(Date.now() - days * 86_400_000);
  const rows = await db
    .select({
      provider: agentUsage.provider,
      model: agentUsage.model,
      tokens: sql<number>`sum(${agentUsage.inputTokens} + ${agentUsage.outputTokens})::bigint`,
    })
    .from(agentUsage)
    .where(and(gte(agentUsage.occurredAt, since)))
    .groupBy(agentUsage.provider, agentUsage.model);
  let local = 0;
  let cloud = 0;
  for (const row of rows) {
    const tokens = Number(row.tokens ?? 0);
    if (isFreeModel(row.model, row.provider)) local += tokens;
    else cloud += tokens;
  }
  return { days, localTokens: local, cloudTokens: cloud };
}

// ── The status card ────────────────────────────────────────────────────────────────────

export async function localAiStatus() {
  type Counts = { interactive: number; normal: number; background: number };
  type PriorityStatus = {
    config: PriorityConfig;
    active: Counts;
    queued: Counts;
    oldestWaitMs: number;
  };
  const [policy, servers, gpu, npu, usage, lastGpuReset, halogenPriority] = await Promise.all([
    readLocalAiPolicy(),
    listModelServers(),
    readGpu(),
    npuPresent(),
    usageShare(),
    readLastGpuReset(),
    fetch('http://127.0.0.1:8741/priority/status', { signal: AbortSignal.timeout(1_000) })
      .then((response) => (response.ok ? (response.json() as Promise<PriorityStatus>) : null))
      .catch(() => null),
  ]);
  const loaded = servers.flatMap((server) =>
    (server.status?.loaded ?? []).map((entry) => ({
      ...entry,
      modelId: localModelId(server.slug, entry.id),
    })),
  );
  const load = servers.find((server) => server.status?.load)?.status?.load ?? null;
  const unitLoaded = (unit: LocalAiUnit) => loaded.filter((entry) => entry.unit === unit);
  return {
    halogenPriority,
    guard: localAiGuard(),
    lastGpuReset,
    enabled: policy.enabled,
    units: {
      gpu: {
        allowed: policy.units.gpu,
        present: gpu.present,
        busyPercent: gpu.busyPercent,
        vramUsedBytes: gpu.vramUsedBytes,
        vramTotalBytes: gpu.vramTotalBytes,
        gttUsedBytes: gpu.gttUsedBytes,
        gttTotalBytes: gpu.gttTotalBytes,
        loaded: unitLoaded('gpu'),
      },
      npu: {
        allowed: policy.units.npu,
        present: npu,
        busyPercent: load?.npuPercent ?? null,
        loaded: unitLoaded('npu'),
      },
      cpu: {
        allowed: policy.units.cpu,
        present: true,
        busyPercent: load?.cpuPercent ?? null,
        loaded: unitLoaded('cpu'),
      },
    },
    servers: servers.map((server) => ({
      id: server.id,
      name: server.name,
      enabled: server.enabled,
      reachable: server.status?.reachable ?? false,
      version: server.status?.version ?? null,
      error: server.status?.error ?? null,
      checkedAt: server.checkedAt ? iso(server.checkedAt) : null,
      latencyMs: server.status?.latencyMs ?? null,
      load: server.status?.load ?? null,
    })),
    classes: taskClasses().map((entry) => ({
      id: entry.id,
      unit: entry.unit,
      mode: policy.classes[entry.id]?.mode ?? 'off',
      experimental: entry.experimental === true,
      wired: entry.wired,
    })),
    usage,
    // The answer time of the servers that answer.
    latencyMsP50: median(
      servers
        .filter((server) => server.status?.reachable)
        .map((server) => server.status?.latencyMs ?? NaN)
        .filter(Number.isFinite),
    ),
  };
}

async function readLastGpuReset(): Promise<{
  at: string;
  bootId: string;
  resetNumber: number;
  restartedUnits: string[];
  failedUnits: string[];
} | null> {
  try {
    const event = JSON.parse(await readFile('/var/lib/helena-ai/gpu-reset.json', 'utf8'));
    if (
      typeof event.at !== 'string' ||
      !Number.isInteger(event.resetNumber) ||
      !Array.isArray(event.restartedUnits) ||
      !Array.isArray(event.failedUnits)
    )
      return null;
    return {
      at: event.at,
      bootId: String(event.bootId ?? ''),
      resetNumber: event.resetNumber,
      restartedUnits: event.restartedUnits,
      failedUnits: event.failedUnits,
    };
  } catch {
    return null;
  }
}

// ── The settings page ──────────────────────────────────────────────────────────────────

export async function localAiSettings() {
  const [policy, servers, evals, running, options] = await Promise.all([
    readLocalAiPolicy(),
    listModelServers(),
    latestEvals(),
    evalsInProgress(),
    readModelOptions(),
  ]);
  return {
    policy,
    servers: servers.map((server) => serverView(server, options)),
    serverTypes: serverTypes().map((type) => ({
      id: type.id,
      label: type.label,
      defaultBaseUrl: type.defaultBaseUrl ?? null,
      defaultKeySource: type.defaultKeySource ?? 'file',
      capabilitiesConfigurable: type.capabilitiesConfigurable === true,
    })),
    classes: taskClasses().map((entry) => {
      const setting = policy.classes[entry.id] ?? { mode: 'off' as LocalAiMode, model: null };
      const resolved = classModel(entry, setting.model, servers);
      return {
        id: entry.id,
        label: entry.label,
        description: entry.description ?? null,
        unit: entry.unit,
        capability: entry.capability,
        priority: entry.priority,
        thinking: entry.thinking ?? 'off',
        experimental: entry.experimental === true,
        inMasterDefault: entry.inMasterDefault,
        wired: entry.wired,
        modes: [...classModes(entry)],
        hasEval: entry.evaluate !== undefined,
        evalVersion: classEvalVersion(entry),
        threshold: entry.threshold ?? 0.8,
        mode: setting.mode,
        model: setting.model,
        resolvedModel: resolved,
        blocker: classBlocker(entry, resolved, evals),
      };
    }),
    evals,
    runningEvals: running,
  };
}
