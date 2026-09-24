import { access, readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { agentUsage, db, helenaLocalAiEval, helenaModelServer, writeSecret } from '@repo/db';
import {
  LOCAL_AI_KEY_DIR,
  allowedKeyFile,
  listModelServers,
  localAiServerSecretKey,
  pickModel,
  readLocalAiPolicy,
  readModelServerKey,
  routeFor,
  writeLocalAiPolicy,
  type LocalAiPolicy,
  type ModelServerRow,
} from '@repo/db';
import { and, desc, eq, gte, sql } from 'drizzle-orm';
import {
  LOCAL_AI_UNITS,
  isLocalProvider,
  isModelServerSlug,
  localModelId,
  localProviderName,
  median,
  parseLocalModelId,
  type LocalAiMode,
  type LocalAiTaskClass,
  type LocalAiUnit,
  type LocalModel,
  type ModelServerContext,
  type ModelServerStatus,
  type ModelServerType,
  type RuntimeLocalAi,
} from '@helena/sdk';
import { host } from '#shared/helena';
import { HttpError, iso } from '#shared/lib';
import { joinUrl, openAiEvalContext } from './eval-context';
import { LEMONADE, LEMONADE_DEFAULT_BASE_URL } from './server-types';

// Local AI in the API (docs/helena-decisions/local-ai-platform.md): the model servers, their
// status and models, the policy (master switch, units, task classes), the evals that gate a
// class, what the runners and the pickers get, and the status the "Lokale KI" card shows.

export const DEFAULT_SERVER_SLUG = 'local';
export const DEFAULT_KEY_FILE = `${LOCAL_AI_KEY_DIR}/api-key`;
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

export function serverContext(
  server: Pick<ModelServerRow, 'baseUrl'>,
  key: string | null,
  timeoutMs: number,
): ModelServerContext {
  return {
    baseUrl: server.baseUrl,
    hasKey: key !== null,
    fetch: (path, init) =>
      fetch(joinUrl(server.baseUrl, path), {
        method: init?.method ?? 'GET',
        headers: {
          accept: 'application/json',
          ...(init?.body !== undefined ? { 'content-type': 'application/json' } : {}),
          ...(key ? { authorization: `Bearer ${key}` } : {}),
        },
        ...(init?.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
        redirect: 'error',
        signal: AbortSignal.timeout(timeoutMs),
      }),
  };
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
}

function serverView(row: ModelServerRow) {
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
    provider: localProviderName(row.slug),
    models: row.models.map((model) => ({ ...model, modelId: localModelId(row.slug, model.id) })),
    status: row.status,
    checkedAt: row.checkedAt ? iso(row.checkedAt) : null,
  };
}

export type ServerView = ReturnType<typeof serverView>;

export async function listServers(): Promise<ServerView[]> {
  return (await listModelServers()).map(serverView);
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
  const keySource = input.keySource ?? 'file';
  const keyFile = keySource === 'file' ? (input.keyFile ?? DEFAULT_KEY_FILE) : null;
  checkKeyFile(keySource, keyFile);
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

export async function runEval(input: { classId: string; modelId: string; userId: string }) {
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
  const key = await readModelServerKey(server);
  const threshold = entry.threshold ?? 0.8;
  let values: typeof helenaLocalAiEval.$inferInsert;
  try {
    const result = await entry.evaluate(
      openAiEvalContext({ baseUrl: server.baseUrl, key, model: model.id }),
    );
    values = {
      classId: entry.id,
      serverId: server.id,
      model: model.id,
      score: result.score,
      threshold,
      passed: result.score >= threshold,
      cases: result.cases.length,
      details: result.cases
        .filter((item) => !item.passed)
        .slice(0, 20)
        .map((item) => ({ id: item.id, detail: item.detail?.slice(0, 200) ?? null })),
      latencyMsP50: result.latencyMsP50 === null ? null : Math.round(result.latencyMsP50),
      tokensPerSecond: result.tokensPerSecond,
      ranBy: input.userId,
    };
  } catch (error) {
    values = {
      classId: entry.id,
      serverId: server.id,
      model: model.id,
      score: 0,
      threshold,
      passed: false,
      cases: 0,
      error: (error instanceof Error ? error.message : String(error)).slice(0, 300),
      ranBy: input.userId,
    };
  }
  const [row] = await db.insert(helenaLocalAiEval).values(values).returning();
  return evalView(row!, server.slug);
}

function evalView(row: typeof helenaLocalAiEval.$inferSelect, slug: string) {
  return {
    id: row.id,
    classId: row.classId,
    modelId: localModelId(slug, row.model),
    score: row.score,
    threshold: row.threshold,
    passed: row.passed,
    cases: row.cases,
    details: (row.details as { id: string; detail: string | null }[]) ?? [],
    latencyMsP50: row.latencyMsP50,
    tokensPerSecond: row.tokensPerSecond,
    error: row.error,
    ranAt: iso(row.ranAt),
  };
}

export type EvalView = ReturnType<typeof evalView>;

// The newest eval of each class and model.
export async function latestEvals(): Promise<EvalView[]> {
  const rows = await db
    .select({ row: helenaLocalAiEval, slug: helenaModelServer.slug })
    .from(helenaLocalAiEval)
    .innerJoin(helenaModelServer, eq(helenaModelServer.id, helenaLocalAiEval.serverId))
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
  if (!latest) return 'eval-missing';
  return latest.passed ? null : 'eval-failed';
}

export interface PolicyPatch {
  enabled?: boolean;
  units?: Partial<Record<LocalAiUnit, boolean>>;
  classes?: Record<string, { mode?: LocalAiMode; model?: string | null }>;
  preset?: LocalAiPolicy['preset'];
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

function chatModels(server: ModelServerRow): LocalModel[] {
  return server.models.filter(
    (model) => model.capabilities.includes('chat') && model.downloaded !== false,
  );
}

// What an agent's runner writes into its Hermes profile: the local servers (only while the
// master switch is on) and the helper calls Hermes sends there first. Null while local AI is
// off, so nothing of it is left in any profile.
export function runtimeLocalAi(
  policy: LocalAiPolicy,
  servers: ModelServerRow[],
): RuntimeLocalAi | null {
  if (!policy.enabled) return null;
  const enabled = servers.filter((server) => server.enabled && chatModels(server).length > 0);
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
    });
    if ('route' in result) {
      const provider = localProviderName(result.route.server.slug);
      helpers.push(
        { task: 'compression', provider, model: result.route.model },
        { task: 'title_generation', provider, model: result.route.model },
      );
      const vision = pickModel(result.route.server.models, 'vision', null);
      if (vision) helpers.push({ task: 'vision', provider, model: vision.id });
    }
  }
  return {
    servers: enabled.map((server) => ({
      provider: localProviderName(server.slug),
      baseUrl: server.baseUrl,
      keyEnv: server.keySource === 'none' ? null : keyVariable(server.slug),
      contextLength: Math.max(server.contextLength, HERMES_MIN_CONTEXT),
      models: chatModels(server).map((model) => ({
        id: model.id,
        contextLength: model.contextLength,
        vision: model.capabilities.includes('vision'),
      })),
    })),
    helpers,
  };
}

