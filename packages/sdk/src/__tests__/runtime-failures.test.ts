import { describe, expect, test } from 'bun:test';
import { classifyProviderFailure, isFinalFailure } from '../index';

// Hermes' answer when Codex with a ChatGPT account refuses the model (live, 2026-09-24).
const CODEX_REFUSAL =
  "ChatGPT or Codex Subscription rejected the request and retrying won't help. Pick another " +
  'model with /model, or check the details in `~/./logs/agent.log`.\n\n' +
  'Provider said: HTTP 400: {"detail":"The \'gpt-6-terra\' model is not supported when using ' +
  'Codex with a ChatGPT account."}';

describe('classifyProviderFailure', () => {
  test('a model Codex does not serve a ChatGPT account is unavailable, for good', () => {
    const failure = classifyProviderFailure({
      output: CODEX_REFUSAL,
      error: 'session_id: 20260924_191027_ae3ffa',
    });
    expect(failure).toEqual({
      code: 'model-unavailable',
      retryable: false,
      model: 'gpt-6-terra',
      detail: "The 'gpt-6-terra' model is not supported when using Codex with a ChatGPT account.",
    });
    expect(isFinalFailure(failure)).toBe(true);
  });

  test('the Codex CLI says the same in its own error line', () => {
    const failure = classifyProviderFailure({
      output: '',
      error:
        '{"type":"error","message":"The \'gpt-6-terra\' model is not supported when using Codex with a ChatGPT account."}',
    });
    expect(failure?.code).toBe('model-unavailable');
    expect(failure?.model).toBe('gpt-6-terra');
  });

  test("Hermes' model_not_found copy names the model", () => {
    const failure = classifyProviderFailure({
      output:
        "Model 'claude-opus-9' isn't available on Anthropic. Pick a different model with /model.",
    });
    expect(failure).toMatchObject({
      code: 'model-unavailable',
      retryable: false,
      model: 'claude-opus-9',
    });
  });

  test('the OpenAI and Anthropic APIs word it their own way', () => {
    expect(
      classifyProviderFailure({
        output: 'Error: The model `gpt-9` does not exist or you do not have access to it.',
      })?.model,
    ).toBe('gpt-9');
    expect(
      classifyProviderFailure({
        output:
          'HTTP 404: {"type":"error","error":{"type":"not_found_error","message":"model: claude-foo-1"}}',
      })?.model,
    ).toBe('claude-foo-1');
    expect(classifyProviderFailure({ output: 'Unsupported model: o9-mini' })?.model).toBe(
      'o9-mini',
    );
  });

  test('a refusal that names no model still ends the run', () => {
    expect(
      classifyProviderFailure({ output: 'error code: model_not_found' }),
    ).toMatchObject({ code: 'model-unavailable', retryable: false, model: null });
    expect(classifyProviderFailure({ output: 'failed', reason: 'model_not_found' })).toMatchObject(
      { code: 'model-unavailable', model: null },
    );
  });

  test('a refusal no retry passes, for another reason, is final but names no model', () => {
    const failure = classifyProviderFailure({
      output:
        "OpenAI rejected the request and retrying won't help. Pick another model with /model.\n\n" +
        'Provider said: HTTP 400: {"detail":"Invalid value for reasoning.effort."}',
    });
    expect(failure).toEqual({
      code: 'provider-rejected',
      retryable: false,
      detail: 'Invalid value for reasoning.effort.',
    });
    expect(
      classifyProviderFailure({ output: 'failed', retryable: false, reason: 'format_error' })?.code,
    ).toBe('provider-rejected');
  });

  test('a refused login, a used-up plan, a crash or a timeout is not called final here', () => {
    expect(
      classifyProviderFailure({ output: 'x', reason: 'auth_permanent', retryable: false }),
    ).toBeNull();
    expect(classifyProviderFailure({ output: 'x', reason: 'billing', retryable: false })).toBeNull();
    expect(
      classifyProviderFailure({
        output: 'Anthropic rejected your sign-in, so the model can\'t be reached. Sign in again.',
      }),
    ).toBeNull();
    expect(classifyProviderFailure({ output: '', error: 'Timed out after 1800000ms' })).toBeNull();
    expect(classifyProviderFailure({ output: 'The run crashed', error: null })).toBeNull();
  });

  test('a model the reasoning effort does not suit is not the model being unavailable', () => {
    expect(
      classifyProviderFailure({
        output: "Unsupported value: 'max' is not supported with this model.",
      }),
    ).toBeNull();
    expect(
      classifyProviderFailure({ output: 'This model version is not supported for images.' }),
    ).toBeNull();
  });
});
