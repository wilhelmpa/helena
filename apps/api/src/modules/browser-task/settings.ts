import { getSetting, setSetting } from '@repo/db';
import { HttpError } from '#shared/lib';
import { getProjectSetting, setProjectSetting } from '#shared/project-settings';
import type { DecisionPolicyKind } from '@helena/sdk';
import { loadConnection, type DecisionConnection } from './connection';
import { optionalBrowserStage } from './first-stage';
import { agentBrowserMode } from '#modules/model-schemas/service';

// "Browser-Steuerung" (docs/helena-decisions/browser-task.md §3.3): how a project's agents drive
// its browser. "Standard (wie bisher)": step by step with their own model, the fast path's tools
// are not offered. "Entscheidungsmodell": browser_task asks the connection named here. A project
// can follow the instance default (Administrator → Agenten-Laufzeit).

export type BrowserControlMode = 'inherit' | 'standard' | 'decision';
export type BrowserControlPolicy = 'auto' | DecisionPolicyKind;

export interface BrowserControlSetting {
  mode: BrowserControlMode;
  credentialId: number | null;
  policy: BrowserControlPolicy;
  // Below this probability of its target the loop hands back; null: the policy's own.
  minConfidence: number | null;
}

export interface BrowserControlDefaults {
  mode: 'standard' | 'decision';
  credentialId: number | null;
  policy: BrowserControlPolicy;
  minConfidence: number | null;
}

const PROJECT_KEY = 'browser_control';
const INSTANCE_KEY = 'browserControlDefaults';

export const DEFAULT_PROJECT_CONTROL: BrowserControlSetting = {
  mode: 'inherit',
  credentialId: null,
  policy: 'auto',
  minConfidence: null,
};

export const DEFAULT_INSTANCE_CONTROL: BrowserControlDefaults = {
  mode: 'standard',
  credentialId: null,
  policy: 'auto',
  minConfidence: null,
};

function policyOf(value: unknown): BrowserControlPolicy {
  return value === 'jev' ? value : 'auto';
}

function confidenceOf(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 && value < 1
    ? Math.round(value * 100) / 100
    : null;
}

function idOf(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : null;
}

export async function getProjectBrowserControl(projectId: number): Promise<BrowserControlSetting> {
  const stored = await getProjectSetting<Partial<BrowserControlSetting>>(projectId, PROJECT_KEY);
  const mode = stored?.mode === 'standard' || stored?.mode === 'decision' ? stored.mode : 'inherit';
  return {
    mode,
    credentialId: idOf(stored?.credentialId),
    policy: policyOf(stored?.policy),
    minConfidence: confidenceOf(stored?.minConfidence),
  };
}

export async function getInstanceBrowserControl(): Promise<BrowserControlDefaults> {
  const stored = await getSetting<Partial<BrowserControlDefaults>>(INSTANCE_KEY);
  return {
    mode: stored?.mode === 'decision' ? 'decision' : 'standard',
    credentialId: idOf(stored?.credentialId),
    policy: policyOf(stored?.policy),
    minConfidence: confidenceOf(stored?.minConfidence),
  };
}

// A connection usable where: a credential of the project's team, for the whole team or for this
// very project. Anything else is refused on save and ignored when read.
async function usableConnection(
  credentialId: number | null,
  scope: { teamId: number; projectId: number | null },
): Promise<DecisionConnection | null> {
  if (credentialId === null) return null;
  const connection = await loadConnection(credentialId);
  if (!connection || connection.teamId !== scope.teamId) return null;
  if (connection.projectId !== null && connection.projectId !== scope.projectId) return null;
  return connection;
}

export async function setProjectBrowserControl(
  project: { id: number; teamId: number },
  patch: Partial<BrowserControlSetting>,
): Promise<BrowserControlSetting> {
  const current = await getProjectBrowserControl(project.id);
  const next: BrowserControlSetting = {
    mode: patch.mode ?? current.mode,
    credentialId: patch.credentialId === undefined ? current.credentialId : patch.credentialId,
    policy: patch.policy ?? current.policy,
    minConfidence:
      patch.minConfidence === undefined ? current.minConfidence : confidenceOf(patch.minConfidence),
  };
  if (next.mode === 'decision') {
    if (next.credentialId === null) throw new HttpError(400, 'Choose a decision model connection.');
    if (
      !(await usableConnection(next.credentialId, {
        teamId: project.teamId,
        projectId: project.id,
      }))
    ) {
      throw new HttpError(400, 'That connection is not one of this project (Zugänge).');
    }
  }
  await setProjectSetting(project.id, PROJECT_KEY, next);
  return next;
}

