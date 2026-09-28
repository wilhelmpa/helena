import { describe, expect, it } from 'bun:test';
import { DEFAULT_JUDGE, judgePrompt, normalizeJudge, runJudge } from '../../judge';
import { cliJudgeArgs, cliJudgeText } from '../../judge-cli';

// The judge of the evals a program cannot check (docs/helena-decisions/halogen.md §7).

describe('judge settings', () => {
  it('default to a text-only run on gpt-6-sol', () => {
    expect(normalizeJudge(null)).toEqual(DEFAULT_JUDGE);
    expect(DEFAULT_JUDGE).toMatchObject({ kind: 'run', model: 'gpt-6-sol' });
  });

  it('keep what is valid and drop the rest', () => {
    expect(
      normalizeJudge({
        kind: 'endpoint',
        model: ' opus ',
        agentId: -3,
        baseUrl: 'https://judge.example/v1',
        extra: true,
      }),
    ).toEqual({
      kind: 'endpoint',
      model: 'opus',
      reasoning: null,
      agentId: null,
      baseUrl: 'https://judge.example/v1',
    });
    expect(normalizeJudge({ kind: 'weird' })).toEqual(DEFAULT_JUDGE);
  });
});

describe('a run judge', () => {
  it('queues one text-only run and answers its output', async () => {
    const queued: { prompt: string; model: string | null }[] = [];
    let polls = 0;
    const judge = runJudge(
      { model: 'gpt-6-sol', reasoning: 'medium' },
      {
        async queue(prompt, choice) {
          queued.push({ prompt, model: choice.model });
          return 41;
        },
        async state(id) {
          expect(id).toBe(41);
          polls++;
          return polls < 3
            ? { status: 'pending', output: null, error: null }
            : { status: 'success', output: '{"score": 88, "reason": "gut"}', error: null };
        },
        sleep: async () => undefined,
      },
    );
    const answer = await judge({ system: 'Bewerte.', prompt: 'Antwort: Hallo', json: true });
    expect(answer.text).toBe('{"score": 88, "reason": "gut"}');
    expect(queued).toEqual([
      { prompt: 'Anweisung: Bewerte.\n\nAntwort: Hallo', model: 'gpt-6-sol' },
    ]);
    expect(polls).toBe(3);
  });

  it('fails with the run when it fails, and when it takes too long', async () => {
    const failed = runJudge(
      { model: 'gpt-6-sol', reasoning: null },
      {
        queue: async () => 7,
        state: async () => ({ status: 'failed', output: null, error: 'model not supported' }),
        sleep: async () => undefined,
      },
    );
    await expect(failed({ prompt: 'x' })).rejects.toThrow(
      'judge run 7 failed: model not supported',
    );
    let clock = 0;
    const slow = runJudge(
      { model: 'gpt-6-sol', reasoning: null },
      {
        queue: async () => 8,
        state: async () => ({ status: 'pending', output: null, error: null }),
        sleep: async () => {
          clock += 60_000;
        },
        now: () => clock,
      },
      120_000,
    );
    await expect(slow({ prompt: 'x' })).rejects.toThrow('did not answer in time');
  });

  it('puts the case instructions before the text', () => {
    expect(judgePrompt({ prompt: 'nur Text' })).toBe('nur Text');
  });
});

describe('the owner CLI as judge', () => {
  it('runs Claude Code without tools, settings or MCP servers', () => {
    const args = cliJudgeArgs('claude', 'opus', { system: 'Nur JSON.', prompt: 'x' });
    expect(args).toEqual([
      '-p',
      '--model',
      'opus',
      '--tools',
      '',
      '--setting-sources',
      '',
      '--strict-mcp-config',
      '--output-format',
      'json',
      '--system-prompt',
      'Nur JSON.',
    ]);
    expect(cliJudgeArgs('codex', 'gpt-6-sol', { prompt: 'x' })).toContain('read-only');
  });

  it('reads the answer text of either CLI', () => {
    expect(cliJudgeText('claude', '{"result": "{\\"score\\": 90}", "is_error": false}')).toBe(
      '{"score": 90}',
    );
    expect(() => cliJudgeText('claude', '{"result": "quota", "is_error": true}')).toThrow('quota');
    const codex = [
      '{"type":"thread.started"}',
      '{"type":"item.completed","item":{"type":"reasoning","text":"…"}}',
      '{"type":"item.completed","item":{"type":"agent_message","text":"{\\"score\\": 71}"}}',
    ].join('\n');
    expect(cliJudgeText('codex', codex)).toBe('{"score": 71}');
  });
});
