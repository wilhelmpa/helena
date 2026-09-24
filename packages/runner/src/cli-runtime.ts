import { spawn } from 'node:child_process';
import { lstat, mkdir, readFile, readdir, rm } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { RunnerConfig } from './config';
import {
  LoginRefusalReader,
  loginEnv,
  type CliLogin,
  type CliLoginRuntime,
  type CliLoginState,
} from './cli-login';
import { claudeToolArgs, cliToolsets, codexToolArgs } from './cli-tools';
import { collectProfile, mcpSecretVariable, type CollectedProfile } from './contributions';
import { atomicWrite, digest, ensureRoot } from './files';
import type { HermesInventory } from './inventory';
import { isolationEnabled, launch, profileHelper } from './isolation';
import type { WorkRef } from './logins';
import type { RuntimePolicyClient, RuntimePolicySnapshot, RuntimeStatus } from './policy';
import {
  profileDigest,
  resolveMcpValue,
  type CodexSandbox,
  type CommandHooks,
  type McpServerSpec,
  type ProfileDrift,
  type ProfileReport,
  type RunSettings,
  type RuntimeAdapter,
  type RuntimeDefaults,
  type RuntimeIssue,
  type SessionFacts,
  type StartGate,
} from './runtime';

// Claude Code and Codex behind the runtime adapter interface (runtime.ts). The runner
// rewrites no configuration file of theirs: everything Helena sets reaches them per run.
//
//   instructions  the agent's SOUL in front of the run's own context: Claude Code's
//                 --append-system-prompt, Codex' prompt
//   skills        written below the agent's home (.helena/): a plugin for Claude Code
//                 (--plugin-dir), an index with the paths for Codex, which reads the SKILL.md
//                 it needs with its own tools
//   MCP servers   Helena's own and the library's, on the command line (--mcp-config with
//                 --strict-mcp-config, Codex -c mcp_servers.*), secrets as variables of the
//                 run's environment
//   tools         the built-in tools the owner turned off, and the ones no agent gets
//                 (cli-tools.ts)
//   model         --model/--effort and -m/-c model_reasoning_effort (presets.ts)
//   login         a login Helena grants the agent, in the one command's environment
//                 (cli-login.ts), else the runtime's own login in the agent's home
//   sandbox       Codex runs the model's commands without its sandbox only inside agent
//                 isolation, read-only otherwise (execute.ts enforces it)
//
// Two ways to run. An agent Helena provisioned has a home of its own (HELENA_AGENT_HOME, its
// profile directory): Claude Code keeps its sessions and settings in <home>/.claude
// (CLAUDE_CONFIG_DIR), Codex in <home>/.codex (CODEX_HOME), whose config.toml Codex is told
// to ignore, since only the agent could have written it. An operator's own runner (a
// laptop) has none: the runtimes use their user's own homes, and Codex servers of its own
// config.toml are turned off.

type CliRuntime = CliLoginRuntime;

const SKILL_SLUG = /^[a-z0-9][a-z0-9-]{0,63}$/;
const SKILL_PATH =
  /^(?:SKILL\.md|(?:[A-Za-z0-9][A-Za-z0-9._-]*\/){0,7}[A-Za-z0-9][A-Za-z0-9._-]*\.(?:md|markdown))$/i;
const CHECK_INTERVAL_MS = 60_000;
// The runtime's program and its local login are looked at this often, and at once after a
// command whose login was refused.
const PROBE_INTERVAL_MS = 10 * 60_000;
const PROBE_TIMEOUT_MS = 30_000;
const PLUGIN_NAME = 'helena';
// Where the runner writes below an agent's home.
const HOME_STATE = '.helena';

// The agent's own home, which the deployment gives every agent it provisions.
export function cliAgentHome(config: Pick<RunnerConfig, 'env'>): string | null {
  const home = config.env.HELENA_AGENT_HOME?.trim();
  return home && home.startsWith('/') ? home : null;
}

// Where an operator's own runner keeps what it writes for an agent: outside the project's
// workspace and outside the runtime's own home.
export function cliStateRoot(config: RunnerConfig): string {
  return (
    config.env.HELENA_RUNTIME_DIR ??
    process.env.HELENA_RUNTIME_DIR ??
    join(homedir(), '.local', 'state', 'helena-runner')
  );
}

