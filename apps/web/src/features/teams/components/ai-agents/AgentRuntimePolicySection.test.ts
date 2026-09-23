import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { AiChatModel } from '@/lib/api/endpoints/agentChat';
import { runtimeSelectionForModel } from './AgentRuntimePolicySection.logic';

const models: AiChatModel[] = [
  {
    id: 'openai/gpt-6-astra',
    name: 'GPT-6 Astra',
    reasoning: true,
    thinkingLevels: ['low', 'medium', 'high', 'xhigh', 'max'],
    thinkingDefault: 'high',
  },
  {
    id: 'openai/gpt-5.5',
    name: 'GPT-5.5',
    reasoning: true,
    thinkingLevels: ['low', 'medium', 'high', 'xhigh'],
    thinkingDefault: 'medium',
  },
];

describe('external agent runtime model selection', () => {
  it('keeps a reasoning effort advertised by the selected model, including max', () => {
    assert.deepEqual(runtimeSelectionForModel(models, 'openai/gpt-6-astra', 'max'), {
      model: 'openai/gpt-6-astra',
      reasoningEffort: 'max',
    });
  });

  it('clears a reasoning effort not advertised by the newly selected model', () => {
    assert.deepEqual(runtimeSelectionForModel(models, 'openai/gpt-5.5', 'max'), {
      model: 'openai/gpt-5.5',
      reasoningEffort: null,
    });
  });

  it('clears reasoning when the model delegates to the agent default', () => {
    assert.deepEqual(runtimeSelectionForModel(models, null, 'high'), {
      model: null,
      reasoningEffort: null,
    });
  });
});
