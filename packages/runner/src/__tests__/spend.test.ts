import { describe, expect, it } from 'bun:test';
import { Redactor } from '../redact';
import { SpendReader } from '../spend';

// The lines a real `hermes chat --format stream-json` wrote for a run of two model calls
// against a scripted model (1200 tokens read, 800 of them from cache, 40 written, per call).
const HERMES_RUN = [
  '{"type": "system", "subtype": "init", "model": "fake-model", "session_id": "20260924_102846_e310ba", "timestamp": 1790238526622}',
  '{"type": "tool_use", "name": "terminal", "input": {"command": "echo hallo-aus-dem-test"}, "timestamp": 1790238536402}',
  '{"type": "text", "text": "Fertig.", "timestamp": 1790238536463}',
  '{"type": "result", "session_id": "20260924_102846_e310ba", "exit_code": 0, "text": "Fertig.", "tokens": {"input": 800, "output": 80, "total": 2480, "cache_read": 1600, "cache_write": 0}, "duration_ms": 9870, "timestamp": 1790238536493}',
].join('\n');

describe('SpendReader', () => {
  it('sums a Hermes run in the GenAI shape, with the model it ran', () => {
    const reader = new SpendReader('hermes-stream-json', 'hermes');
    // Split mid-line, as a pipe delivers it.
    reader.write(HERMES_RUN.slice(0, 100));
    reader.write(HERMES_RUN.slice(100));
    expect(reader.value({ model: null, provider: 'custom' })).toEqual({
      runtime: 'hermes',
      model: 'fake-model',
      provider: 'custom',
      inputTokens: 2400,
      outputTokens: 80,
      cacheReadTokens: 1600,
      cacheWriteTokens: 0,
      reasoningTokens: 0,
      durationMs: 9870,
    });
  });

  it('reads the closing result of Claude Code', () => {
    const reader = new SpendReader('claude-stream-json', 'claude');
    reader.write(
      [
        JSON.stringify({ type: 'system', subtype: 'init', model: 'claude-sonnet-4-6' }),
        JSON.stringify({
          type: 'result',
          duration_ms: 1200,
          usage: {
            input_tokens: 10,
            cache_read_input_tokens: 300,
            cache_creation_input_tokens: 40,
            output_tokens: 90,
          },
        }),
        '',
      ].join('\n'),
    );
    expect(reader.value()).toMatchObject({
      model: 'claude-sonnet-4-6',
      inputTokens: 350,
      cacheReadTokens: 300,
      cacheWriteTokens: 40,
      outputTokens: 90,
      durationMs: 1200,
    });
  });

  it('sums the turns of Codex and takes the asked model', () => {
    const reader = new SpendReader('codex-jsonl', 'codex');
    const turn = JSON.stringify({
      type: 'turn.completed',
      usage: {
        input_tokens: 500,
        cached_input_tokens: 200,
        output_tokens: 30,
        reasoning_output_tokens: 10,
      },
    });
    reader.write(`${turn}\n${turn}\n`);
    expect(reader.value({ model: 'gpt-6-luna' })).toMatchObject({
      model: 'gpt-6-luna',
      inputTokens: 1000,
      cacheReadTokens: 400,
      outputTokens: 60,
      reasoningTokens: 20,
    });
  });

  it('reports nothing for output without counts', () => {
    const reader = new SpendReader('text', null);
    reader.write('hello\n');
    expect(reader.value()).toBeNull();
  });
});

describe('Redactor', () => {
  it('masks known values, common key forms and what secretlint knows', async () => {
    const redactor = new Redactor(['the-agent-api-key-123', 'short']);
    const text = await redactor.text(
      'key the-agent-api-key-123, short stays, sk-proj-abcdefghijklmnopqrstuv, ' +
        'Authorization: Bearer abcdefghijklmnop.qrstuvwxyz, ' +
        'ghp_1234567890abcdefghijABCDEFGHIJ123456 and postgres://user:pw12345@db:5432/app',
    );
    expect(text).not.toContain('the-agent-api-key-123');
    expect(text).toContain('short stays');
    expect(text).not.toContain('sk-proj-abcdefghijklmnopqrstuv');
    expect(text).toContain('Bearer [redacted]');
    expect(text).not.toContain('ghp_1234567890');
    expect(text).not.toContain('pw12345');
  });

  it('walks JSON values and keeps the keys', async () => {
    const redactor = new Redactor(['secret-value-42']);
    expect(
      await redactor.value({ secret: 'x secret-value-42', list: ['secret-value-42', 3] }),
    ).toEqual({
      secret: 'x [redacted]',
      list: ['[redacted]', 3],
    });
  });
});
