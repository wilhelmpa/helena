import { isDeepStrictEqual } from 'node:util';
import {
  CLOUD_AGENT_MODELS,
  ROLE_REASONING,
  type ModelRole,
  type ModelSchema,
} from '../modules/model-schemas/templates';
import { ROLE_SUITES, type MatrixSuite } from './eval-matrix-suites';

export type MatrixBackend = {
  id: string;
  device: 'gpu' | 'npu' | 'cloud';
  model: string;
  base: string;
  windowBase?: string;
  marker?: string;
  profile?: ModelSchema['profile'];
  stages?: string[];
};
const flash: MatrixBackend = {
  id: 'flash',
  device: 'gpu',
  model: 'halogen-qwen3.8-flash-next',
  base: 'http://127.0.0.1:8741/v1',
};
const npu = (model: string): MatrixBackend => ({
  id: model,
  model,
  device: 'npu',
  base: 'http://127.0.0.1:52625/v1',
  marker: model.replaceAll(':', '-'),
});
export const MATRIX_BACKENDS: MatrixBackend[] = [
  flash,
  {
    id: '27b',
    device: 'gpu',
    model: 'qwen3.8-27b',
    base: 'http://127.0.0.1:18791/v1',
    marker: '27b',
    profile: 'local-27b-npu',
  },
  ...['qwen3.5:2b', 'qwen3.5:4b', 'gemma4-it:e2b', 'gemma4-it:e4b'].map(npu),
  { id: 'jev', device: 'cloud', model: 'jev-1.13.0', base: 'https://api.typesafe.ai' },
  { ...flash, id: 'jev-flash', stages: ['jev', 'flash'] },
  ...['qwen3.5:2b', 'qwen3.5:4b', 'gemma4-it:e2b', 'gemma4-it:e4b'].flatMap((model) => [
    { ...npu(model), id: `jev-${model}`, stages: ['jev', model] },
    {
      ...flash,
      id: `${model}-flash`,
      stages: [model, 'flash'],
      marker: model.replaceAll(':', '-'),
    },
  ]),
];
export type MatrixResult = {
  backend: string;
  suite: string;
  source: string;
  at: string;
  status: 'measured' | 'open' | 'unsupported';
  score: number | null;
  passed: boolean;
  cases: number;
  p50: number | null;
  p95: number | null;
  tokensPerSecond: number | null;
  toolErrors: number | null;
  costUsd: number | null;
  reason?: string;
};
export function percentile(values: number[], fraction: number) {
  const finite = values.filter(Number.isFinite).sort((a, b) => a - b);
  return finite.length ? finite[Math.max(0, Math.ceil(finite.length * fraction) - 1)]! : null;
}
export function eligible(
  backend: MatrixBackend,
  suite: MatrixSuite,
  profile: ModelSchema['profile'],
) {
  return (
    (!backend.profile || backend.profile === profile) &&
    !(suite.privateData && (backend.id === 'jev' || backend.stages?.includes('jev')))
  );
}
export function recommend(
  suite: MatrixSuite,
  results: MatrixResult[],
  profile: ModelSchema['profile'],
) {
  return (
    results
      .filter(
        (row) =>
          row.suite === suite.id &&
          row.status === 'measured' &&
          row.passed &&
          row.score !== null &&
          row.score >= suite.threshold &&
          row.cases > 0 &&
          row.toolErrors === 0,
      )
      .filter((row) => {
        const backend = MATRIX_BACKENDS.find((item) => item.id === row.backend);
        return backend && backend.device !== 'cloud' && eligible(backend, suite, profile);
      })
      .sort(
        (a, b) =>
          b.score! - a.score! ||
          (a.p50 ?? Infinity) - (b.p50 ?? Infinity) ||
          a.backend.localeCompare(b.backend),
      )[0] ?? null
  );
}
export function roleRecommendation(
  role: ModelRole,
  results: MatrixResult[],
  profile: ModelSchema['profile'],
  runtime: 'codex' | 'claude' = 'codex',
) {
  const suites = ROLE_SUITES[role];
  const complete = MATRIX_BACKENDS.filter(
    (backend) =>
      backend.device !== 'cloud' &&
      !backend.stages?.includes('jev') &&
      suites.every(
        (suite) =>
          eligible(backend, suite, profile) &&
          results.some(
            (row) =>
              row.backend === backend.id &&
              row.suite === suite.id &&
              row.status === 'measured' &&
              row.passed &&
              row.score !== null &&
              row.score >= suite.threshold &&
              row.cases > 0 &&
              row.toolErrors === 0,
          ),
      ),
  );
  complete.sort((a, b) => {
    const latency = (backend: MatrixBackend) =>
      suites.reduce(
        (sum, suite) =>
          sum +
          (results.find((row) => row.backend === backend.id && row.suite === suite.id)?.p50 ??
            Infinity),
        0,
      );
    return latency(a) - latency(b);
  });
  return {
    backend: complete[0]?.id ?? runtime,
    model: complete[0]?.model ?? CLOUD_AGENT_MODELS[runtime],
    reasoning: ROLE_REASONING[role],
  };
}
export function schemaRecommendations(schema: ModelSchema, results: MatrixResult[]) {
  const next = structuredClone(schema);
  const changes: string[] = [];
  const suites = [
    ...new Map(
      Object.values(ROLE_SUITES)
        .flat()
        .map((suite) => [suite.placement, suite]),
    ).values(),
  ];
  for (const suite of suites) {
    const winner = recommend(suite, results, schema.profile);
    if (!winner) continue;
    const backend = MATRIX_BACKENDS.find((item) => item.id === winner.backend)!;
    const primary =
      backend.stages?.[0] !== 'jev'
        ? (MATRIX_BACKENDS.find((item) => item.id === backend.stages?.[0]) ?? backend)
        : backend;
    const placement = {
      ...next.classes[suite.placement],
      model: primary.model,
      device: primary.device,
      backend: backend.id,
      eval: 'passed' as const,
      score: winner.score!,
      ...(suite.kind === 'decision' && {
        decision: {
          backend:
            backend.id === 'jev'
              ? ('jev' as const)
              : backend.stages?.[0] === 'jev'
                ? ('jev-local' as const)
                : primary.device === 'npu'
                  ? ('npu' as const)
                  : ('gpu' as const),
          threshold: suite.confidenceThreshold ?? suite.threshold,
          fallback: backend.stages ? ('gpu' as const) : ('none' as const),
          privateData: Boolean(suite.privateData),
        },
      }),
    };
    if (!isDeepStrictEqual(next.classes[suite.placement], placement)) {
      next.classes[suite.placement] = placement;
      changes.push(suite.placement);
    }
  }
  return { schema: next, changes };
}
