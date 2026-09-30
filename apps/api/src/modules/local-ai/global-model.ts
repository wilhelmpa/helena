import {
  LOCAL_PROFILES,
  NPU_BASE,
  NPU_SLUG,
  NPU_CLASSES,
  NPU_CHAT_MODELS,
  MODEL_MEMORY,
  npuClassModel,
  type LocalProfile,
} from './npu-profile';
import { randomUUID } from 'node:crypto';
import {
  aiAgent,
  appSetting,
  db,
  forgetSetting,
  helenaModelServer,
  helenaLocalAiEval,
  listModelServers,
  readLocalAiPolicy,
  setSetting,
  type LocalAiPolicy,
} from '@repo/db';
import { and, desc, eq, gte, inArray, sql } from 'drizzle-orm';
import { localModelId, parseLocalModelId } from '@helena/sdk';
import { HttpError } from '#shared/lib';
import { hostd } from '#modules/server/hostd';
import { readModelOptions, saveModelOptions, type LocalModelOptions } from './model-options';
import { localAiWorkActive } from './guard';
import { evalById, refreshServer, startEval, taskClasses } from './service';
import {
  ADMISSION_LOCK,
  DEFAULT_KEY,
  LOCAL_DEFAULT,
  MAINTENANCE_KEY,
  localDefaultModel,
  readMaintenance,
  readUncachedSetting,
  type MaintenanceState,
  type ModelTarget,
} from './maintenance-state';

interface ModelJob {
  id: string;
  startedAt: string;
  previousDefault: string | null;
  previousPolicy: LocalAiPolicy;
  classes: string[];
  committed?: boolean;
  restored?: boolean;
  servers: { id: number; enabled: boolean }[];
  modelOptions?: Record<string, LocalModelOptions>;
  evals: Record<string, number>;
  failedClasses: string[];
  done?: boolean;
}
export async function globalModelStatus() {
  return {
    profiles: LOCAL_PROFILES,
    model: await localDefaultModel(),
    maintenance: await readMaintenance(),
    job: await readUncachedSetting<ModelJob>(MAINTENANCE_KEY),
  };
}

async function targetOf(modelId: string): Promise<ModelTarget> {
  const parsed = parseLocalModelId(modelId);
  const server = parsed && (await listModelServers()).find((row) => row.slug === parsed.slug);
  const model = server && server.models.find((row) => row.id === parsed!.model);
  if (
    !server ||
    !model ||
    (server.kind === 'lemonade' && model.downloaded !== true) ||
    !model.capabilities.includes('chat') ||
    !['halogen', 'lemonade'].includes(server.kind)
  )
    throw new HttpError(400, 'Choose a downloaded local chat model');
  const allowed =
    server.kind === 'halogen'
      ? ['http://127.0.0.1:8731/v1', 'http://127.0.0.1:8741/v1']
      : ['http://127.0.0.1:13305/api/v1', 'http://127.0.0.1:13305/v1'];
  if (!allowed.includes(server.baseUrl.replace(/\/$/, '')))
    throw new HttpError(400, 'Only the managed local server can be switched');
  return { server: server.kind as ModelTarget['server'], slug: server.slug, model: model.id };
}

function switchedClasses(): string[] {
  return taskClasses()
    .filter((entry) => entry.wired && ['chat', 'tools'].includes(entry.capability))
    .map((entry) => entry.id);
}

export async function previewGlobalModel(modelId: string, profile?: LocalProfile) {
  const target = await targetOf(modelId);
  if (profile === 'local-halogen' && target.server !== 'halogen')
    throw new HttpError(400, 'The Halogen profile requires Halogen');
  if (profile === 'local-27b-npu') {
    const definition = LOCAL_PROFILES.find((entry) => entry.id === profile)!;
    if (target.server !== 'lemonade' || target.model !== definition.model)
      throw new HttpError(400, 'The paired profile requires Qwen3.8-27B-GGUF');
    const npu = (await listModelServers()).find((row) => row.slug === NPU_SLUG);
    if (npu?.kind !== 'fastflowlm' || npu.baseUrl !== NPU_BASE)
      throw new HttpError(400, 'Register the managed NPU server first');
    target.npu = NPU_CHAT_MODELS[0];
  }
  if (profile) target.profile = profile;
  const agents = await db
    .select({ id: aiAgent.id, name: aiAgent.username })
    .from(aiAgent)
    .where(eq(aiAgent.model, LOCAL_DEFAULT));
  const classes = [...new Set([...switchedClasses(), ...(target.npu ? NPU_CLASSES : [])])];
  return {
    target,
    agents,
    classes,
    previous: await localDefaultModel(),
    npuClasses: target.npu ? NPU_CLASSES : [],
    npuSelection: target.npu ? [...NPU_CHAT_MODELS] : [],
    memoryReserveGiB: MODEL_MEMORY.reserveGiB,
    weightLockGb: 72,
    simultaneousLargeModels: false,
    requiresGroupStop: true,
  };
}

