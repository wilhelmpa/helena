import { t } from 'elysia';

// Request and response shapes of the decisions routes (docs/helena-decisions/decisions.md §2).

const Localized = t.Union([t.String(), t.Record(t.String(), t.String())]);

const Probabilities = t.Record(t.String(), t.Number());

export const decisionClassParams = t.Object({
  teamId: t.Numeric(),
  classId: t.String({ maxLength: 120 }),
});

export const decisionEvalParams = t.Object({
  teamId: t.Numeric(),
  evalId: t.Numeric(),
});

export const decisionLogParams = t.Object({
  teamId: t.Numeric(),
  decisionId: t.Numeric(),
});

export const DecisionEvalView = t.Object({
  id: t.Number(),
  classId: t.String(),
  credentialId: t.Nullable(t.Number()),
  backendLabel: t.String(),
  model: t.Nullable(t.String()),
  threshold: t.Number(),
  questions: t.Number(),
  answered: t.Number(),
  correct: t.Number(),
  correctAnswered: t.Number(),
  precision: t.Nullable(t.Number()),
  coverage: t.Nullable(t.Number()),
  accuracy: t.Nullable(t.Number()),
  passed: t.Boolean(),
  latencyP50Ms: t.Nullable(t.Number()),
  latencyP95Ms: t.Nullable(t.Number()),
  inputTokens: t.Number(),
  costEur: t.Nullable(t.Number()),
  failures: t.Array(
    t.Object({
      case: t.String(),
      question: t.String(),
      expected: t.Array(t.String()),
      got: t.Nullable(t.String()),
      confidence: t.Nullable(t.Number()),
    }),
  ),
  details: t.Record(t.String(), t.Unknown()),
  error: t.Nullable(t.String()),
  status: t.Union([
    t.Literal('running'),
    t.Literal('done'),
    t.Literal('failed'),
    t.Literal('stale'),
  ]),
  createdAt: t.String(),
  finishedAt: t.Nullable(t.String()),
});

export const DecisionClassView = t.Object({
  id: t.String(),
  label: Localized,
  description: t.Nullable(Localized),
  input: t.Object({
    store: t.Union([t.Literal('never'), t.Literal('optional')]),
    cloud: t.Union([t.Literal('allowed'), t.Literal('never')]),
  }),
  defaults: t.Object({ threshold: t.Number(), timeoutMs: t.Number() }),
  eval: t.Nullable(
    t.Object({ cases: t.Number(), minPrecision: t.Number(), minCoverage: t.Number() }),
  ),
  setting: t.Object({
    enabled: t.Boolean(),
    credentialId: t.Nullable(t.Number()),
    fallbackCredentialId: t.Nullable(t.Number()),
    threshold: t.Number(),
    thresholdCustom: t.Nullable(t.Number()),
    timeoutMs: t.Number(),
    timeoutCustom: t.Nullable(t.Number()),
    storeInput: t.Boolean(),
    config: t.Record(t.String(), t.Unknown()),
  }),
  latestEval: t.Nullable(DecisionEvalView),
  canEnable: t.Object({ ok: t.Boolean(), reason: t.Nullable(t.String()) }),
  stats: t.Object({
    total: t.Number(),
    decided: t.Number(),
    unsure: t.Number(),
    failed: t.Number(),
    corrected: t.Number(),
    wrong: t.Number(),
    latencyP50Ms: t.Nullable(t.Number()),
    costEur: t.Number(),
  }),
});

export const DecisionConnectionOption = t.Object({
  id: t.Number(),
  label: t.String(),
  provider: t.String(),
  model: t.String(),
  local: t.Boolean(),
  projectKey: t.Nullable(t.String()),
  status: t.Nullable(t.String()),
});

export const FirstStagePolicy = t.Object({
  enabled: t.Boolean(),
  credentialId: t.Nullable(t.Integer({ minimum: 1 })),
  timeoutMs: t.Integer({ minimum: 200, maximum: 3000 }),
  useCases: t.Record(
    t.String({ maxLength: 120 }),
    t.Object({ enabled: t.Boolean(), cloudAllowed: t.Boolean() }),
  ),
});
export const updateFirstStageBody = t.Partial(FirstStagePolicy);
export const FirstStageView = t.Composite([
  FirstStagePolicy,
  t.Object({
    revision: t.Nullable(t.String()),
    circuitOpen: t.Boolean(),
    checks: t.Record(
      t.String(),
      t.Object({ ok: t.Boolean(), reason: t.Nullable(t.String()), running: t.Boolean() }),
    ),
    effective: t.Record(
      t.String(),
      t.Object({ enabled: t.Boolean(), reason: t.Nullable(t.String()) }),
    ),
  }),
]);

