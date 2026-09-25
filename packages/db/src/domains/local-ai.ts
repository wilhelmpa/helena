import { readFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { and, asc, desc, eq } from 'drizzle-orm';
import {
  LOCAL_AI_MODES,
  LOCAL_AI_UNITS,
  localModelId,
  parseLocalModelId,
  type LocalAiMode,
  type LocalAiUnit,
  type LocalModel,
  type LocalModelCapability,
} from '@helena/sdk';
import { db } from '../client';
import { readSecret } from '../secrets';
import { getSetting, setSetting } from '../settings';
import { helenaLocalAiEval, helenaModelServer } from '../schema/local-ai';

// The local AI policy and how a kind of work finds its local model
// (docs/helena-decisions/local-ai-platform.md §6). The API (settings, evals, the runners'
// snapshot, the pickers) and the worker (the knowledge indexer's embeddings) both read it,
// so it lives here. The API owns the writes.
//
// Local AI never replaces a configured model. With the master switch off nothing local runs
// automatically and every consumer behaves as before; with it on, a task class in `prefer`
// tries its local model first and the configured model answers whenever local is off, down,
// too slow or wrong.

export const LOCAL_AI_POLICY_KEY = 'localAi.policy';
// The Administrator's key of a server, when it is entered in Helena rather than read from
// the installer's key file.
export const localAiServerSecretKey = (slug: string) => `localAi.server.${slug}`;
// Key files are read only below this directory (native/local-ai/install.sh writes
// /etc/helena/local-ai.key, root:volition-plan 0640), so no setting can point Helena at
// another file and send what it holds to a server.
export const LOCAL_AI_KEY_DIR = '/etc/helena';
// How old a server's last status may be before a route treats the server as unknown and
// checks it again.
export const STATUS_FRESH_MS = 2 * 60_000;

export type LocalAiPreset = 'sparsam' | 'ausgewogen' | 'qualitaet' | 'eigene';

export interface LocalAiClassSetting {
  mode: LocalAiMode;
  // The local model (`helena-<slug>/<id>`) the class uses; null picks the server's first
  // model with the capability the class needs.
  model: string | null;
}

export interface LocalAiPolicy {
  // The master switch. Off: nothing local runs on its own, everything as before.
  enabled: boolean;
  // Which units local work may use.
  units: Record<LocalAiUnit, boolean>;
  classes: Record<string, LocalAiClassSetting>;
  preset: LocalAiPreset;
  // The owner has seen the classes the master switch turns on the first time.
  initialized: boolean;
}

export function defaultLocalAiPolicy(): LocalAiPolicy {
  return {
    enabled: false,
    units: { gpu: true, npu: true, cpu: true },
    classes: {},
    preset: 'ausgewogen',
    initialized: false,
  };
}

const PRESETS: readonly LocalAiPreset[] = ['sparsam', 'ausgewogen', 'qualitaet', 'eigene'];
const CLASS_ID = /^[a-z][a-z0-9-]{0,47}$/;

// A stored policy as Helena uses it: unknown fields dropped, missing ones defaulted.
export function normalizeLocalAiPolicy(value: unknown): LocalAiPolicy {
  const base = defaultLocalAiPolicy();
  if (!value || typeof value !== 'object') return base;
  const raw = value as Record<string, unknown>;
  const units = { ...base.units };
  if (raw.units && typeof raw.units === 'object') {
    for (const unit of LOCAL_AI_UNITS) {
      const flag = (raw.units as Record<string, unknown>)[unit];
      if (typeof flag === 'boolean') units[unit] = flag;
    }
  }
  const classes: Record<string, LocalAiClassSetting> = {};
  if (raw.classes && typeof raw.classes === 'object') {
    for (const [id, entry] of Object.entries(raw.classes as Record<string, unknown>)) {
      if (!CLASS_ID.test(id) || !entry || typeof entry !== 'object') continue;
      const item = entry as Record<string, unknown>;
      const mode = (LOCAL_AI_MODES as readonly unknown[]).includes(item.mode)
        ? (item.mode as LocalAiMode)
        : 'off';
      const model =
        typeof item.model === 'string' && parseLocalModelId(item.model) ? item.model : null;
      classes[id] = { mode, model };
    }
  }
  return {
    enabled: raw.enabled === true,
    units,
    classes,
    preset: (PRESETS as readonly unknown[]).includes(raw.preset)
      ? (raw.preset as LocalAiPreset)
      : base.preset,
    initialized: raw.initialized === true,
  };
}

export async function readLocalAiPolicy(): Promise<LocalAiPolicy> {
  return normalizeLocalAiPolicy(await getSetting(LOCAL_AI_POLICY_KEY));
}

export async function writeLocalAiPolicy(policy: LocalAiPolicy): Promise<LocalAiPolicy> {
  const normalized = normalizeLocalAiPolicy(policy);
  await setSetting(LOCAL_AI_POLICY_KEY, normalized);
  return normalized;
}

export type ModelServerRow = typeof helenaModelServer.$inferSelect;

export async function listModelServers(): Promise<ModelServerRow[]> {
  return db.select().from(helenaModelServer).orderBy(asc(helenaModelServer.id));
}

export async function modelServerBySlug(slug: string): Promise<ModelServerRow | null> {
  const [row] = await db.select().from(helenaModelServer).where(eq(helenaModelServer.slug, slug));
  return row ?? null;
}

// Whether a path is a key file Helena may read: below LOCAL_AI_KEY_DIR, no `..`.
export function allowedKeyFile(path: string | null | undefined): string | null {
  if (!path) return null;
  const full = resolve(path);
  return full.startsWith(`${LOCAL_AI_KEY_DIR}/`) && full === path ? full : null;
}

// The server's key, or null for a server without one. Never logged, never returned over
// HTTP; it goes into the Authorization header of Helena's own requests and, for a run, into
// the environment of the agent that uses the server (the runner asks for it).
export async function readModelServerKey(
  server: Pick<ModelServerRow, 'slug' | 'keySource' | 'keyFile'>,
): Promise<string | null> {
  if (server.keySource === 'none') return null;
  if (server.keySource === 'stored') {
    const stored = await readSecret<{ key?: string }>(localAiServerSecretKey(server.slug));
    return stored?.key?.trim() || null;
  }
  const file = allowedKeyFile(server.keyFile);
  if (!file) return null;
  try {
    const info = await stat(file);
    if (!info.isFile() || info.size > 4096) return null;
    return (await readFile(file, 'utf8')).trim() || null;
  } catch {
    return null;
  }
}

// ── Routes ─────────────────────────────────────────────────────────────────────────────

export interface LocalRoute {
  server: ModelServerRow;
  // The model as the server names it, and as Helena names it (`helena-<slug>/<id>`).
  model: string;
  modelId: string;
  unit: LocalAiUnit | null;
  mode: LocalAiMode;
}

export type RouteRefusal =
  | 'master-off'
  | 'class-off'
  | 'unit-off'
  | 'no-server'
  | 'server-down'
  | 'no-model'
  | 'eval-failed';

export type RouteResult = { route: LocalRoute } | { refusal: RouteRefusal; mode: LocalAiMode };

function serverUp(server: ModelServerRow, now: number): boolean {
  const status = server.status;
  if (!status || !server.checkedAt) return false;
  return status.reachable && now - server.checkedAt.getTime() <= STATUS_FRESH_MS * 5;
}

// The first model of the server that can do what the class needs: loaded ones first.
export function pickModel(
  models: LocalModel[],
  capability: LocalModelCapability,
  wanted: string | null,
): LocalModel | null {
  const able = models.filter((model) => model.capabilities.includes(capability));
  if (wanted) return able.find((model) => model.id === wanted) ?? null;
  return (
    able.find((model) => model.loaded) ?? able.find((model) => model.downloaded !== false) ?? null
  );
}

// Where a kind of work runs locally now, or why it does not. A refusal in `prefer` mode means
// "use the configured model, as today"; in `only` mode it means "wait".
export function routeFor(
  input: {
    classId: string;
    unit: LocalAiUnit;
    capability: LocalModelCapability;
    policy: LocalAiPolicy;
    servers: ModelServerRow[];
    // Embeddings keep their model while the server is down (the vectors of another model
    // are a different space); everything else falls back at once.
    requireUp?: boolean;
    // The models (`helena-<slug>/<id>`) whose newest eval for this class failed: the gate
    // holds after the class was switched on too (a model updated, then evaluated again).
    failed?: ReadonlySet<string>;
  },
  now = Date.now(),
): RouteResult {
  const { policy } = input;
  const setting = policy.classes[input.classId] ?? { mode: 'off' as LocalAiMode, model: null };
  if (!policy.enabled) return { refusal: 'master-off', mode: setting.mode };
  if (setting.mode === 'off') return { refusal: 'class-off', mode: setting.mode };
  const wanted = parseLocalModelId(setting.model);
  const candidates = input.servers.filter(
    (server) => server.enabled && (!wanted || server.slug === wanted.slug),
  );
  if (candidates.length === 0) return { refusal: 'no-server', mode: setting.mode };
  let refusal: RouteRefusal = 'no-model';
  for (const server of candidates) {
    const model = pickModel(server.models, input.capability, wanted?.model ?? null);
    if (!model) continue;
    const unit = model.unit ?? input.unit;
    if (!policy.units[unit]) {
      refusal = 'unit-off';
      continue;
    }
    if (input.failed?.has(localModelId(server.slug, model.id))) {
      refusal = 'eval-failed';
      continue;
    }
    if (input.requireUp !== false && !serverUp(server, now)) {
      refusal = 'server-down';
      continue;
    }
    return {
      route: {
        server,
        model: model.id,
        modelId: localModelId(server.slug, model.id),
        unit: model.unit,
        mode: setting.mode,
      },
    };
  }
  return { refusal, mode: setting.mode };
}

// The models whose newest eval for a class failed, as Helena names them. A class in `prefer`
// or `only` does not route to them: its configured model answers until a new eval passes.
// With `evalVersion`, a newest eval of an older version (the class's eval changed since)
// counts as failed too.
export async function failedEvalModels(classId: string, evalVersion = 1): Promise<Set<string>> {
  const rows = await db
    .select({
      model: helenaLocalAiEval.model,
      slug: helenaModelServer.slug,
      passed: helenaLocalAiEval.passed,
      evalVersion: helenaLocalAiEval.evalVersion,
    })
    .from(helenaLocalAiEval)
    .innerJoin(helenaModelServer, eq(helenaModelServer.id, helenaLocalAiEval.serverId))
    // An eval still running gates nothing yet.
    .where(and(eq(helenaLocalAiEval.classId, classId), eq(helenaLocalAiEval.status, 'done')))
    .orderBy(desc(helenaLocalAiEval.ranAt))
    .limit(200);
  const seen = new Set<string>();
  const failed = new Set<string>();
  for (const row of rows) {
    const id = localModelId(row.slug, row.model);
    if (seen.has(id)) continue;
    seen.add(id);
    if (!row.passed || row.evalVersion < evalVersion) failed.add(id);
  }
  return failed;
}

// The same, read from the database.
export async function resolveLocalRoute(input: {
  classId: string;
  unit: LocalAiUnit;
  capability: LocalModelCapability;
  requireUp?: boolean;
  // The class's eval version (@helena/sdk classEvalVersion): an older eval gates like a
  // failed one.
  evalVersion?: number;
}): Promise<RouteResult> {
  const { evalVersion, ...route } = input;
  const [policy, servers, failed] = await Promise.all([
    readLocalAiPolicy(),
    listModelServers(),
    failedEvalModels(input.classId, evalVersion),
  ]);
  return routeFor({ ...route, policy, servers, failed });
}
