import type { LocalizedText } from './text';

// Local AI: model servers on Helena's own machine (or in its LAN) that Helena offers next to
// the subscription models, and the policy that sends background work there first. Two
// extension points:
//
// - a model server type (registry `modelServers`) says how Helena lists a server's models
//   and reads its status (Lemonade, any OpenAI-compatible server, a plugin's). Chat,
//   embeddings and transcription are plain OpenAI-compatible calls for every kind;
// - a local AI task class (registry `localAiTaskClasses`) is one kind of work that may run
//   locally (embeddings, summaries, Hermes' helper calls, …), with the eval it has to pass
//   before the owner can switch it to local.
//
// Local AI never replaces a configured model: where it is on, it is tried first, and the
// model configured today answers whenever it is off, down, too slow or wrong.
// Decision: docs/helena-decisions/local-ai-platform.md.

// Where a model runs: the iGPU (llama.cpp through Vulkan/ROCm), the NPU (FastFlowLM) or the
// CPU (small encoders).
export type LocalAiUnit = 'gpu' | 'npu' | 'cpu';

export const LOCAL_AI_UNITS: readonly LocalAiUnit[] = ['gpu', 'npu', 'cpu'];

export type LocalModelCapability =
  | 'chat'
  | 'tools'
  | 'reasoning'
  | 'vision'
  | 'embeddings'
  | 'reranking'
  | 'transcription'
  | 'speech';

export const LOCAL_MODEL_CAPABILITIES: readonly LocalModelCapability[] = [
  'chat',
  'tools',
  'reasoning',
  'vision',
  'embeddings',
  'reranking',
  'transcription',
  'speech',
];

// One model a server offers.
export interface LocalModel {
  // As the server names it in its OpenAI-compatible API (`Qwen3.6-35B-A3B-GGUF`).
  id: string;
  name: string;
  unit: LocalAiUnit | null;
  capabilities: LocalModelCapability[];
  // The context window the server serves it with, where it says.
  contextLength: number | null;
  sizeBytes: number | null;
  // Whether its weights are on the machine; null where the server does not say.
  downloaded: boolean | null;
  // Whether it is in memory now.
  loaded: boolean;
  // The engine that serves it (`llamacpp`, `flm`, …), where the server names one.
  backend: string | null;
  // Where its weights come from (`<org>/<repo>:<file>` on Hugging Face), where the server says;
  // the update check looks for newer revisions there.
  checkpoint?: string | null;
}

export interface ModelServerStatus {
  reachable: boolean;
  version: string | null;
  latencyMs: number | null;
  // Short and in English; never a key, a path or a model's answer.
  error: string | null;
  // The models in memory now, with the unit each runs on.
  loaded: { id: string; unit: LocalAiUnit | null; backend: string | null }[];
  // How busy the machine is, where the server measures it (Lemonade's system stats).
  load?: ModelServerLoad | null;
}

export interface ModelServerLoad {
  gpuPercent: number | null;
  npuPercent: number | null;
  cpuPercent: number | null;
  vramGb: number | null;
  memoryGb: number | null;
  // What a server that counts its own work says (Halogen's /health and /metrics): answer and
  // prompt speed over its recent requests, its conversation slots and how many are busy, the
  // requests waiting, and how full its KV cache is. Absent where a server does not say.
  outputTokensPerSecond?: number | null;
  promptTokensPerSecond?: number | null;
  slots?: number | null;
  busySlots?: number | null;
  queued?: number | null;
  kvUsagePercent?: number | null;
}

// What the Administrator set for a server beyond its address and key.
export interface ModelServerOptions {
  // What its chat models can do beyond chatting (`tools`, `reasoning`, `vision`), for a server
  // whose API does not say (a plain OpenAI-compatible server lists ids only). Set, it replaces
  // what Helena derived for every chat model of the server; null or absent: derived.
  capabilities?: LocalModelCapability[] | null;
  // The tokenizer's vocabulary (a Hugging Face `vocab.json`) for servers that take
  // `logit_bias` by token id only (Halogen): the typed decisions look their option letters up
  // there. Below /var/lib; null or absent: the type's default.
  tokenizerFile?: string | null;
}

