import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { friendlyModel } from './modelNames';

describe('friendlyModel', () => {
  it('calls the local Halogen model Flash and marks it local', () => {
    assert.deepEqual(friendlyModel('helena-halogen/halogen-qwen3.8-flash-next'), {
      name: 'Flash',
      local: true,
    });
  });

  it('shortens the local Qwen weights to the family and version', () => {
    assert.deepEqual(friendlyModel('helena-local/Qwen3.8-27B-GGUF'), {
      name: 'Qwen3.8',
      local: true,
    });
    assert.deepEqual(friendlyModel('helena-local/Qwen3.6-35B-A3B-MTP-GGUF'), {
      name: 'Qwen3.6',
      local: true,
    });
  });

  it('names the cloud models by their product names', () => {
    assert.deepEqual(friendlyModel('claude-opus-5-5'), { name: 'Opus 5.5', local: false });
    assert.deepEqual(friendlyModel('claude-sonnet-5'), { name: 'Sonnet 5', local: false });
    assert.deepEqual(friendlyModel('gpt-6-sol'), { name: 'GPT-6 Sol', local: false });
    assert.deepEqual(friendlyModel('gpt-5.6-luna'), { name: 'GPT-5.6 Luna', local: false });
  });

  it('keeps an unknown id and says nothing for none', () => {
    assert.deepEqual(friendlyModel('mistral-small-4'), { name: 'mistral-small-4', local: false });
    assert.equal(friendlyModel(null), null);
    assert.equal(friendlyModel('  '), null);
  });
});
