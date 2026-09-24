import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

import { chatStreamConfig, streamAnswerEvents, type AgUiEvent } from './agentChat';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

const sse = (body: string) =>
  new Response(body, { headers: { 'content-type': 'text/event-stream' } });

async function collect(stream: AsyncGenerator<AgUiEvent>): Promise<AgUiEvent[]> {
  const events: AgUiEvent[] = [];
  for await (const event of stream) events.push(event);
  return events;
}

describe('streamAnswerEvents', () => {
  it('reads the stream as the SSE standard writes it: CRLF, comments, multi-line data', async () => {
    const requests: { path: string; lastEventId: string | null }[] = [];
    globalThis.fetch = (async (input, init) => {
      const url = new URL(String(input));
      requests.push({
        path: url.pathname + url.search,
        lastEventId: new Headers(init?.headers).get('last-event-id'),
      });
      return sse(
        [
          ': keep-alive',
          'id: 1\r\ndata: {"type":"RUN_STARTED"}',
          // One JSON event split over two data lines is joined with a newline.
          'id: 2\ndata: {"type":"TEXT_MESSAGE_CONTENT",\ndata: "delta":"Hi"}',
          'id: 3\ndata: {"type":"RUN_FINISHED"}',
          '',
        ].join('\n\n'),
      );
    }) as typeof fetch;

    const events = await collect(
      streamAnswerEvents('team:7', 4, 11, undefined, { cancelOnAbort: false }),
    );

    assert.deepEqual(events, [
      { type: 'RUN_STARTED' },
      { type: 'TEXT_MESSAGE_CONTENT', delta: 'Hi' },
      { type: 'RUN_FINISHED' },
    ]);
    // A fresh follow starts at the first event: no Last-Event-ID, no query.
    assert.deepEqual(requests, [
      { path: '/teams/7/ai-agents/4/chat/11/stream', lastEventId: null },
    ]);
  });

  it('resumes a dropped stream with Last-Event-ID, after the delay the server asked for', async () => {
    const saved = { ...chatStreamConfig };
    chatStreamConfig.backoffMs = 5000;
    try {
      const sent: (string | null)[] = [];
      globalThis.fetch = (async (_input, init) => {
        sent.push(new Headers(init?.headers).get('last-event-id'));
        if (sent.length === 1) {
          // Half the answer, a 1 ms retry, and the connection drops.
          return sse('retry: 1\n\nid: 7\ndata: {"type":"TEXT_MESSAGE_CONTENT","delta":"Half"}\n\n');
        }
        return sse('id: 8\ndata: {"type":"RUN_FINISHED"}\n\n');
      }) as typeof fetch;

      const started = Date.now();
      const events = await collect(
        streamAnswerEvents('WEB', 4, 12, undefined, { cancelOnAbort: false }),
      );

      assert.deepEqual(sent, [null, '7']);
      assert.deepEqual(
        events.map((event) => event.type),
        ['TEXT_MESSAGE_CONTENT', 'RUN_FINISHED'],
      );
      // The server's `retry:` replaced the 5 s default.
      assert.ok(Date.now() - started < 2000);
    } finally {
      Object.assign(chatStreamConfig, saved);
    }
  });
});
