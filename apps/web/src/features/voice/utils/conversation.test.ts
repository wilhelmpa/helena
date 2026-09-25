import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  conversationPhase,
  conversationStep,
  initialConversation,
  looksLikeEcho,
  type ConversationEffect,
  type ConversationEvent,
  type ConversationState,
} from './conversation';

// Runs events through the machine and collects the phases and effects on the way.
function run(events: ConversationEvent[], from: ConversationState = initialConversation) {
  let state = from;
  const phases: string[] = [];
  const effects: ConversationEffect[] = [];
  for (const event of events) {
    const step = conversationStep(state, event);
    state = step.state;
    effects.push(...step.effects);
    phases.push(conversationPhase(state));
  }
  return { state, phases, effects };
}

const on: ConversationEvent[] = [{ type: 'start' }, { type: 'ready' }];

describe('conversation turn-taking', () => {
  it('listens, writes down, sends, thinks, reads and listens again', () => {
    const { phases, effects, state } = run([
      ...on,
      { type: 'speechStart' },
      { type: 'speechEnd' },
      { type: 'transcribed', text: 'Wie spät ist es?', echo: false },
      { type: 'speakerStarted' },
      { type: 'answerEnded' },
      { type: 'speakerIdle' },
    ]);
    assert.deepEqual(phases, [
      'starting',
      'listening',
      'hearing',
      'transcribing',
      'thinking',
      'speaking',
      'speaking',
      'listening',
    ]);
    assert.deepEqual(effects, [{ type: 'transcribe' }, { type: 'send', text: 'Wie spät ist es?' }]);
    assert.equal(state.awaitingAnswer, false);
  });

  it('sends nothing for silence or noise', () => {
    const { effects, phases } = run([
      ...on,
      { type: 'speechStart' },
      { type: 'speechMisfire' },
      { type: 'speechStart' },
      { type: 'speechEnd' },
      { type: 'transcribed', text: '  ', echo: false },
    ]);
    assert.deepEqual(effects, [{ type: 'transcribe' }]);
    assert.equal(phases.at(-1), 'listening');
  });

  it('joins what the owner said in two breaths into one message', () => {
    const { effects } = run([
      ...on,
      { type: 'speechStart' },
      { type: 'speechEnd' },
      // Still talking when the first part comes back.
      { type: 'speechStart' },
      { type: 'transcribed', text: 'Schreib dem Team', echo: false },
      { type: 'speechEnd' },
      { type: 'transcribed', text: 'dass der Launch verschoben ist.', echo: false },
    ]);
    assert.deepEqual(effects.at(-1), {
      type: 'send',
      text: 'Schreib dem Team dass der Launch verschoben ist.',
    });
    assert.equal(effects.filter((effect) => effect.type === 'send').length, 1);
  });

  it('interrupts the reading when the owner speaks, and drops the rest of it', () => {
    const reading = run([
      ...on,
      { type: 'speechStart' },
      { type: 'speechEnd' },
      { type: 'transcribed', text: 'Erzähl mir alles.', echo: false },
      { type: 'speakerStarted' },
    ]).state;
    const { effects, phases, state } = run(
      [
        { type: 'speechStart' },
        { type: 'speechEnd' },
        { type: 'transcribed', text: 'Stopp, das reicht.', echo: false },
      ],
      reading,
    );
    assert.deepEqual(effects, [
      { type: 'pauseReading' },
      { type: 'transcribe' },
      { type: 'dropReading' },
      { type: 'send', text: 'Stopp, das reicht.' },
    ]);
    assert.deepEqual(phases, ['hearing', 'transcribing', 'thinking']);
    assert.equal(state.speaking, false);
  });

  it('goes on reading when the interruption was only noise', () => {
    const reading = run([...on, { type: 'speakerStarted' }]).state;
    const { effects, phases } = run([{ type: 'speechStart' }, { type: 'speechMisfire' }], reading);
    assert.deepEqual(effects, [{ type: 'pauseReading' }, { type: 'resumeReading' }]);
    assert.deepEqual(phases, ['hearing', 'speaking']);
  });

  it('catches its own voice: reading goes on, and voice no longer interrupts', () => {
    const reading = run([...on, { type: 'speakerStarted' }]).state;
    const echo = run(
      [
        { type: 'speechStart' },
        { type: 'speechEnd' },
        { type: 'transcribed', text: 'Heute stehen drei Dinge an', echo: true },
      ],
      reading,
    );
    assert.deepEqual(echo.effects, [
      { type: 'pauseReading' },
      { type: 'transcribe' },
      { type: 'resumeReading' },
    ]);
    assert.equal(echo.state.bargeIn, false);
    assert.equal(echo.state.notice, 'echo');
    assert.equal(conversationPhase(echo.state), 'speaking');
    // The next sound while reading is not taken for the owner.
    const after = run([{ type: 'speechStart' }, { type: 'speechEnd' }], echo.state);
    assert.deepEqual(after.effects, [{ type: 'discardUtterance' }]);
    assert.deepEqual(after.phases, ['speaking', 'speaking']);
    // Once the reading is over, the owner is heard again.
    const listening = run(
      [{ type: 'speakerIdle' }, { type: 'speechStart' }, { type: 'speechEnd' }],
      after.state,
    );
    assert.deepEqual(listening.effects, [{ type: 'transcribe' }]);
  });

  it('stops reading at the press of "Unterbrechen" and listens', () => {
    const reading = run([...on, { type: 'speakerStarted' }]).state;
    const { effects, phases } = run([{ type: 'interrupt' }, { type: 'speakerIdle' }], reading);
    assert.deepEqual(effects, [{ type: 'dropReading' }]);
    assert.deepEqual(phases, ['listening', 'listening']);
  });

  it('stops everything at once, and ignores what arrives afterwards', () => {
    const busy = run([...on, { type: 'speechStart' }, { type: 'speechEnd' }]).state;
    const stopped = run(
      [{ type: 'stop' }, { type: 'transcribed', text: 'Hallo', echo: false }],
      busy,
    );
    assert.deepEqual(stopped.effects, [{ type: 'stopAll' }]);
    assert.deepEqual(stopped.phases, ['off', 'off']);
  });
});

describe('looksLikeEcho', () => {
  const reading = 'Heute stehen drei Dinge an: der Launch, die Mails und das Budget.';

  it('recognizes the reading, misheard a little', () => {
    assert.equal(looksLikeEcho('heute stehen drei dinge an der lunch', reading), true);
    assert.equal(looksLikeEcho('Die Mails.', reading), true);
  });

  it('does not take the owner for an echo', () => {
    assert.equal(looksLikeEcho('Stopp, erzähl mir lieber vom Wetter.', reading), false);
    assert.equal(looksLikeEcho('Warte mal', reading), false);
    assert.equal(looksLikeEcho('', reading), false);
  });
});
