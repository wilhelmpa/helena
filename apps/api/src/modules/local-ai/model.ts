import { t } from 'elysia';

const unit = t.Union([t.Literal('gpu'), t.Literal('npu'), t.Literal('cpu')]);
const mode = t.Union([t.Literal('off'), t.Literal('prefer'), t.Literal('only')], {
  description:
    '`off`: the configured model, as today. `prefer`: local first, the configured model when ' +
    'local is off, down, too slow or wrong. `only`: local or nothing.',
});
const localized = t.Union([t.String(), t.Record(t.String(), t.String())]);
const keySource = t.Union([t.Literal('file'), t.Literal('stored'), t.Literal('none')]);

export const LocalModel = t.Object({
  id: t.String({ description: 'The model as the server names it' }),
  modelId: t.String({ description: 'As Helena names it: `helena-<slug>/<id>`' }),
  name: t.String(),
  unit: t.Nullable(unit),
  capabilities: t.Array(t.String()),
  contextLength: t.Nullable(t.Number()),
  sizeBytes: t.Nullable(t.Number()),
  downloaded: t.Nullable(t.Boolean()),
  loaded: t.Boolean(),
  backend: t.Nullable(t.String()),
  checkpoint: t.Optional(t.Nullable(t.String({ description: '`<org>/<repo>:<file>`' }))),
  startOptions: t.Optional(
    t.Nullable(
      t.Object({
        backend: t.Nullable(t.Union([t.Literal('rocm'), t.Literal('vulkan')])),
        specType: t.Nullable(t.Union([t.Literal('draft-mtp'), t.Literal('draft-dflash')])),
        draftModel: t.Nullable(t.String()),
        draftTokens: t.Nullable(t.Number()),
        parallel: t.Nullable(t.Number()),
        contextPerSlot: t.Nullable(t.Number()),
      }),
    ),
  ),
});

const load = t.Nullable(
  t.Object({
    gpuPercent: t.Nullable(t.Number()),
    npuPercent: t.Nullable(t.Number()),
    cpuPercent: t.Nullable(t.Number()),
    vramGb: t.Nullable(t.Number()),
    memoryGb: t.Nullable(t.Number()),
  }),
);

export const ServerStatus = t.Object({
  reachable: t.Boolean(),
  version: t.Nullable(t.String()),
  latencyMs: t.Nullable(t.Number()),
  error: t.Nullable(t.String()),
  loaded: t.Array(
    t.Object({ id: t.String(), unit: t.Nullable(unit), backend: t.Nullable(t.String()) }),
  ),
  load: t.Optional(load),
});

export const ModelServer = t.Object({
  id: t.Number(),
  slug: t.String(),
  kind: t.String({ description: '`lemonade` or `openai-compatible`' }),
  name: t.String(),
  baseUrl: t.String(),
  keySource,
  keyFile: t.Nullable(t.String()),
  key: t.Union([t.Literal('file'), t.Literal('stored'), t.Literal('none'), t.Literal('invalid')], {
    description: 'Where the key comes from; never the key itself',
  }),
  enabled: t.Boolean(),
  contextLength: t.Number(),
  provider: t.String({ description: "The server's Hermes provider name, `helena-<slug>`" }),
  models: t.Array(LocalModel),
  status: t.Nullable(ServerStatus),
  checkedAt: t.Nullable(t.String({ format: 'date-time' })),
});

export const EvalResult = t.Object({
  id: t.Number(),
  classId: t.String(),
  modelId: t.String(),
  status: t.Union([t.Literal('running'), t.Literal('done'), t.Literal('stale')], {
    description:
      '`running` while the eval asks its cases (minutes on a local model), `done` once its ' +
      'score is in, `stale` when it was cut off (the API restarted) and never finished',
  }),
  score: t.Number(),
  score100: t.Nullable(t.Number({ description: 'German text judge score on a 0–100 scale' })),
  threshold: t.Number(),
  passed: t.Boolean(),
  cases: t.Number(),
  details: t.Array(t.Object({ id: t.String(), detail: t.Nullable(t.String()) })),
  latencyMsP50: t.Nullable(t.Number()),
  tokensPerSecond: t.Nullable(t.Number()),
  error: t.Nullable(t.String()),
  evalVersion: t.Number({
    description: "The version of the class's eval it ran; an older one no longer gates it",
  }),
  ranAt: t.String({ format: 'date-time', description: 'When it started' }),
  finishedAt: t.Nullable(t.String({ format: 'date-time' })),
});

const classSetting = t.Object({ mode, model: t.Nullable(t.String()) });

export const LocalAiPolicy = t.Object({
  enabled: t.Boolean({ description: 'The master switch' }),
  units: t.Object({ gpu: t.Boolean(), npu: t.Boolean(), cpu: t.Boolean() }),
  classes: t.Record(t.String(), classSetting),
  preset: t.Union([
    t.Literal('sparsam'),
    t.Literal('ausgewogen'),
    t.Literal('qualitaet'),
    t.Literal('eigene'),
  ]),
  initialized: t.Boolean(),
});