export const DecisionClassesResponse = t.Object({
  firstStage: FirstStageView,
  classes: t.Array(DecisionClassView),
  connections: t.Array(DecisionConnectionOption),
});

export const updateDecisionClassBody = t.Object({
  enabled: t.Optional(t.Boolean()),
  credentialId: t.Optional(t.Nullable(t.Integer({ minimum: 1 }))),
  fallbackCredentialId: t.Optional(t.Nullable(t.Integer({ minimum: 1 }))),
  threshold: t.Optional(t.Nullable(t.Number({ minimum: 0, maximum: 1 }))),
  timeoutMs: t.Optional(t.Nullable(t.Integer({ minimum: 200, maximum: 30000 }))),
  storeInput: t.Optional(t.Boolean()),
  config: t.Optional(t.Record(t.String(), t.Unknown())),
});

export const startDecisionEvalBody = t.Object({
  credentialId: t.Optional(t.Nullable(t.Integer({ minimum: 1 }))),
  threshold: t.Optional(t.Nullable(t.Number({ minimum: 0, maximum: 1 }))),
});

export const decisionEvalsQuery = t.Object({
  classId: t.Optional(t.String({ maxLength: 120 })),
  limit: t.Optional(t.Numeric({ minimum: 1, maximum: 100 })),
});

export const DecisionEvalsResponse = t.Object({ evals: t.Array(DecisionEvalView) });

export const decisionLogQuery = t.Object({
  classId: t.Optional(t.String({ maxLength: 120 })),
  status: t.Optional(t.String({ maxLength: 20 })),
  subject: t.Optional(t.String({ maxLength: 200 })),
  before: t.Optional(t.Numeric()),
  limit: t.Optional(t.Numeric({ minimum: 1, maximum: 200 })),
});

export const DecisionLogEntry = t.Object({
  id: t.Number(),
  classId: t.String(),
  subject: t.Nullable(t.String()),
  questionId: t.String(),
  kind: t.String(),
  options: t.Array(t.String()),
  question: t.Nullable(t.String()),
  optionLabels: t.Nullable(t.Record(t.String(), t.String())),
  choice: t.Nullable(t.String()),
  probabilities: t.Nullable(Probabilities),
  confidence: t.Nullable(t.Number()),
  threshold: t.Number(),
  status: t.String(),
  backend: t.Nullable(t.String()),
  // The connection's name in Zugänge.
  connection: t.Nullable(t.String()),
  model: t.Nullable(t.String()),
  latencyMs: t.Nullable(t.Number()),
  inputTokens: t.Number(),
  costEur: t.Nullable(t.Number()),
  error: t.Nullable(t.String()),
  inputText: t.Nullable(t.String()),
  outcome: t.Nullable(t.String()),
  outcomeSource: t.Nullable(t.String()),
  projectKey: t.Nullable(t.String()),
  agentId: t.Nullable(t.Number()),
  createdAt: t.String(),
});

export const DecisionLogResponse = t.Object({
  items: t.Array(DecisionLogEntry),
  nextBefore: t.Nullable(t.Number()),
});

export const decisionOutcomeBody = t.Object({
  outcome: t.String({ minLength: 1, maxLength: 64 }),
});

const OptionInput = t.Union([
  t.String({ minLength: 1, maxLength: 500 }),
  t.Object({
    id: t.String({ minLength: 1, maxLength: 64 }),
    label: t.String({ minLength: 1, maxLength: 500 }),
  }),
]);

export const decideBody = t.Object({
  question: t.String({
    minLength: 1,
    maxLength: 2000,
    description: 'What to decide, in plain words (English works best for the decision models).',
  }),
  options: t.Optional(
    t.Array(OptionInput, {
      minItems: 2,
      maxItems: 50,
      description:
        'The options to choose from: plain strings (their position is the id, "0", "1", …) or ' +
        '{id, label}. Leave out for a yes/no question.',
    }),
  ),
  context: t.Optional(
    t.String({
      maxLength: 20000,
      description: 'What the question is about: the text to judge (a message, a page, a list).',
    }),
  ),
  projectKey: t.Optional(t.String({ maxLength: 20 })),
  teamId: t.Optional(t.Integer({ minimum: 1 })),
});

export const DecideResponse = t.Object({
  status: t.String({
    description:
      'decided (use the choice), unsure (answered below the threshold: do not rely on it), ' +
      'off, no_backend, timeout or error (no answer: decide yourself).',
  }),
  choice: t.Nullable(t.String()),
  label: t.Nullable(t.String()),
  probabilities: t.Nullable(Probabilities),
  confidence: t.Nullable(t.Number()),
  threshold: t.Number(),
  backend: t.Nullable(t.String()),
  model: t.Nullable(t.String()),
  latencyMs: t.Nullable(t.Number()),
  decisionId: t.Nullable(t.Number()),
});
