import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { AiChatModel } from '@/lib/api/endpoints/agentChat';
import { settingsForModel } from './ChatPanelModelSettings.logic';

const models: AiChatModel[] = [
  {
    id: 'openai/gpt-6-astra',
    name: 'GPT-6-Astra',
    reasoning: true,
    thinkingLevels: ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'],
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

describe('chat model settings', () => {
  it('keeps a reasoning level supported by the newly selected model', () => {
    assert.deepEqual(settingsForModel(models, 'openai/gpt-6-astra', 'xhigh'), {
      model: 'openai/gpt-6-astra',
      thinkingLevel: 'xhigh',
    });
  });

  it('clears a reasoning level the newly selected model does not support', () => {
    assert.deepEqual(settingsForModel(models, 'openai/gpt-5.5', 'ultra'), {
      model: 'openai/gpt-5.5',
      thinkingLevel: null,
    });
  });

  it('clears reasoning with the agent-default model', () => {
    assert.deepEqual(settingsForModel(models, null, 'high'), {
      model: null,
      thinkingLevel: null,
    });
  });
});
