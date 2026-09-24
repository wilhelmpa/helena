import { readFile, readdir, rm } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { RunnerConfig } from './config';
import { collectProfile, mcpSecretVariable, type CollectedProfile } from './contributions';
import { atomicWrite, digest, ensureRoot } from './files';
import type { HermesInventory } from './inventory';
import type { WorkRef } from './logins';
import type { RuntimePolicyClient, RuntimePolicySnapshot, RuntimeStatus } from './policy';
import {
  profileDigest,
  resolveMcpValue,
  type McpServerSpec,
  type ProfileDrift,
  type ProfileReport,
  type RunSettings,
  type RuntimeAdapter,
  type RuntimeDefaults,
  type SessionFacts,
} from './runtime';

// Claude Code and Codex behind the runtime adapter interface (runtime.ts). Neither has a
// profile the runner may rewrite: their homes hold the owner's own login and settings, and
// the working directory belongs to the project. So everything Helena sets reaches them per
// run instead:
//
//   instructions  the agent's SOUL (what Hermes reads from SOUL.md) in front of the run's own
//                 context: Claude Code's --append-system-prompt, Codex' prompt
//   skills        written below the runner's state directory: a plugin for Claude Code
//                 (--plugin-dir), an index with the paths for Codex, which reads the SKILL.md
//                 it needs with its own tools
//   MCP servers   Helena's own and the library's, on the command line (--mcp-config with
//                 --strict-mcp-config, Codex -c mcp_servers.*), secrets as variables of the
//                 run's environment; a server of Codex' own config.toml is turned off
//   model         --model/--effort and -m/-c model_reasoning_effort (presets.ts)

type CliRuntime = 'claude' | 'codex';

const SKILL_SLUG = /^[a-z0-9][a-z0-9-]{0,63}$/;
const SKILL_PATH =
  /^(?:SKILL\.md|(?:[A-Za-z0-9][A-Za-z0-9._-]*\/){0,7}[A-Za-z0-9][A-Za-z0-9._-]*\.(?:md|markdown))$/i;
const CHECK_INTERVAL_MS = 60_000;
const PLUGIN_NAME = 'helena';

