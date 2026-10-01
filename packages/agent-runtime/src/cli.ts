import { readFile } from 'node:fs/promises';
import { runAgent } from './agent';
import { parseConfig, type AgentRuntimeConfig } from './config';
import { JsonLineSink, type EventSink } from './events';

// `helena-agent`: one command of Helena's agent loop. The runner starts it as the `helena`
// runtime (packages/runner: `cli.js helena-agent`, inside the project's sandbox when agents
// are isolated), an eval starts it with `bun packages/agent-runtime/src/cli.ts`.
//
//   helena-agent --config <file> [--resume <session>] [--model <id>] [--reasoning <level>]
//                [--max-turns <n>] [--run-budget <seconds>] [--kind run|chat|reflection]
//                [--stdin-json]
//
// The task comes on stdin: plain text, or with --stdin-json the runner's JSON
// ({prompt, systemPrompt, sessionId, model, thinkingLevel, maxTurns, runBudgetSeconds}). What
// the command does comes out on stdout as JSON lines (events.ts); diagnostics go to stderr.
// Exit codes: 0 answered (or waiting for the person), 1 failed, 2 wrong usage, 3 handed over
// to a bigger model, 130 stopped.

export interface CliOptions {
  config: string | null;
  resume: string | null;
  model: string | null;
  reasoning: string | null;
  maxTurns: number | null;
  runBudget: number | null;
  kind: 'run' | 'chat' | 'reflection' | null;
  stdinJson: boolean;
}

export function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    config: null,
    resume: null,
    model: null,
    reasoning: null,
    maxTurns: null,
    runBudget: null,
    kind: null,
    stdinJson: false,
  };
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index]!;
    const value = () => {
      const next = argv[++index];
      if (next === undefined) throw new Error(`${arg} needs a value`);
      return next;
    };
    switch (arg) {
      case '--config':
        options.config = value();
        break;
      case '--resume':
        options.resume = value();
        break;
      case '--model':
        options.model = value();
        break;
      case '--reasoning':
        options.reasoning = value();
        break;
      case '--max-turns':
        options.maxTurns = Number(value()) || null;
        break;
      case '--run-budget':
        options.runBudget = Number(value()) || null;
        break;
      case '--kind': {
        const kind = value();
        if (kind !== 'run' && kind !== 'chat' && kind !== 'reflection')
          throw new Error('--kind must be run, chat or reflection');
        options.kind = kind;
        break;
      }
      case '--stdin-json':
        options.stdinJson = true;
        break;
      case '-':
        break;
      default:
        throw new Error(`unknown argument ${arg}`);
    }
  }
  return options;
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

interface Task {
  prompt: string;
  systemPrompt: string;
  sessionId: string | null;
  model: string | null;
  reasoning: string | null;
  maxTurns: number | null;
  runBudget: number | null;
  labels: string[];
}

export function taskFrom(stdin: string, options: CliOptions): Task {
  if (!options.stdinJson) {
    return {
      prompt: stdin.trim(),
      systemPrompt: '',
      sessionId: options.resume,
      model: options.model,
      reasoning: options.reasoning,
      maxTurns: options.maxTurns,
      runBudget: options.runBudget,
      labels: [],
    };
  }
  const value = JSON.parse(stdin) as Record<string, unknown>;
  const str = (key: string) =>
    typeof value[key] === 'string' && value[key] ? (value[key] as string) : null;
  const num = (key: string) => (typeof value[key] === 'number' ? (value[key] as number) : null);
  return {
    prompt: str('prompt') ?? '',
    systemPrompt: str('systemPrompt') ?? '',
    sessionId: options.resume ?? str('sessionId'),
    model: options.model ?? str('model'),
    reasoning: options.reasoning ?? str('thinkingLevel'),
    maxTurns: options.maxTurns ?? num('maxTurns'),
    runBudget: options.runBudget ?? num('runBudgetSeconds'),
    labels: Array.isArray(value.labels)
      ? value.labels.filter((label): label is string => typeof label === 'string')
      : [],
  };
}

export function applyTask(
  config: AgentRuntimeConfig,
  task: Task,
  kind: CliOptions['kind'],
): AgentRuntimeConfig {
  return {
    ...config,
    ...(task.model && { model: task.model }),
    ...(task.reasoning && { reasoning: task.reasoning }),
    ...(kind && { kind }),
    limits: {
      ...config.limits,
      ...(task.maxTurns && { maxTurns: task.maxTurns }),
      ...(task.runBudget && { runBudgetSeconds: task.runBudget }),
    },
  };
}

export function configForTask(
  raw: unknown,
  task: Task,
  kind: CliOptions['kind'],
): AgentRuntimeConfig {
  const selected =
    raw && typeof raw === 'object' && !Array.isArray(raw) && task.model
      ? { ...raw, model: task.model }
      : raw;
  return applyTask(parseConfig(selected), task, kind);
}

export async function main(
  argv: string[],
  io: { sink?: EventSink; stdin?: string; env?: Record<string, string | undefined> } = {},
): Promise<number> {
  let options: CliOptions;
  try {
    options = parseArgs(argv);
    if (!options.config && !options.stdinJson)
      throw new Error('--config or --stdin-json is required');
  } catch (error) {
    process.stderr.write(
      `helena-agent: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    return 2;
  }
  const sink = io.sink ?? new JsonLineSink((line) => process.stdout.write(line));
  const controller = new AbortController();
  const stop = () => controller.abort();
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  try {
    const stdin = io.stdin ?? (await readStdin());
    const task = taskFrom(stdin, options);
    // The runner hands the configuration inside the task's JSON (RunSettings.input); an eval
    // names a file.
    const raw = options.config
      ? JSON.parse(await readFile(options.config, 'utf8'))
      : (JSON.parse(stdin) as { config?: unknown }).config;
    const env = io.env ?? process.env;
    const kind = options.kind ?? (env.ITSAPLAN_TRIGGER === 'chat' ? 'chat' : null);
    const config = configForTask(raw, task, kind);
    if (!task.prompt) throw new Error('no task on stdin');
    const result = await runAgent({
      config,
      prompt: task.prompt,
      runContext: task.systemPrompt,
      sessionId: task.sessionId,
      labels: task.labels,
      sink,
      env,
      signal: controller.signal,
    });
    return result.exitCode;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`helena-agent: ${message}\n`);
    sink.emit({
      type: 'result',
      text: '',
      exitCode: 1,
      reason: 'error',
      error: message.slice(0, 400),
    });
    return 1;
  } finally {
    process.off('SIGINT', stop);
    process.off('SIGTERM', stop);
  }
}
