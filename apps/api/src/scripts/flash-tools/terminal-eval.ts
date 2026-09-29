import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runAgent } from '../../../../../packages/agent-runtime/src/agent';
import type { AgentRuntimeConfig } from '../../../../../packages/agent-runtime/src/config';
import { MemorySink } from '../../../../../packages/agent-runtime/src/events';
import { runShell } from '../../../../../packages/agent-runtime/src/tools/shell';

export const TERMINAL_CASES = [
  {
    id: '105b-terminal-owner-chain',
    prompt:
      'Run exactly this diagnostic command once: `ls && git status -sb | head -5 && head -50 AGENTS.md 2>/dev/null`. If AGENTS.md is absent, use the preceding output to report the branch and existing.txt; no retry needed.',
    command: 'ls && git status -sb | head -5 && head -50 AGENTS.md 2>/dev/null',
    outcome: 'nonzero_with_output',
  },
  {
    id: '105b-terminal-guarded-file',
    prompt:
      'Use shell to report the Git branch and optionally read AGENTS.md if it exists. Its absence is expected and must not fail the command.',
    outcome: 'ok',
  },
  {
    id: '105b-terminal-independent-checks',
    prompt:
      'Use shell to run independent checks: try optional AGENTS.md, then report the current Git branch. Guard the optional read so the command completes with code 0.',
    outcome: 'ok',
  },
  {
    id: '105b-terminal-no-match',
    prompt:
      'Run exactly: `git status -sb; git ls-files | grep AGENTS.md`. The grep may have no match. Use the preceding output to report the branch; no retry needed.',
    command: 'git status -sb; git ls-files | grep AGENTS.md',
    outcome: 'nonzero_with_output',
  },
] as const;

export async function runTerminalEval(options: {
  config: AgentRuntimeConfig;
  env: Record<string, string | undefined>;
  signal: AbortSignal;
  record?: (id: string, evidence: unknown) => Promise<void>;
}) {
  const cases = [];
  for (const entry of TERMINAL_CASES) {
    const workdir = await mkdtemp(join(tmpdir(), 'volition-terminal-eval-'));
    try {
      await runShell(
        'git init -q -b fix-navigation-bugs',
        workdir,
        { PATH: process.env.PATH! },
        3000,
        options.signal,
      );
      await writeFile(join(workdir, 'existing.txt'), 'Preserve this existing owner file.');
      const sink = new MemorySink();
      const result = await runAgent({
        config: {
          ...options.config,
          workdir,
          memory: { enabled: false },
          policy: 'allow',
          escalation: { mode: 'never' },
          tools: { profile: 'coder-lite', allowUnsandboxedShell: true },
          limits: { maxTurns: 6, runBudgetSeconds: 120 },
        },
        prompt: entry.prompt,
        sink,
        helena: null,
        env: { ...options.env, VOLITION_HALOGEN_PRIORITY: 'background' },
        signal: options.signal,
      });
      const calls = sink.of('tool-call').filter((event) => event.name === 'shell');
      const results = sink
        .of('tool-result')
        .filter((event) => calls.some((call) => call.id === event.id));
      const errors = sink.of('tool-result').filter((event) => event.isError).length;
      const exact =
        !('command' in entry) ||
        calls.some((event) => JSON.parse(event.input).command === entry.command);
      const passed =
        result.status === 'success' &&
        exact &&
        results.some((event) => event.outcome === entry.outcome) &&
        errors === 0 &&
        result.text.includes('fix-navigation-bugs');
      const evidence = { id: entry.id, passed, errors, result, events: sink.events };
      cases.push({ id: entry.id, passed, errors });
      await options.record?.(entry.id, evidence);
    } finally {
      await rm(workdir, { recursive: true, force: true });
    }
  }
  return {
    cases,
    score: cases.filter((entry) => entry.passed).length / cases.length,
    unnecessaryToolErrors: cases.reduce((total, entry) => total + entry.errors, 0),
  };
}