export async function runtimeLocalAiNow(): Promise<RuntimeLocalAi | null> {
  const [policy, servers] = await Promise.all([readLocalAiPolicy(), listModelServers()]);
  return runtimeLocalAi(policy, servers);
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
      ? chatModels(server).map((model) => {
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
// server is enabled; otherwise the agent's default runs, exactly as without local AI.
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
  return server.models.some((item) => item.id === parsed.model) ? model : null;
}

export async function effectiveModelNow(model: string | null): Promise<string | null> {
  if (!parseLocalModelId(model)) return model;
  const [policy, servers] = await Promise.all([readLocalAiPolicy(), listModelServers()]);
  return effectiveModel(model, policy, servers);
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
  const [policy, servers, gpu, npu, usage] = await Promise.all([
    readLocalAiPolicy(),
    listModelServers(),
    readGpu(),
    npuPresent(),
    usageShare(),
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
    enabled: policy.enabled,
    units: {
      gpu: {
        allowed: policy.units.gpu,
        present: gpu.present,
        busyPercent: gpu.busyPercent ?? load?.gpuPercent ?? null,
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
    })),
    classes: taskClasses().map((entry) => ({
      id: entry.id,
      unit: entry.unit,
      mode: policy.classes[entry.id]?.mode ?? 'off',
      experimental: entry.experimental === true,
      wired: entry.wired,
    })),
    usage,
    latencyMsP50: median(
      servers.map((server) => server.status?.latencyMs ?? NaN).filter(Number.isFinite),
    ),
  };
}

// ── The settings page ──────────────────────────────────────────────────────────────────

export async function localAiSettings() {
  const [policy, servers, evals] = await Promise.all([
    readLocalAiPolicy(),
    listModelServers(),
    latestEvals(),
  ]);
  return {
    policy,
    servers: servers.map(serverView),
    serverTypes: serverTypes().map((type) => ({
      id: type.id,
      label: type.label,
      defaultBaseUrl: type.defaultBaseUrl ?? null,
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
        experimental: entry.experimental === true,
        inMasterDefault: entry.inMasterDefault,
        wired: entry.wired,
        hasEval: entry.evaluate !== undefined,
        threshold: entry.threshold ?? 0.8,
        mode: setting.mode,
        model: setting.model,
        resolvedModel: resolved,
        blocker: classBlocker(entry, resolved, evals),
      };
    }),
    evals,
  };
}
