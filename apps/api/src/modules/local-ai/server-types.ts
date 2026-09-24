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

function openAiModels(body: unknown): LocalModel[] {
  return entries(body)
    .map((entry) => {
      const id = text(entry.id);
      return normalizeLocalModel({
        id,
        name: id,
        unit: null,
        capabilities: /embed/i.test(id ?? '') ? ['embeddings'] : ['chat'],
        contextLength: number(entry.context_length) ?? number(entry.max_model_len),
        loaded: false,
      });
    })
    .filter((model): model is LocalModel => model !== null);
}

export const openAiCompatibleServer: ModelServerType = {
  id: OPENAI_COMPATIBLE,
  label: { i18n: 'localAi.serverTypes.openaiCompatible' },
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
      return unreachable(error, started);
    }
  },
};

function unreachable(error: unknown, started: number): ModelServerStatus {
  const message = error instanceof Error ? error.message : String(error);
  return {
    reachable: false,
    version: null,
    latencyMs: Date.now() - started,
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

export const lemonadeServer: ModelServerType = {
  id: LEMONADE,
  label: { i18n: 'localAi.serverTypes.lemonade' },
  defaultBaseUrl: LEMONADE_DEFAULT_BASE_URL,
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
      return unreachable(error, started);
    }
  },
};

export const BUILTIN_MODEL_SERVERS: ModelServerType[] = [lemonadeServer, openAiCompatibleServer];

export type { ModelServerContext };
