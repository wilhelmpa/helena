import type { RuntimeReaders } from './runtime-readers';
import type { LocalizedText } from './text';

// A runtime is an agent harness the runner drives: Hermes, Claude Code, Codex, or one a
// plugin brings. The target contract is the Agent Client Protocol (ACP,
// https://agentclientprotocol.com): the runner starts the runtime's ACP agent over
// stdio, opens or loads a session (with Helena's MCP servers), sends the prompt,
// streams `session/update`, and answers `session/request_permission` through Helena's
// policy. Hermes ships an ACP adapter (`hermes-acp`); Claude Code and Codex have
// Apache-2.0 adapters (`@agentclientprotocol/claude-agent-acp`, `codex-acp`).
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

// Profile materialization: before a run the runner writes what Helena configured for the
// agent (instructions, skills, MCP servers, model defaults) where the runtime reads it,
// and reports drift. The snapshot is Helena's runtime policy for the agent.
export interface RuntimeProfileContext {
  agentId: number;
  // The runtime's home for this agent (HERMES_HOME, CLAUDE_CONFIG_DIR, CODEX_HOME).
  home: string;
  snapshot: unknown;
}

export interface RuntimeProfileResult {
  changed: boolean;
  // Files a person changed outside Helena, kept aside instead of overwritten.
  conflicts?: string[];
}

export interface RuntimeProfile {
  materialize(ctx: RuntimeProfileContext): Promise<RuntimeProfileResult>;
}

interface RuntimeAdapterBase {
  id: string;
  label: LocalizedText;
  description?: LocalizedText;
  capabilities: RuntimeCapabilities;
  profile?: RuntimeProfile;
  // What Helena can read back (sessions, transcripts, logs, health, version) and the
  // controls besides running work (curator, emergency stop).
  readers?: RuntimeReaders;
}

export interface CliRuntimeAdapter extends RuntimeAdapterBase {
  protocol: 'cli';
  command: CliCommand;
  parser?: () => RuntimeStreamParser;
}

export interface AcpRuntimeAdapter extends RuntimeAdapterBase {
  protocol: 'acp';
  launch(settings: RuntimeTaskSettings): AcpLaunch;
}

export type RuntimeAdapter = CliRuntimeAdapter | AcpRuntimeAdapter;

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