export const LocalAiSettings = t.Object({
  policy: LocalAiPolicy,
  servers: t.Array(ModelServer),
  serverTypes: t.Array(
    t.Object({ id: t.String(), label: localized, defaultBaseUrl: t.Nullable(t.String()) }),
  ),
  classes: t.Array(
    t.Object({
      id: t.String(),
      label: localized,
      description: t.Nullable(localized),
      unit,
      capability: t.String(),
      priority: t.String(),
      thinking: t.Union(
        [t.Literal('off'), t.Literal('low'), t.Literal('medium'), t.Literal('high')],
        {
          description:
            'How much a reasoning model may think for this work (its eval runs the same)',
        },
      ),
      experimental: t.Boolean(),
      inMasterDefault: t.Boolean(),
      wired: t.Boolean({ description: 'Helena already sends this work to local AI' }),
      modes: t.Array(mode, {
        description:
          'The modes the class offers: work that runs as an agent turn keeps its configured ' +
          'model as the fallback, so it offers no `only`',
      }),
      hasEval: t.Boolean(),
      evalVersion: t.Number({ description: "The version of the class's eval" }),
      threshold: t.Number(),
      mode,
      model: t.Nullable(t.String()),
      resolvedModel: t.Nullable(t.String()),
      blocker: t.Nullable(
        t.Union([
          t.Literal('not-wired'),
          t.Literal('no-model'),
          t.Literal('eval-missing'),
          t.Literal('eval-failed'),
        ]),
      ),
    }),
  ),
  evals: t.Array(EvalResult, { description: 'The newest finished eval of each class and model' }),
  runningEvals: t.Array(EvalResult, { description: 'The evals still running' }),
});

const loadedEntry = t.Object({
  id: t.String(),
  modelId: t.String(),
  unit: t.Nullable(unit),
  backend: t.Nullable(t.String()),
});

export const LocalAiStatus = t.Object({
  guard: t.Object({
    checkedAt: t.Nullable(t.String()),
    probeAt: t.Nullable(t.String()),
    probeMs: t.Nullable(t.Number()),
    probeFailures: t.Number(),
    problem: t.Nullable(t.Union([t.Literal('eviction'), t.Literal('probe')])),
    availableBytes: t.Nullable(t.Number()),
    consumers: t.Array(t.Object({ pid: t.Number(), name: t.String(), rssBytes: t.Number() })),
  }),
  enabled: t.Boolean(),
  units: t.Object({
    gpu: t.Object({
      allowed: t.Boolean(),
      present: t.Boolean(),
      busyPercent: t.Nullable(t.Number()),
      vramUsedBytes: t.Nullable(t.Number()),
      vramTotalBytes: t.Nullable(t.Number()),
      gttUsedBytes: t.Nullable(t.Number()),
      gttTotalBytes: t.Nullable(t.Number()),
      loaded: t.Array(loadedEntry),
    }),
    npu: t.Object({
      allowed: t.Boolean(),
      present: t.Boolean(),
      busyPercent: t.Nullable(t.Number()),
      loaded: t.Array(loadedEntry),
    }),
    cpu: t.Object({
      allowed: t.Boolean(),
      present: t.Boolean(),
      busyPercent: t.Nullable(t.Number()),
      loaded: t.Array(loadedEntry),
    }),
  }),
  servers: t.Array(
    t.Object({
      id: t.Number(),
      name: t.String(),
      enabled: t.Boolean(),
      reachable: t.Boolean(),
      version: t.Nullable(t.String()),
      error: t.Nullable(t.String()),
      checkedAt: t.Nullable(t.String({ format: 'date-time' })),
      latencyMs: t.Nullable(t.Number()),
    }),
  ),
  classes: t.Array(
    t.Object({
      id: t.String(),
      unit,
      mode,
      experimental: t.Boolean(),
      wired: t.Boolean(),
    }),
  ),
  usage: t.Object({
    days: t.Number(),
    localTokens: t.Number(),
    cloudTokens: t.Number(),
  }),
  latencyMsP50: t.Nullable(t.Number()),
});

export const policyBody = t.Object({
  enabled: t.Optional(t.Boolean()),
  units: t.Optional(
    t.Object({
      gpu: t.Optional(t.Boolean()),
      npu: t.Optional(t.Boolean()),
      cpu: t.Optional(t.Boolean()),
    }),
  ),
  classes: t.Optional(
    t.Record(
      t.String({ pattern: '^[a-z][a-z0-9-]{0,47}$' }),
      t.Object({ mode: t.Optional(mode), model: t.Optional(t.Nullable(t.String())) }),
    ),
  ),
  preset: t.Optional(
    t.Union([
      t.Literal('sparsam'),
      t.Literal('ausgewogen'),
      t.Literal('qualitaet'),
      t.Literal('eigene'),
    ]),
  ),
});

export const serverBody = t.Object({
  slug: t.Optional(t.String({ maxLength: 32 })),
  kind: t.Optional(t.String({ maxLength: 64 })),
  name: t.Optional(t.String({ maxLength: 120 })),
  baseUrl: t.Optional(t.String({ maxLength: 500 })),
  keySource: t.Optional(keySource),
  keyFile: t.Optional(t.Nullable(t.String({ maxLength: 300 }))),
  key: t.Optional(t.Nullable(t.String({ maxLength: 500 }))),
  enabled: t.Optional(t.Boolean()),
  contextLength: t.Optional(t.Number()),
});

export const serverParams = t.Object({ id: t.Numeric() });

export const evalParams = t.Object({ id: t.Numeric() });

export const evalBody = t.Object({
  classId: t.String({ maxLength: 48 }),
  modelId: t.String({ maxLength: 300 }),
});

export const modelOptionsBody = t.Object({
  backend: t.Nullable(t.Union([t.Literal('rocm'), t.Literal('vulkan')])),
  specType: t.Nullable(t.Union([t.Literal('draft-mtp'), t.Literal('draft-dflash')])),
  draftModel: t.Nullable(t.String()),
  draftTokens: t.Nullable(t.Number()),
  parallel: t.Nullable(t.Number()),
  contextPerSlot: t.Nullable(t.Number()),
});

export const ServerKeysResponse = t.Object({
  keys: t.Record(t.String(), t.String(), {
    description: "The keys of the local model servers the agent's profile names, by variable",
  }),
});