export async function beginGlobalModel(modelId: string, profile?: LocalProfile) {
  return db.transaction(async (tx) => {
    const gate = await tx.execute(
      sql`select pg_try_advisory_xact_lock(${ADMISSION_LOCK}) as acquired`,
    );
    if (!gate[0]?.acquired) throw new HttpError(409, 'Admission is busy; retry');
    const preview = await previewGlobalModel(modelId, profile);
    const status = await hostd<MaintenanceState>('ModelMaintenanceStatus');
    if (status.operation && !['done', 'rolled-back'].includes(status.operation.phase))
      throw new HttpError(409, 'A model operation is pending');
    const servers = await listModelServers();
    let previous = status.active;
    if (!previous) {
      const candidates = servers.filter(
        (row) => ['halogen', 'lemonade'].includes(row.kind) && row.enabled && row.status?.reachable,
      );
      if (candidates.length !== 1)
        throw new HttpError(409, 'Identify the currently active model server first');
      const server = candidates[0]!;
      const loaded = server.models.filter(
        (model) => model.loaded && model.capabilities.includes('chat'),
      );
      if (loaded.length !== 1)
        throw new HttpError(409, 'Identify the currently loaded chat model first');
      previous = await targetOf(localModelId(server.slug, loaded[0]!.id));
    }
    const id = randomUUID();
    const job: ModelJob = {
      id,
      startedAt: new Date().toISOString(),
      previousDefault: await localDefaultModel(),
      previousPolicy: await readLocalAiPolicy(),
      modelOptions: await readModelOptions(),
      servers: servers.map(({ id, enabled }) => ({ id, enabled })),
      classes: preview.classes,
      evals: {},
      failedClasses: [],
    };
    // Persist before the host boundary: a lost reply is resumed by its operation id.
    await setSetting(MAINTENANCE_KEY, job);
    return hostd<MaintenanceState>('SwitchModelServer', {
      id,
      action: 'begin',
      target: preview.target,
      previous,
    });
  });
}

async function commitModel(state: MaintenanceState, job: ModelJob, rollback: boolean) {
  const op = state.operation!;
  const target = rollback ? op.previous : op.target;
  const policy = structuredClone(job.previousPolicy);
  const model = localModelId(target.slug, target.model);
  if (!rollback) for (const id of job.classes) policy.classes[id] = { mode: 'off', model };
  await db.transaction(async (tx) => {
    const values = [
      [DEFAULT_KEY, rollback ? job.previousDefault : model],
      ['localAi.policy', policy],
      [MAINTENANCE_KEY, { ...job, ...(rollback ? { restored: true } : { committed: true }) }],
    ] as const;
    for (const [key, value] of values)
      await tx
        .insert(appSetting)
        .values({ key, value })
        .onConflictDoUpdate({
          target: appSetting.key,
          set: { value: sql`excluded.value`, updatedAt: new Date() },
        });
    for (const server of await listModelServers()) {
      if (!['halogen', 'lemonade'].includes(server.kind) && server.slug !== NPU_SLUG) continue;
      await tx
        .update(helenaModelServer)
        .set({
          enabled: rollback
            ? (job.servers.find((row) => row.id === server.id)?.enabled ?? false)
            : server.slug === target.slug || (server.slug === NPU_SLUG && !!target.npu),
        })
        .where(eq(helenaModelServer.id, server.id));
    }
  });
  await forgetSetting('localAi.policy');
}

async function evaluateClasses(state: MaintenanceState, job: ModelJob): Promise<boolean> {
  const target = state.operation!.target;
  const servers = await listModelServers();
  for (const classId of job.classes) {
    const npuModel = npuClassModel(target, classId);
    const slug = npuModel ? NPU_SLUG : target.slug;
    const modelName = npuModel ?? target.model;
    const server = servers.find((row) => row.slug === slug)!;
    if (!job.evals[classId]) {
      // The eval row itself closes the crash window between starting it and storing its id.
      const [existing] = await db
        .select()
        .from(helenaLocalAiEval)
        .where(
          and(
            eq(helenaLocalAiEval.serverId, server.id),
            eq(helenaLocalAiEval.model, modelName),
            eq(helenaLocalAiEval.classId, classId),
            gte(helenaLocalAiEval.ranAt, new Date(job.startedAt)),
          ),
        )
        .orderBy(desc(helenaLocalAiEval.id))
        .limit(1);
      try {
        job.evals[classId] =
          existing?.id ??
          (
            await startEval({
              classId,
              modelId: localModelId(slug, modelName),
              userId: null,
            })
          ).id;
      } catch {
        if (!job.failedClasses.includes(classId)) job.failedClasses.push(classId);
      }
      await setSetting(MAINTENANCE_KEY, job);
    }
    const result = job.evals[classId] ? await evalById(job.evals[classId]!) : null;
    if (result?.status === 'running' && Date.now() - Date.parse(job.startedAt) < 3_600_000)
      return false;
    if (!result?.passed && !job.failedClasses.includes(classId)) job.failedClasses.push(classId);
    const policy = await readLocalAiPolicy();
    policy.classes[classId] = {
      mode: job.failedClasses.includes(classId)
        ? 'off'
        : (job.previousPolicy.classes[classId]?.mode ?? 'off'),
      model: job.failedClasses.includes(classId)
        ? localModelId(target.slug, target.model)
        : localModelId(slug, modelName),
    };
    await setSetting('localAi.policy', policy);
    await setSetting(MAINTENANCE_KEY, job);
  }
  job.done = true;
  await setSetting(MAINTENANCE_KEY, job);
  return true;
}

