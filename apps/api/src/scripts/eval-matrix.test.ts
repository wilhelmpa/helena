import { describe, expect, it } from 'bun:test';
import {
  MODEL_TEMPLATES,
  MODEL_ROLES,
  ROLE_REASONING,
  CLOUD_AGENT_MODELS,
} from '../modules/model-schemas/templates';
import {
  migrateCloudModels,
  cloudAgentUpgrades,
} from '../modules/model-schemas/cloud-model-migration';
import { ROLE_SUITES } from './eval-matrix-suites';
import {
  MATRIX_BACKENDS,
  percentile,
  recommend,
  roleRecommendation,
  schemaRecommendations,
  type MatrixResult,
} from './eval-matrix-results';
import { cascadeAsker, chatResult, markdown } from './eval-matrix';
import { DECISION_EVAL_SETS } from './decisions-eval';
import { CODING_TASKS } from './agentic-coding/tasks';

const suite = ROLE_SUITES.home[0]!;
const row = (patch: Partial<MatrixResult> = {}): MatrixResult => ({
  backend: 'flash',
  suite: suite.id,
  source: '148',
  at: '2026-09-30',
  status: 'measured',
  score: 1,
  passed: true,
  cases: 16,
  p50: 100,
  p95: 200,
  tokensPerSecond: 10,
  toolErrors: 0,
  costUsd: 0,
  ...patch,
});
describe('cloud role defaults and migration', () => {
  it('assigns every external agent the required model and exact reasoning table', () => {
    const high = [
      'home',
      'coordinator',
      'coder',
      'reviewer',
      'planning',
      'finance',
      'trading',
      'devops',
    ];
    expect(Object.keys(ROLE_REASONING).sort()).toEqual([...MODEL_ROLES].sort());
    for (const schema of Object.values(MODEL_TEMPLATES))
      for (const role of MODEL_ROLES) {
        const values = schema.roles[role]!;
        expect(values.reasoning).toBe(high.includes(role) ? 'high' : 'medium');
        if (values.runtime === 'codex' || values.runtime === 'claude') {
          expect(values.model).toBe(CLOUD_AGENT_MODELS[values.runtime]);
          expect(values.escalation.model).toBe(
            values.runtime === 'claude' ? 'claude-opus-5-5' : 'gpt-6.1-sol',
          );
        }
      }
  });
  it('migrates inherited legacy values, preserves explicit agent models and is idempotent', () => {
    const schemas = structuredClone(MODEL_TEMPLATES);
    schemas['nur-codex']!.roles.coder!.model = 'gpt-6-sol';
    schemas['nur-codex']!.roles.research!.model = 'gpt-6-luna';
    schemas['nur-claude']!.roles.content!.model = 'claude-sonnet-5';
    schemas['nur-claude']!.roles.finance!.model = 'owner-special';
    const result = migrateCloudModels(schemas);
    expect(result.changes).toHaveLength(3);
    expect(schemas['nur-codex']!.roles.coder!.model).toBe('gpt-6-sol');
    expect(result.schemas['nur-claude']!.roles.finance!.model).toBe('owner-special');
    expect(migrateCloudModels(result.schemas).changes).toEqual([]);
    expect(
      cloudAgentUpgrades(
        [
          { id: 1, overrides: {} },
          { id: 2, overrides: { model: 'gpt-6-sol' } },
        ],
        [
          { id: 1, schema: 'nur-codex', role: 'coder' },
          { id: 2, schema: 'nur-codex', role: 'coder' },
        ],
        result.changes,
      ).map((entry) => entry.agentId),
    ).toEqual([1]);
  });
});
describe('matrix suites and evaluation', () => {
  it('covers all roles using existing sets, twelve coding tasks and strict browser variants', () => {
    expect(Object.keys(ROLE_SUITES).sort()).toEqual([...MODEL_ROLES].sort());
    expect(CODING_TASKS).toHaveLength(12);
    expect(
      ROLE_SUITES.browser.map((entry) => [entry.id, entry.threshold, Boolean(entry.jevControl)]),
    ).toEqual([
      ['browser-direct', 1, false],
      ['browser-jev', 1, true],
    ]);
    for (const entries of Object.values(ROLE_SUITES)) {
      expect(new Set(entries.map((entry) => entry.id)).size).toBe(entries.length);
      for (const entry of entries)
        if (entry.kind === 'decision') expect(DECISION_EVAL_SETS[entry.source]).toBeDefined();
    }
    expect(
      MATRIX_BACKENDS.filter((backend) => backend.device === 'npu' && !backend.stages).map(
        (backend) => backend.model,
      ),
    ).toHaveLength(4);
  });
  it('uses finite nearest-rank percentiles and rejects failed or empty runs', () => {
    expect(percentile([300, 100, 200, NaN], 0.95)).toBe(300);
    expect(percentile([], 0.5)).toBeNull();
    expect(
      chatResult(
        'flash',
        suite,
        { score: 1, cases: [], latencyMsP50: null, tokensPerSecond: null },
        0,
      ).passed,
    ).toBe(false);
    for (const patch of [
      { score: 0.1 },
      { toolErrors: 1 },
      { toolErrors: null },
      { passed: false },
      { status: 'open' as const },
      { cases: 0 },
    ])
      expect(recommend(suite, [row(patch)], 'local-halogen')).toBeNull();
  });
  it('requires all role suites, excludes 27B in Halogen and private Jev decisions', () => {
    expect(roleRecommendation('home', [row()], 'local-halogen').model).toBe('gpt-6.1-sol');
    const rows = ROLE_SUITES.home.map((entry) => row({ suite: entry.id }));
    expect(roleRecommendation('home', rows, 'local-halogen').backend).toBe('flash');
    expect(recommend(suite, [row({ backend: '27b' })], 'local-halogen')).toBeNull();
    const privateSuite = ROLE_SUITES.finance[0]!;
    expect(
      recommend(
        privateSuite,
        [row({ backend: 'jev-flash', suite: privateSuite.id })],
        'local-halogen',
      ),
    ).toBeNull();
    expect(roleRecommendation('content', [], 'local-halogen', 'claude').model).toBe(
      'claude-sonnet-5-5',
    );
  });
  it('dry-run does not mutate schemas and repeated apply produces no changes', () => {
    const schema = structuredClone(MODEL_TEMPLATES['nur-lokal']!);
    const before = structuredClone(schema);
    const result = schemaRecommendations(schema, [row()]);
    expect(schema).toEqual(before);
    expect(result.changes).toContain(suite.placement);
    expect(result.schema.classes[suite.placement]).toMatchObject({
      eval: 'passed',
      score: 1,
      backend: 'flash',
    });
    expect(schemaRecommendations(result.schema, [row()]).changes).toEqual([]);
    expect(schemaRecommendations(schema, [row({ passed: false })]).changes).toEqual([]);
    expect(markdown([], [suite])).toContain('Not measured');
  });
  it('cascades only uncertain questions and sums real latency/tokens, including primary failures', async () => {
    const questions = {
      a: { kind: 'yesno' as const, question: 'Synthetic yes/no' },
      b: { kind: 'yesno' as const, question: 'Synthetic yes/no' },
    };
    let received: unknown;
    const first = async () => ({
      answers: {
        a: { choice: 'yes', confidence: 1, probabilities: { yes: 1, no: 0 } },
        b: { choice: 'no', confidence: 0.2, probabilities: { yes: 0.4, no: 0.6 } },
      },
      latencyMs: 5,
      inputTokens: 10,
      outputTokens: 1,
      model: 'first',
    });
    const second = async (
      _context: string,
      values: Record<string, import('@helena/sdk').DecisionQuestion>,
    ) => {
      received = Object.keys(values);
      return {
        answers: { b: { choice: 'yes', confidence: 1, probabilities: { yes: 1, no: 0 } } },
        latencyMs: 5,
        inputTokens: 20,
        outputTokens: 2,
        model: 'second',
      };
    };
    const result = await cascadeAsker(first, second, 0.8)('fixture', questions);
    expect(received).toEqual(['b']);
    expect(result.inputTokens).toBe(30);
    expect(result.latencyMs).toBe(10);
    expect(result.answers.a?.choice).toBe('yes');
    expect(result.answers.b?.choice).toBe('yes');
    await cascadeAsker(
      async () => {
        throw Error('offline');
      },
      second,
      0.8,
    )('fixture', questions);
    expect(received).toEqual(['a', 'b']);
  });
});

it('audits exact cloud catalog, price and runtime availability without inventing availability', async () => {
  const { cloudModelAudit } = await import('../modules/model-schemas/cloud-model-migration');
  const result = cloudModelAudit(
    [{ runtime: 'codex', models: [{ id: 'openai/gpt-6.1-sol' }] }],
    [{ runtime: 'claude', model: 'claude-sonnet-5-5', state: 'unavailable' }],
    [{ model: 'gpt-6.1-sol' }],
  );
  expect(result[0]).toMatchObject({ inCatalog: true, pricePresent: true, available: null });
  expect(result[1]).toMatchObject({ inCatalog: false, pricePresent: false, available: false });
});