function isolated(config: Pick<RunnerConfig, 'isolation'>): boolean {
  return isolationEnabled() && config.isolation !== undefined;
}

// Codex' sandbox for the agent. Its own sandbox (bubblewrap) cannot start inside the
// container Helena runs in, so an agent Helena provisioned runs without it only inside
// agent isolation, where its unit is the sandbox, and read-only otherwise: then it reaches
// Helena's tools, but no shell command runs. An operator's own runner keeps Codex'
// workspace-write.
export function codexSandbox(config: Pick<RunnerConfig, 'env' | 'isolation'>): CodexSandbox {
  if (isolated(config)) return 'danger-full-access';
  return cliAgentHome(config) ? 'read-only' : 'workspace-write';
}

// ── MCP servers on the command line ─────────────────────────────────────────────────────

export function claudeMcpArgs(specs: McpServerSpec[]): string[] {
  if (specs.length === 0) return ['--strict-mcp-config'];
  const values = (entries: McpServerSpec['env']) =>
    Object.fromEntries(
      (entries ?? []).map(({ name, value }) => [
        name,
        'literal' in value ? value.literal : 'env' in value ? `\${${value.env}}` : value.template,
      ]),
    );
  const servers = Object.fromEntries(
    specs.map((spec) => [
      spec.name,
      spec.transport === 'stdio'
        ? // Claude Code hands a stdio server its whole environment, so passEnv needs
          // nothing here; a ${VAR} of an unset variable would fail the whole config.
          { type: 'stdio', command: spec.command, args: spec.args ?? [], env: values(spec.env) }
        : { type: spec.transport, url: spec.url, headers: values(spec.headers) },
    ]),
  );
  return [
    '--mcp-config',
    JSON.stringify({ mcpServers: servers }),
    // Only Helena's servers: none of the owner's own configuration reaches the agent.
    '--strict-mcp-config',
    // Nobody is there to approve a tool call of a server the owner gave the agent.
    ...specs.flatMap((spec) => ['--allowedTools', `mcp__${spec.name}`]),
  ];
}

const BARE_KEY = /^[A-Za-z0-9_-]+$/;

function tomlString(value: string): string {
  return JSON.stringify(value);
}

function tomlTable(entries: [string, string][]): string {
  return `{${entries
    .map(([key, value]) => `${BARE_KEY.test(key) ? key : tomlString(key)}=${tomlString(value)}`)
    .join(',')}}`;
}

// Codex takes each key of a server as a -c override. A secret reaches a stdio server as a
// variable of the run's environment under the name the server reads (env_vars), and an
// HTTP header from the variable that holds it (env_http_headers); an Authorization header
// "Bearer ${VAR}" is Codex' bearer_token_env_var. Codex runs no SSE server.
export function codexMcpArgs(
  specs: McpServerSpec[],
  ownServers: string[],
  env: Record<string, string | undefined>,
): { args: string[]; env: Record<string, string>; drift: ProfileDrift[] } {
  const args: string[] = [];
  const childEnv: Record<string, string> = {};
  const drift: ProfileDrift[] = [];
  const set = (name: string, key: string, value: string) =>
    args.push('-c', `mcp_servers.${name}.${key}=${value}`);
  for (const spec of specs) {
    if (spec.transport === 'sse') {
      drift.push({ key: `mcp_servers.${spec.name}`, code: 'mcp-unsupported' });
      continue;
    }
    if (spec.transport === 'stdio') {
      set(spec.name, 'command', tomlString(spec.command ?? ''));
      set(spec.name, 'args', `[${(spec.args ?? []).map(tomlString).join(',')}]`);
      const literals: [string, string][] = [];
      const passed = [...(spec.passEnv ?? [])];
      for (const { name, value } of spec.env ?? []) {
        if ('literal' in value) literals.push([name, value.literal]);
        else {
          childEnv[name] = resolveMcpValue(value, env);
          passed.push(name);
        }
      }
      if (literals.length > 0) set(spec.name, 'env', tomlTable(literals));
      if (passed.length > 0) set(spec.name, 'env_vars', `[${passed.map(tomlString).join(',')}]`);
    } else {
      set(spec.name, 'url', tomlString(spec.url ?? ''));
      const literal: [string, string][] = [];
      const fromEnv: [string, string][] = [];
      for (const { name, value } of spec.headers ?? []) {
        const bearer =
          'template' in value ? /^Bearer \$\{([A-Z0-9_]+)\}$/.exec(value.template) : null;
        if (name.toLowerCase() === 'authorization' && bearer) {
          set(spec.name, 'bearer_token_env_var', tomlString(bearer[1]));
        } else if ('literal' in value) literal.push([name, value.literal]);
        else if ('env' in value) fromEnv.push([name, value.env]);
        else drift.push({ key: `mcp_servers.${spec.name}`, code: 'mcp-differs', detail: name });
      }
      if (literal.length > 0) set(spec.name, 'http_headers', tomlTable(literal));
      if (fromEnv.length > 0) set(spec.name, 'env_http_headers', tomlTable(fromEnv));
    }
    if (spec.toolTimeoutSec !== undefined) {
      set(spec.name, 'tool_timeout_sec', String(spec.toolTimeoutSec));
    }
    if (spec.startupTimeoutSec !== undefined) {
      set(spec.name, 'startup_timeout_sec', String(spec.startupTimeoutSec));
    }
    for (const [key, value] of Object.entries(spec.codex ?? {})) {
      if (BARE_KEY.test(key)) set(spec.name, key, value);
    }
    set(spec.name, 'enabled', 'true');
  }
  const managed = new Set(specs.map((spec) => spec.name));
  for (const name of ownServers) {
    if (!managed.has(name) && BARE_KEY.test(name)) set(name, 'enabled', 'false');
  }
  return { args, env: childEnv, drift };
}

