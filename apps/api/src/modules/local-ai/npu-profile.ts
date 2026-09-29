import type { ModelTarget } from './maintenance-state';

export const NPU_SLUG = 'volition-npu';
export const NPU_BASE = 'http://127.0.0.1:13306/v1';
export const NPU_EMBED = 'embed-gemma:300m';
export const NPU_CLASSES = ['triage', 'decisions', 'embeddings'] as const;
export type LocalProfile = 'local-halogen' | 'local-27b-npu';
export const LOCAL_PROFILES = [
  { id: 'local-halogen', name: 'Lokal Halogen', npu: false },
  { id: 'local-27b-npu', name: 'Lokal 27B + NPU', npu: true },
] as const;

export function npuClassModel(target: ModelTarget, classId: string): string | null {
  if (!target.npu || !(NPU_CLASSES as readonly string[]).includes(classId)) return null;
  return classId === 'embeddings' ? NPU_EMBED : target.npu;
}
