import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  accountOf,
  isUnverified,
  knownFailure,
  refusalOf,
  refusedModels,
  templateFallbackModel,
} from './modelFailure';

const REFUSED = [
  {
    id: 'gpt-6-terra',
    provider: 'openai-codex',
    detail: 'not supported',
    since: '2026-09-24',
    findingId: 1,
  },
];

describe('accountOf', () => {
  it('names the subscription behind a provider or a runtime', () => {
    assert.equal(accountOf('openai-codex'), 'chatgpt');
    assert.equal(accountOf(null, 'codex'), 'chatgpt');
    assert.equal(accountOf('anthropic'), 'claude');
    assert.equal(accountOf('', 'claude'), 'claude');
    assert.equal(accountOf('copilot', 'hermes'), 'other');
    assert.equal(accountOf(undefined, undefined), 'other');
  });

  it("falls back on the model's family where nothing else is known", () => {
    assert.equal(accountOf(null, 'hermes', 'gpt-6-terra'), 'chatgpt');
    assert.equal(accountOf(null, null, 'anthropic/claude-opus-5'), 'claude');
    assert.equal(accountOf(null, null, 'opus'), 'claude');
    assert.equal(accountOf(null, null, 'llama-4'), 'other');
    assert.equal(accountOf('copilot', null, 'gpt-5.5'), 'other');
  });
});

describe('knownFailure', () => {
  it('words a refused model and a final refusal, nothing else', () => {
    assert.equal(knownFailure({ code: 'model-unavailable', model: 'x' }), 'modelUnavailable');
    assert.equal(knownFailure({ code: 'provider-rejected' }), 'providerRejected');
    assert.equal(knownFailure({ code: 'login-rejected' }), null);
    assert.equal(knownFailure(null), null);
  });
});

describe('templateFallbackModel', () => {
  it("names the template's refused model on a copy running on the default", () => {
    const copy = { model: null, sourceTemplateId: 15 };
    assert.equal(templateFallbackModel(copy, { model: 'gpt-6-terra' }, REFUSED), 'gpt-6-terra');
  });

  it('says nothing for a copy with a model of its own, a working template, or no copy', () => {
    assert.equal(
      templateFallbackModel(
        { model: 'gpt-5.6-terra', sourceTemplateId: 15 },
        { model: 'gpt-6-terra' },
        REFUSED,
      ),
      null,
    );
    assert.equal(
      templateFallbackModel({ model: null, sourceTemplateId: 15 }, { model: 'gpt-6-sol' }, REFUSED),
      null,
    );
    assert.equal(
      templateFallbackModel(
        { model: null, sourceTemplateId: null },
        { model: 'gpt-6-terra' },
        REFUSED,
      ),
      null,
    );
    assert.equal(
      templateFallbackModel({ model: null, sourceTemplateId: 15 }, undefined, REFUSED),
      null,
    );
  });
});

describe('refusedModels', () => {
  const finding = (fields: Record<string, unknown>) => ({
    id: 7,
    runtime: 'hermes',
    provider: 'openai-codex',
    model: 'gpt-6-terra',
    state: 'unavailable' as const,
    reason: 'model-unavailable',
    detail: 'from the team',
    agentId: 1,
    runId: 2,
    chatMessageId: null,
    since: '2026-09-24T19:00:00Z',
    observedAt: '2026-09-24T19:10:00Z',
    agents: [],
    ...fields,
  });

  it("joins the catalog's refusals with the team's findings of the agent's runtime", () => {
    const joined = refusedModels(
      [],
      [
        finding({}),
        finding({ id: 8, model: 'gpt-6-sol', runtime: 'codex' }),
        finding({ id: 9, model: 'x', state: 'works' }),
      ],
      'hermes',
    );
    assert.deepEqual(joined, [
      {
        id: 'gpt-6-terra',
        provider: 'openai-codex',
        detail: 'from the team',
        since: '2026-09-24T19:00:00Z',
        findingId: 7,
      },
    ]);
  });

  it("keeps the catalog's own entry for a model both name", () => {
    assert.equal(refusedModels(REFUSED, [finding({})], 'hermes')[0]?.findingId, 1);
    assert.deepEqual(refusedModels(undefined, undefined, 'hermes'), []);
  });
});

describe('refusalOf and isUnverified', () => {
  it('finds the refusal of the configured model', () => {
    assert.equal(refusalOf('gpt-6-terra', REFUSED)?.detail, 'not supported');
    assert.equal(refusalOf('gpt-6-sol', REFUSED), undefined);
    assert.equal(refusalOf(null, REFUSED), undefined);
    assert.equal(refusalOf('gpt-6-terra', undefined), undefined);
  });

  it('marks only a model known to be unconfirmed', () => {
    assert.equal(isUnverified({ verified: false }), true);
    assert.equal(isUnverified({ verified: true }), false);
    assert.equal(isUnverified({}), false);
  });
});
