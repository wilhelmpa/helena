import { request } from '@/lib/api/core/client';
import type { AiChatModel } from './agentChat';

export const LOCAL_DEFAULT = 'volition-local-default';
export interface ModelTarget {
  server: 'halogen' | 'lemonade';
  slug: string;
  model: string;
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
export const previewGlobalModel = (model: string) => action<ModelPreview>('preview', { model });
export const applyGlobalModel = (model: string) =>
  action<GlobalModelStatus['maintenance']>('apply', { model });
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
