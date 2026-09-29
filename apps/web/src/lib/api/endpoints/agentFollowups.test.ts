import assert from 'node:assert/strict';
import { afterEach, it } from 'node:test';
import { followupEvent, mergeFollowup, type Followup } from './agentFollowups';
import { chatStreamConfig, streamAnswerEvents } from './agentChat';

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});
it('resumes message_injected states through the existing SSE reconnect path', async () => {
  const saved = { ...chatStreamConfig };
  chatStreamConfig.backoffMs = 1;
  try {
    const cursors: (string | null)[] = [];
    const instruction = {
      id: 'instruction-1',
      mode: 'inject',
      prompt: 'Continue here',
      nextId: null,
    };
    globalThis.fetch = (async (_input, init) => {
      cursors.push(new Headers(init?.headers).get('last-event-id'));
      const event = {
        type: 'CUSTOM',
        name: 'message_injected',
        value: { ...instruction, state: cursors.length === 1 ? 'pending' : 'applied' },
      };
      const frames = `id: ${cursors.length}\ndata: ${JSON.stringify(event)}\n\n`;
      return new Response(
        frames + (cursors.length > 1 ? 'id: 3\ndata: {"type":"RUN_FINISHED"}\n\n' : ''),
        { headers: { 'content-type': 'text/event-stream' } },
      );
    }) as typeof fetch;
    const states = [];
    for await (const event of streamAnswerEvents('VOL', 1, 2, undefined, {
      cancelOnAbort: false,
    })) {
      const instruction = followupEvent(event);
      if (instruction) states.push(instruction.state);
    }
    assert.deepEqual(cursors, [null, '1']);
    assert.deepEqual(states, ['pending', 'applied']);
  } finally {
    Object.assign(chatStreamConfig, saved);
  }
});

it('a late POST response cannot regress an applied stream state or reorder instructions', () => {
  const first: Followup = {
    id: 'first',
    mode: 'inject',
    prompt: 'first',
    state: 'pending',
    nextId: null,
  };
  const second: Followup = { ...first, id: 'second' };
  const applied = mergeFollowup([first, second], { ...first, state: 'applied' });
  assert.deepEqual(
    mergeFollowup(applied, first).map((item) => [item.id, item.state]),
    [
      ['first', 'applied'],
      ['second', 'pending'],
    ],
  );
});
