import { request } from '@/lib/api/core/client';

// browser_task's settings and Browser 2.0 (apps/api/src/modules/browser-task,
// docs/helena-decisions/browser-task.md): the kinds of decision service, "Verbindung testen",
// a project's "Browser-Steuerung", the instance default, and the test area's runs.

export type LocalizedLabel = string | Record<string, string>;

export interface DecisionBackendPreset {
  id: string;
  label: LocalizedLabel;
  baseUrl: string;
  model: string;
  allowPrivateAddress: boolean;
  keySource: 'local-laya' | null;
}

export interface DecisionBackend {
  id: string;
  label: LocalizedLabel;
  location: 'cloud' | 'local';
  defaultBaseUrl: string | null;
  defaultModel: string;
  policy: 'jev' | 'laya';
  keyRequired: boolean;
  signupUrl: string | null;
  presets: DecisionBackendPreset[];
}

export const getDecisionBackends = () =>
  request<{ backends: DecisionBackend[] }>('/decision-backends');

export interface ConnectionTest {
  ok: boolean;
  message: string;
  models: string[];
  latencyMs: number | null;
}

export const testDecisionConnection = (teamId: number, credentialId: number) =>
  request<ConnectionTest>(`/teams/${teamId}/credentials/${credentialId}/test`, { method: 'POST' });

export type BrowserControlMode = 'inherit' | 'standard' | 'decision';
export type BrowserControlPolicy = 'auto' | 'jev' | 'laya';

export interface BrowserControl {
  setting: {
    mode: BrowserControlMode;
    credentialId: number | null;
    policy: BrowserControlPolicy;
    minConfidence: number | null;
  };
  effective: {
    enabled: boolean;
    source: 'project' | 'instance';
    label: string;
    policy: 'jev' | 'laya';
    credentialId: number | null;
    problem: 'connection_missing' | null;
  };
}

export interface BrowserControlPatch {
  mode?: BrowserControlMode;
  credentialId?: number | null;
  policy?: BrowserControlPolicy;
  minConfidence?: number | null;
}

export const getBrowserControl = (projectKey: string) =>
  request<BrowserControl>(`/projects/${projectKey}/settings/browser-control`);

export const updateBrowserControl = (projectKey: string, patch: BrowserControlPatch) =>
  request<BrowserControl>(`/projects/${projectKey}/settings/browser-control`, {
    method: 'PUT',
    body: JSON.stringify(patch),
  });

export interface DecisionConnection {
  id: number;
  label: string;
  provider: string | null;
  model: string | null;
  baseUrl: string | null;
  keySource: string;
  hasKey: boolean;
  status: string | null;
}

export const listProjectConnections = (projectKey: string) =>
  request<{ connections: DecisionConnection[] }>(
    `/projects/${projectKey}/browser-control/connections`,
  );

export const listTeamConnections = (teamId: number) =>
  request<{ connections: DecisionConnection[] }>(`/teams/${teamId}/browser-control/connections`);

export interface InstanceBrowserControl {
  mode: 'standard' | 'decision';
  credentialId: number | null;
  policy: BrowserControlPolicy;
  minConfidence: number | null;
}

export const getInstanceBrowserControl = () =>
  request<InstanceBrowserControl>('/god/browser-control');

export const updateInstanceBrowserControl = (patch: Partial<InstanceBrowserControl>) =>
  request<InstanceBrowserControl>('/god/browser-control', {
    method: 'PUT',
    body: JSON.stringify(patch),
  });

// Browser 2.0: a project, or Home's own browser (the team's Home-Master).
export type LabScope = { kind: 'project'; projectKey: string } | { kind: 'home'; teamId: number };

function labBase(scope: LabScope): string {
  return scope.kind === 'project'
    ? `/projects/${scope.projectKey}/browser-lab`
    : `/teams/${scope.teamId}/browser-lab/home`;
}

export type LabBackend = 'decision' | 'standard' | 'jev-browser';

export interface LabStep {
  n: number | null;
  operation: string;
  element: string | null;
  valueKey?: string | null;
  option?: string | null;
  probability?: number | null;
  confidence?: number | null;
  decisionMs?: number | null;
  actionMs?: number | null;
  category?: string | null;
  outcome?: string | null;
}

export interface LabRun {
  id: number;
  source: string;
  kind: string;
  backend: LabBackend;
  backendLabel: string;
  provider: string | null;
  policy: string | null;
  modelConfigured: string | null;
  modelReported: string | null;
  goal: string;
  mode: string;
  maxSteps: number;
  startUrl: string | null;
  valueKeys: string[];
  status: string;
  summary: string | null;
  steps: LabStep[];
  result: {
    url?: string | null;
    title?: string | null;
    confidence?: number | null;
    approvalId?: number | null;
    candidates?: { element: string | null; probability: number }[];
    pending?: { operation: string | null; element: string | null; category: string | null };
  } | null;
  decisions: number;
  inputTokens: number;
  outputTokens: number;
  decisionMs: number;
  durationMs: number | null;
  costEur: number | null;
  agentId: number | null;
  agentName: string | null;
  chatThreadId: string | null;
  finalFrame: string | null;
  createdAt: string;
  finishedAt: string | null;
}

export interface LabOptions {
  agents: { id: number; name: string; username: string }[];
  connections: DecisionConnection[];
  defaultConnectionId: number | null;
  controlEnabled: boolean;
  slug: string;
}

export interface StartLabRun {
  backend: LabBackend;
  agentId: number;
  credentialId?: number | null;
  policy?: BrowserControlPolicy;
  goal: string;
  values?: Record<string, string>;
  startUrl?: string | null;
  mode?: 'read' | 'act';
  maxSteps?: number;
}

export const getLabOptions = (scope: LabScope) => request<LabOptions>(`${labBase(scope)}/options`);

export const listLabRuns = (scope: LabScope) =>
  request<{ runs: LabRun[] }>(`${labBase(scope)}/runs`);

export const getLabRun = (scope: LabScope, runId: number) =>
  request<LabRun>(`${labBase(scope)}/runs/${runId}`);

export const startLabRun = (scope: LabScope, body: StartLabRun) =>
  request<LabRun>(`${labBase(scope)}/runs`, { method: 'POST', body: JSON.stringify(body) });

export const cancelLabRun = (scope: LabScope, runId: number) =>
  request<LabRun>(`${labBase(scope)}/runs/${runId}/cancel`, { method: 'POST' });

// A run that is still going (the page keeps asking for it).
export function labRunActive(run: Pick<LabRun, 'status' | 'finishedAt'>): boolean {
  return !run.finishedAt && (run.status === 'queued' || run.status === 'running');
}