// The capabilities an Administrator may set for a server's chat models.
export const CONFIGURABLE_CAPABILITIES: readonly LocalModelCapability[] = [
  'tools',
  'reasoning',
  'vision',
];

// A chat model with the capabilities the Administrator set for its server: chat, plus exactly
// the configured ones. Models that are not chat models (embeddings, speech) keep theirs.
export function withConfiguredCapabilities(
  model: LocalModel,
  configured: readonly LocalModelCapability[] | null | undefined,
): LocalModel {
  if (!configured || !model.capabilities.includes('chat')) return model;
  const extra = CONFIGURABLE_CAPABILITIES.filter((entry) => configured.includes(entry));
  return { ...model, capabilities: ['chat', ...extra] };
}

// What a model server type gets to reach its server. `fetch` is bounded by a timeout and
// sends the server's key; the base URL is the one the Administrator configured.
export interface ModelServerContext {
  baseUrl: string;
  // Whether a key is configured; the key itself stays in `fetch`.
  hasKey: boolean;
  // What the Administrator set for the server (absent from older callers).
  options?: ModelServerOptions;
  signal?: AbortSignal;
  // `path` is appended to the base URL; a path starting with `//` is taken from the server's
  // root instead (`//health` for `http://host:port/health` when the base is …/v1).
  fetch(path: string, init?: { method?: 'GET' | 'POST'; body?: unknown }): Promise<Response>;
}

// A kind of model server (registry `modelServers`).
export interface ModelServerType {
  id: string;
  label: LocalizedText;
  // The base URL of its OpenAI-compatible API (ending in /v1) when installed the standard way.
  defaultBaseUrl?: string;
  models(context: ModelServerContext): Promise<LocalModel[]>;
  status(context: ModelServerContext): Promise<ModelServerStatus>;
  // A second address of the same API, for the agent turns that run without thinking. Hermes
  // tells its providers apart by their address (a provider's `extra_body` is looked up by it),
  // so the turns that must not think need a provider at another address than the ones that
  // do. Lemonade serves the same API under /api/v1 and /v1. Absent or null: the server has
  // none, and every agent turn on it thinks.
  noThinkingBaseUrl?(baseUrl: string): string | null;
  // What its speech endpoints take beyond the plain OpenAI fields (docs/helena-decisions/
  // voice-2.md). Absent: the full OpenAI shape (`prompt`, `temperature`, `verbose_json` on
  // `/audio/transcriptions`) and a plain WAV from `/audio/speech`.
  audio?: ModelServerAudio;
  // The voices its speech model offers (names for `/audio/speech`'s `voice`), for the owner to
  // pick one. Absent: the server offers no choice Helena knows how to list.
  voices?(context: ModelServerContext): Promise<string[]>;
  // Where its key comes from when installed the standard way: `none` for a server without one
  // (Halogen: loopback, guarded by the firewall). Absent: the installer's key file.
  defaultKeySource?: 'file' | 'none';
  // Whether the Administrator sets what its chat models can do (ModelServerOptions
  // .capabilities): true for servers whose API does not say.
  capabilitiesConfigurable?: boolean;
  // The token id of each text that is exactly one token of its model's tokenizer, else null.
  // For servers that take `logit_bias` by token id only (the typed decisions' letters).
  // Absent: the server takes the text itself as a `logit_bias` key (llama.cpp, Lemonade).
  tokenIds?(context: ModelServerContext, texts: string[]): Promise<(number | null)[]>;
}

export interface ModelServerAudio {
  // `/audio/transcriptions` takes `prompt` (the words the recording is likely to contain),
  // `temperature` and `response_format: verbose_json` with each segment's confidence.
  transcriptionContext: boolean;
  // `/audio/speech` streams raw 16-bit PCM as it is generated (`response_format: pcm`), at
  // this sample rate (mono); null: it answers a whole WAV file only.
  speechPcmRate: number | null;
  // `/audio/speech` takes `language` (the name its model knows, e.g. "German").
  speechLanguage: boolean;
}

