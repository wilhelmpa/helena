import type { RuntimePolicySnapshot } from './runtime-policy';
import type { CommandSandbox, RuntimeAdapter, RuntimeId } from './runtime-profile';
import type { RuntimeReaders } from './runtime-readers';
import type { LocalizedText } from './text';

// A runtime is an agent harness the runner drives: Hermes, Claude Code, Codex, or one a
// plugin brings. The target contract is the Agent Client Protocol (ACP,
// https://agentclientprotocol.com): the runner starts the runtime's ACP agent over
// stdio, opens or loads a session (with Helena's MCP servers), sends the prompt,
// streams `session/update`, and answers `session/request_permission` through Helena's
// policy. Hermes ships an ACP adapter (`hermes-acp`); Claude Code and Codex have
// ACP adapters (`@agentclientprotocol/codex-acp`; `@agentclientprotocol/claude-agent-acp`,
// installed outside Helena's tree because its Claude SDK is not OSI-licensed).
//
// Runtimes that only have a one-shot CLI with a JSON stream (today's presets) are `cli`
// adapters: argv building plus a stream parser. They stay until each runtime is proven
// over ACP.

export interface RuntimeTaskSettings {
  model?: string | null;
  thinkingLevel?: string | null;
  provider?: string | null;
  maxTurns?: number | null;
  runBudgetSeconds?: number | null;
  toolsets?: string[] | null;
  image?: string | null;
  // The sandbox of the commands the model runs, for a runtime that has one of its own
  // (Codex). Unset: the runtime's default for an operator's own runner.
  sandbox?: CommandSandbox;
  // Helena's Autopilot level for this run or chat answer (absent on an older server), and
  // the command a runtime with pre-tool hooks runs to ask Helena's policy engine.
  autopilotLevel?: number | null;
  policyHook?: string | null;
}

export interface RuntimeCapabilities {
  // Keeps sessions the runner can resume.
  sessions: boolean;
  // Streams a chat answer as it is written.
  chat: boolean;
  // Takes the run's context as a system prompt of its own, rather than in front of the
  // task.
  systemPrompt: boolean;
  // Honors the model/reasoning of a run.
  modelSelection: boolean;
  // Loads MCP servers Helena hands it.
  mcp: boolean;
  // Can run inside the isolation launcher (a project's own user and sandbox).
  isolation: boolean;
  images?: boolean;
  toolsets?: boolean;
}

// The events a runtime's output is read into, whatever its format. The runner turns
// them into AG-UI events for the chat and into the run's report. They mirror ACP's
// `session/update` variants, so an ACP runtime and a CLI one read the same.
export type RuntimeStreamEvent =
  | { type: 'session'; id: string }
  | { type: 'model'; id: string }
  | { type: 'text'; delta: string }
  | { type: 'thinking'; delta: string }
  | { type: 'tool-call'; id: string; name: string; input: string }
  | { type: 'tool-result'; id: string; output: string; isError?: boolean }
  // The context size of the last model call: tokens read (cache included) and written.
  | { type: 'usage'; inputTokens: number; outputTokens: number }
  | { type: 'result'; text: string; exitCode?: number };

// Reads one JSON line of a CLI's output (already parsed) into events.
export interface RuntimeStreamParser {
  line(value: object): RuntimeStreamEvent[];
}

export interface CliCommand {
  bin: string;
  // The name of the output format the runner reads; a plugin runtime with a format of its
  // own supplies `parser` and names it after itself.
  outputFormat: string;
  promptVia: 'stdin' | 'arg';
  systemPromptFlag?: string;
  // The arguments before the operator's own, given null for a fresh session.
  head: (sessionId: string | null) => string[];
  taskArgs?: (settings: RuntimeTaskSettings) => string[];
  // The arguments after the operator's own: a stdin marker, or the flag the prompt follows.
  tail: string[];
  // Whether a failure says the resumed session is gone.
  sessionLost?: (error: string) => boolean;
}

export interface AcpLaunch {
  bin: string;
  args: string[];
  env?: Record<string, string>;
}

// What the runner hands a plugin runtime's `adapter` factory for one agent it serves.
export interface RuntimeAdapterContext {
  // The agent's name in the runner's log lines.
  name: string;
  // Where Helena's API answers.
  url: string;
  env: Record<string, string>;
  cwd: string | null;
  // The agent's runtime policy as Helena has it now.
  policy(): Promise<RuntimePolicySnapshot>;
}

// A kind of runtime, as the runner's registry holds it: how to start it (a one-shot CLI
// or an ACP agent), what it can do, the per-agent profile adapter that keeps it in line
// with Helena (runtime-profile.ts RuntimeAdapter), and what Helena can read back from it
// (runtime-readers.ts).
interface RuntimeTypeBase {
  id: RuntimeId;
  label: LocalizedText;
  description?: LocalizedText;
  capabilities: RuntimeCapabilities;
  // Builds the agent's profile adapter. The built-in runtimes build theirs in the runner
  // (packages/runner/src/adapters.ts); a plugin runtime brings its own here.
  adapter?(context: RuntimeAdapterContext): RuntimeAdapter;
  // What Helena can read back (sessions, transcripts, logs, health, version) and the
  // controls besides running work (curator, emergency stop).
  readers?: RuntimeReaders;
}

export interface CliRuntimeType extends RuntimeTypeBase {
  protocol: 'cli';
  command: CliCommand;
  parser?: () => RuntimeStreamParser;
}

export interface AcpRuntimeType extends RuntimeTypeBase {
  protocol: 'acp';
  launch(settings: RuntimeTaskSettings): AcpLaunch;
}

export type RuntimeType = CliRuntimeType | AcpRuntimeType;

// The prompt as a CLI adapter receives it: without a system-prompt flag, the run's
// context goes in front of the task.
export function cliPrompt(command: CliCommand, systemPrompt: string, prompt: string): string {
  if (command.systemPromptFlag || !systemPrompt) return prompt;
  return `${systemPrompt}\n\n${prompt}`;
}

// The full argv of a CLI adapter: what it needs in front, the operator's own arguments,
// the task's settings, what it needs last, and the prompt when it takes it as an
// argument.
export function cliArgv(
  command: CliCommand,
  sessionId: string | null,
  systemPrompt: string,
  extraArgs: string[],
  prompt: string,
  settings: RuntimeTaskSettings = {},
): string[] {
  return [
    ...command.head(sessionId),
    ...(command.systemPromptFlag && systemPrompt ? [command.systemPromptFlag, systemPrompt] : []),
    ...extraArgs,
    ...(command.taskArgs?.(settings) ?? []),
    ...command.tail,
    ...(command.promptVia === 'arg' ? [cliPrompt(command, systemPrompt, prompt)] : []),
  ];
}
