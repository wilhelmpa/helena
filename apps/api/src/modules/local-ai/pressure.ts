import { LOCAL_DEFAULT, localDefaultModel, readMaintenance } from './maintenance-state';
import { aiAgent, db, pipelineRun, readLocalAiPolicy } from '@repo/db';
import { parseLocalModelId } from '@helena/sdk';
import { eq } from 'drizzle-orm';
import { chooseModelNow, classModelNow } from './service';
import { WORK_CLASS } from './work-classes';

export const LOCAL_AI_MAX_WAIT_MS = 5 * 60_000;
type Capacity = 'available' | 'overloaded' | 'unreachable';
export type CapacityCache = Partial<Record<'normal' | 'background', Promise<Capacity>>>;
let pressureSignal: { reason: 'overloaded' | 'unreachable'; at: string } | null = null;

export function localAiPressureSignal() {
  return pressureSignal;
}

type Counts = Record<'interactive' | 'realtime' | 'normal' | 'background', number>;
export interface PressureStatus {
  healthy: boolean;
  active: Counts;
  queued: Counts;
  config: {
    maxConcurrent: number;
    reservedInteractive: number;
    maxBackground: number;
    maxNormal: number;
  };
}

export function capacityFromStatus(kind: 'normal' | 'background', status: PressureStatus): boolean {
  if (!status.healthy) return false;
  const { active, queued, config } = status;
  const total = Object.values(active).reduce((sum, count) => sum + count, 0);
  const others = total - active.interactive;
  if (kind === 'normal')
    return (
      queued.interactive + queued.realtime === 0 &&
      active.normal < config.maxNormal &&
      others < config.maxConcurrent - config.reservedInteractive
    );
  return (
    active.interactive + active.realtime + queued.interactive + queued.realtime === 0 &&
    active.background < config.maxBackground &&
    others < config.maxConcurrent - config.reservedInteractive
  );
}

// Read only, before a schedule is fired or a run is claimed. The durable schedule/run row
// stays pending; the next poll retries it under its existing id/claim fence.
export async function localAiCapacity(
  kind: 'normal' | 'background',
  request: typeof fetch = fetch,
): Promise<Capacity> {
  const policy = await readLocalAiPolicy();
  if (!policy.enabled) {
    pressureSignal = null;
    return 'available';
  }
  let status: PressureStatus;
  try {
    const response = await request('http://127.0.0.1:8741/priority/status', {
      signal: AbortSignal.timeout(1_000),
    });
    if (!response.ok) return 'unreachable';
    status = (await response.json()) as PressureStatus;
  } catch {
    return 'unreachable';
  }
  if (!status.healthy) return 'unreachable';
  const capacity = capacityFromStatus(kind, status) ? 'available' : 'overloaded';
  if (capacity === 'available') pressureSignal = null;
  return capacity;
}

export async function localAiHasCapacity(
  kind: 'normal' | 'background',
  request: typeof fetch = fetch,
): Promise<boolean> {
  return (await localAiCapacity(kind, request)) === 'available';
}

export async function localAiMayStart(
  input: {
    kind: 'normal' | 'background';
    model: string | null;
    fallbackModel?: string | null;
    workClass?: string | null;
    resumedElsewhere?: boolean;
    createdAt: Date;
  },
  request: typeof fetch = fetch,
  capacityCache?: CapacityCache,
): Promise<boolean> {
  if ((await readMaintenance())?.admissionPaused) return false;
  if (input.model === LOCAL_DEFAULT)
    input = { ...input, model: await localDefaultModel(), fallbackModel: 'gpt-6-luna' };
  const explicitLocal = parseLocalModelId(input.model) !== null;
  const model = explicitLocal
    ? (await chooseModelNow(input.model, input.fallbackModel ?? null)).model
    : input.model;
  const classModel =
    !explicitLocal && input.workClass && !input.resumedElsewhere
      ? (await classModelNow(input.workClass)).model
      : null;
  if (!parseLocalModelId(model) && !classModel) return true;

  const capacity = await (capacityCache
    ? (capacityCache[input.kind] ??= localAiCapacity(input.kind, request))
    : localAiCapacity(input.kind, request));
  if (capacity === 'available') return true;
  pressureSignal = { reason: capacity, at: new Date().toISOString() };
  const fallback = explicitLocal ? input.fallbackModel : input.model;
  if (
    capacity === 'unreachable' &&
    (input.kind === 'normal' || (fallback != null && !parseLocalModelId(fallback)))
  )
    return true;
  return Date.now() - input.createdAt.getTime() >= LOCAL_AI_MAX_WAIT_MS;
}

export async function localAiMayStartRoutine(runId: string): Promise<boolean> {
  const [run] = await db
    .select({
      kind: pipelineRun.kind,
      model: aiAgent.model,
      createdAt: pipelineRun.createdAt,
    })
    .from(pipelineRun)
    .leftJoin(aiAgent, eq(aiAgent.id, pipelineRun.agentId))
    .where(eq(pipelineRun.id, runId));
  if (!run || run.kind !== 'routine') return true;
  return localAiMayStart({
    kind: 'background',
    model: run.model,
    workClass: WORK_CLASS.routines,
    createdAt: run.createdAt,
  });
}
