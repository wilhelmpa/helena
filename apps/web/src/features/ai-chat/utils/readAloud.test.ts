import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { PlanUIMessage } from './chatMessages';
import { answerToRead } from './readAloud';

const user = (via?: 'voice'): PlanUIMessage => ({
  id: 'u',
  role: 'user',
  parts: [{ type: 'text', text: 'Frage' }],
  metadata: via ? { via } : {},
});
const answer = (metadata: PlanUIMessage['metadata'] = {}, text = 'Antwort.'): PlanUIMessage => ({
  id: 'a',
  role: 'assistant',
  parts: [{ type: 'text', text }],
  metadata,
});

describe('answerToRead', () => {
  it('stays quiet for a typed question', () => {
    assert.equal(
      answerToRead({ messages: [user(), answer()], readAll: false, talking: false }),
      null,
    );
  });

  it('reads the answer to a spoken question', () => {
    assert.equal(
      answerToRead({ messages: [user('voice'), answer()], readAll: false, talking: false }),
      'Antwort.',
    );
    // A question just sent by voice, before the chat has a record of how it was given.
    assert.equal(
      answerToRead({
        messages: [user(), answer()],
        readAll: false,
        talking: false,
        lastQuestionVia: 'voice',
      }),
      'Antwort.',
    );
  });

  it('does not let an earlier spoken question make the answer to a typed one loud', () => {
    assert.equal(
      answerToRead({
        messages: [user('voice'), answer(), user(), answer({}, 'Zweite.')],
        readAll: false,
        talking: false,
        lastQuestionVia: null,
      }),
      null,
    );
  });

  it('reads everything in a chat where "read everything" is on', () => {
    assert.equal(
      answerToRead({ messages: [user(), answer()], readAll: true, talking: false }),
      'Antwort.',
    );
  });

  it('leaves a running conversation to read for itself', () => {
    assert.equal(
      answerToRead({ messages: [user('voice'), answer()], readAll: true, talking: true }),
      null,
    );
  });

  it('never reads a stopped, failed or interrupted answer, or an empty one', () => {
    for (const metadata of [{ stopped: true }, { error: 'x' }, { interrupted: true }]) {
      assert.equal(
        answerToRead({
          messages: [user('voice'), answer(metadata)],
          readAll: true,
          talking: false,
        }),
        null,
      );
    }
    assert.equal(
      answerToRead({ messages: [user('voice'), answer({}, '')], readAll: true, talking: false }),
      null,
    );
    assert.equal(answerToRead({ messages: [user('voice')], readAll: true, talking: false }), null);
  });
});
