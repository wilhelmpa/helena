// The constants and ids of the local profile switch, apart from the request client so that
// components can use them without loading it (apps/api local-ai/npu-profile.ts has the same).
export const LOCAL_DEFAULT = 'volition-local-default';
// The local profiles of the managed switch: Flash on Halogen with the NPU off, or
// Qwen3.8-27B on the GPU with a small chat model on the NPU.
export type LocalProfileId = 'local-halogen' | 'local-27b-npu';
export const NPU_CHAT_MODELS = [
  'qwen3.5:2b',
  'qwen3.5:4b',
  'gemma4-it:e2b',
  'gemma4-it:e4b',
] as const;
export type NpuChatModel = (typeof NPU_CHAT_MODELS)[number];