// ── The policy ─────────────────────────────────────────────────────────────────────────

// `off`: the configured model, as today. `prefer`: local first, the configured model when
// local is off, down, too slow or its answer is unusable. `only`: local or nothing (for work
// that must not leave the machine; it waits while local is down).
export type LocalAiMode = 'off' | 'prefer' | 'only';

export const LOCAL_AI_MODES: readonly LocalAiMode[] = ['off', 'prefer', 'only'];

// How urgent a class's work is when units are shared: a person waiting, a browser step, the
// background, the nightly batch.
export type LocalAiPriority = 'interactive' | 'browser' | 'background' | 'batch';

export const LOCAL_AI_PRIORITIES: readonly LocalAiPriority[] = [
  'interactive',
  'browser',
  'background',
  'batch',
];

// How much a local model may think before it answers, per kind of work. A reasoning model
// (Qwen3.x) spends a small `max_tokens` on its reasoning and then answers nothing: background
// work that only summarises, compresses or picks an option does better without (measured on
// Kingston: the same summary 48 instead of 430 tokens, the JSON right, ~9× faster).
// `off`: `chat_template_kwargs.enable_thinking = false`; a level switches thinking on and gives
// the template the level (templates with effort levels read `reasoning_effort`; Qwen3 has
// none). llama-server merges the request's kwargs over its own defaults, and Lemonade passes
// them through; a top-level `enable_thinking` is not used (Lemonade turns it into a prompt
// prefix).
export type LocalAiThinking = 'off' | 'low' | 'medium' | 'high';

export const LOCAL_AI_THINKING: readonly LocalAiThinking[] = ['off', 'low', 'medium', 'high'];

// The request fields for a level of thinking, for any chat-completions call Helena makes to a
// local server (the evals, a feature's own calls).
export function localThinkingFields(thinking: LocalAiThinking): {
  chat_template_kwargs: { enable_thinking: boolean; reasoning_effort?: string };
} {
  return thinking === 'off'
    ? { chat_template_kwargs: { enable_thinking: false } }
    : { chat_template_kwargs: { enable_thinking: true, reasoning_effort: thinking } };
}

// One chat-completions call of an eval. The answer's text and tool calls, as the server
// returned them.
export interface LocalAiChatRequest {
  system?: string;
  prompt: string;
  tools?: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  }[];
  maxTokens?: number;
  // Ask for a JSON object (response_format json_object).
  json?: boolean;
  // Another level of thinking than the class's, for this call.
  thinking?: LocalAiThinking;
}

export interface LocalAiChatAnswer {
  text: string;
  toolCalls: { name: string; arguments: string }[];
  inputTokens: number | null;
  outputTokens: number | null;
  latencyMs: number;
  // Why the answer ended (`stop`, `tool_calls`, `length` when `maxTokens` cut it off), where
  // the server said.
  finishReason?: string | null;
}

export interface LocalAiEvalContext {
  // The model under test (its id on the server).
  model: string;
  signal?: AbortSignal;
  chat(request: LocalAiChatRequest): Promise<LocalAiChatAnswer>;
  judge?(request: LocalAiChatRequest): Promise<LocalAiChatAnswer>;
  runSkillLearning?(): Promise<LocalAiEvalResult>;
  runSkillUsage?(): Promise<LocalAiEvalResult>;
  runCodingTask?(id: string): Promise<{
    testsPassed: boolean;
    validToolCalls: number;
    toolCalls: number;
    loops: number;
    aborted: boolean;
    durationMs: number;
    inputTokens: number;
    outputTokens: number;
  }>;
  embed(texts: string[]): Promise<{ vectors: number[][]; latencyMs: number }>;
}

export interface LocalAiEvalCaseResult {
  id: string;
  passed: boolean;
  // A short English note on a failed case (what was expected, what came back, clipped).
  detail?: string | null;
  latencyMs?: number | null;
}

