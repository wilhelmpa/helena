import { readFile } from 'node:fs/promises';
import type { HermesProfile } from './inventory';
import type { AgentIsolation } from './isolation';
import type { CliCommand } from '@helena/sdk';
import { cliCommandOf, pluginOutputFormats, runtimeOf, runtimes } from './runtimes';

// Two ways to say what to run. `agent` names a CLI the runner knows (see presets.ts) and
// the runner builds the invocation, which is what lets it resume that CLI's sessions.
// `command` is a shell command the operator writes themselves, and no session is kept for
// it. `command` wins where both are set.
//
// One runner serves one agent per key, and a config may list several: `apiKeys` runs the
// same setup under each key, `agents` is the same list where an entry can also change what
// that agent runs. Loading a config therefore yields one of these per agent.

export interface RunnerConfig {
  // What the runner's log lines say this agent is. Empty when only one is configured.
  name: string;
  url: string;
  apiKey: string;
  // A registered runtime (runtimes.ts): a built-in preset or a plugin's.
  agent?: string;
  provider?: string;
  // Receives the prompt on stdin.
  command?: string;
  // Appended to what the preset builds. Ignored with `command`, which already spells out
  // the whole invocation.
  args: string[];
  // Defaults to the process's own.
  cwd?: string;
  // On top of the runner's own environment.
  env: Record<string, string>;
  concurrency: number;
  // How often to ask for work when the queue was empty.
  pollIntervalMs: number;
  // How long one task may take before it is killed and reported as failed.
  timeoutMs: number;
  // How the output is read when the command answers a chat message. 'text' takes whatever
  // it prints; the others read one CLI's own event stream, which also carries the tool
  // calls it makes and the session it started.
  outputFormat: OutputFormat;
  models: ChatCatalogModel[];
  // What the Hermes profile enables, as the deployment reads it from its config.yaml.
  // Reported to Plan, and the list a toolset restriction is taken from.
  hermes?: HermesProfile;
  // The project and profile the agent runs in when agents are isolated (AGENT_ISOLATION=on):
  // the launcher starts its commands as that project's user. Written by the deployment.
  isolation?: AgentIsolation;
}

export interface ChatCatalogModel {
  id: string;
  name: string;
  reasoning: boolean;
  thinkingLevels: string[];
  thinkingDefault: string | null;
  // The provider that serves the model, when the catalog lists more than one.
  provider?: string;
  // Whether the account's own model list names it (true), or the runtime only expects it to
  // work (false: Hermes adds newer models it has not seen listed). Unset when the catalog
  // could not ask the account.
  listed?: boolean;
  // The model this one is a variant of (a larger context window of the same model), which
  // the provider serves or refuses together with it.
  variantOf?: string;
}

const OUTPUT_FORMATS = [
  'text',
  'claude-stream-json',
  'codex-jsonl',
  'opencode-json',
  'antigravity-stream-json',
  'copilot-json',
  'hermes-stream-json',
  'helena-jsonl',
] as const;

// The formats agui.ts reads itself, plus the name of any plugin runtime's own format,
// which that runtime's parser reads.
export type OutputFormat = (typeof OUTPUT_FORMATS)[number] | (string & {});

// The preset a config resolves to, or undefined when it runs the operator's own command.
export function presetOf(config: Pick<RunnerConfig, 'agent' | 'command'>): CliCommand | undefined {
  if (config.command || !config.agent) return undefined;
  return cliCommandOf(config.agent);
}

const DEFAULTS = {
  concurrency: 1,
  pollIntervalMs: 3000,
  timeoutMs: 30 * 60 * 1000,
};

// An empty poll is three writes on the server (the lease sweep, the presence stamp, and
// the claim itself), so asking faster than once a second costs the instance more than it
// saves its operator.
const MIN_POLL_INTERVAL_MS = 1000;

function textOf(value: unknown): string | undefined {
  const text = typeof value === 'string' ? value.trim() : '';
  return text || undefined;
}

function intFrom(value: unknown, fallback: number): number {
  const parsed = typeof value === 'string' ? Number.parseInt(value, 10) : value;
  return typeof parsed === 'number' && Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

// The preset's own format unless the operator names one.
function outputFormatFrom(value: unknown, preset: CliCommand | undefined): OutputFormat {
  const name = textOf(value);
  if (!name) return preset?.outputFormat ?? 'text';
  const formats = [...OUTPUT_FORMATS, ...pluginOutputFormats()];
  const format = formats.find((candidate) => candidate === name);
  if (!format) {
    throw new Error(`outputFormat must be one of ${formats.join(', ')}`);
  }
  return format;
}

function agentFrom(value: unknown): string | undefined {
  const name = textOf(value);
  if (!name) return undefined;
  const adapter = runtimeOf(name);
  if (!adapter) {
    throw new Error(`agent must be one of ${runtimes.ids().join(', ')}`);
  }
  // The contract is there (@helena/sdk AcpRuntimeAdapter); this runner still starts
  // every runtime as a one-shot CLI.
  if (adapter.protocol !== 'cli') {
    throw new Error(`${name} speaks the Agent Client Protocol, which this runner cannot start yet`);
  }
  return name;
}

function argsFrom(value: unknown): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw new Error('args must be an array of strings');
  }
  return value as string[];
}

