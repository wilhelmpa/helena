import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { Chat } from '@ai-sdk/react';
import { chatStreamConfig } from '@/lib/api/endpoints/agentChat';
import { PlanChatTransport } from './planChatTransport';
import type { PlanUIMessage } from '../utils/chatMessages';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function sse(events: object[]): Response {
  const body = events
    .map((event, i) => `id: ${i + 1}\ndata: ${JSON.stringify(event)}`)
    .join('\n\n');
  return new Response(body + '\n\n', { headers: { 'content-type': 'text/event-stream' } });
}

type Call = { method: string; path: string; body?: unknown };

function fakeApi(answer: object[]) {
  const calls: Call[] = [];
  globalThis.fetch = (async (input, init) => {
    const url = new URL(String(input));
    const call: Call = { method: init?.method ?? 'GET', path: url.pathname + url.search };
    if (init?.body) call.body = JSON.parse(String(init.body));
    calls.push(call);
    if (url.pathname.endsWith('/chat')) {
      return Response.json({ threadId: 'chat:4:u:t', messageId: 12, userMessageId: 11 });
    }
    if (url.pathname.endsWith('/chat/retry')) {
      return Response.json({ threadId: 'chat:4:u:t', messageId: 13 });
    }
    if (url.pathname.endsWith('/cancel')) return new Response(null, { status: 204 });
    return sse(answer);
  }) as typeof fetch;
  return calls;
}

const answer = [
  { type: 'RUN_STARTED' },
  { type: 'THINKING_TEXT_MESSAGE_CONTENT', delta: 'Look at the build.' },
  { type: 'TOOL_CALL_START', toolCallId: 't1', toolCallName: 'terminal' },
  { type: 'TOOL_CALL_ARGS', toolCallId: 't1', delta: '{"command":"make"}' },
  { type: 'TOOL_CALL_END', toolCallId: 't1' },
  { type: 'TOOL_CALL_RESULT', toolCallId: 't1', content: 'exit 2', isError: true },
  { type: 'TOOL_CALL_START', toolCallId: 't2', toolCallName: 'read_file' },
  { type: 'TOOL_CALL_RESULT', toolCallId: 't2', content: '{"lines":3}' },
  { type: 'TEXT_MESSAGE_CONTENT', delta: 'The build ' },
  { type: 'TEXT_MESSAGE_CONTENT', delta: 'fails.' },
  { type: 'RUN_FINISHED' },
];

// A text or reasoning part without the fields the SDK adds that the chat does not read.
const plain = (part: PlanUIMessage['parts'][number]) =>
  'text' in part ? { type: part.type, text: part.text, state: part.state } : part;

function chatWith(transport: PlanChatTransport, messages: PlanUIMessage[] = []) {
  const turns: unknown[] = [];
  const chat = new Chat<PlanUIMessage>({
    id: 'test',
    transport,
    messages,
    onData: (part) => turns.push(part.data),
  });
  return { chat, turns };
}