export interface LocalAiEvalResult {
  // 0–1.
  score: number;
  cases: LocalAiEvalCaseResult[];
  latencyMsP50: number | null;
  // Output tokens per second over the whole eval, where the server counted tokens.
  tokensPerSecond: number | null;
}

// A kind of work local AI may take (registry `localAiTaskClasses`).
export interface LocalAiTaskClass {
  id: string;
  label: LocalizedText;
  // What the class does locally, one sentence.
  description?: LocalizedText;
  // The unit it runs on by default, and what its model must be able to do.
  unit: LocalAiUnit;
  capability: LocalModelCapability;
  priority: LocalAiPriority;
  // How much its model may think (chat classes). Absent: `off`, the right choice for work
  // that only summarises, compresses or classifies; its eval runs with the same setting.
  thinking?: LocalAiThinking;
  // Shown as "Experimentell"; never part of the master switch's default set.
  experimental?: boolean;
  // On when the owner first turns the master switch on.
  inMasterDefault: boolean;
  // Whether something in Helena already sends this work to local AI; a planned class is
  // listed so the owner sees the plan, and cannot be switched on yet.
  wired: boolean;
  // The eval a model has to pass for this class before its mode may leave `off`, and the
  // score it needs.
  evaluate?(context: LocalAiEvalContext): Promise<LocalAiEvalResult>;
  threshold?: number;
  // The version of the eval (1 when absent). A class that changes what its eval measures
  // raises it: an eval of an older version no longer counts, so the class stays off (or
  // stops routing) until its model passed the new one.
  evalVersion?: number;
  // The modes the class offers (all three when absent). Work that runs as an agent's turn
  // cannot promise `only`: the turn keeps the agent's configured model as its fallback.
  modes?: readonly LocalAiMode[];
}

// The modes a class offers, in the order of LOCAL_AI_MODES; `off` always.
export function classModes(entry: Pick<LocalAiTaskClass, 'modes'>): readonly LocalAiMode[] {
  if (!entry.modes || entry.modes.length === 0) return LOCAL_AI_MODES;
  return LOCAL_AI_MODES.filter((mode) => mode === 'off' || entry.modes!.includes(mode));
}

// The version of a class's eval.
export function classEvalVersion(entry: Pick<LocalAiTaskClass, 'evalVersion'>): number {
  return entry.evalVersion && entry.evalVersion > 0 ? Math.trunc(entry.evalVersion) : 1;
}

// ── Model ids ──────────────────────────────────────────────────────────────────────────

// Helena names a local model `<provider>/<model>`, the provider being the server's Hermes
// provider name `helena-<slug>`: `helena-local/Qwen3.6-35B-A3B-GGUF`. So a local model can
// never be mistaken for a subscription model of the same name, and the runner knows where
// to send it without asking.
export const LOCAL_PROVIDER_PREFIX = 'helena-';

const SLUG = /^[a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])?$/;

// No `--` in a slug: the provider of a server's turns without thinking is `helena-<slug>--nothink`
// (localProviderWithoutThinking), which must never be another server's.
export function isModelServerSlug(value: string): boolean {
  return SLUG.test(value) && !value.includes('--');
}

export const LOCAL_NO_THINKING_SUFFIX = '--nothink';

// The provider of a local server's agent turns that do not think (RuntimeModelServer
// `noThinkingBaseUrl`): the runner starts a run whose reasoning is `none` there.
export function localProviderWithoutThinking(provider: string): string {
  return provider.endsWith(LOCAL_NO_THINKING_SUFFIX)
    ? provider
    : `${provider}${LOCAL_NO_THINKING_SUFFIX}`;
}

export function localProviderName(slug: string): string {
  return `${LOCAL_PROVIDER_PREFIX}${slug}`;
}

export function localModelId(slug: string, model: string): string {
  return `${localProviderName(slug)}/${model}`;
}

const LOCAL_ID = /^(helena-[a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])?)\/(.+)$/;

