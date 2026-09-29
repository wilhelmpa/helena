import { readFile, readdir, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { singleTokenIds } from '@helena/decisions';
import {
  normalizeLocalModel,
  type LocalAiUnit,
  type LocalModel,
  type LocalModelCapability,
  type ModelServerContext,
  type ModelServerLoad,
  type ModelServerStatus,
  type ModelServerType,
} from '@helena/sdk';

// The built-in model server types (@helena/sdk ModelServerType). Both list models from the
// OpenAI-compatible `GET /models`; Lemonade adds what its own API says about each model (the
// engine that serves it, what it can do, whether it is downloaded and loaded).
// Decision: docs/helena-decisions/local-ai-platform.md §4.

export const OPENAI_COMPATIBLE = 'openai-compatible';
export const LEMONADE = 'lemonade';

// Lemonade on the machine itself, as native/local-ai/install.sh sets it up.
export const LEMONADE_DEFAULT_BASE_URL = 'http://127.0.0.1:13305/api/v1';

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function number(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

async function json(response: Response): Promise<unknown> {
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

// `{ data: [...] }` as OpenAI answers, or a bare array.
function entries(body: unknown): Record<string, unknown>[] {
  const data =
    body && typeof body === 'object' && !Array.isArray(body)
      ? (body as { data?: unknown }).data
      : body;
  return list(data).filter(
    (entry): entry is Record<string, unknown> => !!entry && typeof entry === 'object',
  );
}

// What a model can do, from Lemonade's labels (`tool-calling`, `reasoning`, `vision`,
// `embeddings`, `reranking`, `audio`/`transcription`, `tts`).
export function capabilitiesOf(labels: unknown[], id: string): LocalModelCapability[] {
  const set = new Set<LocalModelCapability>();
  const words = labels.map((label) => String(label).toLowerCase());
  const has = (...names: string[]) => names.some((name) => words.includes(name));
  if (has('embeddings', 'embedding')) set.add('embeddings');
  else if (has('reranking', 'reranker')) set.add('reranking');
  else if (has('transcription', 'audio', 'asr', 'whisper') || /whisper/i.test(id))
    set.add('transcription');
  else if (has('tts', 'speech')) set.add('speech');
  else {
    set.add('chat');
    if (has('tool-calling', 'tools', 'tool_calling')) set.add('tools');
    if (has('reasoning', 'thinking')) set.add('reasoning');
    if (has('vision', 'multimodal')) set.add('vision');
  }
  return [...set];
}

// The unit an engine runs on: FastFlowLM is the NPU; llama.cpp, vLLM and the like the GPU;
// anything that says CPU the CPU.
export function unitOf(backend: string | null, device: string | null): LocalAiUnit | null {
  const where = `${device ?? ''} ${backend ?? ''}`.toLowerCase();
  if (/\bnpu\b|flm|fastflow|oga-npu|hybrid/.test(where)) return 'npu';
  if (/\bcpu\b/.test(where) && !/gpu|vulkan|rocm/.test(where)) return 'cpu';
  if (/gpu|vulkan|rocm|llamacpp|llama\.cpp|vllm|igpu/.test(where)) return 'gpu';
  return null;
}

// What a model of a plain OpenAI-compatible server can do, from its id alone: such servers list
// no labels. Speech servers (whisper.cpp's, Speaches, a Piper or Kokoro server) name their models
// after the engine.
export function capabilitiesFromId(id: string): LocalModelCapability[] {
  if (/embed/i.test(id)) return ['embeddings'];
  if (/whisper|parakeet|transcri|(^|[^a-z])(asr|stt)([^a-z]|$)/i.test(id)) return ['transcription'];
  if (/kokoro|piper|(^|[^a-z])tts([^a-z]|$)|text-to-speech/i.test(id)) return ['speech'];
  return ['chat'];
}

function openAiModels(body: unknown): LocalModel[] {
  return entries(body)
    .map((entry) => {
      const id = text(entry.id);
      return normalizeLocalModel({
        id,
        name: id,
        unit: null,
        capabilities: capabilitiesFromId(id ?? ''),
        contextLength: number(entry.context_length) ?? number(entry.max_model_len),
        loaded: false,
      });
    })
    .filter((model): model is LocalModel => model !== null);
}

export const openAiCompatibleServer: ModelServerType = {
  id: OPENAI_COMPATIBLE,
  label: { i18n: 'localAi.serverTypes.openaiCompatible' },
  // Such a server lists ids only: what its chat models can do is the Administrator's to say.
  capabilitiesConfigurable: true,
  async models(context) {
    return openAiModels(await json(await context.fetch('/models')));
  },
  async status(context) {
    const started = Date.now();
    try {
      const models = openAiModels(await json(await context.fetch('/models')));
      return {
        reachable: true,
        version: null,
        latencyMs: Date.now() - started,
        error: null,
        loaded: models
          .filter((model) => model.loaded)
          .map(({ id }) => ({
            id,
            unit: null,
            backend: null,
          })),
      };
    } catch (error) {
      return unreachable(error);
    }
  },
};

export const fastFlowLmServer: ModelServerType = {
  ...openAiCompatibleServer,
  id: 'fastflowlm',
  label: { en: 'FastFlowLM (NPU)', de: 'FastFlowLM (NPU)' },
  capabilitiesConfigurable: false,
  async status(context) {
    const started = Date.now();
    try {
      const models = await fastFlowLmServer.models(context);
      return {
        reachable: true,
        version: null,
        latencyMs: Date.now() - started,
        error: null,
        loaded: models.map(({ id, unit, backend }) => ({ id, unit, backend })),
      };
    } catch (error) {
      return unreachable(error);
    }
  },
  async models(context) {
    return openAiModels(await json(await context.fetch('/models'))).map((model) => ({
      ...model,
      unit: 'npu' as const,
      backend: 'fastflowlm',
      downloaded: true,
      loaded: true,
      capabilities:
        model.id === 'embed-gemma:300m'
          ? ['embeddings' as const]
          : ['chat' as const, 'tools' as const],
    }));
  },
};

function unreachable(error: unknown): ModelServerStatus {
  const message = error instanceof Error ? error.message : String(error);
  return {
    reachable: false,
    version: null,
    // How long it took to fail is no answer time.
    latencyMs: null,
    // The fetch's own words, short; never a URL with credentials (the key is a header).
    error: message.slice(0, 200),
    loaded: [],
  };
}

// ── Lemonade ───────────────────────────────────────────────────────────────────────────

// One entry of Lemonade's `GET /models` (with `show_all`): the OpenAI fields plus its own.
export function lemonadeModel(
  entry: Record<string, unknown>,
  loaded: Set<string>,
): LocalModel | null {
  const id = text(entry.id);
  if (!id) return null;
  const recipe = text(entry.recipe);
  const labels = list(entry.labels);
  const size = number(entry.size);
  return normalizeLocalModel({
    id,
    name: id,
    unit: unitOf(recipe, text(entry.device)),
    capabilities: capabilitiesOf(labels, id),
    contextLength:
      number(entry.context_length) ?? number(entry.max_context_window) ?? number(entry.ctx_size),
    // Lemonade gives the size in GB.
    sizeBytes: size === null ? null : size < 10_000 ? Math.round(size * 1_000_000_000) : size,
    downloaded: typeof entry.downloaded === 'boolean' ? entry.downloaded : null,
    loaded: loaded.has(id),
    backend: recipe,
    checkpoint: text(entry.checkpoint),
  });
}

// Lemonade's `GET /health`: `all_models_loaded` names each model in memory with the engine
// (`recipe`) and the device it runs on.
export function lemonadeLoaded(health: unknown): ModelServerStatus['loaded'] {
  const body = (health && typeof health === 'object' ? health : {}) as Record<string, unknown>;
  const all = list(body.all_models_loaded);
  const loaded = all
    .map((entry) => {
      const item = (entry && typeof entry === 'object' ? entry : {}) as Record<string, unknown>;
      const id = text(item.model_name) ?? text(item.id);
      if (!id) return null;
      const backend = text(item.recipe);
      return { id, unit: unitOf(backend, text(item.device)), backend };
    })
    .filter((entry): entry is ModelServerStatus['loaded'][number] => entry !== null);
  const single = text(body.model_loaded);
  if (single && !loaded.some((entry) => entry.id === single)) {
    loaded.push({ id: single, unit: null, backend: null });
  }
  return loaded;
}

// Lemonade's `GET /system-stats`: how busy CPU, GPU and NPU are, and the memory in use.
export function lemonadeLoad(stats: unknown): ModelServerLoad | null {
  if (!stats || typeof stats !== 'object') return null;
  const body = stats as Record<string, unknown>;
  const load = {
    gpuPercent: number(body.gpu_percent),
    npuPercent: number(body.npu_percent),
    cpuPercent: number(body.cpu_percent),
    vramGb: number(body.vram_gb),
    memoryGb: number(body.memory_gb),
  };
  return Object.values(load).some((value) => value !== null) ? load : null;
}

// Lemonade serves its OpenAI-compatible API under /api/v1 and /v1 alike (its server registers
// every route under both); the other one of the two is the address of the turns without
// thinking (ModelServerType.noThinkingBaseUrl).
export function lemonadeNoThinkingBaseUrl(baseUrl: string): string | null {
  const base = baseUrl.replace(/\/+$/, '');
  if (/\/api\/v1$/.test(base)) return base.replace(/\/api\/v1$/, '/v1');
  if (/\/v1$/.test(base)) return base.replace(/\/v1$/, '/api/v1');
  return null;
}

// Lemonade 2026.39.1 documents only `file`, `model`, `language` and `response_format` for its
// transcriptions (FastFlowLM's Whisper answers the compact shape and ignores `language`), and
// buffered WAV or streamed PCM for speech (streaming is OpenMOSS-only, at its own rate).
const LEMONADE_AUDIO = {
  transcriptionContext: false,
  speechPcmRate: null,
  speechLanguage: false,
} as const;

export const lemonadeServer: ModelServerType = {
  id: LEMONADE,
  label: { i18n: 'localAi.serverTypes.lemonade' },
  defaultBaseUrl: LEMONADE_DEFAULT_BASE_URL,
  noThinkingBaseUrl: lemonadeNoThinkingBaseUrl,
  audio: LEMONADE_AUDIO,
  async models(context) {
    const [models, health] = await Promise.all([
      context.fetch('/models?show_all=true').then(json),
      context
        .fetch('/health')
        .then(json)
        .catch(() => null),
    ]);
    const loaded = new Set(lemonadeLoaded(health).map((entry) => entry.id));
    return entries(models)
      .map((entry) => lemonadeModel(entry, loaded))
      .filter((model): model is LocalModel => model !== null);
  },
  async status(context) {
    const started = Date.now();
    try {
      const health = await json(await context.fetch('/health'));
      const latencyMs = Date.now() - started;
      const body = (health && typeof health === 'object' ? health : {}) as Record<string, unknown>;
      const stats = await context
        .fetch('/system-stats')
        .then(json)
        .catch(() => null);
      return {
        reachable: true,
        version: text(body.version),
        latencyMs,
        error: null,
        loaded: lemonadeLoaded(health),
        load: lemonadeLoad(stats),
      };
    } catch (error) {
      return unreachable(error);
    }
  },
};

// ── Halogen ───────────────────────────────────────────────────────────────────────────

export const HALOGEN = 'halogen';
// native/halogen/install.sh publishes the API on the loopback twice: 8731, and 8733 for the
// agent turns that must not think (Hermes finds a provider's `extra_body` by its address).
export const HALOGEN_PORT = 8731;
export const HALOGEN_QUIET_PORT = 8733;
export const HALOGEN_DEFAULT_BASE_URL = `http://127.0.0.1:${HALOGEN_PORT}/v1`;
// Where the installer puts the tokenizer (files.tsv): the decisions' letters need token ids.
export const HALOGEN_DEFAULT_TOKENIZER = '/var/lib/helena-halogen/models/tokenizer/vocab.json';
// The unit's cgroup: with `--cgroups=split` the container's memory is the unit's.
export const HALOGEN_CGROUP = '/sys/fs/cgroup/system.slice/helena-halogen.service';

// The same API at its second port, where the base is Halogen's own port on this machine.
export function halogenNoThinkingBaseUrl(baseUrl: string): string | null {
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    return null;
  }
  if (url.port !== String(HALOGEN_PORT)) return null;
  url.port = String(HALOGEN_QUIET_PORT);
  return url.toString().replace(/\/+$/, '');
}

// Halogen's `GET /health` (the server's own description of itself): what it can do.
export function halogenCapabilities(health: Record<string, unknown>): LocalModelCapability[] {
  const set: LocalModelCapability[] = ['chat'];
  const tools = health.tool_calls;
  const supported = list(health.supported).map(String);
  if ((tools && typeof tools === 'object') || supported.includes('tools')) set.push('tools');
  const template = (health.chat_template ?? {}) as Record<string, unknown>;
  if (template.thinking_control === true || supported.includes('reasoning_effort'))
    set.push('reasoning');
  const vision = (health.vision ?? {}) as Record<string, unknown>;
  if (vision.enabled === true) set.push('vision');
  return set;
}

// Prometheus text: `name value` lines (no labels on Halogen's).
export function prometheusValues(text: string): Record<string, number> {
  const values: Record<string, number> = {};
  for (const line of text.split('\n')) {
    const match = /^([A-Za-z_:][\w:]*)\s+(-?[\d.eE+-]+)\s*$/.exec(line.trim());
    if (match) values[match[1]!] = Number(match[2]);
  }
  return values;
}

function rate(tokens: number | undefined, seconds: number | undefined): number | null {
  return tokens && seconds && seconds > 0 ? Math.round((tokens / seconds) * 10) / 10 : null;
}

// How busy Halogen is: from /health (slots, requests in flight, waiting) and /metrics (the
// average answer and prompt speed since it started, the KV cache in use).
export function halogenLoad(
  health: Record<string, unknown>,
  metrics: Record<string, number>,
  memoryBytes: number | null,
  gpuPercent: number | null,
): ModelServerLoad {
  const kv = metrics['llamacpp:kv_cache_usage_ratio'];
  return {
    gpuPercent,
    npuPercent: null,
    cpuPercent: null,
    vramGb: null,
    // Under 1 GB the container is not in the unit's cgroup (a unit without --cgroups=split):
    // the unit's own memory would read as Halogen's.
    memoryGb: memoryBytes === null || memoryBytes < 1e9 ? null : Math.round(memoryBytes / 1e8) / 10,
    outputTokensPerSecond: rate(
      metrics['llamacpp:tokens_predicted_total'],
      metrics['llamacpp:tokens_predicted_seconds_total'],
    ),
    promptTokensPerSecond: rate(
      metrics['llamacpp:prompt_tokens_total'],
      metrics['llamacpp:prompt_seconds_total'],
    ),
    slots: number(health.slots),
    busySlots: number(health.in_flight),
    queued: number(health.queued),
    kvUsagePercent: kv === undefined ? null : Math.round(kv * 1000) / 10,
  };
}

async function readBytes(path: string): Promise<number | null> {
  try {
    const value = Number((await readFile(path, 'utf8')).trim());
    return Number.isFinite(value) && value > 0 ? value : null;
  } catch {
    return null;
  }
}

// The GPU's busy percentage (amdgpu, world-readable): Halogen is what keeps it busy.
async function gpuBusy(root = '/sys/class/drm'): Promise<number | null> {
  try {
    for (const card of (await readdir(root)).filter((name) => /^card\d+$/.test(name))) {
      const value = await readBytes(`${root}/${card}/device/gpu_busy_percent`);
      if (value !== null) return value;
    }
  } catch {
    // No GPU counters here.
  }
  return null;
}

function isLoopback(baseUrl: string): boolean {
  try {
    const host = new URL(baseUrl).hostname;
    return host === '127.0.0.1' || host === 'localhost' || host === '[::1]';
  } catch {
    return false;
  }
}

// A tokenizer file Helena may read: a `.json` below /var/lib, no `..`.
export function allowedTokenizerFile(path: string | null | undefined): string | null {
  if (!path) return null;
  const full = resolve(path);
  return full === path && full.startsWith('/var/lib/') && full.endsWith('.json') ? full : null;
}

const vocabularies = new Map<string, { mtimeMs: number; vocab: Record<string, unknown> }>();

// The vocabulary of a tokenizer file, read once while it is unchanged (6.7 MB for Qwen3.8).
export async function readVocabulary(path: string): Promise<Record<string, unknown>> {
  const file = allowedTokenizerFile(path);
  if (!file) throw new Error('The tokenizer file must be a .json below /var/lib');
  const info = await stat(file);
  const cached = vocabularies.get(file);
  if (cached && cached.mtimeMs === info.mtimeMs) return cached.vocab;
  if (info.size > 64 * 1024 * 1024) throw new Error('The tokenizer file is too large');
  const vocab = JSON.parse(await readFile(file, 'utf8')) as Record<string, unknown>;
  if (!vocab || typeof vocab !== 'object' || Array.isArray(vocab))
    throw new Error('The tokenizer file is not a vocabulary');
  vocabularies.set(file, { mtimeMs: info.mtimeMs, vocab });
  return vocab;
}

// Halogen's /health probes its engine, and while the engine is deep in a long prompt it may
// answer only after seconds: its description is asked briefly and is optional. Whether the
// server answers at all is what /v1/models says (at once, busy or not).
export const HALOGEN_HEALTH_WAIT_MS = 1_500;

async function halogenHealth(
  context: ModelServerContext,
  waitMs = HALOGEN_HEALTH_WAIT_MS,
): Promise<Record<string, unknown> | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), waitMs);
  });
  const asked = context
    .fetch('//health')
    .then(json)
    .then((body) => (body && typeof body === 'object' ? (body as Record<string, unknown>) : {}))
    .catch(() => null);
  try {
    return await Promise.race([asked, late]);
  } finally {
    clearTimeout(timer);
  }
}