function modelsFrom(value: unknown): ChatCatalogModel[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error('models must be an array');
  return value.map((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new Error('each model must be an object');
    }
    const model = entry as Record<string, unknown>;
    const id = required(model.id, 'model id');
    const levels = model.thinkingLevels;
    if (!Array.isArray(levels) || levels.some((level) => typeof level !== 'string')) {
      throw new Error('model thinkingLevels must be an array of strings');
    }
    const thinkingDefault = model.thinkingDefault;
    if (thinkingDefault != null && typeof thinkingDefault !== 'string') {
      throw new Error('model thinkingDefault must be a string or null');
    }
    if (thinkingDefault && !levels.includes(thinkingDefault)) {
      throw new Error('model thinkingDefault must be one of thinkingLevels');
    }
    return {
      id,
      name: textOf(model.name) ?? id,
      reasoning: model.reasoning === true,
      thinkingLevels: levels as string[],
      thinkingDefault: (thinkingDefault as string | null | undefined) ?? null,
      ...(textOf(model.provider) ? { provider: textOf(model.provider) } : {}),
      ...(typeof model.listed === 'boolean' ? { listed: model.listed } : {}),
      ...(textOf(model.variantOf) ? { variantOf: textOf(model.variantOf) } : {}),
    };
  });
}

function hermesFrom(value: unknown): HermesProfile | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('hermes must be an object');
  }
  const profile = value as Record<string, unknown>;
  const list = (field: 'toolsets' | 'mcpServers') => {
    const items = profile[field];
    if (!Array.isArray(items) || items.some((item) => typeof item !== 'string')) {
      throw new Error(`hermes.${field} must be an array of strings`);
    }
    return items as string[];
  };
  const plugins = profile.plugins;
  if (
    plugins !== undefined &&
    (!plugins ||
      typeof plugins !== 'object' ||
      Array.isArray(plugins) ||
      Object.values(plugins).some((source) => typeof source !== 'string'))
  ) {
    throw new Error('hermes.plugins must map plugin names to directories');
  }
  const path = (field: 'sharedConfig' | 'browserHarness') => {
    const value = profile[field];
    if (value === undefined) return undefined;
    if (typeof value !== 'string' || !value.startsWith('/')) {
      throw new Error(`hermes.${field} must be an absolute path`);
    }
    return value;
  };
  const sharedConfig = path('sharedConfig');
  const browserHarness = path('browserHarness');
  return {
    toolsets: list('toolsets'),
    mcpServers: list('mcpServers'),
    ...(plugins !== undefined && { plugins: plugins as Record<string, string> }),
    ...(sharedConfig && { sharedConfig }),
    ...(browserHarness && { browserHarness }),
  };
}

const SLUG = /^[a-z0-9][a-z0-9-]{0,28}$/;
const PROFILE = /^[a-z0-9][a-z0-9-]{0,28}(?:_[1-9][0-9]{0,9})?$/;

function isolationFrom(value: unknown): AgentIsolation | undefined {
  if (value === undefined) return undefined;
  const entry = value as Record<string, unknown> | null;
  const agentId = entry?.agentId ?? null;
  if (
    !entry ||
    typeof entry !== 'object' ||
    typeof entry.slug !== 'string' ||
    !SLUG.test(entry.slug) ||
    typeof entry.profile !== 'string' ||
    !PROFILE.test(entry.profile) ||
    (agentId !== null && (!Number.isSafeInteger(agentId) || (agentId as number) < 1))
  ) {
    throw new Error('isolation must name a project slug, a profile and optionally an agent id');
  }
  return { slug: entry.slug, profile: entry.profile, agentId: agentId as number | null };
}

function required(value: unknown, field: string): string {
  const text = textOf(value);
  if (!text) throw new Error(`${field} is required — set it in the config file or the environment`);
  return text;
}

// A runner configured entirely by environment variables needs no file.
async function readConfigFile(path: string): Promise<Record<string, unknown>> {
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return {};
    throw err;
  }
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new Error(`${path} is not valid JSON`);
  }
}

// What the command line contributed, which wins over both the file and the environment.
export interface ConfigOverrides {
  agent?: string;
  // The arguments after `--`, appended to the ones the config file already gives.
  args?: string[];
}

type Fields = Record<string, unknown>;

// The list of agents to serve. `apiKeys` is the short form of an `agents` list that
// changes nothing but the key; without either there is one agent, described by the file
// itself.
function agentFieldsFrom(file: Fields): Fields[] {
  if (file.apiKeys !== undefined && file.agents !== undefined) {
    throw new Error('set either apiKeys or agents, not both');
  }
  if (file.apiKeys !== undefined) {
    const keys = file.apiKeys;
    if (!Array.isArray(keys) || keys.some((key) => typeof key !== 'string')) {
      throw new Error('apiKeys must be an array of strings');
    }
    return (keys as string[]).map((apiKey) => ({ apiKey }));
  }
  if (file.agents === undefined) return [{}];
  const agents = file.agents;
  // Without its own key an entry inherits the shared one, and two entries then poll as the
  // same agent under different names, each with its own concurrency.
  if (
    !Array.isArray(agents) ||
    agents.some(
      (entry) =>
        typeof entry !== 'object' ||
        entry === null ||
        Array.isArray(entry) ||
        !textOf((entry as Fields).apiKey),
    )
  ) {
    throw new Error('agents must be an array of objects, each with its own apiKey');
  }
  return agents as Fields[];
}

