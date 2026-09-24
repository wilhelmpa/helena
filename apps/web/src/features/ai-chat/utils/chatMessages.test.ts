import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  mergeNewestPage,
  mergeOlderPage,
  messageText,
  toUIMessage,
  type PlanUIMessage,
} from './chatMessages';

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

describe('merging transcript pages', () => {
  const message = (id: string, text = id): PlanUIMessage => ({
    id,
    role: 'user',
    parts: [{ type: 'text', text }],
  });

  it('puts an older page in front without repeating what is already shown', () => {
    const merged = mergeOlderPage(
      [message('3'), message('4')],
      [message('1'), message('2'), message('3')],
    );
    assert.deepEqual(
      merged.map((m) => m.id),
      ['1', '2', '3', '4'],
    );
  });

  it("lets the server's newest page replace the streamed turns, keeping older ones", () => {
    const merged = mergeNewestPage(
      [message('1'), message('2'), message('3', 'streamed')],
      [message('2'), message('3', 'stored')],
    );
    assert.deepEqual(
      merged.map((m) => [m.id, messageText(m)]),
      [
        ['1', '1'],
        ['2', '2'],
        ['3', 'stored'],
      ],
    );
  });
});