// The provider and the server's own model id of a Helena local model id; null for any other.
export function parseLocalModelId(
  value: string | null | undefined,
): { provider: string; slug: string; model: string } | null {
  const match = LOCAL_ID.exec(value?.trim() ?? '');
  if (!match) return null;
  return {
    provider: match[1]!,
    slug: match[1]!.slice(LOCAL_PROVIDER_PREFIX.length),
    model: match[2]!,
  };
}

// Whether a provider name, as a runtime reports it, is one of Helena's local servers. Hermes
// reports a named provider as `custom:<name>` in some places.
export function isLocalProvider(provider: string | null | undefined): boolean {
  const name = (provider ?? '')
    .trim()
    .toLowerCase()
    .replace(/^custom:/, '');
  return (
    name.startsWith(LOCAL_PROVIDER_PREFIX) && SLUG.test(name.slice(LOCAL_PROVIDER_PREFIX.length))
  );
}

// ── Checking what a server answered ────────────────────────────────────────────────────

const MODEL_ID = /^[A-Za-z0-9][A-Za-z0-9._:+@/-]{0,199}$/;

function positiveInt(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.round(value)
    : null;
}

// A model as Helena keeps it, or null when it is unusable. Everything a server type hands
// over passes through here, a plugin's included.
export function normalizeLocalModel(value: unknown): LocalModel | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  const id = typeof raw.id === 'string' ? raw.id.trim() : '';
  if (!MODEL_ID.test(id)) return null;
  const name = typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim().slice(0, 200) : id;
  const unit =
    typeof raw.unit === 'string' && (LOCAL_AI_UNITS as readonly string[]).includes(raw.unit)
      ? (raw.unit as LocalAiUnit)
      : null;
  const capabilities = Array.isArray(raw.capabilities)
    ? [
        ...new Set(
          raw.capabilities.filter((entry): entry is LocalModelCapability =>
            (LOCAL_MODEL_CAPABILITIES as readonly unknown[]).includes(entry),
          ),
        ),
      ]
    : [];
  return {
    id,
    name,
    unit,
    capabilities,
    contextLength: positiveInt(raw.contextLength),
    sizeBytes: positiveInt(raw.sizeBytes),
    downloaded: typeof raw.downloaded === 'boolean' ? raw.downloaded : null,
    loaded: raw.loaded === true,
    backend:
      typeof raw.backend === 'string' && raw.backend.trim()
        ? raw.backend.trim().slice(0, 40)
        : null,
    checkpoint:
      typeof raw.checkpoint === 'string' && /^[\w.-]+\/[\w.-]+(:[\w.,+-]+)?$/.test(raw.checkpoint)
        ? raw.checkpoint
        : null,
  };
}

// The middle value of a list of latencies, or null for none.
export function median(values: number[]): number | null {
  const sorted = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

// ── What a runner gets ─────────────────────────────────────────────────────────────────

// A local model server as an agent's runtime reaches it (the runtime policy snapshot's
// `localAi`). Hermes gets it as a named provider (`providers.<provider>` with `key_env`).
export interface RuntimeModelServer {
  // `helena-<slug>`, the provider name every model id of the server starts with.
  provider: string;
  // The OpenAI-compatible base (…/v1). Loopback on the machine itself; an isolated agent
  // reaches the same address through its unit's forwarder.
  baseUrl: string;
  // The variable the key reaches the runtime in; null for a server without one.
  keyEnv: string | null;
  contextLength: number;
  models: { id: string; contextLength: number | null; vision: boolean }[];
  // The server's second address (ModelServerType.noThinkingBaseUrl): the runner writes a
  // second provider there, `localProviderWithoutThinking(provider)`, whose turns do not think.
  // Absent on a server without one, and from an older API.
  noThinkingBaseUrl?: string | null;
}

export type HermesHelperTask = 'compression' | 'vision';

// Local AI as the runner writes it into an agent's profile. Absent while local AI is off:
// then nothing local is in any profile.
export interface RuntimeLocalAi {
  servers: RuntimeModelServer[];
  // Hermes' helper calls that try a local model first (auxiliary.<task>); the main model
  // answers when it fails.
  helpers: { task: HermesHelperTask; provider: string; model: string }[];
}
