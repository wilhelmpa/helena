import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { composerActivity, pendingChoices } from './composerActivity';
import type { PlanUIMessage } from './chatMessages';

const question: PlanUIMessage = { id: '1', role: 'user', parts: [{ type: 'text', text: 'Q' }] };
const answer = (
  parts: PlanUIMessage['parts'],
  metadata: PlanUIMessage['metadata'] = {},
): PlanUIMessage => ({ id: '2', role: 'assistant', parts, metadata });

describe('composerActivity', () => {
  it('says thinking until the answer has something to show, then writing', () => {
    assert.equal(composerActivity([question], 'submitted', true), 'thinking');
    assert.equal(composerActivity([question, answer([])], 'streaming', true), 'thinking');
    assert.equal(
      composerActivity([question, answer([{ type: 'text', text: 'Hi' }])], 'streaming', true),
      'writing',
    );
  });

  it('says the question is queued while the runner is away', () => {
    assert.equal(composerActivity([question], 'submitted', false), 'queued');
  });

  it('names how the last answer ended', () => {
    const text = [{ type: 'text' as const, text: 'Half' }];
    assert.equal(composerActivity([question, answer(text)], 'ready', true), 'answered');
    assert.equal(
      composerActivity([question, answer(text, { interrupted: true })], 'ready', true),
      'lost',
    );
    assert.equal(
      composerActivity([question, answer(text, { stopped: true })], 'ready', true),
      'stopped',
    );
    assert.equal(composerActivity([question, answer([], { error: 'x' })], 'ready', true), 'failed');
    assert.equal(composerActivity([question], 'error', true), 'sendFailed');
    assert.equal(composerActivity([], 'ready', true), 'idle');
  });
});

describe('pendingChoices', () => {
  it("offers the choices of the agent's structured question, and nothing for plain text", () => {
    const clarify = answer([
      {
        type: 'dynamic-tool',
        toolName: 'clarify',
        toolCallId: 't1',
        state: 'input-available',
        input: { question: 'Which one?', choices: ['A', 'B', 3] },
      },
    ]);
    assert.deepEqual(pendingChoices([question, clarify]), {
      question: 'Which one?',
      choices: ['A', 'B'],
    });
    assert.equal(
      pendingChoices([question, answer([{ type: 'text', text: 'Which one, A or B?' }])]),
      null,
    );
    assert.equal(pendingChoices([question]), null);
  });
});
