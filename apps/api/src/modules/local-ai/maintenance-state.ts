import { HttpError } from '#shared/lib';
import { readFile } from 'node:fs/promises';
import { appSetting, db } from '@repo/db';
import { eq, sql } from 'drizzle-orm';

export const LOCAL_DEFAULT = 'volition-local-default';
export const DEFAULT_KEY = 'volition.localDefault';
export const MAINTENANCE_KEY = 'volition.modelMaintenance';
export const ADMISSION_LOCK = 114_290_926;
export interface ModelTarget {
  server: 'halogen' | 'lemonade';
  slug: string;
  model: string;
  profile?: 'local-halogen' | 'local-27b-npu';
  npu?: 'qwen3.5:4b' | 'qwen3.5:2b';
}
export interface MaintenanceState {
  version: 1;
  active: ModelTarget | null;
  admissionPaused: boolean;
  proxyPaused: boolean;
  startsBlocked: boolean;
  operation: null | {
    id: string;
    target: ModelTarget;
    previous: ModelTarget;
    phase: string;
    error: string | null;
    journal: { at: number; phase: string; event: string }[];
  };
}
export async function readMaintenance(): Promise<MaintenanceState | null> {
  try {
    const value = JSON.parse(
      await readFile(
        process.env.VOLITION_MODEL_MAINTENANCE_STATE ??
          '/var/lib/volition/model-maintenance/state.json',
        'utf8',
      ),
    ) as MaintenanceState;
    if (value.version !== 1 || typeof value.admissionPaused !== 'boolean')
      throw new Error('Invalid maintenance state');
    return value;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}
export async function readUncachedSetting<T>(key: string): Promise<T | null> {
  const [row] = await db
    .select({ value: appSetting.value })
    .from(appSetting)
    .where(eq(appSetting.key, key));
  return row ? (row.value as T) : null;
}
export async function localDefaultModel(): Promise<string | null> {
  return readUncachedSetting<string>(DEFAULT_KEY);
}
export async function withModelAdmission<T>(claim: () => Promise<T>): Promise<T | null> {
  return db.transaction(async (tx) => {
    const lock = await tx.execute(
      sql`select pg_try_advisory_xact_lock(${ADMISSION_LOCK}) as acquired`,
    );
    if (!lock[0]?.acquired) return null;
    if ((await readMaintenance())?.admissionPaused) return null;
    return claim();
  });
}

export async function assertModelIdle(): Promise<void> {
  const operation = (await readMaintenance())?.operation;
  if (operation && !['done', 'rolled-back'].includes(operation.phase))
    throw new HttpError(409, 'Model maintenance is pending');
}
