import {
  NPU_CHAT_MODELS,
  type LocalProfileId,
  type NpuChatModel,
} from '@/lib/api/endpoints/localProfiles';
import type { GlobalModelStatus, ModelSwitchRequest } from '@/lib/api/endpoints/globalModel';
import type { ModelServer } from '@/lib/api/endpoints/localAi';

// The server's slug of the NPU (apps/api local-ai/npu-profile.ts) and the models of the two
// local profiles: the managed switch only knows these.
export const NPU_SLUG = 'volition-npu';
export const DEFAULT_NPU_MODEL: NpuChatModel = 'gemma4-it:e2b';
export const LOCAL_PROFILE_IDS: LocalProfileId[] = ['local-halogen', 'local-27b-npu'];
const HALOGEN_MODEL = 'halogen-qwen3.8-flash-next';
const PAIRED_MODEL = 'Qwen3.8-27B-GGUF';

const providerOf = (slug: string) => `helena-${slug}`;
export const localModelIdOf = (slug: string, model: string) => `${providerOf(slug)}/${model}`;

// A local model id (`helena-<slug>/<model>`) that lives on the NPU server.
export function isNpuModel(id: string | null | undefined): boolean {
  return (id ?? '').startsWith(`${providerOf(NPU_SLUG)}/`);
}

export function isNpuChatModel(value: string | null | undefined): value is NpuChatModel {
  return (NPU_CHAT_MODELS as readonly string[]).includes(value ?? '');
}

// The model name of a local id, without the provider.
export function localModelName(id: string): string {
  const slash = id.indexOf('/');
  return slash < 0 ? id : id.slice(slash + 1);
}

// The brand names of the four NPU chat models; any other model keeps the name its server gave.
const NPU_NAMES: Record<NpuChatModel, string> = {
  'qwen3.5:2b': 'Qwen 3.5 2B',
  'qwen3.5:4b': 'Qwen 3.5 4B',
  'gemma4-it:e2b': 'Gemma 4 E2B',
  'gemma4-it:e4b': 'Gemma 4 E4B',
};
export function npuModelName(model: string): string {
  return isNpuChatModel(model) ? NPU_NAMES[model] : model;
}
// next-intl keys cannot hold dots, so a model's hint is keyed without them.
const NPU_KEYS = {
  'qwen3.5:2b': 'qwen2b',
  'qwen3.5:4b': 'qwen4b',
  'gemma4-it:e2b': 'gemmaE2b',
  'gemma4-it:e4b': 'gemmaE4b',
} as const;
export function npuModelKey(model: NpuChatModel): (typeof NPU_KEYS)[NpuChatModel] {
  return NPU_KEYS[model];
}

// Splits a runtime's local models into the ones on the GPU and the ones on the NPU.
export function groupLocalModels<T extends { id: string }>(models: T[]): { gpu: T[]; npu: T[] } {
  return {
    gpu: models.filter((entry) => !isNpuModel(entry.id)),
    npu: models.filter((entry) => isNpuModel(entry.id)),
  };
}

// The model id a switch to a profile asks for, the way the server resolves it: Halogen's Flash
// on its own server; the 27B on the Lemonade server (a registered one, else the slug the
// switch registers it under). Null while Halogen is not registered.
export function profileModelId(profile: LocalProfileId, servers: ModelServer[]): string | null {
  if (profile === 'local-halogen') {
    const halogen = servers.find((entry) => entry.kind === 'halogen');
    return halogen ? localModelIdOf(halogen.slug, HALOGEN_MODEL) : null;
  }
  const lemonade = servers.find((entry) => entry.kind === 'lemonade');
  const local = servers.find((entry) => entry.slug === 'local');
  const slug =
    lemonade?.slug ?? (local && local.kind !== 'lemonade' ? 'volition-lemonade' : 'local');
  return localModelIdOf(slug, PAIRED_MODEL);
}

export function switchRequest(
  profile: LocalProfileId,
  npuModel: NpuChatModel | null,
  servers: ModelServer[],
): ModelSwitchRequest | null {
  const model = profileModelId(profile, servers);
  if (!model) return null;
  return profile === 'local-27b-npu' && npuModel
    ? { model, profile, npuModel }
    : { model, profile };
}

// Which profile is on now and, with the paired one, which NPU model: what the last switch put
// in place, else what the default model says.
export function currentProfile(status: GlobalModelStatus | undefined): {
  profile: LocalProfileId | null;
  npu: NpuChatModel | null;
} {
  const active = status?.maintenance?.active;
  if (active?.profile) return { profile: active.profile, npu: active.npu ?? null };
  const model = active?.model ?? (status?.model ? localModelName(status.model) : null);
  if (!model) return { profile: null, npu: null };
  return { profile: model === PAIRED_MODEL ? 'local-27b-npu' : 'local-halogen', npu: null };
}

// A switch that is under way or stopped half way: the owner continues or takes it back.
export function pendingOperation(status: GlobalModelStatus | undefined) {
  const operation = status?.maintenance?.operation ?? null;
  return operation && !['done', 'rolled-back'].includes(operation.phase) ? operation : null;
}