// What Halogen serves whatever its /health says: chat, tools (qwen-xml tool calls) and thinking
// control. Vision only when /health says its tower is loaded.
const HALOGEN_BASE_CAPABILITIES: LocalModelCapability[] = ['chat', 'tools', 'reasoning'];

// Halogen (peonist-ai; native/halogen/install.sh): one model, OpenAI-compatible under /v1, no
// key (the firewall lets only Helena's users reach it), `GET /health` describing what it serves
// and can do, Prometheus `GET /metrics`. `logit_bias` by token id only, like OpenAI's API.
export const halogenServer: ModelServerType = {
  id: HALOGEN,
  label: { i18n: 'localAi.serverTypes.halogen' },
  defaultBaseUrl: HALOGEN_DEFAULT_BASE_URL,
  noThinkingBaseUrl: halogenNoThinkingBaseUrl,
  defaultKeySource: 'none',
  capabilitiesConfigurable: true,
  async models(context) {
    const [listed, health] = await Promise.all([
      context.fetch('/models').then(json),
      halogenHealth(context),
    ]);
    // Listed means served; a /health that says otherwise (loading) wins.
    const up = health === null || health.status === 'ok';
    const capabilities = health ? halogenCapabilities(health) : HALOGEN_BASE_CAPABILITIES;
    return entries(listed)
      .map((entry) => {
        const id = text(entry.id);
        return normalizeLocalModel({
          id,
          name: id,
          // Halogen runs on the GPU (ROCm); it serves no other device.
          unit: 'gpu',
          capabilities,
          contextLength: number(entry.context_length) ?? number(health?.slot_ctx),
          loaded: up,
          backend: 'halogen',
        });
      })
      .filter((model): model is LocalModel => model !== null);
  },
  async status(context) {
    const started = Date.now();
    try {
      const listed = entries(await json(await context.fetch('/models')));
      const latencyMs = Date.now() - started;
      const health = await halogenHealth(context);
      if (health && health.status !== 'ok')
        throw new Error(`status ${String(health.status ?? 'unknown')}`);
      const metrics = await context
        .fetch('//metrics')
        .then((response) => (response.ok ? response.text() : ''))
        .then(prometheusValues)
        .catch(() => ({}));
      const local = isLoopback(context.baseUrl);
      const [memory, gpu] = local
        ? await Promise.all([readBytes(`${HALOGEN_CGROUP}/memory.current`), gpuBusy()])
        : [null, null];
      const version = (health?.version ?? {}) as Record<string, unknown>;
      const models = health?.model ? [text(health.model)] : listed.map((entry) => text(entry.id));
      return {
        reachable: true,
        // Unknown while /health is slow (the engine is busy); the last check's stays shown.
        version: text(version.engine) ?? text(version.api),
        latencyMs,
        error: null,
        loaded: models
          .filter((id): id is string => id !== null)
          .map((id) => ({ id, unit: 'gpu' as const, backend: 'halogen' })),
        load: halogenLoad(health ?? {}, metrics, memory, gpu),
      };
    } catch (error) {
      return unreachable(error);
    }
  },
  async tokenIds(context, texts) {
    const file = context.options?.tokenizerFile ?? HALOGEN_DEFAULT_TOKENIZER;
    return singleTokenIds(await readVocabulary(file), texts);
  },
};

