import type { RuntimeAccount } from './runtime-account';

// The runtime profile contract (from hub/hermes-sync, docs/helena-decisions/
// runtime-protocol.md): the per-agent adapter the runner keeps for an agent's runtime. One
// adapter per runtime (Hermes, Claude Code, Codex, or a plugin's) brings the runtime to the
// agent's settings in Helena and says how far it got:
//
//   ensure()        applies the agent's policy (instructions, skills, MCP servers, settings)
//                   and checks it again every minute and after every run; never throws
//   runSettings()   what a run or chat answer hands the runtime besides the task
//   sessionFacts()  the model and reasoning a finished session really used
//
// Each adapter reports a ProfileReport with its status: a digest of everything it wrote and
// checked, and the drift it found and could not put right. Helena shows "Profil synchron" or
// the drift on the agent. What goes into a profile is collected from ProfileContributions
// (contributions.ts), so a new setting or MCP server reaches every runtime by registering one
// contribution, not by another special path in an adapter. The shapes below follow the Agent
// Client Protocol's (ACP) session setup where it has one (McpServerSpec is ACP's McpServer),
// so a runtime driven through ACP later takes the same values (docs/helena-decisions/
// runtime-protocol.md).

// A runtime's id: a built-in's, or a plugin runtime's (RuntimeType.id).
export type RuntimeId = 'hermes' | 'claude' | 'codex' | (string & {});

export const runtimeToolObservation: Readonly<Record<string, boolean>> = {
  hermes: true,
  central: true,
  claude: false,
  codex: false,
};

export function toolsFullyObserved(runtime: string): boolean {
  return runtimeToolObservation[runtime] === true;
}

// What a runner works on: a queued run or a chat message.
export type WorkRef = { runId: number } | { messageId: number };

// The sandbox a runtime with one of its own (Codex) runs the model's commands in. Helena
// decides it per agent: no sandbox only inside Helena's agent isolation, whose unit is the
// sandbox then (docs/helena-decisions/cli-runtimes.md §6).
export type CommandSandbox = 'read-only' | 'workspace-write' | 'danger-full-access';

// Held while a command starts, so that two commands sharing one login file never refresh
// it at the same moment. Released by the first model output, the end of the command, or a
// deadline.
export interface StartGate {
  acquire(): Promise<() => void>;
}

// What an adapter asks of the one command a run or chat answer starts.
export interface CommandHooks {
  sandbox?: CommandSandbox;
  startGate?: StartGate;
  // Sees the command's output as it arrives.
  output?(chunk: string): void;
  // Told how the command ended.
  finished?(outcome: { status: 'success' | 'failed'; error?: string }): void;
}

// What a run or chat answer hands the runtime besides the task.
export interface RunSettings {
  // Hermes toolsets the run is limited to; null leaves the runtime's own selection.
  toolsets: string[] | null;
  env: Record<string, string>;
  // The Helena credential of each Hermes vault handle written for this work.
  logins?: Map<string, number>;
  // Arguments the adapter adds to the runtime's command line (MCP servers, skills).
  args?: string[];
  // The agent's standing instructions, for a runtime that has no file of its own for them:
  // the adapter puts them in front of the run's own context.
  instructions?: string;
  hooks?: CommandHooks;
  // The environment variables Helena delivered for this work (Zugänge), by name, and the
  // secret values among them, which everything reported about the work masks. Their values
  // are in `env`.
  delivered?: { names: string[]; secrets: string[] };
}

// Why an agent's runtime cannot do its work, or only part of it, as Helena shows it on the
// agent and in the health overview ("Laufzeit nicht angemeldet").
export type RuntimeIssueCode =
  // The runtime's program is not installed where the runner looks for it.
  | 'runtime-missing'
  // No login reaches the runtime, or the one it has was refused (detail 'rejected').
  | 'not-signed-in'
  // The runtime's own sandbox cannot start here, so it runs read-only (Codex without
  // Helena's agent isolation).
  | 'sandbox-unavailable';

export interface RuntimeIssue {
  code: RuntimeIssueCode;
  // A short word or a name, never a value that could be a secret.
  detail?: string;
  // The command the owner runs in the owner terminal to put it right (sign the runtime in).
  command?: string;
}

// The model and reasoning a session actually ran with, as the runtime recorded them.
export interface SessionFacts {
  model: string | null;
  reasoning: string | null;
  provider: string | null;
}

// What the runtime uses when Helena names no model or reasoning ("Agent default").
export interface RuntimeDefaults {
  model: string | null;
  provider: string | null;
  reasoning: string | null;
}

export type DriftCode =
  // The profile's config.yaml is not the link to the shared configuration.
  | 'not-linked'
  // The runtime does not apply Helena's managed configuration (missing, unreadable, changed).
  | 'managed-config'
  // An MCP server Helena does not manage is on.
  | 'mcp-unmanaged'
  // An MCP server Helena manages is off or missing.
  | 'mcp-missing'
  // An MCP server Helena manages runs with other settings than Helena wrote.
  | 'mcp-differs'
  // The runtime cannot run this kind of MCP server (Codex and SSE).
  | 'mcp-unsupported'
  // A setting Helena manages has another value in the runtime.
  | 'setting-differs'
  // Dangerous commands are not decided by Helena's approval guard.
  | 'approval-guard'
  // The adapter could not read what the runtime will load.
  | 'probe-failed';

