import { request } from '@/lib/api/core/client';
import type { AiChatModel } from './agentChat';
import type { LocalProfileId, NpuChatModel } from './localProfiles';

export { LOCAL_DEFAULT, NPU_CHAT_MODELS } from './localProfiles';
export type { LocalProfileId, NpuChatModel } from './localProfiles';
export interface ModelTarget {
  server: 'halogen' | 'lemonade';
  slug: string;
  model: string;
  // Set once the paired profile is on: its id and the NPU chat model.
  npu?: NpuChatModel;
  profile?: LocalProfileId;
}
// What a switch asks for: the model, the profile it belongs to and, for the paired profile,
// the NPU chat model (the server takes Gemma E2B when none is given).
export interface ModelSwitchRequest {
  model: string;
  profile?: LocalProfileId;
  npuModel?: NpuChatModel;
}
export interface GlobalModelStatus {
  model: string | null;
  maintenance: null | {
    admissionPaused: boolean;
    proxyPaused: boolean;
    active: ModelTarget | null;
    operation: null | {
      id: string;
      phase: string;
      error: string | null;
      target: ModelTarget;
      previous: ModelTarget;
    };
  };
  job: null | {
    startedAt: string;
    failedClasses: string[];
    classes: string[];
    committed?: boolean;
    restored?: boolean;
    done?: boolean;
  };
}
export interface ModelPreview {
  target: ModelTarget;
  previous: string | null;
  weightLockGb: number;
  simultaneousLargeModels: false;
  requiresGroupStop: true;
  agents: { id: number; name: string }[];
  classes: string[];
  // The kinds of work the NPU takes and the NPU chat models on offer; empty while the
  // profile has no NPU.
  npuClasses?: string[];
  npuSelection?: NpuChatModel[];
  memoryReserveGiB?: number;
}
export interface ModelPickerData {
  localDefault: { id: string; model: string | null };
  agentDefault: { id: null; model: string | null; local: boolean };
  groups: {
    id: 'local' | 'cloud';
    models: (Pick<AiChatModel, 'id' | 'name' | 'thinkingLevels'> & {
      group: 'local' | 'cloud';
      status: string;
      selectable: boolean;
      strength: string;
      speed: string;
      cost: string;
    })[];
  }[];
}
const action = <T>(path: string, body: unknown) =>
  request<T>(`/god/local-ai/default/${path}`, { method: 'POST', body: JSON.stringify(body) });
export const previewGlobalModel = (request: ModelSwitchRequest) =>
  action<ModelPreview>('preview', request);
export const applyGlobalModel = (request: ModelSwitchRequest) =>
  action<GlobalModelStatus['maintenance']>('apply', request);
export const resumeGlobalModel = (rollback = false) =>
  action<GlobalModelStatus['maintenance']>('resume', { rollback });
export const bulkLocalDefault = (ids: number[], apply = false) =>
  action<{ applied: boolean; agents: { id: number; name: string; model: string | null }[] }>(
    'agents',
    { ids, apply },
  );
export const getModelPicker = (scope: string, agentId: number) =>
  request<ModelPickerData>(
    `${scope.startsWith('team:') ? `/teams/${scope.slice(5)}` : `/projects/${encodeURIComponent(scope)}`}/ai-agents/${agentId}/chat/model-picker`,
  );
