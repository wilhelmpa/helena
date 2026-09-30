import type { ModelTarget } from './maintenance-state';

export const NPU_SLUG = 'volition-npu';
export const NPU_BASE = 'http://127.0.0.1:13306/v1';
export const NPU_EMBED = 'embed-gemma:300m';
export const NPU_CHAT_MODELS = ['qwen3.5:4b', 'qwen3.5:2b'] as const;
export const MODEL_MEMORY = { capacityBytes: 124_000_000_000, reserveGiB: 12 } as const;
export const NPU_CLASSES = ['triage', 'decisions', 'embeddings'] as const;
export type LocalProfile = 'local-halogen' | 'local-27b-npu';
export const LOCAL_PROFILES = [
  { id: 'local-halogen', name: 'Lokal Halogen', model: 'halogen-qwen3.8-flash-next', npu: false },
  { id: 'local-27b-npu', name: 'Lokal 27B + NPU', model: 'Qwen3.8-27B-GGUF', npu: true },
] as const;

export function npuClassModel(target: ModelTarget, classId: string): string | null {
  if (!target.npu || !(NPU_CLASSES as readonly string[]).includes(classId)) return null;
  return classId === 'embeddings' ? NPU_EMBED : target.npu;
}
