import { request } from '@/lib/api/core/client';

// Helena's local AI (docs/helena-decisions/local-ai-platform.md): the owner's model servers
// (Lemonade on the machine itself), the policy that sends background work there first, the
// evals that gate each kind of work, and the status the "Lokale KI" card shows. Owner only.

export type LocalAiUnit = 'gpu' | 'npu' | 'cpu';
export type LocalAiMode = 'off' | 'prefer' | 'only';
export type LocalAiPreset = 'sparsam' | 'ausgewogen' | 'qualitaet' | 'eigene';
export type LocalizedText = string | Record<string, string>;
export type ClassBlocker = 'not-wired' | 'no-model' | 'eval-missing' | 'eval-failed';

export interface LocalModel {
  id: string;
  modelId: string;
  name: string;
  unit: LocalAiUnit | null;
  capabilities: string[];
  contextLength: number | null;
  sizeBytes: number | null;
  downloaded: boolean | null;
  loaded: boolean;
  backend: string | null;
  checkpoint?: string | null;
}

export interface ServerLoad {
  gpuPercent: number | null;
  npuPercent: number | null;
  cpuPercent: number | null;
  vramGb: number | null;
  memoryGb: number | null;
}

export interface ServerStatus {
  reachable: boolean;
  version: string | null;
  latencyMs: number | null;
  error: string | null;
  loaded: { id: string; unit: LocalAiUnit | null; backend: string | null }[];
  load?: ServerLoad | null;
}

export interface ModelServer {
  id: number;
  slug: string;
  kind: string;
  name: string;
  baseUrl: string;
  keySource: 'file' | 'stored' | 'none';
  keyFile: string | null;
  key: 'file' | 'stored' | 'none' | 'invalid';
  enabled: boolean;
  contextLength: number;
  provider: string;
  models: LocalModel[];
  status: ServerStatus | null;
  checkedAt: string | null;
}

export interface LocalAiPolicy {
  enabled: boolean;
  units: Record<LocalAiUnit, boolean>;
  classes: Record<string, { mode: LocalAiMode; model: string | null }>;
  preset: LocalAiPreset;
  initialized: boolean;
}

export interface LocalAiClass {
  id: string;
  label: LocalizedText;
  description: LocalizedText | null;
  unit: LocalAiUnit;
  capability: string;
  priority: string;
  // How much a reasoning model may think for this work.
  thinking: 'off' | 'low' | 'medium' | 'high';
  experimental: boolean;
  inMasterDefault: boolean;
  wired: boolean;
  // The modes the class offers: work that runs as an agent's turn offers no `only`.
  modes: LocalAiMode[];
  hasEval: boolean;
  // The version of its eval: an eval of an older one no longer counts.
  evalVersion: number;
  threshold: number;
  mode: LocalAiMode;
  model: string | null;
  resolvedModel: string | null;
  blocker: ClassBlocker | null;
}

export interface LocalAiEval {
  id: number;
  classId: string;
  modelId: string;
  // `running` while it asks its cases (minutes on a local model), `done` once its score is in,
  // `stale` when it was cut off and never finished.
  status: 'running' | 'done' | 'stale';
  score: number;
  threshold: number;
  passed: boolean;
  cases: number;
  details: { id: string; detail: string | null }[];
  latencyMsP50: number | null;
  tokensPerSecond: number | null;
  error: string | null;
  evalVersion: number;
  // When it started, and when its score came in.
  ranAt: string;
  finishedAt: string | null;
}

export interface LocalAiSettings {
  policy: LocalAiPolicy;
  servers: ModelServer[];
  serverTypes: { id: string; label: LocalizedText; defaultBaseUrl: string | null }[];
  classes: LocalAiClass[];
  // The newest finished eval of each class and model.
  evals: LocalAiEval[];
  // The evals still running.
  runningEvals: LocalAiEval[];
}

export interface LoadedModel {
  id: string;
  modelId: string;
  unit: LocalAiUnit | null;
  backend: string | null;
}

export interface LocalAiStatus {
  guard: {
    checkedAt: string | null;
    probeAt: string | null;
    probeMs: number | null;
    probeFailures: number;
    problem: 'eviction' | 'probe' | null;
    availableBytes: number | null;
    consumers: { pid: number; name: string; rssBytes: number }[];
  };
  enabled: boolean;
  units: {
    gpu: {
      allowed: boolean;
      present: boolean;
      busyPercent: number | null;
      vramUsedBytes: number | null;
      vramTotalBytes: number | null;
      gttUsedBytes: number | null;
      gttTotalBytes: number | null;
      loaded: LoadedModel[];
    };
    npu: { allowed: boolean; present: boolean; busyPercent: number | null; loaded: LoadedModel[] };
    cpu: { allowed: boolean; present: boolean; busyPercent: number | null; loaded: LoadedModel[] };
  };
  servers: {
    id: number;
    name: string;
    enabled: boolean;
    reachable: boolean;
    version: string | null;
    error: string | null;
    checkedAt: string | null;
    latencyMs: number | null;
  }[];
  classes: {
    id: string;
    unit: LocalAiUnit;
    mode: LocalAiMode;
    experimental: boolean;
    wired: boolean;
  }[];
  usage: { days: number; localTokens: number; cloudTokens: number };
  latencyMsP50: number | null;
}

export interface PolicyPatch {
  enabled?: boolean;
  units?: Partial<Record<LocalAiUnit, boolean>>;
  classes?: Record<string, { mode?: LocalAiMode; model?: string | null }>;
  preset?: LocalAiPreset;
}

export interface ServerInput {
  slug?: string;
  kind?: string;
  name?: string;
  baseUrl?: string;
  keySource?: 'file' | 'stored' | 'none';
  keyFile?: string | null;
  key?: string | null;
  enabled?: boolean;
  contextLength?: number;
}

export const getLocalAiSettings = () => request<LocalAiSettings>('/god/local-ai');

export const getLocalAiStatus = () => request<LocalAiStatus>('/god/local-ai/status');

export const updateLocalAiPolicy = (patch: PolicyPatch) =>
  request<LocalAiPolicy>('/god/local-ai/policy', { method: 'PATCH', body: JSON.stringify(patch) });

export const createModelServer = (input: ServerInput) =>
  request<ModelServer>('/god/local-ai/servers', { method: 'POST', body: JSON.stringify(input) });

export const updateModelServer = (id: number, input: ServerInput) =>
  request<ModelServer>(`/god/local-ai/servers/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });

export const deleteModelServer = (id: number) =>
  request<void>(`/god/local-ai/servers/${id}`, { method: 'DELETE' });

export const checkModelServer = (id: number) =>
  request<ModelServer>(`/god/local-ai/servers/${id}/check`, { method: 'POST' });

// Starts the eval in the background: the answer is the eval, `running` (202).
export const runLocalAiEval = (classId: string, modelId: string) =>
  request<LocalAiEval>('/god/local-ai/evals', {
    method: 'POST',
    body: JSON.stringify({ classId, modelId }),
  });

export const getLocalAiEval = (id: number) => request<LocalAiEval>(`/god/local-ai/evals/${id}`);
