import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isLocalModel } from './modelIdentity';

test('response identity follows the actual model or local provider, including Halogen', () => {
  assert.equal(isLocalModel('helena-halogen/Flash'), true);
  assert.equal(isLocalModel('Qwen27B', 'helena-local'), true);
  assert.equal(isLocalModel('volition-local-default'), true);
  assert.equal(isLocalModel('gpt-6-luna', 'openai-codex'), false);
  assert.equal(isLocalModel(null), false);
});