// Where the runner keeps what it writes for an agent: outside the project's workspace and
// outside the runtime's own home.
export function cliStateRoot(config: RunnerConfig): string {
  return (
    config.env.HELENA_RUNTIME_DIR ??
    process.env.HELENA_RUNTIME_DIR ??
    join(homedir(), '.local', 'state', 'helena-runner')
  );
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

interface SkillFiles {
  files: { path: string; content: string }[];
  index: string;
}

function skillsOf(snapshot: RuntimePolicySnapshot, root: string): SkillFiles {
  const files: { path: string; content: string }[] = [
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

// The agent's standing instructions: the SOUL.md Helena writes for Hermes.
function instructionsOf(snapshot: RuntimePolicySnapshot): string {
  return snapshot.runtimePolicy.files
    .filter((file) => file.path === 'SOUL.md')
    .map((file) => file.content.trim())
    .join('\n\n');
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

export class CliRuntimeAdapter implements RuntimeAdapter {
  private applied: Applied | null = null;
  private status: Pick<RuntimeStatus, 'status' | 'detail'> = { status: 'online', detail: null };
  private profile: ProfileReport | null = null;
  private reported: string | null = null;
  private checkedAt = -Infinity;
  private runtimeDefaults: RuntimeDefaults | null = null;
  private active: Promise<void> | null = null;
  private readonly root: string;

  constructor(
    readonly runtime: CliRuntime,
    private readonly config: RunnerConfig,
    private readonly client: RuntimePolicyClient,
    private readonly now: () => number = Date.now,
  ) {
    // Named after a digest of the agent's key: unique per agent, and it gives nothing away.
    this.root = join(cliStateRoot(config), `agent-${digest(config.apiKey).slice(0, 16)}`);
  }

  private codexHome(): string {
    return this.config.env.CODEX_HOME ?? process.env.CODEX_HOME ?? join(homedir(), '.codex');
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
    await this.report(snapshot);
  }

  // Writes the agent's skills below the state directory, each file only when it changed,
  // and removes the ones Helena no longer gives it.
  private async apply(snapshot: RuntimePolicySnapshot): Promise<Applied> {
    const collected = collectProfile({
      runtime: this.runtime,
      snapshot,
      url: this.config.url,
      env: this.config.env,
    });
    const skills = skillsOf(snapshot, this.root);
    await ensureRoot(this.root);
    const wanted = new Set(skills.files.map((file) => file.path));
    for (const file of skills.files) {
      const target = join(this.root, file.path);
      const current = await readFile(target).then(digest, () => null);
      if (current !== digest(file.content)) await atomicWrite(this.root, target, file.content);
    }
    const skillRoot = join(this.root, 'skills');
    for (const slug of await readdir(skillRoot).catch(() => [] as string[])) {
      if (![...wanted].some((path) => path.startsWith(`skills/${slug}/`))) {
        await rm(join(skillRoot, slug), { recursive: true, force: true });
      }
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

  private enabledSpecs(applied: Applied): McpServerSpec[] {
    const off = new Set([
      ...(applied.snapshot.runtimePolicy.toolDeny ?? []),
      ...applied.collected.suppressed,
    ]);
    return applied.collected.mcpServers.filter((spec) => !off.has(spec.name));
  }

  private async check(applied: Applied): Promise<ProfileReport> {
    const specs = this.enabledSpecs(applied);
    let drift: ProfileDrift[] = [];
    const own = this.runtime === 'codex' ? await codexOwnMcpServers(this.codexHome()) : [];
    if (this.runtime === 'codex') {
      drift = codexMcpArgs(specs, own, {}).drift;
      this.runtimeDefaults = await codexDefaults(this.codexHome());
    }
    const managed = new Set(specs.map((spec) => spec.name));
    return {
      hash: profileDigest({
        revision: applied.revision,
        instructions: digest(applied.instructions),
        skills: applied.skills.files.map((file) => [file.path, digest(file.content)]),
        servers: specs.map((spec) => spec.name),
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

  private async report(snapshot: RuntimePolicySnapshot): Promise<void> {
    const applied = this.applied;
    const inventory: HermesInventory | undefined = applied
      ? {
          toolsets: [],
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
    const status: RuntimeStatus = {
      adapter: this.runtime,
      ...this.status,
      appliedRevision: applied?.revision ?? null,
      capabilities: [
        'model',
        'reasoning',
        'managed-skills',
        'managed-mcp-servers',
        'profile-drift',
      ],
      ...(inventory && { inventory }),
      ...(this.profile && { profile: this.profile }),
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

  async runSettings(work?: WorkRef): Promise<RunSettings> {
    await this.ensure();
    const applied = this.applied;
    if (!applied) return { toolsets: null, env: {} };
    const env: Record<string, string> = {};
    if (applied.secrets.length > 0) {
      const values = await this.client.mcpSecrets(work);
      for (const id of applied.secrets) env[mcpSecretVariable(id)] = values[String(id)] ?? '';
    }
    const specs = this.enabledSpecs(applied);
    if (this.runtime === 'claude') {
      return {
        toolsets: null,
        env,
        args: [...claudeMcpArgs(specs), '--plugin-dir', this.root],
        instructions: applied.instructions,
      };
    }
    const codex = codexMcpArgs(specs, await codexOwnMcpServers(this.codexHome()), {
      ...process.env,
      ...this.config.env,
      ...env,
    });
    return {
      toolsets: null,
      env: { ...env, ...codex.env },
      args: codex.args,
      instructions: [applied.instructions, applied.skills.index].filter(Boolean).join('\n\n'),
    };
  }
}