// ── whisper.cpp's whisper-server ──────────────────────────────────────────────────────────

export const WHISPER_CPP = 'whisper-cpp';

// Helena's voice on the GPU (native/local-ai/voice.sh) runs it at 127.0.0.1:13306 with
// `--request-path /v1 --inference-path /audio/transcriptions`, so it answers the OpenAI path.
export const WHISPER_CPP_DEFAULT_BASE_URL = 'http://127.0.0.1:13306/v1';

// The one model a whisper-server holds (it lists none): Helena calls it `whisper`; which
// weights it loaded is the installer's (voice.sh, models.tsv).
export const WHISPER_CPP_MODEL = 'whisper';

async function voiceUnit(
  context: ModelServerContext,
  service: 'stt' | 'tts',
): Promise<LocalAiUnit> {
  const port = service === 'stt' ? 13306 : 13307;
  if (!new RegExp(`^http://(?:127\\.0\\.0\\.1|localhost):${port}(?:/|$)`).test(context.baseUrl))
    return 'gpu';
  try {
    const unit = await readFile(`/etc/systemd/system/helena-voice-${service}.service`, 'utf8');
    return /^ExecStart=.*-cpu\//m.test(unit) ? 'cpu' : 'gpu';
  } catch {
    return 'gpu';
  }
}

