import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readUIMessageStream } from 'ai';
import type { AgUiEvent } from '@/lib/api/endpoints/agentChat';
import { AgUiChunkMapper, type PlanChunk } from './agUiChunks';
import type { PlanUIMessage } from './chatMessages';

// Runs events through the mapper and the AI SDK's own message reader, so the test sees
// exactly the message the chat would render.
async function messageOf(events: AgUiEvent[], end = false): Promise<PlanUIMessage> {
  const mapper = new AgUiChunkMapper('7', { agentId: 1 });
  const chunks: PlanChunk[] = [...mapper.start(), ...events.flatMap((event) => mapper.map(event))];
  if (end) chunks.push(...mapper.end());
  const stream = new ReadableStream<PlanChunk>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
  });
  let last: PlanUIMessage | undefined;
  for await (const message of readUIMessageStream<PlanUIMessage>({ stream })) last = message;
  assert.ok(last);
  return last;
}

const plain = (message: PlanUIMessage) =>
  message.parts.map((part) =>
    part.type === 'text' || part.type === 'reasoning'
      ? { type: part.type, text: part.text }
      : part.type === 'dynamic-tool'
        ? {
            type: part.type,
            toolName: part.toolName,
            state: part.state,
            input: part.input,
            ...('output' in part && part.output !== undefined ? { output: part.output } : {}),
            ...('errorText' in part && part.errorText ? { errorText: part.errorText } : {}),
          }
        : { type: part.type },
  );

describe('AgUiChunkMapper', () => {
  it('reads the AG-UI 1.0 reasoning events and the older THINKING_* alike', async () => {
    const current = await messageOf([
      { type: 'RUN_STARTED' },
      { type: 'REASONING_MESSAGE_START' },
      { type: 'REASONING_MESSAGE_CONTENT', delta: 'Look at ' },
      { type: 'REASONING_MESSAGE_CONTENT', delta: 'the build.' },
      { type: 'REASONING_MESSAGE_END' },
      { type: 'TEXT_MESSAGE_CONTENT', delta: 'It fails.' },
      { type: 'RUN_FINISHED' },
    ]);
    const legacy = await messageOf([
      { type: 'RUN_STARTED' },
      { type: 'THINKING_TEXT_MESSAGE_CONTENT', delta: 'Look at the build.' },
      { type: 'TEXT_MESSAGE_CONTENT', delta: 'It fails.' },
      { type: 'RUN_FINISHED' },
    ]);
    const expected = [
      { type: 'reasoning', text: 'Look at the build.' },
      { type: 'text', text: 'It fails.' },
    ];
    assert.deepEqual(plain(current), expected);
    assert.deepEqual(plain(legacy), expected);
  });

  it('reads the *_CHUNK shorthands: text, reasoning and a tool call named by its first chunk', async () => {
    const message = await messageOf([
      { type: 'REASONING_MESSAGE_CHUNK', delta: 'Search first.' },
      { type: 'TOOL_CALL_CHUNK', toolCallId: 't1', toolCallName: 'web_search', delta: '{"q":' },
      { type: 'TOOL_CALL_CHUNK', delta: '"launch"}' },
      { type: 'TOOL_CALL_END', toolCallId: 't1' },
      { type: 'TOOL_CALL_RESULT', toolCallId: 't1', content: '3 hits' },
      { type: 'TEXT_MESSAGE_CHUNK', delta: 'Found 3.' },
      { type: 'RUN_FINISHED' },
    ]);
    assert.deepEqual(plain(message), [
      { type: 'reasoning', text: 'Search first.' },
      {
        type: 'dynamic-tool',
        toolName: 'web_search',
        state: 'output-available',
        input: { q: 'launch' },
        output: '3 hits',
      },
      { type: 'text', text: 'Found 3.' },
    ]);
  });

  it('marks a failed tool from the result metadata (AG-UI 1.0) or the older isError flag', async () => {
    const message = await messageOf([
      { type: 'TOOL_CALL_START', toolCallId: 'a', toolCallName: 'terminal' },
      { type: 'TOOL_CALL_RESULT', toolCallId: 'a', content: 'exit 2', metadata: { isError: true } },
      { type: 'TOOL_CALL_START', toolCallId: 'b', toolCallName: 'terminal' },
      { type: 'TOOL_CALL_RESULT', toolCallId: 'b', content: 'exit 1', isError: true },
      { type: 'RUN_FINISHED' },
    ]);
    const states = message.parts.map((part) =>
      part.type === 'dynamic-tool' ? [part.state, part.errorText] : null,
    );
    assert.deepEqual(states, [
      ['output-error', 'exit 2'],
      ['output-error', 'exit 1'],
    ]);
  });

  it('flattens a result given as AG-UI content parts to its text', async () => {
    const message = await messageOf([
      { type: 'TOOL_CALL_START', toolCallId: 'a', toolCallName: 'read' },
      {
        type: 'TOOL_CALL_RESULT',
        toolCallId: 'a',
        content: [{ type: 'text', text: 'line one' }] as unknown as string,
      },
      { type: 'RUN_FINISHED' },
    ]);
    const part = message.parts[0];
    assert.equal(
      part.type === 'dynamic-tool' && part.state === 'output-available' && part.output,
      'line one',
    );
  });

  it('ends a run error with the message, and a cut stream as interrupted', async () => {
    const failed = await messageOf([
      { type: 'TEXT_MESSAGE_CONTENT', delta: 'Half' },
      { type: 'RUN_ERROR', message: 'The runner gave up' },
    ]);
    assert.equal(failed.metadata?.error, 'The runner gave up');
    const cut = await messageOf([{ type: 'TEXT_MESSAGE_CONTENT', delta: 'Half' }], true);
    assert.equal(cut.metadata?.interrupted, true);
    assert.deepEqual(plain(cut), [{ type: 'text', text: 'Half' }]);
  });
});
