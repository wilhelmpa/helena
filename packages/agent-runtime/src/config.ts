import type { McpServerSpec } from '@helena/sdk';

// What one command of the loop is handed, as the runner's HelenaRuntimeAdapter writes it
// (`--config <file>`), or an eval script builds it. Secrets never appear here: a key is named
// by the environment variable that holds it.

// A model server the loop can reach: a local one (Halogen, Lemonade, llama.cpp) or an
// API-key provider. A model id `<provider>/<model>` runs on the server of that provider.
export interface ModelServer {
  provider: string;
  kind: 'openai-compatible' | 'anthropic';
  // The base of its API (…/v1). Unset for Anthropic: the provider's default.
  baseUrl?: string | null;
  // The environment variable holding its key; unset for a server without one.
  keyEnv?: string | null;
  // The context window it serves, where known; the compression threshold follows it.
  contextLength?: number | null;
  // Local model servers (Qwen templates) switch thinking with chat_template_kwargs.
  thinkingSwitch?: boolean;
  // false: the turns on this server never think (Helena's `<provider>--nothink`).
  thinking?: boolean;
  // Whether it is on this machine (price 0, no subscription).
  local?: boolean;
}

// The tools a role sees (docs/helena-decisions/zentrale-laufzeit.md §6).
export type ToolProfile = 'assistent' | 'recherche' | 'coder-lite' | 'voll';

export interface ToolSettings {
  profile?: ToolProfile;
  // Helena MCP tools every profile carries directly, by name; the rest are found with find_tools.
  core?: string[];
  // Seconds one tool call may take, a shell command, and all browser tools of the command
  // together (the owner's hard limit per browser task).
  toolTimeoutSeconds?: number;
  shellTimeoutSeconds?: number;
  browserBudgetSeconds?: number;
  // A shell without Helena's agent isolation: only the evals and an operator's own machine.
  allowUnsandboxedShell?: boolean;
}

export interface Limits {
  maxTurns?: number;
  runBudgetSeconds?: number;
  firstChunkSeconds?: number;
  chunkSeconds?: number;
  stepSeconds?: number;
  maxOutputTokens?: number;
  localModelQueueSeconds?: number;
  // Compress at this token count (default: at most 12,000, or 60 % of the window).
  compressAtTokens?: number;
}

export interface SkillEntry {
  name: string;
  displayName?: string;
  whenToUse?: string;
  description: string;
  markdown: string;
  files?: { path: string; content: string }[];
}

export interface EscalationSettings {
  // 'never' keeps every task here, 'always' hands every task over at once.
  mode?: 'auto' | 'never' | 'always';
  // Where a hand-over goes: a model id this loop drives (an API-key model), or
  // `runtime:claude[/model]` / `runtime:codex[/model]`, which Helena starts as a follow-up run.
  target?: string | null;
  // Task kinds (labels, words of the task) that go to the bigger model before the first step.
  taskKinds?: string[];
  // The decision service's confidence below which the task goes there (0..1).
  confidenceBelow?: number;
  // Hand over after a failure (loop, budget, repeated invalid calls, red tests).
  onFailure?: boolean;
  central?: import('@helena/sdk').EscalationSettings;
  agentId?: number;
}

export interface AgentRuntimeConfig {
  model: string;
  reasoning?: string | null;
  fallbackModels?: string[];
  runtimeFallback?: string;
  servers: ModelServer[];
  instructions?: string;
  contextLimits?: import('@helena/sdk').ContextLimits;
  contextWarnings?: string[];
  // Absolute: the files and shell tools stay below it.
  workdir: string;
  // Where Helena's API answers and the variable its key is in. Absent in an eval without Helena.
  helena?: { url: string; apiKeyEnv?: string } | null;
  mcpServers?: McpServerSpec[];
  tools?: ToolSettings;
  limits?: Limits;
  skills?: SkillEntry[];
  memory?: { enabled?: boolean };
  escalation?: EscalationSettings;
  sessions?: { store?: 'helena' | 'file' | 'memory'; dir?: string };
  // 'helena' asks /agent-policy/decide before each call that changes anything; 'allow' is for
  // the evals only (a stand-in allows everything but the hard blocks).
  policy?: 'helena' | 'allow';
  kind?: 'run' | 'chat' | 'reflection';
}

export const DEFAULTS = {
  maxTurns: 40,
  runBudgetSeconds: 1800,
  chatBudgetSeconds: 900,
  localModelQueueSeconds: 600,
  chatModelQueueSeconds: 180,
  firstChunkSeconds: 30,
  chunkSeconds: 30,
  stepSeconds: 60,
  maxOutputTokens: 4096,
  toolTimeoutSeconds: 120,
  shellTimeoutSeconds: 300,
  browserBudgetSeconds: 240,
  contextLength: 131_072,
  toolResultChars: 32_000,
} as const;

function fail(message: string): never {
  throw new Error(`config: ${message}`);
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

// Reads and checks a config. What is left out takes the defaults above.
export function parseConfig(value: unknown): AgentRuntimeConfig {
  if (!isObject(value)) fail('not an object');
  if (typeof value.model !== 'string' || !value.model.includes('/')) {
    fail('model must be "<provider>/<model>"');
  }
  // Without one, the folder the command was started in (the runner starts it in the run's).
  if (value.workdir === undefined || value.workdir === null) value.workdir = process.cwd();
  if (typeof value.workdir !== 'string' || !value.workdir.startsWith('/')) {
    fail('workdir must be absolute');
  }
  if (!Array.isArray(value.servers) || value.servers.length === 0) fail('no model server');
  for (const server of value.servers) {
    if (!isObject(server) || typeof server.provider !== 'string' || !server.provider) {
      fail('a server has no provider');
    }
    if (server.kind !== 'openai-compatible' && server.kind !== 'anthropic') {
      fail(`server ${server.provider} has an unknown kind`);
    }
    if (server.kind === 'openai-compatible' && typeof server.baseUrl !== 'string') {
      fail(`server ${server.provider} has no baseUrl`);
    }
    if (server.keyEnv != null && !/^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(String(server.keyEnv))) {
      fail(`server ${server.provider} names an invalid key variable`);
    }
  }
  if (value.fallbackModels != null && !Array.isArray(value.fallbackModels)) {
    fail('fallbackModels must be a list');
  }
  if (
    value.runtimeFallback != null &&
    (typeof value.runtimeFallback !== 'string' ||
      !/^runtime:(codex|claude)(\/[A-Za-z0-9._/-]+)?$/.test(value.runtimeFallback))
  )
    fail('Invalid subscription runtime fallback');
  if (value.policy != null && value.policy !== 'helena' && value.policy !== 'allow') {
    fail('policy must be helena or allow');
  }
  if (value.limits != null && !isObject(value.limits)) fail('limits must be an object');
  const queueSeconds = (value.limits as Record<string, unknown> | undefined)
    ?.localModelQueueSeconds;
  if (
    queueSeconds !== undefined &&
    (typeof queueSeconds !== 'number' ||
      !Number.isFinite(queueSeconds) ||
      queueSeconds < 0 ||
      queueSeconds > 86_400)
  )
    fail('localModelQueueSeconds must be between 0 and 86400');
  return value as unknown as AgentRuntimeConfig;
}

// "<provider>/<model>": the provider is the part before the first slash, so a model id with a
// slash of its own (`qwen/qwen3`) keeps it.
export function splitModelId(id: string): { provider: string; model: string } {
  const index = id.indexOf('/');
  if (index <= 0 || index === id.length - 1) throw new Error(`model id ${id} names no provider`);
  return { provider: id.slice(0, index), model: id.slice(index + 1) };
}