export interface ProfileDrift {
  // What drifted, as a path into the runtime's configuration ("mcp_servers.browser-harness").
  key: string;
  code: DriftCode;
  // Names only (setting keys, server names), never a value that could be a secret.
  detail?: string;
}

export interface ProfileMcpServer {
  name: string;
  enabled: boolean;
  // Written by Helena, or found in the runtime's own configuration.
  managed: boolean;
}

export interface ProfileReport {
  // A digest over what the adapter wrote and what it read back.
  hash: string;
  checkedAt: string;
  drift: ProfileDrift[];
  defaults: RuntimeDefaults | null;
  mcpServers: ProfileMcpServer[];
}

export interface RuntimeAdapter {
  readonly runtime: RuntimeId;
  // Never throws: the agent keeps working with what was applied last, and Helena shows why.
  ensure(): Promise<void>;
  runSettings(work?: WorkRef): Promise<RunSettings>;
  // A run or chat answer may have changed the profile, so the next ensure() checks it again.
  inventoryChanged(): void;
  // The model and reasoning a finished session used, or null where the runtime cannot tell.
  sessionFacts(sessionId: string | undefined): Promise<SessionFacts | null>;
  // The model and reasoning the runtime falls back to, once the adapter has read them.
  defaults(): RuntimeDefaults | null;
  // The runtime's own login in the agent's home (runtime-account.ts), read by the runtime
  // itself, never from its file: for Zugänge. `force` asks now instead of reusing the last
  // look. Left out by a runtime whose logins are not the agent's own (Hermes shares them;
  // the token keeper reports those).
  account?(options?: { force?: boolean }): Promise<RuntimeAccount | null>;
  // Signs that login out with the runtime's own command, in the agent's own sandbox, and
  // reads it again. The owner's "Abmelden" in Zugänge.
  signOut?(): Promise<RuntimeAccount | null>;
}

// ── MCP servers, runtime-neutral ─────────────────────────────────────────────────────

// A value handed to an MCP server: a literal, a variable of the runner's environment, or a
// text with ${VAR} references in it (a header such as "Bearer ${KEY}").
export type McpValue = { literal: string } | { env: string } | { template: string };

export interface McpNamedValue {
  name: string;
  value: McpValue;
}

// One MCP server of an agent, as ACP's session/new names one, plus what a runtime needs
// beyond it. Adapters render it into their runtime's own format.
export interface McpServerSpec {
  name: string;
  transport: 'stdio' | 'http' | 'sse';
  command?: string;
  args?: string[];
  env?: McpNamedValue[];
  url?: string;
  headers?: McpNamedValue[];
  // Variables of the runner's environment the server reads by their own name.
  passEnv?: string[];
  // Seconds a tool call may take, and the server to start.
  toolTimeoutSec?: number;
  startupTimeoutSec?: number;
  // Keys only one runtime knows, merged into its entry as they are: Hermes' YAML values,
  // Codex' TOML values (`-c mcp_servers.<name>.<key>=<value>`).
  hermes?: Record<string, unknown>;
  codex?: Record<string, string>;
}

const TEMPLATE_VAR = /\$\{([A-Z0-9_]+)\}/g;

// The value with every ${VAR} replaced from `env`; an unset variable becomes empty.
export function resolveMcpValue(value: McpValue, env: Record<string, string | undefined>): string {
  if ('literal' in value) return value.literal;
  if ('env' in value) return env[value.env] ?? '';
  return value.template.replace(TEMPLATE_VAR, (_, name: string) => env[name] ?? '');
}

// The value as a runtime that expands ${VAR} itself (Hermes, Claude Code) reads it.
export function templateOf(value: McpValue): string {
  if ('literal' in value) return value.literal;
  if ('env' in value) return `\${${value.env}}`;
  return value.template;
}

// JSON with sorted keys, so two equal structures have one digest.
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

// What a run reports about its model: what Helena asked for, what the runtime falls back to
// when nothing was asked for ("Agent default"), and what the session really ran on. Helena
// compares them and shows a run whose model or reasoning differs.
export interface RunModelReport {
  // `provider` is the provider the runner routed the model to (a model the catalog lists
  // under another provider runs there), where the runtime takes one.
  requested: { model: string | null; reasoning: string | null; provider?: string | null };
  defaults: RuntimeDefaults | null;
  used: SessionFacts | null;
}

// `streamModel` is what the command named on its opening line, for a runtime whose session
// store the adapter cannot read.
export async function runModelReport(
  runtime: RuntimeAdapter | null,
  requested: RunModelReport['requested'],
  sessionId: string | undefined,
  streamModel: string | null,
): Promise<RunModelReport | undefined> {
  if (!runtime) return undefined;
  const facts = await runtime.sessionFacts(sessionId).catch(() => null);
  const used =
    facts ?? (streamModel ? { model: streamModel, reasoning: null, provider: null } : null);
  return { requested, defaults: runtime.defaults(), used };
}
