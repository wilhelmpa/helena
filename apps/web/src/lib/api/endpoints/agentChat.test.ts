import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

import { resumeAiAgentChat, streamAiAgentChat } from './agentChat';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function answerStream(text: string): Response {
  const body = [
    `id: 1\ndata: ${JSON.stringify({ type: 'RUN_STARTED' })}`,
    `id: 2\ndata: ${JSON.stringify({
      type: 'TEXT_MESSAGE_CONTENT',
      messageId: 'answer-1',
      delta: text,
    })}`,
    `id: 3\ndata: ${JSON.stringify({ type: 'RUN_FINISHED' })}`,
    '',
  ].join('\n\n');
  return new Response(body, { headers: { 'content-type': 'text/event-stream' } });
}

function requestSummary(input: RequestInfo | URL, init?: RequestInit) {
  const url = new URL(String(input));
  return { path: url.pathname + url.search, method: init?.method ?? 'GET' };
}

describe('external agent chat transport', () => {
  it('reports the persisted thread before waiting for its answer', async () => {
    const requests: { path: string; method: string }[] = [];
    globalThis.fetch = (async (input, init) => {
      requests.push(requestSummary(input, init));
      if (init?.method === 'POST') {
        return Response.json({ threadId: 'chat:4:user:thread', messageId: 11 });
      }
      return answerStream('Done.');
    }) as typeof fetch;

    const stream = streamAiAgentChat('team:7', 4, { prompt: 'Start' });
    assert.deepEqual((await stream.next()).value, {
      type: 'done',
      threadId: 'chat:4:user:thread',
    });
    assert.deepEqual(requests, [{ path: '/teams/7/ai-agents/4/chat', method: 'POST' }]);
    assert.deepEqual((await stream.next()).value, { type: 'text', value: 'Done.' });
    await stream.return(undefined);
  });

  it('reattaches to an existing answer without posting another prompt', async () => {
    const requests: { path: string; method: string }[] = [];
    globalThis.fetch = (async (input, init) => {
      requests.push(requestSummary(input, init));
      return answerStream('Continued.');
    }) as typeof fetch;

    const events = [];
    for await (const event of resumeAiAgentChat('team:7', 4, 11)) events.push(event);

    assert.deepEqual(events, [{ type: 'text', value: 'Continued.' }]);
    assert.deepEqual(requests, [
      {
        path: '/teams/7/ai-agents/4/chat/11/stream?after=0',
        method: 'GET',
      },
    ]);
  });
});