export async function resumeGlobalModel(rollback = false): Promise<MaintenanceState | null> {
  // One coordinator across API processes; admission has a separate, short transaction.
  return db.transaction(async (tx) => {
    const result = await tx.execute(
      sql`select pg_try_advisory_xact_lock(${ADMISSION_LOCK + 1}) as acquired`,
    );
    if (!result[0]?.acquired) return readMaintenance();
    let state = await readMaintenance();
    if (
      !state?.operation ||
      state.operation.phase === 'rolled-back' ||
      (state.operation.phase === 'done' && !rollback)
    )
      return state;
    let job = await readUncachedSetting<ModelJob>(MAINTENANCE_KEY);
    if (!job || job.id !== state.operation.id) {
      // GPU-reset recovery uses the same barriers and keeps the current configuration.
      const policy = await readLocalAiPolicy();
      job = {
        id: state.operation.id,
        startedAt: new Date().toISOString(),
        previousDefault: await localDefaultModel(),
        previousPolicy: policy,
        classes: switchedClasses(),
        servers: (await listModelServers()).map(({ id, enabled }) => ({ id, enabled })),
        evals: {},
        failedClasses: [],
      };
      await setSetting(MAINTENANCE_KEY, job);
    }
    if (rollback)
      state = await hostd<MaintenanceState>('SwitchModelServer', {
        id: job.id,
        action: 'rollback',
      });
    const op = state.operation!;
    const phase = op.phase;
    if (phase === 'drain' || phase === 'rollback-pause') {
      const drained = await db.transaction(async (gate) => {
        const lock = await gate.execute(
          sql`select pg_try_advisory_xact_lock(${ADMISSION_LOCK}) as acquired`,
        );
        if (!lock[0]?.acquired) return false;
        return !(await localAiWorkActive());
      });
      if (!drained) return state;
    }
    if (phase === 'rollback-start' && job.modelOptions?.[op.previous.model])
      await saveModelOptions(op.previous.model, job.modelOptions[op.previous.model]!);
    if (phase === 'commit' || phase === 'rollback-commit') {
      const reverse = phase === 'rollback-commit';
      if (!(reverse ? job.restored : job.committed)) await commitModel(state, job, reverse);
      await forgetSetting('localAi.policy');
      const target = reverse ? op.previous : op.target;
      const server = (await listModelServers()).find((row) => row.slug === target.slug);
      if (server) await refreshServer(server.id);
      if (target.npu) {
        const npu = (await listModelServers()).find((row) => row.slug === NPU_SLUG);
        if (npu) await refreshServer(npu.id);
      }
    }
    if (phase === 'eval' && !(await evaluateClasses(state, job))) return state;
    return hostd<MaintenanceState>(
      'SwitchModelServer',
      { id: op.id, expected: phase, ack: phase },
      900_000,
    );
  });
}

export async function localDefaultClassFallback(classId: string | null): Promise<boolean> {
  if (!classId) return false;
  const job = await readUncachedSetting<ModelJob>(MAINTENANCE_KEY);
  return (
    !!job?.committed &&
    !job.restored &&
    job.classes.includes(classId) &&
    (!job.done || job.failedClasses.includes(classId))
  );
}

export async function bulkLocalDefault(ids: number[], apply: boolean) {
  const agents = await db
    .select({ id: aiAgent.id, name: aiAgent.username, model: aiAgent.model })
    .from(aiAgent)
    .where(inArray(aiAgent.id, ids));
  if (agents.length !== new Set(ids).size) throw new HttpError(404, 'An agent no longer exists');
  if (apply) {
    if (!(await localDefaultModel())) throw new HttpError(409, 'Set the local default first');
    if ((await readMaintenance())?.admissionPaused)
      throw new HttpError(409, 'Model maintenance is pending');
    await db
      .update(aiAgent)
      .set({
        model: LOCAL_DEFAULT,
        templateOverrides: sql`CASE WHEN ${aiAgent.sourceTemplateId} IS NOT NULL AND NOT (${aiAgent.templateOverrides} @> '["model"]'::jsonb) THEN ${aiAgent.templateOverrides} || '["model"]'::jsonb ELSE ${aiAgent.templateOverrides} END`,
        runtimePolicy: sql`jsonb_set(coalesce(${aiAgent.runtimePolicy}, '{}'::jsonb), '{runtime}', '"hermes"'::jsonb)`,
      })
      .where(inArray(aiAgent.id, ids));
  }
  return { applied: apply, agents, model: LOCAL_DEFAULT };
}
