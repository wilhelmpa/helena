import { request } from '@/lib/api/core/client';
import type { GlobalModelStatus } from './globalModel';

// The model matrix (Auftrag 121c): which runtime, model, thinking depth, escalation, browser
// control, decider and device every agent uses, and where each value comes from — the
// active schema ("Nur lokal", "Gemischt" …), the schema of its project, or the agent itself.
// Changes are staged in the browser, checked with `preview` and written with `apply`, both
// against the revision the matrix was read at. Administrator only.

export type MatrixColumn =
  'runtime' | 'model' | 'reasoning' | 'escalation' | 'browser' | 'decision' | 'device';
export const MATRIX_COLUMNS: MatrixColumn[] = [
  'runtime',
  'model',
  'reasoning',
  'escalation',
  'browser',
  'decision',
  'device',
];
export type CellSource = 'schema' | 'project' | 'own';

export type MatrixRuntime = 'helena' | 'claude' | 'codex' | 'hermes' | 'command' | 'webhook';
export type MatrixReasoning = 'low' | 'medium' | 'high' | 'xhigh';
export type MatrixBrowser = 'standard' | 'jev' | 'combined';
export type MatrixDevice = 'gpu' | 'npu' | 'cloud' | 'cpu';
export type MatrixDecisionBackend = 'jev' | 'gpu' | 'npu' | 'jev-local' | 'local-jev';
export interface MatrixDecision {
  backend: MatrixDecisionBackend;
  threshold: number;
  fallback: 'gpu' | 'coordinator' | 'none';
  privateData: boolean;
}

// The escalation as the server stores it. Two shapes exist while the matrix moves onto the
// escalation policy of the runner (121d): the policy's own fields, and the first draft's.
// Both are read; unknown fields are ignored (utils/escalation.ts).
export type MatrixEscalation = Record<string, unknown>;

export interface MatrixValues {
  runtime: MatrixRuntime;
  model: string;
  reasoning: MatrixReasoning;
  escalation: MatrixEscalation;
  browser: MatrixBrowser;
  decision: MatrixDecision;
  device: MatrixDevice;
}

export interface MatrixCellValue<K extends MatrixColumn = MatrixColumn> {
  value: MatrixValues[K];
  source: CellSource;
}
export type MatrixCells = { [K in MatrixColumn]: MatrixCellValue<K> };

export interface MatrixAgentRow {
  id: number;
  teamId: number;
  username: string;
  role: string;
  project: { id: number; key: string } | null;
  schemaId: string;
  cells: MatrixCells;
}

export type ClassDevice = 'gpu' | 'npu' | 'cpu' | 'cloud' | 'vulkan';
export type EvalStatus = 'passed' | 'failed' | 'untested';
export interface MatrixClass {
  id: string;
  device: ClassDevice;
  model: string;
  eval: EvalStatus;
  score?: number;
  decision?: MatrixDecision;
  candidates: { device: ClassDevice; model: string; eval: EvalStatus; score?: number }[];
}

export interface MatrixSchema {
  id: string;
  name: string;
  description: string;
  profile: string;
  roles: Record<string, MatrixValues>;
  classes: Record<string, Omit<MatrixClass, 'id' | 'candidates'>>;
  npuSlots: number;
  gpuSlots: number;
  speechRecognition: 'cpu' | 'npu';
  jevPrivate: boolean;
}

export interface MatrixProfile {
  id: string;
  name: string;
  npu: boolean;
  classes: MatrixSchema['classes'];
  npuSlots: number;
  gpuSlots: number;
  speechRecognition: 'cpu' | 'npu';
}

// What an undo can take back: the last applies (at most ten), newest last, with how many agents
// each changed; null for one written before agent changes were kept (only the schemas return).
export interface MatrixUndo {
  depth: number;
  steps: { revision: number; agents: number | null }[];
}

export interface ModelMatrix {
  revision: number;
  undo: MatrixUndo;
  active: string;
  schemas: Record<string, MatrixSchema>;
  profiles: MatrixProfile[];
  // projectId → schema id, for projects that have a schema of their own.
  projects: Record<string, string>;
  agents: MatrixAgentRow[];
  classes: MatrixClass[];
  local: Pick<GlobalModelStatus, 'model' | 'maintenance' | 'job'>;
  browser: unknown;
}

export interface AgentChange {
  agentId: number;
  role?: string;
  // `null` takes the agent's own setting away, so the column follows the schema again.
  values: Partial<Record<MatrixColumn, MatrixValues[MatrixColumn] | null>>;
}
export interface MatrixPatch {
  expectedRevision: number;
  active?: string;
  projects?: { projectId: number; schemaId: string | null }[];
  agents?: AgentChange[];
  schema?: MatrixSchema;
  undo?: boolean;
}
export interface MatrixPreview {
  revision: number;
  nextRevision: number;
  affectedAgents: number;
  changes: {
    agentId: number;
    username: string;
    role: string;
    changes: { column: MatrixColumn; before: MatrixCellValue; after: MatrixCellValue }[];
  }[];
}

export const getModelMatrix = (teamId: number, projectId?: number) =>
  request<ModelMatrix>(
    `/god/model-schemas/matrix?teamId=${teamId}${projectId ? `&projectId=${projectId}` : ''}`,
  );
export const previewModelMatrix = (patch: MatrixPatch) =>
  request<MatrixPreview>('/god/model-schemas/preview', {
    method: 'POST',
    body: JSON.stringify(patch),
  });
export const applyModelMatrix = (patch: MatrixPatch) =>
  request<MatrixPreview>('/god/model-schemas/apply', {
    method: 'POST',
    body: JSON.stringify(patch),
  });
