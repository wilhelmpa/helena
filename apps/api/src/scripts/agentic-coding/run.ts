import { spawn } from 'node:child_process';
import { lstat, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CODING_TASKS, type CodingTask } from './tasks';

interface ProcessResult {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

function run(
  command: string,
  args: string[],
  cwd: string,
  input = '',
  timeoutMs = 30_000,
): Promise<ProcessResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, timeoutMs);
    child.stdout.on('data', (data: Buffer) => {
      stdout += data.toString();
      if (stdout.length > 2_000_000) child.kill('SIGKILL');
    });
    child.stderr.on('data', (data: Buffer) => {
      stderr += data.toString().slice(0, 20_000);
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr, timedOut });
    });
    child.stdin.on('error', () => undefined);
    child.stdin.end(input);
  });
}

export function hermesMetrics(output: string) {
  let toolCalls = 0;
  let validToolCalls = 0;
  let loops = 0;
  let aborted = true;
  let inputTokens = 0;
  let outputTokens = 0;
  const seen = new Set<string>();
  for (const line of output.split('\n')) {
    let event: Record<string, unknown>;
    try {
      event = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue;
    }
    if (event.type === 'tool_use') {
      toolCalls++;
      const valid =
        typeof event.name === 'string' &&
        event.name.length > 0 &&
        event.input !== null &&
        typeof event.input === 'object' &&
        !Array.isArray(event.input);
      if (valid) validToolCalls++;
      const signature = JSON.stringify([event.name, event.input]);
      if (seen.has(signature)) loops++;
      seen.add(signature);
    }
    if (event.type === 'tool_result' && event.is_error === true)
      validToolCalls = Math.max(0, validToolCalls - 1);
    if (event.type === 'result') {
      aborted = event.exit_code !== 0;
      const tokens = event.tokens as Record<string, unknown> | undefined;
      inputTokens = Number(tokens?.input ?? 0) + Number(tokens?.cache_read ?? 0);
      outputTokens = Number(tokens?.output ?? 0);
    }
  }
  return { toolCalls, validToolCalls, loops, aborted, inputTokens, outputTokens };
}

// The same numbers from Helena's own loop (packages/agent-runtime, helena-jsonl): a call is
// valid unless its result was an error, as for Hermes; the spend line has the tokens.
export function helenaMetrics(output: string) {
  let toolCalls = 0;
  let errors = 0;
  let loops = 0;
  let aborted = true;
  let inputTokens = 0;
  let outputTokens = 0;
  const seen = new Set<string>();
  for (const line of output.split('\n')) {
    let event: Record<string, unknown>;
    try {
      event = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue;
    }
    if (event.type === 'tool-call') {
      toolCalls++;
      const signature = `${String(event.name)}:${String(event.input)}`;
      if (seen.has(signature)) loops++;
      seen.add(signature);
    }
    if (event.type === 'tool-result' && event.isError === true) errors++;
    if (event.type === 'spend') {
      inputTokens = Number(event.inputTokens ?? 0);
      outputTokens = Number(event.outputTokens ?? 0);
    }
    if (event.type === 'result') aborted = event.exitCode !== 0;
  }
  return {
    toolCalls,
    validToolCalls: Math.max(0, toolCalls - errors),
    loops,
    aborted,
    inputTokens,
    outputTokens,
  };
}

// How a candidate runs: the Hermes CLI, or Helena's own loop against an OpenAI-compatible
// server (Halogen) or an API-key provider.
export type CodingRuntime =
  | { kind: 'hermes'; bin: string }
  | { kind: 'helena'; entry: string; baseUrl: string; keyEnv?: string | null; anthropic?: boolean };

const REPO_ROOT = join(import.meta.dir, '../../../../..');
export const HELENA_AGENT_ENTRY = join(REPO_ROOT, 'packages/agent-runtime/src/bin.ts');

export function helenaCodingConfig(
  model: string,
  provider: string | null,
  runtime: Extract<CodingRuntime, { kind: 'helena' }>,
  directory: string,
) {
  const name = provider ?? 'local';
  return {
    model: `${name}/${model}`,
    servers: [
      runtime.anthropic
        ? { provider: name, kind: 'anthropic', keyEnv: runtime.keyEnv ?? 'ANTHROPIC_API_KEY' }
        : {
            provider: name,
            kind: 'openai-compatible',
            baseUrl: runtime.baseUrl,
            ...(runtime.keyEnv ? { keyEnv: runtime.keyEnv } : {}),
            local: true,
            thinkingSwitch: true,
          },
    ],
    workdir: directory,
    tools: { profile: 'coder-lite', allowUnsandboxedShell: true },
    policy: 'allow',
    // The same limits as the Hermes candidate: 12 turns, 240 s.
    limits: { maxTurns: 12, runBudgetSeconds: 240 },
  };
}