// whisper.cpp's own server (MIT, ggml-org/whisper.cpp examples/server): one model, loaded at
// start, `GET /health`, and the OpenAI transcription fields including `prompt`, `temperature`
// and `verbose_json` with each segment's confidence. No key of its own: it listens on loopback
// and the firewall lets only Helena's API reach it (voice.sh).
export const whisperCppServer: ModelServerType = {
  id: WHISPER_CPP,
  label: { i18n: 'localAi.serverTypes.whisperCpp' },
  defaultBaseUrl: WHISPER_CPP_DEFAULT_BASE_URL,
  audio: { transcriptionContext: true, speechPcmRate: null, speechLanguage: false },
  async models(context) {
    const unit = await voiceUnit(context, 'stt');
    const up = await context
      .fetch('/health')
      .then((response) => response.ok)
      .catch(() => false);
    const model = normalizeLocalModel({
      id: WHISPER_CPP_MODEL,
      name: 'Whisper (whisper.cpp)',
      // voice.sh builds it for the GPU (HIP); a CPU build would say so in its server's name.
      unit,
      capabilities: ['transcription'],
      contextLength: null,
      loaded: up,
    });
    return model ? [model] : [];
  },
  async status(context) {
    const started = Date.now();
    try {
      const unit = await voiceUnit(context, 'stt');
      const response = await context.fetch('/health');
      // 503 while the model loads: reachable, not ready.
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return {
        reachable: true,
        version: null,
        latencyMs: Date.now() - started,
        error: null,
        loaded: [{ id: WHISPER_CPP_MODEL, unit, backend: 'whisper.cpp' }],
      };
    } catch (error) {
      return unreachable(error);
    }
  },
};