export async function setInstanceBrowserControl(
  patch: Partial<BrowserControlDefaults>,
): Promise<BrowserControlDefaults> {
  const current = await getInstanceBrowserControl();
  const next: BrowserControlDefaults = {
    mode: patch.mode ?? current.mode,
    credentialId: patch.credentialId === undefined ? current.credentialId : patch.credentialId,
    policy: patch.policy ?? current.policy,
    minConfidence:
      patch.minConfidence === undefined ? current.minConfidence : confidenceOf(patch.minConfidence),
  };
  if (next.mode === 'decision') {
    if (next.credentialId === null) throw new HttpError(400, 'Choose a decision model connection.');
    const connection = await loadConnection(next.credentialId);
    if (!connection) throw new HttpError(400, 'That decision model connection does not exist.');
    if (connection.projectId !== null) {
      throw new HttpError(
        400,
        'The default needs a connection of the whole team, not of one project.',
      );
    }
  }
  await setSetting(INSTANCE_KEY, next);
  return next;
}

export interface EffectiveBrowserControl {
  firstStage?: { revision: string | null; timeoutMs: number };
  enabled: boolean;
  // Where the answer came from.
  source: 'project' | 'instance' | 'agent';
  connection: DecisionConnection | null;
  policy: DecisionPolicyKind;
  minConfidence: number | null;
  // What the agent and the live view are told: "Jev (TypeSafe)" or the connection's name.
  label: string;
  // Why a configured decision model is not used (the instance default's connection belongs to
  // another team, or it was deleted).
  problem: 'connection_missing' | null;
}

// What applies to a project's browser (or Home's, projectId null, for the Home-Master's team).
export async function effectiveBrowserControl(scope: {
  teamId: number;
  projectId: number | null;
  agentId?: number;
}): Promise<EffectiveBrowserControl> {
  const own =
    scope.projectId === null
      ? DEFAULT_PROJECT_CONTROL
      : await getProjectBrowserControl(scope.projectId);
  const selectedMode = scope.agentId ? await agentBrowserMode(scope.agentId) : null;
  const agentMode = own.mode !== 'inherit' && selectedMode?.source !== 'own' ? null : selectedMode;
  const chosen =
    own.mode === 'inherit'
      ? { ...(await getInstanceBrowserControl()), source: 'instance' as const }
      : { ...own, source: 'project' as const };
  const off = {
    enabled: false,
    source: chosen.source,
    connection: null,
    policy: 'jev' as const,
    minConfidence: null,
    label: 'Standard',
  };
  if (agentMode?.value === 'standard') return { ...off, source: 'agent', problem: null };
  if (
    agentMode?.value === 'combined' ||
    (agentMode?.value === 'jev' && chosen.mode !== 'decision')
  ) {
    const stage = await optionalBrowserStage(scope.teamId).catch(() => null);
    if (stage)
      return {
        enabled: true,
        source: 'agent',
        connection: stage.connection,
        policy: 'jev',
        minConfidence: stage.threshold,
        label: stage.connection.label,
        problem: null,
        firstStage: { revision: stage.policy.revision, timeoutMs: stage.policy.timeoutMs },
      };
  }
  if (chosen.mode !== 'decision') {
    if (own.mode === 'inherit') {
      const stage = await optionalBrowserStage(scope.teamId).catch(() => null);
      if (stage)
        return {
          enabled: true,
          source: 'instance',
          connection: stage.connection,
          policy: 'jev',
          minConfidence: stage.threshold,
          label: stage.connection.label,
          problem: null,
          firstStage: { revision: stage.policy.revision, timeoutMs: stage.policy.timeoutMs },
        };
    }
    return { ...off, problem: null };
  }
  const connection = await usableConnection(chosen.credentialId, scope);
  if (!connection) return { ...off, problem: 'connection_missing' };
  const policy: DecisionPolicyKind =
    chosen.policy === 'auto' ? connection.backend.policy : chosen.policy;
  return {
    enabled: true,
    source: chosen.source,
    connection,
    policy,
    minConfidence: chosen.minConfidence,
    label: connection.label || String(connection.backend.id),
    problem: null,
  };
}