async function fixture(task: CodingTask): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), `helena-eval-${task.id}-`));
  for (const [file, content] of Object.entries(task.files))
    await writeFile(join(directory, file), content);
  const git = await run('git', ['init', '-q'], directory);
  if (git.code !== 0) throw new Error(`Could not create fixture: ${git.stderr}`);
  return directory;
}

export async function evaluateCodingTask(
  task: CodingTask,
  model: string,
  provider: string | null,
  runner: string | CodingRuntime,
) {
  const runtime: CodingRuntime =
    typeof runner === 'string' ? { kind: 'hermes', bin: runner } : runner;
  const directory = await fixture(task);
  const configDir =
    runtime.kind === 'helena' ? await mkdtemp(join(tmpdir(), 'helena-eval-config-')) : null;
  const started = Date.now();
  try {
    const prompt = `Work only in this temporary Git repository: ${directory}. ${task.prompt} Read the files, make the change, and run the existing tests. No network access or package installation. Return a short summary.`;
    let output: ProcessResult;
    if (runtime.kind === 'hermes') {
      output = await run(
        runtime.bin,
        [
          'chat',
          '--format',
          'stream-json',
          '--query-file',
          '-',
          '--source',
          'tool',
          '--accept-hooks',
          '--model',
          model,
          ...(provider ? ['--provider', provider] : []),
          '--max-turns',
          '12',
          '--run-budget',
          '240',
        ],
        directory,
        prompt,
        270_000,
      );
    } else {
      const configFile = join(configDir!, 'config.json');
      await writeFile(
        configFile,
        JSON.stringify(helenaCodingConfig(model, provider, runtime, directory)),
      );
      output = await run(
        'bun',
        [runtime.entry, '--config', configFile],
        directory,
        prompt,
        270_000,
      );
    }
    const metrics =
      runtime.kind === 'hermes' ? hermesMetrics(output.stdout) : helenaMetrics(output.stdout);
    let testsPassed = false;
    let testOutput = '';
    for (const [file, content] of Object.entries(task.files)) {
      if (file.endsWith('.test.ts') || file.startsWith('test_')) {
        await rm(join(directory, file), { recursive: true, force: true });
        await writeFile(join(directory, file), content);
      }
    }
    if (task.addedTest) {
      try {
        const info = await lstat(join(directory, task.addedTest));
        if (!info.isFile() || info.isSymbolicLink())
          throw new Error('Expected a regular test file');
        const text = await readFile(join(directory, task.addedTest), 'utf8');
        if (task.language === 'typescript') {
          testsPassed =
            /(?:test|it)\s*\(/.test(text) &&
            ['0', '1', '2', '9', '11'].every((n) => text.includes(n));
        } else {
          testsPassed =
            /def test_/.test(text) &&
            /assertRaises/.test(text) &&
            /strip|space|uppercase|upper/i.test(text);
        }
      } catch {
        testsPassed = false;
      }
      const source = task.language === 'typescript' ? 'solution.ts' : 'solution.py';
      const info = await lstat(join(directory, source)).catch(() => null);
      const unchanged =
        info?.isFile() && !info.isSymbolicLink()
          ? await readFile(join(directory, source), 'utf8').catch(() => null)
          : null;
      testsPassed = testsPassed && unchanged === task.files[source];
    }
    const test = await run(
      task.language === 'typescript' ? 'bun' : 'python3',
      task.language === 'typescript'
        ? ['test', 'solution.test.ts']
        : ['-m', 'unittest', 'test_solution'],
      directory,
    );
    testOutput = (test.stdout + test.stderr).slice(-500);
    if (task.addedTest) {
      testsPassed = testsPassed && test.code === 0;
      const source = task.language === 'typescript' ? 'solution.ts' : 'solution.py';
      await writeFile(
        join(directory, source),
        task.language === 'typescript'
          ? 'export function isPrime(_n: number): boolean { return true; }\n'
          : 'def normalize_email(value):\n    return value\n',
      );
      const mutant = await run(
        task.language === 'typescript' ? 'bun' : 'python3',
        task.language === 'typescript'
          ? ['test', 'solution.test.ts']
          : ['-m', 'unittest', 'test_solution'],
        directory,
      );
      testsPassed = testsPassed && mutant.code !== 0 && !mutant.timedOut;
    } else testsPassed = test.code === 0;
    return {
      task: task.id,
      model,
      testsPassed,
      ...metrics,
      aborted: metrics.aborted || output.code !== 0 || output.timedOut,
      durationMs: Date.now() - started,
      testOutput: testsPassed ? null : testOutput,
      error: output.code === 0 ? null : output.stderr.slice(-300),
    };
  } finally {
    await rm(directory, { recursive: true, force: true });
    if (configDir) await rm(configDir, { recursive: true, force: true });
  }
}

function arg(name: string): string | null {
  const index = process.argv.indexOf(`--${name}`);
  return index < 0 ? null : (process.argv[index + 1] ?? null);
}

if (import.meta.main) {
  const modelA = arg('model-a');
  const modelB = arg('model-b');
  if (!modelA) {
    console.error(
      'usage: bun apps/api/src/scripts/agentic-coding/run.ts --model-a MODEL [--provider-a PROVIDER] [--model-b MODEL --provider-b PROVIDER] [--json FILE]',
    );
    process.exit(2);
  }
  const candidates: ['A' | 'B', string, string | null][] = [
    ['A', modelA, arg('provider-a')],
    ...(modelB ? ([['B', modelB, arg('provider-b')]] as ['B', string, string | null][]) : []),
  ];
  // --runtime-a/--runtime-b helena runs the candidate on Helena's own loop; its model server is
  // --base-url-a/-b (default Halogen on this machine), or Anthropic with --anthropic-b.
  const runtimeOf = (candidate: 'a' | 'b'): CodingRuntime =>
    arg(`runtime-${candidate}`) === 'helena'
      ? {
          kind: 'helena',
          entry: HELENA_AGENT_ENTRY,
          baseUrl: arg(`base-url-${candidate}`) ?? 'http://127.0.0.1:8731/v1',
          keyEnv: arg(`key-env-${candidate}`),
          anthropic: process.argv.includes(`--anthropic-${candidate}`),
        }
      : { kind: 'hermes', bin: arg('hermes-bin') ?? 'hermes' };
  const only = arg('only')?.split(',');
  const rows: (Awaited<ReturnType<typeof evaluateCodingTask>> & { candidate: 'A' | 'B' })[] = [];
  for (const [candidate, model, provider] of candidates) {
    for (const task of CODING_TASKS.filter((entry) => !only || only.includes(entry.id))) {
      const row = await evaluateCodingTask(
        task,
        model,
        provider,
        runtimeOf(candidate === 'A' ? 'a' : 'b'),
      );
      rows.push({ ...row, candidate });
      console.error(
        `${model} ${task.id}: ${row.testsPassed ? 'PASS' : 'FAIL'}; tools ${row.validToolCalls}/${row.toolCalls}; loops ${row.loops}; ${row.durationMs} ms`,
      );
    }
  }
  const summary = candidates.map(([candidate, model, provider]) => ({
    candidate,
    model,
    provider,
    runtime: runtimeOf(candidate === 'A' ? 'a' : 'b').kind,
    testsPassed: rows.filter((row) => row.candidate === candidate && row.testsPassed).length,
    cases: CODING_TASKS.length,
    validToolCalls: rows
      .filter((row) => row.candidate === candidate)
      .reduce((sum, row) => sum + row.validToolCalls, 0),
    loops: rows
      .filter((row) => row.candidate === candidate)
      .reduce((sum, row) => sum + row.loops, 0),
    aborts: rows.filter((row) => row.candidate === candidate && row.aborted).length,
    durationMs: rows
      .filter((row) => row.candidate === candidate)
      .reduce((sum, row) => sum + row.durationMs, 0),
    inputTokens: rows
      .filter((row) => row.candidate === candidate)
      .reduce((sum, row) => sum + row.inputTokens, 0),
    outputTokens: rows
      .filter((row) => row.candidate === candidate)
      .reduce((sum, row) => sum + row.outputTokens, 0),
  }));
  const report = `${JSON.stringify({ summary, rows }, null, 2)}\n`;
  if (arg('json')) await writeFile(arg('json')!, report);
  else process.stdout.write(report);
}