// The narrower side replaces the fields it sets, so `agent` and `command` — two ways to
// say the same thing — never end up one from each side, where `command` would silently win
// over the agent that was named. A format the wider side asked for described the mode it
// named, so a narrower side that names another one drops it too and the new mode's preset
// decides the format again.
function merge(shared: Fields, own: Fields): Fields {
  const merged = { ...shared, ...own };
  const mode = textOf(own.agent) ?? textOf(own.command);
  const changesMode =
    mode !== undefined && mode !== (textOf(shared.agent) ?? textOf(shared.command));
  if (textOf(own.agent)) delete merged.command;
  else if (textOf(own.command)) delete merged.agent;
  if (changesMode && !textOf(own.outputFormat)) delete merged.outputFormat;
  return merged;
}

function nameOf(entry: Fields, index: number, total: number): string {
  if (total === 1) return '';
  return textOf(entry.name) ?? `#${index + 1}`;
}

function configFrom(fields: Fields, name: string, extraArgs: string[]): RunnerConfig {
  const agent = agentFrom(fields.agent);
  const command = textOf(fields.command);
  if (!agent && !command) {
    throw new Error(
      `set either agent (one of ${runtimes.ids().join(', ')}) or command in the config file or the environment`,
    );
  }
  const args = [...argsFrom(fields.args), ...extraArgs];
  if (agent === 'hermes' && args.includes('--ignore-rules')) {
    throw new Error('Hermes cannot use --ignore-rules while Helena runtime policy sync is enabled');
  }
  return {
    name,
    url: required(fields.url, 'url').replace(/\/+$/, ''),
    apiKey: required(fields.apiKey, 'apiKey'),
    agent,
    provider: textOf(fields.provider),
    command,
    args,
    cwd: textOf(fields.cwd)?.replace(/^~/, process.env.HOME ?? '~'),
    env: (fields.env as Record<string, string> | undefined) ?? {},
    concurrency: intFrom(fields.concurrency, DEFAULTS.concurrency),
    pollIntervalMs: Math.max(
      intFrom(fields.pollIntervalMs, DEFAULTS.pollIntervalMs),
      MIN_POLL_INTERVAL_MS,
    ),
    timeoutMs: intFrom(fields.timeoutMs, DEFAULTS.timeoutMs),
    outputFormat: outputFormatFrom(fields.outputFormat, presetOf({ agent, command })),
    models: modelsFrom(fields.models),
    hermes: hermesFrom(fields.hermes),
    isolation: withRuntime(isolationFrom(fields.isolation), agent),
  };
}

// The launcher needs to know whose profile its helper works in (isolation.ts AgentIsolation).
function withRuntime(
  isolation: AgentIsolation | undefined,
  agent: string | undefined,
): AgentIsolation | undefined {
  return isolation && agent ? { ...isolation, runtime: agent } : isolation;
}

// Whatever the environment and the command line said, which is what the file's shared
// fields are read through. An agent entry then wins over all three: it is the only place
// that can describe one agent among several.
function sharedFields(file: Fields, overrides: ConfigOverrides): Fields {
  const env = process.env;
  const outside: Fields = {
    url: env.ITSAPLAN_URL,
    apiKey: env.ITSAPLAN_API_KEY,
    agent: overrides.agent ?? env.ITSAPLAN_AGENT,
    provider: env.ITSAPLAN_PROVIDER,
    command: env.ITSAPLAN_COMMAND,
    cwd: env.ITSAPLAN_CWD,
    concurrency: env.ITSAPLAN_CONCURRENCY,
    pollIntervalMs: env.ITSAPLAN_POLL_INTERVAL_MS,
    timeoutMs: env.ITSAPLAN_TIMEOUT_MS,
    outputFormat: env.ITSAPLAN_OUTPUT_FORMAT,
  };
  // A variable that is not set says nothing about the field, so it must not overwrite it.
  for (const [field, value] of Object.entries(outside)) {
    if (!textOf(value)) delete outside[field];
  }
  return merge(file, outside);
}

// One config per agent the file lists, in its order.
export async function loadConfig(
  path: string,
  overrides: ConfigOverrides = {},
): Promise<RunnerConfig[]> {
  const file = await readConfigFile(path);
  const entries = agentFieldsFrom(file);
  if (entries.length === 0) {
    throw new Error('no agents configured — apiKeys and agents cannot be empty');
  }
  const shared = sharedFields(file, overrides);
  return entries.map((entry, index) =>
    configFrom(merge(shared, entry), nameOf(entry, index, entries.length), overrides.args ?? []),
  );
}
