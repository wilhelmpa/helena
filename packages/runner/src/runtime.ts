import { createHash } from 'node:crypto';
import type { WorkRef } from './logins';

// The runner's extension point for agent runtimes. One adapter per runtime (Hermes, Claude
// Code, Codex) brings the runtime to the agent's settings in Helena and says how far it got:
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

export type RuntimeId = 'hermes' | 'claude' | 'codex';

// Codex' sandbox for the shell commands the model runs. Helena decides it per agent
// (cli-runtime.ts codexSandbox): no sandbox only inside Helena's agent isolation.
export type CodexSandbox = 'read-only' | 'workspace-write' | 'danger-full-access';

// Held while a command starts, so that two commands sharing one login file never refresh
// it at the same moment (cli-runtime.ts). Released by the first model output, the end of
// the command, or a deadline.
export interface StartGate {
  acquire(): Promise<() => void>;
}

// What an adapter asks of the one command a run or chat answer starts (execute.ts).
export interface CommandHooks {
  // Codex only: the sandbox of its shell commands.
  sandbox?: CodexSandbox;
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
}

// Why an agent's runtime cannot do its work, or only part of it, as Helena shows it on the
// agent and in the health overview ("Laufzeit nicht angemeldet").
export type RuntimeIssueCode =
  // The runtime's program is not installed where the runner looks for it.
  | 'runtime-missing'
  // No login reaches the runtime, or the one it has was refused (detail 'rejected').
  | 'not-signed-in'
  // Codex without Helena's agent isolation: its own sandbox cannot start in this
  // container, so it runs read-only and reaches only Helena's tools.
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

// A short digest of a value that is neither empty nor a pure ${VAR} reference: enough to
// tell two values apart in a drift report, too short and one-way to give the value away.
export function maskValue(value: string): string {
  if (/^\$\{[A-Z0-9_]+\}$/.test(value)) return value;
  return `sha256:${createHash('sha256').update(value).digest('hex').slice(0, 16)}`;
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

export function profileDigest(value: unknown): string {
  return `sha256:${createHash('sha256').update(canonicalJson(value)).digest('hex')}`;
}

// What a run reports about its model: what Helena asked for, what the runtime falls back to
// when nothing was asked for ("Agent default"), and what the session really ran on. Helena
// compares them and shows a run whose model or reasoning differs.
export interface RunModelReport {
  requested: { model: string | null; reasoning: string | null };
  defaults: RuntimeDefaults | null;
  used: SessionFacts | null;
}

// `streamModel` is what the command named on its opening line, for a runtime whose session
// store the adapter cannot read.
export async function runModelReport(
  runtime: RuntimeAdapter | null,
  requested: { model: string | null; reasoning: string | null },
  sessionId: string | undefined,
  streamModel: string | null,
): Promise<RunModelReport | undefined> {
  if (!runtime) return undefined;
  const facts = await runtime.sessionFacts(sessionId).catch(() => null);
  const used =
    facts ?? (streamModel ? { model: streamModel, reasoning: null, provider: null } : null);
  return { requested, defaults: runtime.defaults(), used };
}
