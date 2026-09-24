import { t } from 'elysia';

export { projectKeyParams as browserTaskProjectParams } from '../issues/model';

const Policy = t.Union([t.Literal('auto'), t.Literal('jev'), t.Literal('laya')]);
const Confidence = t.Nullable(t.Number({ minimum: 0, maximum: 1 }));

export const BrowserControlResponse = t.Object({
  setting: t.Object({
    mode: t.Union([t.Literal('inherit'), t.Literal('standard'), t.Literal('decision')]),
    credentialId: t.Nullable(t.Number()),
    policy: Policy,
    minConfidence: Confidence,
  }),
  effective: t.Object({
    enabled: t.Boolean(),
    source: t.Union([t.Literal('project'), t.Literal('instance')]),
    label: t.String(),
    policy: t.Union([t.Literal('jev'), t.Literal('laya')]),
    credentialId: t.Nullable(t.Number()),
    problem: t.Nullable(t.Literal('connection_missing')),
  }),
});

export const updateBrowserControlBody = t.Object({
  mode: t.Optional(t.Union([t.Literal('inherit'), t.Literal('standard'), t.Literal('decision')])),
  credentialId: t.Optional(t.Nullable(t.Integer())),
  policy: t.Optional(Policy),
  minConfidence: t.Optional(Confidence),
});

export const InstanceBrowserControlResponse = t.Object({
  mode: t.Union([t.Literal('standard'), t.Literal('decision')]),
  credentialId: t.Nullable(t.Number()),
  policy: Policy,
  minConfidence: Confidence,
});

export const updateInstanceBrowserControlBody = t.Object({
  mode: t.Optional(t.Union([t.Literal('standard'), t.Literal('decision')])),
  credentialId: t.Optional(t.Nullable(t.Integer())),
  policy: t.Optional(Policy),
  minConfidence: t.Optional(Confidence),
});

const Localized = t.Union([t.String(), t.Record(t.String(), t.String())]);

export const DecisionBackendsResponse = t.Object({
  backends: t.Array(
    t.Object({
      id: t.String(),
      label: Localized,
      location: t.Union([t.Literal('cloud'), t.Literal('local')]),
      defaultBaseUrl: t.Nullable(t.String()),
      defaultModel: t.String(),
      policy: t.Union([t.Literal('jev'), t.Literal('laya')]),
      protocol: t.Union([
        t.Literal('systemone'),
        t.Literal('openai-logprobs'),
        t.Literal('openai-json'),
      ]),
      keyRequired: t.Boolean(),
      signupUrl: t.Nullable(t.String()),
      presets: t.Array(
        t.Object({
          id: t.String(),
          label: Localized,
          baseUrl: t.String(),
          model: t.String(),
          allowPrivateAddress: t.Boolean(),
          keySource: t.Nullable(t.Union([t.Literal('local-laya'), t.Literal('local-ai')])),
          modelServer: t.Nullable(t.String()),
        }),
      ),
    }),
  ),
});

export const ConnectionSummary = t.Object({
  id: t.Number(),
  label: t.String(),
  provider: t.Nullable(t.String()),
  model: t.Nullable(t.String()),
  baseUrl: t.Nullable(t.String()),
  keySource: t.String(),
  hasKey: t.Boolean(),
  status: t.Nullable(t.String()),
});

export const ConnectionsResponse = t.Object({ connections: t.Array(ConnectionSummary) });

export const ConnectionTestResponse = t.Object({
  ok: t.Boolean(),
  // A code the web words ('ok', 'no_key', 'no_local_key', 'key_refused', 'address_not_allowed')
  // or the service's own words.
  message: t.String(),
  models: t.Array(t.String()),
  latencyMs: t.Nullable(t.Number()),
});

export const connectionTestParams = t.Object({ teamId: t.Numeric(), credentialId: t.Numeric() });

export const LabRun = t.Object({
  id: t.Number(),
  source: t.String(),
  kind: t.String(),
  backend: t.String(),
  backendLabel: t.String(),
  provider: t.Nullable(t.String()),
  policy: t.Nullable(t.String()),
  modelConfigured: t.Nullable(t.String()),
  modelReported: t.Nullable(t.String()),
  goal: t.String(),
  mode: t.String(),
  maxSteps: t.Number(),
  startUrl: t.Nullable(t.String()),
  valueKeys: t.Array(t.String()),
  status: t.String(),
  summary: t.Nullable(t.String()),
  steps: t.Array(t.Unknown()),
  result: t.Nullable(t.Record(t.String(), t.Unknown())),
  decisions: t.Number(),
  inputTokens: t.Number(),
  outputTokens: t.Number(),
  decisionMs: t.Number(),
  durationMs: t.Nullable(t.Number()),
  costEur: t.Nullable(t.Number()),
  agentId: t.Nullable(t.Number()),
  agentName: t.Nullable(t.String()),
  chatThreadId: t.Nullable(t.String()),
  finalFrame: t.Nullable(t.String()),
  createdAt: t.String(),
  finishedAt: t.Nullable(t.String()),
});

export const LabRunsResponse = t.Object({ runs: t.Array(LabRun) });

export const LabOptionsResponse = t.Object({
  agents: t.Array(t.Object({ id: t.Number(), name: t.String(), username: t.String() })),
  connections: t.Array(ConnectionSummary),
  defaultConnectionId: t.Nullable(t.Number()),
  // The project's own setting, for the backend the form starts on.
  controlEnabled: t.Boolean(),
  slug: t.String(),
});

export const startLabRunBody = t.Object({
  backend: t.Union([t.Literal('decision'), t.Literal('standard'), t.Literal('jev-browser')]),
  agentId: t.Integer(),
  credentialId: t.Optional(t.Nullable(t.Integer())),
  policy: t.Optional(Policy),
  goal: t.String({ minLength: 1, maxLength: 1000 }),
  values: t.Optional(t.Record(t.String({ maxLength: 60 }), t.String({ maxLength: 2000 }))),
  startUrl: t.Optional(t.Nullable(t.String({ maxLength: 2000 }))),
  mode: t.Optional(t.Union([t.Literal('read'), t.Literal('act')])),
  maxSteps: t.Optional(t.Integer({ minimum: 1, maximum: 60 })),
});

export const labRunParams = t.Object({ projectKey: t.String(), runId: t.Numeric() });
export const homeLabRunParams = t.Object({ runId: t.Numeric() });
export const labListQuery = t.Object({ limit: t.Optional(t.Numeric()) });