describe('PlanChatTransport', () => {
  it("streams Plan's answer into an AI SDK message with reasoning, tools and text", async () => {
    const calls = fakeApi(answer);
    const transport = new PlanChatTransport('WEB', 4);
    const { chat, turns } = chatWith(transport);

    await chat.sendMessage({ text: 'Why does it fail?' }, { body: { files: ['Home/log.txt'] } });

    assert.equal(chat.status, 'ready');
    assert.equal(transport.threadId, 'chat:4:u:t');
    assert.deepEqual(calls[0], {
      method: 'POST',
      path: '/projects/WEB/ai-agents/4/chat',
      body: { prompt: 'Why does it fail?', attachments: { files: ['Home/log.txt'] } },
    });
    assert.equal(calls[1].path, '/projects/WEB/ai-agents/4/chat/12/stream');
    assert.deepEqual(turns, [
      { threadId: 'chat:4:u:t', questionId: '11', clientId: chat.messages[0].id },
    ]);

    const reply = chat.messages[1];
    assert.equal(reply.id, '12');
    assert.equal(reply.metadata?.agentId, 4);
    assert.deepEqual(
      reply.parts.map((part) => part.type),
      ['reasoning', 'dynamic-tool', 'dynamic-tool', 'text'],
    );
    const [reasoning, failed, read, text] = reply.parts;
    assert.deepEqual(plain(reasoning), {
      type: 'reasoning',
      text: 'Look at the build.',
      state: 'done',
    });
    assert.ok(failed.type === 'dynamic-tool' && read.type === 'dynamic-tool');
    assert.equal(failed.state, 'output-error');
    assert.deepEqual(failed.input, { command: 'make' });
    assert.equal(failed.errorText, 'exit 2');
    assert.equal(read.state, 'output-available');
    assert.equal(read.output, '{"lines":3}');
    assert.deepEqual(plain(text), { type: 'text', text: 'The build fails.', state: 'done' });
  });

  it('continues the thread from the message shown last, and edits from a given one', async () => {
    const calls = fakeApi([
      { type: 'TEXT_MESSAGE_CONTENT', delta: 'Ok.' },
      { type: 'RUN_FINISHED' },
    ]);
    const transport = new PlanChatTransport('team:7', 4);
    transport.threadId = 'chat:4:u:t';
    const { chat } = chatWith(transport, [
      { id: '5', role: 'user', parts: [{ type: 'text', text: 'First' }] },
      { id: '6', role: 'assistant', parts: [{ type: 'text', text: 'Answer' }] },
    ]);

    await chat.sendMessage(
      { text: 'Next' },
      { body: { agentId: 9, model: 'm', thinkingLevel: null } },
    );
    assert.deepEqual(calls[0], {
      method: 'POST',
      path: '/teams/7/ai-agents/9/chat',
      body: {
        prompt: 'Next',
        threadId: 'chat:4:u:t',
        parentId: 6,
        model: 'm',
        thinkingLevel: null,
      },
    });

    await chat.sendMessage({ text: 'First, edited', messageId: '5' }, { body: { parentId: null } });
    const edit = calls.find((call, i) => i > 1 && call.method === 'POST');
    assert.deepEqual(edit?.body, {
      prompt: 'First, edited',
      threadId: 'chat:4:u:t',
      parentId: null,
    });
    assert.deepEqual(
      chat.messages.map((message) => message.role),
      ['user', 'assistant'],
    );
  });

  it('answers the question again next to the answer it had', async () => {
    const calls = fakeApi([
      { type: 'TEXT_MESSAGE_CONTENT', delta: 'Again.' },
      { type: 'RUN_FINISHED' },
    ]);
    const transport = new PlanChatTransport('WEB', 4);
    transport.threadId = 'chat:4:u:t';
    const { chat } = chatWith(transport, [
      { id: '5', role: 'user', parts: [{ type: 'text', text: 'Q' }] },
      { id: '6', role: 'assistant', parts: [{ type: 'text', text: 'A' }] },
    ]);

    await chat.regenerate({ messageId: '6' });
    assert.deepEqual(calls[0], {
      method: 'POST',
      path: '/projects/WEB/ai-agents/4/chat/retry',
      body: { threadId: 'chat:4:u:t', questionId: 5 },
    });
    assert.deepEqual(
      chat.messages.map((message) => [message.id, plain(message.parts[0])]),
      [
        ['5', { type: 'text', text: 'Q', state: undefined }],
        ['13', { type: 'text', text: 'Again.', state: 'done' }],
      ],
    );
  });

  it('resumes an answer that was running, and keeps the error of a failed one', async () => {
    fakeApi([
      { type: 'TEXT_MESSAGE_CONTENT', delta: 'Half' },
      { type: 'RUN_ERROR', message: 'Provider refused' },
    ]);
    const transport = new PlanChatTransport('WEB', 4);
    transport.resume = { messageId: 20, agentId: 4 };
    const { chat } = chatWith(transport, [
      { id: '19', role: 'user', parts: [{ type: 'text', text: 'Q' }] },
      { id: '20', role: 'assistant', parts: [] },
    ]);

    await chat.resumeStream();
    assert.equal(chat.messages.length, 2);
    assert.equal(chat.messages[1].id, '20');
    assert.deepEqual(chat.messages[1].parts.map(plain), [
      { type: 'text', text: 'Half', state: 'done' },
    ]);
    assert.equal(chat.messages[1].metadata?.error, 'Provider refused');
    assert.equal(transport.resume, null);
  });

  it('only closes the stream when the chat is left, and stops the answer on cancel', async () => {
    const calls: Call[] = [];
    globalThis.fetch = (async (input, init) => {
      const url = new URL(String(input));
      calls.push({ method: init?.method ?? 'GET', path: url.pathname });
      if (url.pathname.endsWith('/chat')) {
        return Response.json({ threadId: 't', messageId: 12, userMessageId: 11 });
      }
      if (url.pathname.endsWith('/cancel')) return new Response(null, { status: 204 });
      // A stream that stays open until the request is aborted.
      return new Promise<Response>((_, reject) =>
        init?.signal?.addEventListener('abort', () =>
          reject(new DOMException('aborted', 'AbortError')),
        ),
      );
    }) as typeof fetch;
    const transport = new PlanChatTransport('WEB', 4);
    const { chat } = chatWith(transport);

    const sending = chat.sendMessage({ text: 'Long job' });
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.deepEqual(transport.active, { agentId: 4, messageId: 12 });
    // Leaving the conversation (the view unmounts) only stops following the answer —
    // the agent keeps working, the chat list shows it running.
    await chat.stop();
    await sending;
    assert.equal(chat.status, 'ready');
    assert.ok(!calls.some((call) => call.path.endsWith('/cancel')));

    // Pressing stop is its own request.
    transport.active = { agentId: 4, messageId: 12 };
    await transport.cancel();
    assert.ok(calls.some((call) => call.path === '/projects/WEB/ai-agents/4/chat/12/cancel'));
  });

  it('keeps reading through events that map to nothing (the answer used to hang)', async () => {
    // What a real runner sends: lifecycle events without anything to show, one after
    // another, each arriving on its own. A stream that handed over nothing on a pull was
    // never pulled again and stayed at "Thinking …" with the whole answer already sent.
    const events = [
      { type: 'RUN_STARTED' },
      { role: 'assistant', type: 'TEXT_MESSAGE_START', messageId: 'msg-12' },
      { type: 'TEXT_MESSAGE_CONTENT', delta: 'OK', messageId: 'msg-12' },
      { type: 'TEXT_MESSAGE_END', messageId: 'msg-12' },
      { type: 'RUN_FINISHED' },
    ];
    globalThis.fetch = (async (input) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith('/chat')) {
        return Response.json({ threadId: 't', messageId: 12, userMessageId: 11 });
      }
      const encoder = new TextEncoder();
      const body = new ReadableStream<Uint8Array>({
        async start(controller) {
          for (const [i, event] of events.entries()) {
            await new Promise((resolve) => setTimeout(resolve, 5));
            controller.enqueue(encoder.encode(`id: ${i + 1}\ndata: ${JSON.stringify(event)}\n\n`));
          }
          controller.close();
        },
      });
      return new Response(body, { headers: { 'content-type': 'text/event-stream' } });
    }) as typeof fetch;
    const { chat } = chatWith(new PlanChatTransport('WEB', 4));

    await Promise.race([
      chat.sendMessage({ text: 'Test: answer only with OK.' }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('The answer hung')), 2000)),
    ]);
    assert.equal(chat.status, 'ready');
    assert.deepEqual(chat.messages[1].parts.map(plain), [
      { type: 'text', text: 'OK', state: 'done' },
    ]);
  });

  it('picks a dropped stream up after the last event, and marks an answer it lost', async () => {
    const saved = { ...chatStreamConfig };
    chatStreamConfig.backoffMs = 1;
    chatStreamConfig.retries = 2;
    try {
      const streams: (string | null)[] = [];
      globalThis.fetch = (async (input, init) => {
        const url = new URL(String(input));
        if (url.pathname.endsWith('/chat')) {
          return Response.json({ threadId: 't', messageId: 12, userMessageId: 11 });
        }
        streams.push(new Headers(init?.headers).get('last-event-id'));
        // The first connection delivers half the answer and drops; every later one
        // fails outright.
        if (streams.length > 1) throw new TypeError('network error');
        return new Response(
          `id: 7\ndata: ${JSON.stringify({ type: 'TEXT_MESSAGE_CONTENT', delta: 'Half' })}\n\n`,
          { headers: { 'content-type': 'text/event-stream' } },
        );
      }) as typeof fetch;
      const { chat } = chatWith(new PlanChatTransport('WEB', 4));

      await chat.sendMessage({ text: 'Q' });
      assert.deepEqual(streams, [null, '7', '7', '7']);
      assert.equal(chat.status, 'ready');
      assert.equal(chat.messages[1].metadata?.interrupted, true);
      assert.deepEqual(chat.messages[1].parts.map(plain), [
        { type: 'text', text: 'Half', state: 'done' },
      ]);
    } finally {
      Object.assign(chatStreamConfig, saved);
    }
  });
});
