import { randomUUID } from 'node:crypto';
import { appSetting, db, forgetSetting, getSetting } from '@repo/db';
import { eq } from 'drizzle-orm';
import { HttpError } from '#shared/lib';
import { loadConnection } from '#modules/browser-task/connection';
import { BROWSER_CLASS, decisionClass, decisionClasses } from './classes';
import { evalAllows, latestEval } from './evals-runner';
import { classSetting, effectiveThreshold, usableDecisionConnection } from './service';
import { jevDecisionPolicy } from './jev-policy';
export { stageContext, stageQuestions, FIRST_STAGE_READINESS } from './stage-questions';

// An additive optimization, never an execution permission or agent/model assignment.
// Only this feature constructs the team-scoped key; callers cannot supply a setting key.
const key = (teamId: number) => `decisions.jev-first-stage.team.${teamId}`;
export const FIRST_STAGE_DEFAULT_TIMEOUT = 1000;
export const FIRST_STAGE_MAX_TIMEOUT = 3000;
export { FIRST_STAGE_POLL_MS } from './stage-request';

export interface FirstStagePolicy {
  enabled: boolean;
  credentialId: number | null;
  timeoutMs: number;
  useCases: Record<string, { enabled: boolean; cloudAllowed: boolean }>;
}

export interface StoredFirstStagePolicy extends FirstStagePolicy {
  revision: string | null;
}

export async function firstStagePolicy(teamId: number): Promise<StoredFirstStagePolicy> {
  const stored = await getSetting<Partial<StoredFirstStagePolicy>>(key(teamId));
  return normalizePolicy(stored);
}

function normalizePolicy(stored: Partial<StoredFirstStagePolicy> | null): StoredFirstStagePolicy {
  return {
    revision: typeof stored?.revision === 'string' ? stored.revision : null,
    enabled: stored?.enabled === true,
    credentialId:
      Number.isSafeInteger(stored?.credentialId) && (stored!.credentialId ?? 0) > 0
        ? stored!.credentialId!
        : null,
    timeoutMs:
      typeof stored?.timeoutMs === 'number' && Number.isFinite(stored.timeoutMs)
        ? Math.max(200, Math.min(FIRST_STAGE_MAX_TIMEOUT, Math.floor(stored.timeoutMs)))
        : FIRST_STAGE_DEFAULT_TIMEOUT,
    useCases: stored?.useCases ?? {},
  };
}

export function caseAllowed(policy: FirstStagePolicy, classId: string): boolean {
  return (
    policy.enabled &&
    policy.credentialId !== null &&
    policy.useCases[classId]?.enabled === true &&
    policy.useCases[classId]?.cloudAllowed === true &&
    decisionClass(classId)?.input.cloud === 'allowed'
  );
}

const circuits = new Map<string, { failures: number; until: number }>();
const circuitKey = (teamId: number, credentialId: number) => `${teamId}:${credentialId}`;
export function stageCircuitOpen(teamId: number, credentialId: number): boolean {
  const state = circuits.get(circuitKey(teamId, credentialId));
  if (!state) return false;
  if (state.until && state.until <= Date.now()) {
    circuits.delete(circuitKey(teamId, credentialId));
    return false;
  }
  return state.until > Date.now();
}
export function stageCircuitResult(teamId: number, credentialId: number, success: boolean): void {
  const id = circuitKey(teamId, credentialId);
  if (success) {
    circuits.delete(id);
    return;
  }
  // No request contents, keys or answers enter this bounded process-local breaker.
  if (circuits.size >= 256 && !circuits.has(id)) circuits.delete(circuits.keys().next().value!);
  const failures = (circuits.get(id)?.failures ?? 0) + 1;
  circuits.set(id, { failures, until: failures >= 3 ? Date.now() + 30_000 : 0 });
}

export async function firstStageCandidate(teamId: number, classId: string, threshold: number) {
  const policy = await firstStagePolicy(teamId);
  if (!caseAllowed(policy, classId) || stageCircuitOpen(teamId, policy.credentialId!)) return null;
  const calibrated = jevDecisionPolicy(classId, 'typesafe', threshold, null);
  if (!calibrated.enabled) return null;
  const connection = await loadConnection(policy.credentialId!);
  if (
    !connection ||
    connection.teamId !== teamId ||
    connection.projectId !== null ||
    !['typesafe', 'vercel'].includes(connection.backend.id)
  )
    return null;
  if (!(await evalAllows(teamId, classId, connection.credentialId, threshold)).ok) return null;
  return { policy, connection };
}

export async function stageStillEnabled(
  teamId: number,
  classId: string,
  credentialId: number,
  revision?: string | null,
) {
  const current = await firstStagePolicy(teamId);
  return (
    caseAllowed(current, classId) &&
    current.credentialId === credentialId &&
    (revision === undefined || current.revision === revision)
  );
}

export interface FirstStageView extends FirstStagePolicy {
  revision: string | null;
  circuitOpen: boolean;
  checks: Record<string, { ok: boolean; reason: string | null; running: boolean }>;
  effective: Record<string, { enabled: boolean; reason: string | null }>;
}

