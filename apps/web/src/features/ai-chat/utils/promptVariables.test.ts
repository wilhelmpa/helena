import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { fillPrompt, promptVariables } from './promptVariables';

describe('prompt variables', () => {
  it('lists each variable once, in order', () => {
    assert.deepEqual(
      promptVariables('Summarize {{topic}} for {{ audience }}. Keep {{topic}} short. {{Zeitraum}}'),
      ['topic', 'audience', 'Zeitraum'],
    );
    assert.deepEqual(promptVariables('No variables, just {braces}.'), []);
  });

  it('fills the variables and keeps the ones left empty', () => {
    assert.equal(
      fillPrompt('Summarize {{topic}} for {{ audience }}.', { topic: 'the launch', audience: '' }),
      'Summarize the launch for {{ audience }}.',
    );
  });
});