// The servers Codex' own config.toml defines, by name: its [mcp_servers.<name>] tables.
export async function codexOwnMcpServers(codexHome: string): Promise<string[]> {
  let text: string;
  try {
    text = await readFile(join(codexHome, 'config.toml'), 'utf8');
  } catch {
    return [];
  }
  const names = new Set<string>();
  for (const match of text.matchAll(/^\s*\[mcp_servers\.("?)([^\]".]+)\1\]\s*$/gm)) {
    names.add(match[2]);
  }
  return [...names];
}

// Codex' defaults, from the top of its config.toml.
async function codexDefaults(codexHome: string): Promise<RuntimeDefaults | null> {
  let text: string;
  try {
    text = await readFile(join(codexHome, 'config.toml'), 'utf8');
  } catch {
    return null;
  }
  const top = text.split(/^\s*\[/m)[0];
  const read = (key: string) =>
    new RegExp(`^\\s*${key}\\s*=\\s*"([^"]*)"`, 'm').exec(top)?.[1] ?? null;
  return {
    model: read('model'),
    provider: read('model_provider'),
    reasoning: read('model_reasoning_effort'),
  };
}

// ── Skills ──────────────────────────────────────────────────────────────────────────────

export interface CliFile {
  path: string;
  content: string;
}

interface SkillFiles {
  files: CliFile[];
  index: string;
}

function skillsOf(snapshot: RuntimePolicySnapshot, root: string): SkillFiles {
  const files: CliFile[] = [
    {
      path: '.claude-plugin/plugin.json',
      content: `${JSON.stringify({ name: PLUGIN_NAME, version: '1.0.0', description: "The agent's skills from Helena" }, null, 2)}\n`,
    },
  ];
  const lines: string[] = [];
  for (const skill of snapshot.skills ?? []) {
    if (!SKILL_SLUG.test(skill.slug)) throw new Error('runtime skill identity is invalid');
    for (const file of [{ path: 'SKILL.md', content: skill.markdown }, ...(skill.files ?? [])]) {
      if (!SKILL_PATH.test(file.path))
        throw new Error('runtime policy contains an unsafe skill path');
      files.push({ path: `skills/${skill.slug}/${file.path}`, content: file.content });
    }
    const description = skill.description.replace(/\s+/g, ' ').trim();
    lines.push(
      `- ${skill.name}${description ? `: ${description}` : ''} (${join(root, 'skills', skill.slug, 'SKILL.md')})`,
    );
  }
  const index =
    lines.length === 0
      ? ''
      : [
          '## Skills',
          'Your skills from Helena. Before you use one, read its SKILL.md with your file tools.',
          ...lines,
        ].join('\n');
  return { files, index };
}

const CLI_FILE_PATH = /^(?:\.claude-plugin\/plugin\.json|skills\/[a-z0-9][a-z0-9-]{0,63}\/.+)$/;

// Makes `root` hold exactly these files: each written only when it changed, and a skill
// Helena no longer gives the agent removed. Run by the runner itself, or, for an isolated
// agent, by its profile helper in the agent's own unit (cli.ts), since the runner opens no
// file in an isolated agent's home.
export async function syncCliFiles(root: string, files: CliFile[]): Promise<number> {
  await ensureRoot(root);
  let written = 0;
  const wanted = new Set<string>();
  for (const file of files) {
    if (!CLI_FILE_PATH.test(file.path) || file.path.split('/').includes('..')) {
      throw new Error('runtime policy contains an unsafe skill path');
    }
    wanted.add(file.path);
    const target = join(root, file.path);
    const current = await readFile(target).then(digest, () => null);
    if (current !== digest(file.content)) {
      await atomicWrite(root, target, file.content);
      written++;
    }
  }
  const skillRoot = join(root, 'skills');
  for (const slug of await readdir(skillRoot).catch(() => [] as string[])) {
    if (![...wanted].some((path) => path.startsWith(`skills/${slug}/`))) {
      await rm(join(skillRoot, slug), { recursive: true, force: true });
    }
  }
  return written;
}

// The runtime's own directory in the agent's home, which Codex refuses to start without.
export async function ensureRuntimeDir(path: string): Promise<void> {
  await mkdir(path, { recursive: true, mode: 0o700 });
  const info = await lstat(path);
  if (info.isSymbolicLink() || !info.isDirectory()) throw new Error(`${path} is not a directory`);
}

// The agent's standing instructions: the SOUL.md Helena writes for Hermes.
function instructionsOf(snapshot: RuntimePolicySnapshot): string {
  return snapshot.runtimePolicy.files
    .filter((file) => file.path === 'SOUL.md')
    .map((file) => file.content.trim())
    .join('\n\n');
}

// ── The runtime's program and its login ────────────────────────────────────────────────

// "2.1.281 (Claude Code)", "codex-cli 0.156.1".
export function parseVersion(output: string): string | null {
  return /(\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?)/.exec(output)?.[1] ?? null;
}

export interface CommandResult {
  code: number | null;
  stdout: string;
  missing: boolean;
}

export type ShortCommand = (
  bin: string,
  args: string[],
  env: Record<string, string>,
) => Promise<CommandResult>;

// Runs a short command of the runtime's program; never throws.
export function runShort(
  bin: string,
  args: string[],
  env: Record<string, string>,
): Promise<CommandResult> {
  return new Promise((resolve) => {
    let stdout = '';
    let settled = false;
    const done = (result: CommandResult) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };
    let child;
    try {
      child = spawn(bin, args, {
        env: { ...(process.env as Record<string, string>), ...env },
        stdio: ['ignore', 'pipe', 'ignore'],
      });
    } catch {
      return done({ code: null, stdout: '', missing: true });
    }
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      done({ code: null, stdout, missing: false });
    }, PROBE_TIMEOUT_MS);
    timer.unref?.();
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      if (stdout.length < 65_536) stdout += chunk;
    });
    child.on('error', (error: NodeJS.ErrnoException) => {
      clearTimeout(timer);
      done({ code: null, stdout: '', missing: error.code === 'ENOENT' || error.code === 'EACCES' });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      done({ code, stdout, missing: false });
    });
  });
}