// ── qwentts.cpp's tts-server ─────────────────────────────────────────────────────────────

export const QWEN_TTS = 'qwentts-cpp';
export const QWEN_TTS_DEFAULT_BASE_URL = 'http://127.0.0.1:13307/v1';

// qwentts.cpp's OpenAI-compatible server (MIT; Qwen3-TTS weights Apache-2.0): one model resident
// on the GPU, `GET /v1/models`, `GET /health`, `/v1/audio/speech` streaming 16-bit PCM at 24 kHz
// as it is generated (or a WAV file), `language` per request, and a registry of voices
// (`GET /v1/audio/voices`: the model's own speakers plus the cloned ones voice.sh registers).
// No key of its own: loopback, and the firewall lets only Helena's API reach it.
export const qwenTtsServer: ModelServerType = {
  id: QWEN_TTS,
  label: { i18n: 'localAi.serverTypes.qwenTts' },
  defaultBaseUrl: QWEN_TTS_DEFAULT_BASE_URL,
  audio: { transcriptionContext: false, speechPcmRate: 24_000, speechLanguage: true },
  async models(context) {
    const unit = await voiceUnit(context, 'tts');
    return openAiModels(await json(await context.fetch('/models'))).map((model) => ({
      ...model,
      unit,
      capabilities: ['speech' as const],
      loaded: true,
    }));
  },
  async status(context) {
    const started = Date.now();
    try {
      const unit = await voiceUnit(context, 'tts');
      const models = openAiModels(await json(await context.fetch('/models')));
      return {
        reachable: true,
        version: null,
        latencyMs: Date.now() - started,
        error: null,
        loaded: models.map(({ id }) => ({ id, unit, backend: 'qwentts.cpp' })),
      };
    } catch (error) {
      return unreachable(error);
    }
  },
  async voices(context) {
    const body = await json(await context.fetch('/audio/voices'));
    return voiceNames(body);
  },
};

// `GET /audio/voices`: `{ voices: [...] }` or `{ data: [...] }`, each a name or `{ name | id }`.
export function voiceNames(body: unknown): string[] {
  const value = body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
  const items = list(value.voices ?? value.data ?? body);
  const names = items.flatMap((item) => {
    if (typeof item === 'string') return [item];
    if (item && typeof item === 'object') {
      const entry = item as Record<string, unknown>;
      const name = text(entry.name) ?? text(entry.id) ?? text(entry.voice);
      return name ? [name] : [];
    }
    return [];
  });
  return [...new Set(names)].slice(0, 100);
}

export const BUILTIN_MODEL_SERVERS: ModelServerType[] = [
  lemonadeServer,
  halogenServer,
  openAiCompatibleServer,
  fastFlowLmServer,
  whisperCppServer,
  qwenTtsServer,
];

export type { ModelServerContext };
