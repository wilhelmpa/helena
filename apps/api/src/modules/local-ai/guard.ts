import { readMaintenance } from './maintenance-state';
import {
  agentChatMessage,
  agentRun,
  db,
  helenaBrowserTaskRun,
  helenaLocalAiEval,
  readModelServerKey,
  resolveLocalRoute,
} from '@repo/db';
import { and, eq, isNotNull, isNull } from 'drizzle-orm';
import { HttpError } from '#shared/lib';
import { HostdError, hostd } from '#modules/server/hostd';
import type { HostSystemStatus } from '#modules/server/types';
import { joinUrl, openAiEvalContext } from './eval-context';
import {
  evictionDetected,
  modelReadyAndIdle,
  probeDue,
  probeOutcome,
  type LocalAiGuard,
} from './guard-state';
import { LEMONADE_DEFAULT_BASE_URL } from './server-types';

const PROBE_LIMIT_MS = 5_000;
const LOCAL_LEMONADE_URLS = new Set([LEMONADE_DEFAULT_BASE_URL, 'http://127.0.0.1:13305/v1']);

export type { LocalAiGuard } from './guard-state';

let guard: LocalAiGuard = {
  checkedAt: null,
  probeAt: null,
  probeMs: null,
  probeFailures: 0,
  problem: null,
  availableBytes: null,
  consumers: [],
};
let lastProbe = 0;
let running = false;
let restarting = false;

export function localAiGuard(): LocalAiGuard {
  return guard;
}

export async function localAiWorkActive(): Promise<boolean> {
  const [runs, chats, evals, browserTasks] = await Promise.all([
    db
      .select({ id: agentRun.id })
      .from(agentRun)
      .where(
        and(
          eq(agentRun.status, 'pending'),
          isNotNull(agentRun.claimedAt),
          isNull(agentRun.finishedAt),
        ),
      )
      .limit(1),
    db
      .select({ id: agentChatMessage.id })
      .from(agentChatMessage)
      .where(eq(agentChatMessage.status, 'streaming'))
      .limit(1),
    db
      .select({ id: helenaLocalAiEval.id })
      .from(helenaLocalAiEval)
      .where(eq(helenaLocalAiEval.status, 'running'))
      .limit(1),
    db
      .select({ id: helenaBrowserTaskRun.id })
      .from(helenaBrowserTaskRun)
      .where(eq(helenaBrowserTaskRun.status, 'running'))
      .limit(1),
  ]);
  return runs.length > 0 || chats.length > 0 || evals.length > 0 || browserTasks.length > 0;
}

export async function checkLocalAiGuard(now = Date.now()): Promise<void> {
  const operation = (await readMaintenance())?.operation;
  if (running || restarting || (operation && !['done', 'rolled-back'].includes(operation.phase)))
    return;
  running = true;
  try {
    let host: HostSystemStatus;
    try {
      host = await hostd<HostSystemStatus>('SystemStatus', {}, 10_000);
    } catch (error) {
      if (error instanceof HostdError && error.code === 'Unavailable') return;
      throw error;
    }
    const eviction =
      evictionDetected(host.gpuProcesses) ||
      (host.gpuProcesses == null && guard.problem === 'eviction');
    guard = {
      ...guard,
      checkedAt: new Date(now).toISOString(),
      availableBytes: host.memory.availableBytes,
      consumers: host.memoryConsumers ?? [],
      problem: eviction ? 'eviction' : guard.probeFailures >= 3 ? 'probe' : null,
    };
    if (host.localAiPreloadRunning || !probeDue(lastProbe, now) || (await localAiWorkActive()))
      return;
    const route = await resolveLocalRoute({
      classId: 'decisions',
      unit: 'gpu',
      capability: 'chat',
    });
    if ('refusal' in route) return;
    const { server, model } = route.route;
    if (
      server.kind !== 'lemonade' ||
      !LOCAL_LEMONADE_URLS.has(server.baseUrl) ||
      !(server.status?.loaded ?? []).some((item) => item.id === model)
    )
      return;
    if (await localAiWorkActive()) return;
    const key = await readModelServerKey(server);
    if (server.keySource !== 'none' && !key) return;
    let ready = false;
    try {
      const response = await fetch(joinUrl(server.baseUrl, '/health'), {
        headers: key ? { authorization: `Bearer ${key}` } : {},
        redirect: 'error',
        signal: AbortSignal.timeout(2_000),
      });
      ready = response.ok && modelReadyAndIdle(await response.json(), model);
    } catch {
      return;
    }
    if (!ready || (await localAiWorkActive())) return;
    lastProbe = now;
    const started = Date.now();
    try {
      const result = await openAiEvalContext({
        baseUrl: server.baseUrl,
        key,
        model,
        timeoutMs: PROBE_LIMIT_MS,
      }).chat({ prompt: 'Reply with OK.', maxTokens: 2, thinking: 'off' });
      if (!result.text.trim()) throw new Error('empty answer');
      const duration = Date.now() - started;
      guard = probeOutcome(guard, now, duration, duration <= PROBE_LIMIT_MS, eviction);
    } catch (error) {
      const duration = Date.now() - started;
      const timedOut =
        duration >= PROBE_LIMIT_MS || (error instanceof Error && error.name === 'TimeoutError');
      guard = probeOutcome(guard, now, duration, !timedOut, eviction);
    }
  } finally {
    running = false;
  }
}

export async function restartLocalAi(actor: string): Promise<{ restarted: boolean }> {
  if (running || restarting || (await localAiWorkActive()))
    throw new HttpError(409, 'Local AI is in use');
  restarting = true;
  try {
    if (await localAiWorkActive()) throw new HttpError(409, 'Local AI is in use');
    const result = await hostd<{ restarted: boolean }>('RestartLocalAi', { actor }, 260_000);
    guard = { ...guard, probeFailures: 0, problem: null, probeMs: null };
    lastProbe = Date.now();
    return result;
  } finally {
    restarting = false;
  }
}
