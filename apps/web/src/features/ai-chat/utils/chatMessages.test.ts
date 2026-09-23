import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { messageBlocks, messageText, toUIMessage, type PlanUIMessage } from './chatMessages';

describe('messageBlocks', () => {
  it('groups the parts of an answer into text, reasoning and tool blocks in order', () => {
    const message: Pick<PlanUIMessage, 'parts'> = {
      parts: [
        { type: 'reasoning', text: 'Let me check the file.', state: 'done' },
        {
          type: 'dynamic-tool',
          toolCallId: 't1',
          toolName: 'read_file',
          state: 'output-available',
          input: { path: 'a.ts' },
          output: 'contents',
        },
        {
          type: 'dynamic-tool',
          toolCallId: 't2',
          toolName: 'read_file',
          state: 'output-available',
          input: { path: 'b.ts' },
          output: 'contents',
        },
        { type: 'text', text: 'Both files look fine.', state: 'done' },
      ],
    };

    const blocks = messageBlocks(message);
    assert.equal(blocks.length, 3);
    assert.deepEqual(blocks[0], { kind: 'reasoning', text: 'Let me check the file.' });
    assert.equal(blocks[1].kind, 'tools');
    assert.equal(blocks[1].kind === 'tools' ? blocks[1].tools.length : 0, 2);
    assert.deepEqual(blocks[2], { kind: 'text', text: 'Both files look fine.' });
  });

  it('starts a new tool block once text or reasoning comes between two calls', () => {
    const message: Pick<PlanUIMessage, 'parts'> = {
      parts: [
        {
          type: 'dynamic-tool',
          toolCallId: 't1',
          toolName: 'a',
          state: 'output-available',
          input: {},
          output: '',
        },
        { type: 'text', text: 'checking further', state: 'done' },
        {
          type: 'dynamic-tool',
          toolCallId: 't2',
          toolName: 'b',
          state: 'output-available',
          input: {},
          output: '',
        },
      ],
    };
    const blocks = messageBlocks(message);
    assert.equal(blocks.length, 3);
    assert.equal(blocks[0].kind, 'tools');
    assert.equal(blocks[1].kind, 'text');
    assert.equal(blocks[2].kind, 'tools');
  });

  it('ignores parts of a type it does not draw a block for', () => {
    const message = {
      parts: [{ type: 'step-start' as const }],
    } as unknown as Pick<PlanUIMessage, 'parts'>;
    assert.deepEqual(messageBlocks(message), []);
  });
});

describe('toUIMessage / messageText', () => {
  it('joins a stored message back into the text the composer would have sent', () => {
    const ui = toUIMessage({
      id: '1',
      role: 'assistant',
      createdAt: '2026-09-23T10:00:00Z',
      parts: [
        { type: 'text', text: 'First part.' },
        { type: 'tool', toolCallId: 't', toolName: 'x', args: '{}', result: '{}' },
        { type: 'text', text: 'Second part.' },
      ],
    });
    assert.equal(messageText(ui), 'First part.\n\nSecond part.');
  });

  it('turns a failed tool call into an errored dynamic-tool part', () => {
    const ui = toUIMessage({
      id: '2',
      role: 'assistant',
      createdAt: '2026-09-23T10:00:00Z',
      parts: [
        {
          type: 'tool',
          toolCallId: 't',
          toolName: 'run',
          args: '{"cmd":"ls"}',
          result: 'permission denied',
          isError: true,
        },
      ],
    });
    const [part] = ui.parts;
    assert.equal(part.type, 'dynamic-tool');
    assert.equal(part.state === 'output-error' ? part.errorText : undefined, 'permission denied');
  });
});