export async function firstStageView(teamId: number): Promise<FirstStageView> {
  const policy = await firstStagePolicy(teamId);
  const checks: FirstStageView['checks'] = {};
  const effective: FirstStageView['effective'] = {};
  const circuitOpen = policy.credentialId !== null && stageCircuitOpen(teamId, policy.credentialId);
  for (const cls of decisionClasses().filter((entry) => entry.input.cloud === 'allowed')) {
    const setting = await classSetting(teamId, cls.id);
    const calibrated = jevDecisionPolicy(
      cls.id,
      'typesafe',
      effectiveThreshold(cls, setting),
      setting.threshold,
    );
    const threshold =
      cls.id === BROWSER_CLASS
        ? Math.max(calibrated.threshold, effectiveThreshold(cls, setting))
        : calibrated.threshold;
    const unavailableReason = calibrated.enabled ? 'no_connection' : 'jev_calibration_abstains';
    const allowed =
      policy.credentialId && calibrated.enabled
        ? await evalAllows(teamId, cls.id, policy.credentialId, threshold)
        : { ok: false as const, reason: unavailableReason };
    const latest = policy.credentialId
      ? await latestEval(teamId, cls.id, policy.credentialId)
      : null;
    checks[cls.id] = {
      ok: allowed.ok,
      reason: allowed.ok ? null : allowed.reason,
      running: latest?.status === 'running',
    };
    let reason: string | null = !policy.enabled
      ? 'master_off'
      : !policy.useCases[cls.id]?.enabled
        ? 'use_case_off'
        : !policy.useCases[cls.id]?.cloudAllowed
          ? 'cloud_not_allowed'
          : cls.id !== BROWSER_CLASS && !setting.enabled
            ? 'class_off'
            : !allowed.ok
              ? allowed.reason
              : circuitOpen
                ? 'cooldown'
                : null;
    if (!reason) {
      const connection = await usableDecisionConnection(teamId, cls, policy.credentialId);
      if (
        'refused' in connection ||
        !['typesafe', 'vercel'].includes(connection.connection.backend.id)
      )
        reason = 'connection_blocked';
    }
    effective[cls.id] = { enabled: reason === null, reason };
  }
  return {
    ...policy,
    circuitOpen,
    checks,
    effective,
  };
}

export async function updateFirstStage(
  teamId: number,
  patch: Partial<FirstStagePolicy>,
): Promise<FirstStageView> {
  await db.transaction(async (tx) => {
    await tx
      .insert(appSetting)
      .values({ key: key(teamId), value: {} })
      .onConflictDoNothing();
    const [row] = await tx
      .select({ value: appSetting.value })
      .from(appSetting)
      .where(eq(appSetting.key, key(teamId)))
      .for('update');
    const current = normalizePolicy(row!.value as Partial<StoredFirstStagePolicy>);
    const next = await nextPolicy(teamId, current, patch);
    await tx
      .update(appSetting)
      .set({ value: next, updatedAt: new Date() })
      .where(eq(appSetting.key, key(teamId)));
  });
  await forgetSetting(key(teamId));
  return firstStageView(teamId);
}

async function nextPolicy(
  teamId: number,
  current: StoredFirstStagePolicy,
  patch: Partial<FirstStagePolicy>,
): Promise<StoredFirstStagePolicy> {
  // The off switch wins even when a formerly valid connection, eval or use case has
  // since disappeared. It only disables; reconfiguration is a separate explicit patch.
  if (patch.enabled === false) {
    return { ...current, enabled: false, revision: randomUUID() };
  }
  const changedConnection =
    patch.credentialId !== undefined && patch.credentialId !== current.credentialId;
  const next = {
    ...current,
    ...patch,
    revision: randomUUID(),
    enabled: changedConnection ? false : (patch.enabled ?? current.enabled),
    useCases: changedConnection
      ? (patch.useCases ?? {})
      : { ...current.useCases, ...patch.useCases },
  };
  if (
    patch.enabled === undefined &&
    patch.credentialId === undefined &&
    patch.timeoutMs === undefined &&
    patch.useCases &&
    Object.values(patch.useCases).every((entry) => !entry.enabled && !entry.cloudAllowed)
  )
    return next;
  if (next.credentialId !== null && (next.enabled || patch.credentialId !== undefined)) {
    const connection = await loadConnection(next.credentialId);
    if (
      !connection ||
      connection.teamId !== teamId ||
      connection.projectId !== null ||
      !['typesafe', 'vercel'].includes(connection.backend.id)
    )
      throw new HttpError(400, 'Choose a team-wide Jev connection of this team.');
  }
  if (next.enabled && !next.credentialId) throw new HttpError(409, 'no_connection');
  for (const [classId, selected] of Object.entries(next.useCases)) {
    const cls = decisionClass(classId);
    if (!cls || cls.input.cloud !== 'allowed')
      throw new HttpError(400, 'This use case does not permit cloud decisions.');
    if (selected.enabled && !selected.cloudAllowed)
      throw new HttpError(400, 'Explicit cloud permission is required for this use case.');
    if (next.enabled && selected.enabled && next.credentialId) {
      const setting = await classSetting(teamId, classId);
      const allowed = await evalAllows(
        teamId,
        classId,
        next.credentialId,
        effectiveThreshold(cls, setting),
      );
      if (!allowed.ok) throw new HttpError(409, allowed.reason);
    }
  }
  return next;
}