// Whether the runtime holds a login of its own in the agent's home: `claude auth status`
// (JSON, loggedIn) and `codex login status` (exit 0). Neither shows the login itself.
export function localLoginArgs(runtime: CliRuntime): string[] {
  return runtime === 'claude' ? ['auth', 'status'] : ['login', 'status'];
}

export function localLoginFrom(runtime: CliRuntime, result: CommandResult): boolean | null {
  if (result.missing || result.code === null) return null;
  if (runtime === 'codex') return result.code === 0;
  try {
    return (JSON.parse(result.stdout) as { loggedIn?: unknown }).loggedIn === true;
  } catch {
    return result.code === 0;
  }
}

// Serializes the starts of the commands that share one login file: Codex refreshes its
// ChatGPT login in its auth.json when it is about a week old, and two commands refreshing
// the same login at once lose it (OpenAI: one auth.json per serialized stream). A command
// holds the gate only until the model first answered it (execute.ts).
export class LoginStartGate implements StartGate {
  private tail: Promise<void> = Promise.resolve();

  acquire(): Promise<() => void> {
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const previous = this.tail;
    this.tail = previous.then(() => held);
    return previous.then(() => release);
  }
}

// Where the launcher's command-line client lives, for a command the owner runs as the
// runner's user (deployment/volition-stack/native/isolation.sh installs it).
const LAUNCH_CLIENT = '/usr/local/lib/volition-isolation/launch_client.py';
const RUNNER_USER = 'volition-hermes';

