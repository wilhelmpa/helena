import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  mergeNewestPage,
  mergeOlderPage,
  messageText,
  toUIMessage,
  type PlanUIMessage,
} from './chatMessages';
import { toolOutcome } from '@/components/agent-message/toolOutcome';

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

  it('restores a command that exited non-zero with output as an error with its exit code', () => {
    const ui = toUIMessage({
      id: '2',
      role: 'assistant',
      createdAt: '2026-09-23T10:00:00Z',
      parts: [
        {
          type: 'tool',
          toolCallId: 't',
          toolName: 'terminal',
          args: '{"cmd":"grep x y"}',
          result: '',
          isError: true,
          outcome: 'nonzero_with_output',
          exitCode: 1,
        },
      ],
    });
    const [part] = ui.parts;
    assert.equal(part.type === 'dynamic-tool' && part.state, 'output-error');
    assert.deepEqual(part.type === 'dynamic-tool' && toolOutcome(part), {
      outcome: 'nonzero_with_output',
      exitCode: 1,
    });
  });

  it('keeps the reported runtime, model and fallback on a restored answer', () => {
    const check = {
      runtime: 'hermes',
      configured: { model: 'helena-local/qwen', reasoning: null, source: 'agent' as const },
      used: { model: 'openai/gpt-6-luna', reasoning: null, provider: 'openai' },
      mismatch: [] as ('model' | 'reasoning')[],
      fallback: { from: 'helena-local/qwen', reason: 'down' as const },
    };
    const ui = toUIMessage({
      id: '3',
      role: 'assistant',
      createdAt: '2026-09-23T10:00:00Z',
      parts: [{ type: 'text', text: 'Answer' }],
      modelCheck: check,
    });
    assert.deepEqual(ui.metadata?.modelCheck, check);
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