function shellQuote(value: string): string {
  return /^[A-Za-z0-9_./:=@%+-]+$/.test(value) ? value : `'${value.replace(/'/g, `'\\''`)}'`;
}

// The command the owner runs in the owner terminal to sign the agent's runtime in. Claude
// Code: `claude setup-token` makes a token of a year for the owner's plan, which goes into
// Zugänge as a runtime login. Codex: its device login in the agent's own home, run as the
// user the agent runs as (through the launcher when the agent is isolated); Codex keeps and
// refreshes that login there.
export function signInCommand(
  runtime: CliRuntime,
  config: Pick<RunnerConfig, 'env' | 'isolation' | 'cwd'>,
): string | undefined {
  if (runtime === 'claude') return 'claude setup-token';
  const home = cliAgentHome(config);
  if (!home) return 'codex login --device-auth';
  const codexHome = config.env.CODEX_HOME ?? join(home, '.codex');
  const isolation = config.isolation;
  if (isolated(config) && isolation && config.cwd) {
    return [
      'sudo',
      '-u',
      RUNNER_USER,
      '/usr/bin/python3',
      '-I',
      LAUNCH_CLIENT,
      'run',
      '--slug',
      isolation.slug,
      '--profile',
      isolation.profile,
      '--runtime',
      'codex',
      '--kind',
      'helper',
      '--cwd',
      config.cwd,
      '--env',
      `CODEX_HOME=${codexHome}`,
      '--',
      'login',
      '--device-auth',
    ]
      .map(shellQuote)
      .join(' ');
  }
  return [
    'sudo',
    '-u',
    RUNNER_USER,
    'env',
    `HOME=${home}`,
    `CODEX_HOME=${codexHome}`,
    '/usr/local/bin/codex',
    'login',
    '--device-auth',
  ]
    .map(shellQuote)
    .join(' ');
}

// ── The adapter ─────────────────────────────────────────────────────────────────────────

interface Applied {
  revision: string;
  snapshot: RuntimePolicySnapshot;
  collected: CollectedProfile;
  instructions: string;
  skills: SkillFiles;
  secrets: number[];
}

interface Probe {
  at: number;
  version: string | null;
  missing: boolean;
  // Null where it could not be told.
  localLogin: boolean | null;
}

export class CliRuntimeAdapter implements RuntimeAdapter {
  private applied: Applied | null = null;
  private status: Pick<RuntimeStatus, 'status' | 'detail'> = { status: 'online', detail: null };
  private profile: ProfileReport | null = null;
  private reported: string | null = null;
  private checkedAt = -Infinity;
  private runtimeDefaults: RuntimeDefaults | null = null;
  private active: Promise<void> | null = null;
  private probe: Probe | null = null;
  private granted: CliLoginState | null = null;
  // Set when the runtime's service refused the login a command used; cleared when a
  // command gets an answer again.
  private refused = false;
  private readonly gate = new LoginStartGate();
  private readonly home: string | null;
  private readonly root: string;

  constructor(
    readonly runtime: CliRuntime,
    private readonly config: RunnerConfig,
    private readonly client: RuntimePolicyClient,
    private readonly now: () => number = Date.now,
    // How the runtime's program is asked for its version and its login.
    private readonly command: ShortCommand = runShort,
  ) {
    this.home = cliAgentHome(config);
    // An agent's own home, or a directory named after a digest of the agent's key: unique
    // per agent, and it gives nothing away.
    this.root = this.home
      ? join(this.home, HOME_STATE)
      : join(cliStateRoot(config), `agent-${digest(config.apiKey).slice(0, 16)}`);
  }

  private codexHome(): string {
    return this.config.env.CODEX_HOME ?? process.env.CODEX_HOME ?? join(homedir(), '.codex');
  }

  // The runtime's own directory in the agent's home.
  private runtimeDir(): string | null {
    if (!this.home) return null;
    return this.runtime === 'claude'
      ? (this.config.env.CLAUDE_CONFIG_DIR ?? join(this.home, '.claude'))
      : (this.config.env.CODEX_HOME ?? join(this.home, '.codex'));
  }

  private runtimeEnv(): Record<string, string> {
    const dir = this.runtimeDir();
    if (!dir) return {};
    return this.runtime === 'claude'
      ? {
          CLAUDE_CONFIG_DIR: dir,
          // The installation is Helena's (install-cli-runtimes.sh); no command updates it.
          DISABLE_AUTOUPDATER: '1',
          DISABLE_UPDATES: '1',
          CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
        }
      : { CODEX_HOME: dir };
  }

  ensure(): Promise<void> {
    this.active ??= this.sync().finally(() => {
      this.active = null;
    });
    return this.active;
  }

  inventoryChanged(): void {
    this.checkedAt = -Infinity;
  }

  defaults(): RuntimeDefaults | null {
    return this.runtimeDefaults;
  }

  // Claude Code names its model on the first line of every answer, which the run reads
  // off its output; Codex does not say which model it used.
  sessionFacts(): Promise<SessionFacts | null> {
    return Promise.resolve(null);
  }

  private async sync(): Promise<void> {
    let snapshot: RuntimePolicySnapshot;
    try {
      snapshot = await this.client.runtimePolicy();
    } catch {
      return;
    }
    const due = this.now() - this.checkedAt >= CHECK_INTERVAL_MS;
    if (snapshot.revision === this.applied?.revision && !due) return;
    this.checkedAt = this.now();
    try {
      this.applied = await this.apply(snapshot);
      this.status = { status: 'online', detail: null };
      this.profile = await this.check(this.applied);
    } catch (error) {
      this.status = {
        status: 'degraded',
        detail: `Runtime policy sync failed: ${error instanceof Error ? error.message.slice(0, 200) : 'unknown error'}`,
      };
    }
    await this.refreshLogin();
    await this.refreshProbe();
    await this.report(snapshot);
  }

  // Whether Helena grants the agent a login, without reading it.
  private async refreshLogin(): Promise<void> {
    if (!this.client.runtimeLogin) return;
    try {
      const state = await this.client.runtimeLogin();
      this.granted = state && state.runtime === this.runtime ? state : null;
    } catch {
      // Kept as it was; the next check asks again.
    }
  }

  // The runtime's version and whether it holds a login of its own, looked at every few
  // minutes: each is a start of the runtime's program.
  private async refreshProbe(force = false): Promise<void> {
    if (!force && this.probe && this.now() - this.probe.at < PROBE_INTERVAL_MS) return;
    const bin = this.runtime;
    const version = await this.command(bin, ['--version'], {});
    const localLogin = version.missing ? null : await this.probeLocalLogin(bin);
    this.probe = {
      at: this.now(),
      version: version.missing ? null : parseVersion(version.stdout),
      missing: version.missing,
      localLogin,
    };
  }

  private async probeLocalLogin(bin: string): Promise<boolean | null> {
    const args = localLoginArgs(this.runtime);
    const isolation = this.config.isolation;
    if (isolated(this.config) && isolation && this.config.cwd) {
      // The agent's home is its project's: its own unit reads it.
      let stdout = '';
      try {
        const result = await launch(
          {
            slug: isolation.slug,
            profile: isolation.profile,
            runtime: this.runtime,
            args,
            env: this.runtimeEnv(),
            cwd: this.config.cwd,
            agentId: isolation.agentId,
            work: { kind: 'helper', id: null },
            limits: { runtimeMaxSec: 120 },
          },
          {
            onStdout: (chunk) => {
              if (stdout.length < 65_536) stdout += chunk.toString('utf8');
            },
          },
        );
        return localLoginFrom(this.runtime, { code: result.code, stdout, missing: false });
      } catch {
        return null;
      }
    }
    return localLoginFrom(this.runtime, await this.command(bin, args, this.runtimeEnv()));
  }

  // Writes the agent's skills, each file only when it changed, and removes the ones Helena
  // no longer gives it.
  private async apply(snapshot: RuntimePolicySnapshot): Promise<Applied> {
    const collected = collectProfile({
      runtime: this.runtime,
      snapshot,
      url: this.config.url,
      env: this.config.env,
    });
    const skills = skillsOf(snapshot, this.root);
    const isolation = this.config.isolation;
    if (isolated(this.config) && isolation && this.config.cwd) {
      await profileHelper(isolation, this.config.cwd, {
        op: 'cli-files',
        runtime: this.runtime,
        files: skills.files,
      });
    } else {
      await syncCliFiles(this.root, skills.files);
      const dir = this.runtimeDir();
      if (dir) await ensureRuntimeDir(dir);
    }
    const secrets = (snapshot.mcpServers ?? [])
      .flatMap((server) => [...server.env, ...server.headers])
      .flatMap((entry) => ('secret' in entry ? [entry.secret] : []));
    return {
      revision: snapshot.revision,
      snapshot,
      collected,
      instructions: instructionsOf(snapshot),
      skills,
      secrets: [...new Set(secrets)],
    };
  }

  private denied(applied: Applied): string[] {
    return applied.snapshot.runtimePolicy.toolDeny ?? [];
  }

  private enabledSpecs(applied: Applied): McpServerSpec[] {
    const off = new Set([...this.denied(applied), ...applied.collected.suppressed]);
    return applied.collected.mcpServers.filter((spec) => !off.has(spec.name));
  }

  // The servers of Codex' own config.toml, which an operator's runner turns off. An agent
  // Helena provisioned runs with --ignore-user-config instead: only Helena configures it.
  private async ownServers(): Promise<string[]> {
    if (this.runtime !== 'codex' || this.home) return [];
    return codexOwnMcpServers(this.codexHome());
  }

  private async check(applied: Applied): Promise<ProfileReport> {
    const specs = this.enabledSpecs(applied);
    let drift: ProfileDrift[] = [];
    const own = await this.ownServers();
    if (this.runtime === 'codex') {
      drift = codexMcpArgs(specs, own, {}).drift;
      this.runtimeDefaults = this.home ? null : await codexDefaults(this.codexHome());
    }
    const managed = new Set(specs.map((spec) => spec.name));
    return {
      hash: profileDigest({
        revision: applied.revision,
        instructions: digest(applied.instructions),
        skills: applied.skills.files.map((file) => [file.path, digest(file.content)]),
        servers: specs.map((spec) => spec.name),
        tools: this.toolArgs(applied),
        own,
      }),
      checkedAt: new Date(this.now()).toISOString(),
      drift,
      defaults: this.runtimeDefaults,
      mcpServers: [
        ...specs.map((spec) => ({ name: spec.name, enabled: true, managed: true })),
        ...own
          .filter((name) => !managed.has(name))
          .map((name) => ({ name, enabled: false, managed: false })),
      ],
    };
  }

  private toolArgs(applied: Applied): string[] {
    return this.runtime === 'claude'
      ? claudeToolArgs(this.denied(applied))
      : codexToolArgs(this.denied(applied));
  }

  // What keeps the runtime from its work, as Helena shows it.
  issues(): RuntimeIssue[] {
    const issues: RuntimeIssue[] = [];
    if (this.probe?.missing) issues.push({ code: 'runtime-missing', detail: this.runtime });
    else if (this.refused || (!this.granted && this.probe?.localLogin === false)) {
      const command = signInCommand(this.runtime, this.config);
      issues.push({
        code: 'not-signed-in',
        detail: this.refused ? 'rejected' : 'missing',
        ...(command && { command }),
      });
    }
    if (
      this.runtime === 'codex' &&
      codexSandbox(this.config) !== 'danger-full-access' &&
      this.home
    ) {
      issues.push({ code: 'sandbox-unavailable', detail: codexSandbox(this.config) });
    }
    return issues;
  }

  private async report(snapshot: RuntimePolicySnapshot): Promise<void> {
    const applied = this.applied;
    const inventory: HermesInventory | undefined = applied
      ? {
          toolsets: cliToolsets(this.runtime),
          mcpServers: applied.collected.runtimeServers,
          skills: (snapshot.skills ?? []).map((skill) => ({
            name: skill.name,
            category: PLUGIN_NAME,
            description: skill.description.slice(0, 300),
            origin: 'plan' as const,
            pinned: false,
          })),
          memory: [],
          cronJobs: 0,
        }
      : undefined;
    const issues = this.issues();
    const blocking = issues.find((issue) => issue.code !== 'sandbox-unavailable');
    const status: RuntimeStatus = {
      adapter: this.runtime,
      ...(this.status.status === 'online' && issues.length > 0
        ? {
            status: 'degraded' as const,
            detail: blocking
              ? blocking.code === 'runtime-missing'
                ? `${this.runtime} is not installed`
                : `${this.runtime} is not signed in`
              : 'Codex runs read-only: its sandbox needs agent isolation',
          }
        : this.status),
      appliedRevision: applied?.revision ?? null,
      capabilities: [
        'model',
        'reasoning',
        'managed-skills',
        'managed-mcp-servers',
        'managed-tools',
        'profile-drift',
      ],
      ...(inventory && { inventory }),
      ...(this.profile && { profile: this.profile }),
      version: this.probe?.version ?? null,
      issues,
      // An owner's actions on what an agent learned are Hermes'; here each is done at once.
      actions: (snapshot.actions ?? []).map((action) => ({
        id: action.id,
        error: action.kind === 'rewrite-profile' ? null : 'Only Hermes agents learn',
      })),
    };
    const key = digest(
      JSON.stringify({ ...status, profile: { ...this.profile, checkedAt: null } }),
    );
    if (key === this.reported) return;
    try {
      await this.client.reportRuntimeStatus(status);
      this.reported = key;
    } catch {
      // Sent again with the next change or check.
    }
  }

  // The login granted to the agent for this work, or null. A server that cannot answer
  // leaves the runtime its own login.
  private async loginFor(work?: WorkRef): Promise<CliLogin | null> {
    if (!work || !this.client.runtimeLogin) return null;
    try {
      const login = await this.client.runtimeLogin(work);
      return login && 'value' in login && login.runtime === this.runtime ? login : null;
    } catch {
      return null;
    }
  }

  // Watches one command for a refused login and tells Helena when that changes.
  private hooks(login: CliLogin | null): CommandHooks {
    const reader = new LoginRefusalReader(this.runtime);
    const gate =
      this.runtime === 'codex' && this.home && !(login && login.method === 'api_key')
        ? this.gate
        : undefined;
    return {
      ...(this.runtime === 'codex' && { sandbox: codexSandbox(this.config) }),
      ...(gate && { startGate: gate }),
      output: (chunk) => reader.write(chunk),
      finished: () => {
        reader.end();
        const refused = reader.refused();
        if (refused === this.refused) return;
        this.refused = refused;
        this.inventoryChanged();
        // The owner sees it at once rather than with the next check.
        void this.refreshProbe(true)
          .then(() => this.applied && this.report(this.applied.snapshot))
          .catch(() => {});
      },
    };
  }

  async runSettings(work?: WorkRef): Promise<RunSettings> {
    await this.ensure();
    const applied = this.applied;
    if (!applied) return { toolsets: null, env: {} };
    const login = await this.loginFor(work);
    const env: Record<string, string> = {
      ...this.runtimeEnv(),
      ...loginEnv(this.runtime, login, this.home !== null),
    };
    if (applied.secrets.length > 0) {
      const values = await this.client.mcpSecrets(work);
      for (const id of applied.secrets) env[mcpSecretVariable(id)] = values[String(id)] ?? '';
    }
    const specs = this.enabledSpecs(applied);
    const hooks = this.hooks(login);
    if (this.runtime === 'claude') {
      return {
        toolsets: null,
        env,
        args: [...claudeMcpArgs(specs), '--plugin-dir', this.root, ...this.toolArgs(applied)],
        instructions: applied.instructions,
        hooks,
      };
    }
    const codex = codexMcpArgs(specs, await this.ownServers(), {
      ...process.env,
      ...this.config.env,
      ...env,
    });
    return {
      toolsets: null,
      env: { ...env, ...codex.env },
      args: [
        // Workspaces are git repositories, but an area folder or Home's may not be.
        '--skip-git-repo-check',
        ...(this.home ? ['--ignore-user-config'] : []),
        ...codex.args,
        ...this.toolArgs(applied),
      ],
      instructions: [applied.instructions, applied.skills.index].filter(Boolean).join('\n\n'),
      hooks,
    };
  }
}
