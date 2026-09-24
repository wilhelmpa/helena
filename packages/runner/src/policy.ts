import { lstat, readFile, readlink, rename, symlink, unlink } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';
import { RequestError } from './client';
import type { RunnerConfig } from './config';
import { collectProfile, deepMerge, mcpSecretVariable, type ProfileContext } from './contributions';
import { atomicWrite, digest, ensureRoot, ensureSafeParent } from './files';
import {
  enabledMcpServers,
  ensureConfigLink,
  hermesDrift,
  hermesManagedMcp,
  hermesSessionFacts,
  leaves,
  probeHermesProfile,
  type HermesProbe,
} from './hermes-profile';
import {
  readHermesInventory,
  type HermesInventory,
  type HermesProfile,
  type InventorySkill,
} from './inventory';
import {
  readLearnedSkills,
  runActions,
  setCuratorPaused,
  type LearnedSkill,
  type RuntimeAction,
  type RuntimeActionResult,
  type RuntimeLearning,
} from './learning';
import { isolationEnabled, profileHelper, type AgentIsolation } from './isolation';
import { pythonVaultStore, WebLoginVault, type WebLogin, type WorkRef } from './logins';
import {
  profileDigest,
  type ProfileReport,
  type RunSettings,
  type RuntimeAdapter,
  type RuntimeDefaults,
  type SessionFacts,
} from './runtime';

export { mcpSecretVariable } from './contributions';

export interface RuntimePolicyFile {
  kind: 'instructions';
  path: string;
  content: string;
}

export interface RuntimeSkillFile {
  path: string;
  content: string;
}

export interface RuntimeSkill {
  id: number;
  slug: string;
  name: string;
  description: string;
  markdown: string;
  files: RuntimeSkillFile[];
}

// The parts of the knowledge vault the agent's file tools may reach, as absolute paths:
// a path is readable below an entry of `read`, writable below one of `write`, and
// neither below one of `deny`. Hermes gets it as VOLITION_VAULT_ACCESS (JSON) for its
// approval plugin to enforce.
export interface VaultAccess {
  root: string;
  read: string[];
  write: string[];
  deny: string[];
}

// A literal, or the id of one of the team's secrets, whose value the runner reads from
// Plan before each run and chat answer.
export type RuntimeMcpValue = { name: string; value: string } | { name: string; secret: number };

export interface RuntimeMcpServer {
  name: string;
  transport: 'stdio' | 'http' | 'sse';
  command: string | null;
  args: string[];
  url: string | null;
  env: RuntimeMcpValue[];
  headers: RuntimeMcpValue[];
}

export interface RuntimePolicySnapshot {
  revision: string;
  runtimePolicy: {
    files: RuntimePolicyFile[];
    // The Hermes toolsets and MCP servers of the Hermes configuration the agent may not use.
    toolDeny?: string[];
  };
  skills: RuntimeSkill[];
  // The MCP servers of the team library enabled on the agent. An older server sends none.
  mcpServers?: RuntimeMcpServer[];
  // Whether website logins are granted to the agent. An older server sends none.
  webLogins?: boolean;
  vaultAccess?: VaultAccess;
  // Whether the agent learns. An older server sends none, and Hermes' own settings apply.
  learning?: RuntimeLearning;
  // The owner's decisions on what the agent learned, not carried out yet.
  actions?: RuntimeAction[];
}

// A managed file that was changed outside Plan. Plan's version replaced it; the changed
// content is kept next to it and reported, so it can be taken over in Plan.
export interface RuntimeConflict {
  path: string;
  content: string;
}

export interface RuntimeStatus {
  adapter: string;
  status: 'online' | 'degraded';
  appliedRevision: string | null;
  capabilities: string[];
  detail: string | null;
  conflicts?: RuntimeConflict[];
  // What the runner put back after it was changed or removed outside Plan: managed files
  // and plugin links, by their path in the Hermes home.
  restored?: string[];
  inventory?: HermesInventory;
  learnedSkills?: LearnedSkill[];
  // The results of the actions of the applied revision.
  actions?: RuntimeActionResult[];
  // What the runtime will load, read back and compared with what Helena wrote.
  profile?: ProfileReport;
}

export interface RuntimePolicyClient {
  runtimePolicy(): Promise<RuntimePolicySnapshot>;
  reportRuntimeStatus(status: RuntimeStatus): Promise<void>;
  mcpSecrets(work?: WorkRef): Promise<Record<string, string>>;
  webLogins(work: WorkRef): Promise<WebLogin[]>;
}

// What a run or a chat answer hands Hermes besides the task. `logins` names the Plan
// credential of each vault handle the runner wrote, for a run or chat answer.
export type HermesRunSettings = RunSettings;

type ManifestEntry =
  | { source: 'runtime'; path: string; sha256: string }
  | { source: 'skill'; slug: string; path: string; sha256: string };

interface Manifest {
  schemaVersion: 1;
  revision: string;
  entries: ManifestEntry[];
}

interface DesiredEntry {
  manifest: ManifestEntry;
  target: string;
  root: string;
  content: string;
}

// Plan sends the agent's identity and instructions as one SOUL.md. Memory belongs to
// Hermes, and the AGENTS.md in the working directory belongs to the project.
const RUNTIME_PATH = /^SOUL\.md$/;
const SKILL_SLUG = /^[a-z0-9][a-z0-9-]{0,63}$/;
const SKILL_PATH =
  /^(?:SKILL\.md|(?:[A-Za-z0-9][A-Za-z0-9._-]*\/){0,7}[A-Za-z0-9][A-Za-z0-9._-]*\.(?:md|markdown))$/i;
const SHA256 = /^[a-f0-9]{64}$/;
const MAX_RUNTIME_BYTES = 128 * 1024;
const MAX_SKILL_BYTES = 1024 * 1024;
const MAX_CONFLICT_BYTES = 64 * 1024;
const PLUGIN_NAME = /^[a-z0-9][a-z0-9-]{0,63}$/;
const MAX_CONFLICTS = 8;
const MAX_RESTORED = 20;
const CAPABILITIES = [
  'model',
  'reasoning',
  'managed-markdown',
  'managed-skills',
  'managed-mcp-servers',
  'learning',
  // Owns every MCP server of the profile, reads back what Hermes loads and reports drift.
  'profile-drift',
  'rewrite-profile',
  'session-facts',
];
// A revision that failed to apply is tried again after this long, not on every claim.
const RETRY_FAILED_MS = 60_000;
// Skills and memory change while the agent works, and so can the files Plan manages. Both
// are checked again after this long, and after every run and chat answer.
const CHECK_INTERVAL_MS = 60_000;

function byteLengthWithin(content: string, limit: number): boolean {
  return Buffer.byteLength(content, 'utf8') <= limit;
}

function assertRoot(path: string, label: string): string {
  if (!isAbsolute(path)) throw new Error(`${label} must be an absolute path`);
  return resolve(path);
}

async function existingHash(target: string): Promise<string | null> {
  try {
    const info = await lstat(target);
    if (info.isSymbolicLink() || !info.isFile()) throw new Error('managed target is unsafe');
    return digest(await readFile(target));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

function runtimeTarget(path: string, hermesHome: string): { root: string; target: string } {
  if (!RUNTIME_PATH.test(path)) throw new Error('runtime policy contains an unsafe path');
  return { root: hermesHome, target: join(hermesHome, path) };
}

function skillTarget(
  slug: string,
  path: string,
  hermesHome: string,
): { root: string; target: string } {
  if (!SKILL_SLUG.test(slug) || !SKILL_PATH.test(path)) {
    throw new Error('runtime policy contains an unsafe skill path');
  }
  const root = join(hermesHome, 'skills', 'plan-managed');
  return { root, target: join(root, slug, path) };
}

function entryKey(entry: ManifestEntry): string {
  return entry.source === 'runtime' ? `runtime:${entry.path}` : `skill:${entry.slug}:${entry.path}`;
}

function targetOf(entry: ManifestEntry, hermesHome: string) {
  return entry.source === 'runtime'
    ? runtimeTarget(entry.path, hermesHome)
    : skillTarget(entry.slug, entry.path, hermesHome);
}

function desiredEntries(snapshot: RuntimePolicySnapshot, hermesHome: string): DesiredEntry[] {
  if (!snapshot.revision || !Array.isArray(snapshot.runtimePolicy?.files)) {
    throw new Error('runtime policy snapshot is invalid');
  }
  const desired: DesiredEntry[] = [];
  for (const file of snapshot.runtimePolicy.files) {
    const mapped = runtimeTarget(file.path, hermesHome);
    if (!byteLengthWithin(file.content, MAX_RUNTIME_BYTES)) {
      throw new Error('runtime policy file is too large');
    }
    if (file.kind !== 'instructions')
      throw new Error('runtime policy file kind does not match its path');
    desired.push({
      ...mapped,
      content: file.content,
      manifest: { source: 'runtime', path: file.path, sha256: digest(file.content) },
    });
  }
  if (!Array.isArray(snapshot.skills)) throw new Error('runtime skill snapshot is invalid');
  for (const skill of snapshot.skills) {
    if (!Number.isInteger(skill.id) || !SKILL_SLUG.test(skill.slug)) {
      throw new Error('runtime skill identity is invalid');
    }
    if (!byteLengthWithin(skill.markdown, MAX_SKILL_BYTES)) {
      throw new Error('runtime skill is too large');
    }
    const files = [{ path: 'SKILL.md', content: skill.markdown }, ...(skill.files ?? [])];
    for (const file of files) {
      if (!byteLengthWithin(file.content, MAX_SKILL_BYTES)) {
        throw new Error('runtime skill reference is too large');
      }
      const mapped = skillTarget(skill.slug, file.path, hermesHome);
      desired.push({
        ...mapped,
        content: file.content,
        manifest: {
          source: 'skill',
          slug: skill.slug,
          path: file.path,
          sha256: digest(file.content),
        },
      });
    }
  }
  const keys = desired.map(({ manifest }) => entryKey(manifest));
  if (new Set(keys).size !== keys.length)
    throw new Error('runtime policy contains duplicate paths');
  return desired;
}

async function loadManifest(path: string, hermesHome: string): Promise<Manifest | null> {
  try {
    const info = await lstat(path);
    if (info.isSymbolicLink() || !info.isFile() || (info.mode & 0o077) !== 0) {
      throw new Error('runtime policy manifest is unsafe');
    }
    const value = JSON.parse(await readFile(path, 'utf8')) as Partial<Manifest>;
    if (
      value.schemaVersion !== 1 ||
      typeof value.revision !== 'string' ||
      !Array.isArray(value.entries)
    ) {
      throw new Error('runtime policy manifest is invalid');
    }
    const entries: ManifestEntry[] = [];
    const keys = new Set<string>();
    for (const entry of value.entries as ManifestEntry[]) {
      if (!entry || !SHA256.test(entry.sha256))
        throw new Error('runtime policy manifest is invalid');
      // A path this runner no longer writes (an AGENTS.md or memory file of an older
      // version) is left alone on disk and dropped from management.
      if (entry.source === 'runtime' && !RUNTIME_PATH.test(entry.path)) continue;
      targetOf(entry, hermesHome);
      const key = entryKey(entry);
      if (keys.has(key)) throw new Error('runtime policy manifest has duplicate paths');
      keys.add(key);
      entries.push(entry);
    }
    return { schemaVersion: 1, revision: value.revision, entries };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

function conflictPath(entry: ManifestEntry): string {
  return entry.source === 'runtime' ? entry.path : `skills/${entry.slug}/${entry.path}`;
}

function homePath(entry: ManifestEntry): string {
  return entry.source === 'runtime'
    ? entry.path
    : `skills/plan-managed/${entry.slug}/${entry.path}`;
}

function mcpSecretIds(servers: RuntimeMcpServer[]): number[] {
  const ids = servers
    .flatMap((server) => [...server.env, ...server.headers])
    .flatMap((entry) => ('secret' in entry ? [entry.secret] : []));
  return [...new Set(ids)];
}

// The message of an error the materializer raises names a rule, never file content; an
// operating-system error is reduced to its code and path.
function describeFailure(error: unknown): string {
  const failure = error as NodeJS.ErrnoException;
  if (failure?.code) return `${failure.code}${failure.path ? ` ${failure.path}` : ''}`;
  return error instanceof Error ? error.message.slice(0, 200) : 'unknown error';
}

// What the materializer needs besides the policy to build the agent's profile: where Helena
// answers (for its own MCP server), the agent's environment from the runner config (the
// project browser), and Hermes' Python for reading the profile back.
export interface MaterializerContext {
  url?: string;
  env?: Record<string, string>;
  python?: string;
  // Reads back what Hermes loads; Hermes' own Python unless replaced (tests).
  reader?: HermesReader;
}

export interface HermesReader {
  probe(home: string, managedDir: string, keys: string[]): Promise<HermesProbe>;
  session(home: string, sessionId: string): Promise<SessionFacts | null>;
}

function pythonReader(python: string, env: Record<string, string>): HermesReader {
  return {
    probe: (home, managedDir, keys) => probeHermesProfile(home, managedDir, python, env, keys),
    session: (home, sessionId) => hermesSessionFacts(home, sessionId, python, env),
  };
}

export interface ApplyOptions {
  // Write every managed file again, even one that is unchanged ("Neu schreiben").
  force?: boolean;
  // Servers the last check found in the shared configuration or in plugins, which the
  // managed configuration turns off like the ones the runner config names.
  sharedMcpServers?: string[];
}

export class HermesPolicyMaterializer implements PolicyMaterializer {
  readonly hermesHome: string;
  readonly manifestPath: string;
  // The directory Hermes reads as HERMES_MANAGED_DIR: its config.yaml is merged over the
  // profile's own, which the agents share, and cannot be changed from inside Hermes.
  readonly managedDir: string;
  private readonly profile: HermesProfile | undefined;
  private readonly context: MaterializerContext;
  private pluginCheck: Promise<string[]> | null = null;

  constructor(options: {
    hermesHome: string;
    profile?: HermesProfile;
    context?: MaterializerContext;
  }) {
    this.hermesHome = assertRoot(options.hermesHome, 'HERMES_HOME');
    this.manifestPath = join(this.hermesHome, 'run', 'itsaplan-policy-manifest.json');
    this.managedDir = join(this.hermesHome, 'run', 'itsaplan-managed');
    this.profile = options.profile;
    this.context = options.context ?? {};
  }

  // Plan's version always wins. A file found changed outside Plan (an existing SOUL.md on
  // first sync, or one Hermes edited since) is kept next to it and returned as a conflict;
  // `restored` names every managed file that was changed or removed since Plan wrote it.
  // Applying the same snapshot again is how that is checked. `mcpSecrets` lists the
  // secrets the managed configuration names, and is null when it names none.
  async apply(
    snapshot: RuntimePolicySnapshot,
    options: ApplyOptions = {},
  ): Promise<MaterializeResult> {
    await ensureRoot(this.hermesHome);
    await ensureSafeParent(this.hermesHome, this.manifestPath);
    const previous = await loadManifest(this.manifestPath, this.hermesHome);
    const desired = desiredEntries(snapshot, this.hermesHome);
    const managed = managedConfigOf(snapshot, this.profileContext(snapshot), options);
    const oldByKey = new Map((previous?.entries ?? []).map((entry) => [entryKey(entry), entry]));
    const desiredByKey = new Map(desired.map((entry) => [entryKey(entry.manifest), entry]));
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const conflicts: RuntimeConflict[] = [];
    const restored: string[] = [];

    for (const entry of desired) {
      const current = await existingHash(entry.target);
      if (current === entry.manifest.sha256 && !options.force) continue;
      const old = oldByKey.get(entryKey(entry.manifest));
      if (current !== null && current !== entry.manifest.sha256 && current !== old?.sha256) {
        const content = await readFile(entry.target, 'utf8');
        await atomicWrite(entry.root, `${entry.target}.outside-${stamp}`, content);
        conflicts.push({
          path: conflictPath(entry.manifest),
          content: content.slice(0, MAX_CONFLICT_BYTES),
        });
      }
      if (old && current !== old.sha256) restored.push(homePath(entry.manifest));
      await atomicWrite(entry.root, entry.target, entry.content);
    }
    for (const old of previous?.entries ?? []) {
      if (desiredByKey.has(entryKey(old))) continue;
      const { target } = targetOf(old, this.hermesHome);
      // A file changed outside Plan stays where it is and is no longer managed.
      if ((await existingHash(target)) === old.sha256) await unlink(target);
    }

    // JSON is YAML, which is how Hermes reads it.
    const managedChanged = await this.writeIfChanged(
      this.managedDir,
      join(this.managedDir, 'config.yaml'),
      `${JSON.stringify(managed.config, null, 2)}\n`,
      options.force,
    );
    if (snapshot.learning) await setCuratorPaused(this.hermesHome, !snapshot.learning.curator);

    const manifest: Manifest = {
      schemaVersion: 1,
      revision: snapshot.revision,
      entries: desired.map(({ manifest }) => manifest),
    };
    await this.writeIfChanged(this.hermesHome, this.manifestPath, `${JSON.stringify(manifest)}\n`);
    return {
      revision: snapshot.revision,
      conflicts,
      restored,
      mcpSecrets: managed.mcpSecrets,
      managedConfig: managed.config,
      mcpToolsets: managed.mcpToolsets,
      runtimeServers: managed.runtimeServers,
      managedChanged,
    };
  }

  private profileContext(snapshot: RuntimePolicySnapshot): ProfileContext {
    return {
      runtime: 'hermes',
      snapshot,
      url: this.context.url,
      env: this.context.env ?? {},
      hermes: this.profile,
    };
  }

  // The links Plan requires in the home: the shared config.yaml, where the runner config
  // names one, and the plugins, such as the approval guard, which link from plugins/ to
  // Plan's checkout. One the agent removed or replaced is put back, and whatever took its
  // place is moved to run/. Returns the entries it restored. Runs and chat answers that
  // start together share one check.
  ensurePlugins(): Promise<string[]> {
    this.pluginCheck ??= this.checkPlugins().finally(() => {
      this.pluginCheck = null;
    });
    return this.pluginCheck;
  }

  private async checkPlugins(): Promise<string[]> {
    const restored: string[] = [];
    const shared = this.profile?.sharedConfig;
    if (shared && (await ensureConfigLink(this.hermesHome, shared))) restored.push('config.yaml');
    const plugins = join(this.hermesHome, 'plugins');
    for (const [name, source] of Object.entries(this.profile?.plugins ?? {})) {
      if (!PLUGIN_NAME.test(name) || !isAbsolute(source)) {
        throw new Error('the runner config names an invalid Hermes plugin');
      }
      await ensureRoot(plugins);
      const target = join(plugins, name);
      const info = await lstat(target).catch((error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') return null;
        throw error;
      });
      if (info?.isSymbolicLink() && (await readlink(target)) === source) continue;
      if (info) {
        const aside = join(this.hermesHome, 'run', `plugin-${name}.outside-${Date.now()}`);
        await ensureSafeParent(this.hermesHome, aside);
        await rename(target, aside);
      }
      await symlink(source, target);
      restored.push(`plugins/${name}`);
    }
    return restored;
  }

  async runActions(actions: RuntimeAction[]): Promise<RuntimeActionResult[]> {
    return runActions(this.hermesHome, await this.planSkills(), actions);
  }

  private reader(): HermesReader {
    return (
      this.context.reader ?? pythonReader(this.context.python ?? 'python3', this.context.env ?? {})
    );
  }

  // What Hermes will load for this home, read back in Hermes' own Python.
  probe(keys: string[]): Promise<HermesProbe> {
    return this.reader().probe(this.hermesHome, this.managedDir, keys);
  }

  sessionFacts(sessionId: string): Promise<SessionFacts | null> {
    return this.reader().session(this.hermesHome, sessionId);
  }

  // The skill directories below skills/plan-managed that the manifest says Plan wrote.
  async planSkills(): Promise<Set<string>> {
    const manifest = await loadManifest(this.manifestPath, this.hermesHome);
    return new Set(
      (manifest?.entries ?? []).flatMap((entry) => (entry.source === 'skill' ? [entry.slug] : [])),
    );
  }

  // True when the file had to be written.
  private async writeIfChanged(
    root: string,
    target: string,
    content: string,
    force = false,
  ): Promise<boolean> {
    if (!force && (await existingHash(target)) === digest(content)) return false;
    await atomicWrite(root, target, content);
    return true;
  }
}

// The managed configuration of a snapshot: every contribution's settings, and the MCP
// servers Helena gives the agent with every other server Hermes would find turned off.
export function managedConfigOf(
  snapshot: RuntimePolicySnapshot,
  context: ProfileContext,
  options: Pick<ApplyOptions, 'sharedMcpServers'> = {},
): {
  config: Record<string, unknown>;
  mcpSecrets: number[] | null;
  mcpToolsets: string[];
  runtimeServers: string[];
} {
  const collected = collectProfile(context);
  const shared = [
    ...new Set([...(context.hermes?.mcpServers ?? []), ...(options.sharedMcpServers ?? [])]),
  ];
  const mcp = hermesManagedMcp(collected, shared, snapshot.runtimePolicy.toolDeny ?? []);
  const config = mcp
    ? deepMerge(collected.hermesConfig, { mcp_servers: mcp })
    : collected.hermesConfig;
  const secrets = mcpSecretIds(snapshot.mcpServers ?? []);
  return {
    config,
    // Null while the managed configuration names no secret, so no run asks Plan for any.
    mcpSecrets: mcp && secrets.length > 0 ? secrets : null,
    mcpToolsets: enabledMcpServers(mcp),
    runtimeServers: collected.runtimeServers,
  };
}

// Hermes' own scheduler. Plan schedules work through its routines, so a job Hermes ran
// on its own would run the work a second time.
const WITHHELD_TOOLSETS = ['cronjob'];

// The `--toolsets` list for Hermes: the profile's toolsets and MCP servers without the
// withheld and the denied ones, plus the agent's own servers, which an explicit list has
// to name to keep. The list is always explicit, so a withheld toolset stays off even
// where the profile enables it. Without the profile the runner reports no toolsets, so
// Plan offers none to turn off.
export function allowedToolsets(
  profile: HermesProfile | undefined,
  denied: string[],
  ownMcpServers: string[] = [],
): string[] | null {
  if (!profile) return null;
  const enabled = [
    ...profile.toolsets.filter((name) => !WITHHELD_TOOLSETS.includes(name)),
    ...profile.mcpServers,
    ...ownMcpServers,
  ];
  const toolsets = enabled.filter((name) => !denied.includes(name));
  // Hermes reads an empty list as no selection and enables every toolset.
  if (toolsets.length === 0) {
    throw new Error('Every Hermes toolset and MCP server of the agent is turned off');
  }
  return toolsets;
}

// The browser toolset carries Hermes' vault tools, so an agent with website logins keeps
// it whatever else is turned off for it.
export function toolsetsWithBrowser(
  profile: HermesProfile | undefined,
  denied: string[],
  ownMcpServers: string[] = [],
): string[] | null {
  const kept = denied.filter((name) => name !== 'browser');
  const toolsets = allowedToolsets(profile, kept, ownMcpServers);
  return toolsets && !toolsets.includes('browser') ? [...toolsets, 'browser'] : toolsets;
}

type ReportedState = Pick<
  RuntimeStatus,
  'status' | 'detail' | 'conflicts' | 'restored' | 'actions'
>;

export interface MaterializeResult {
  revision: string;
  conflicts: RuntimeConflict[];
  restored: string[];
  mcpSecrets: number[] | null;
  // The managed configuration as written, which the check compares Hermes' view with.
  managedConfig: Record<string, unknown>;
  // Helena's MCP servers that are on, which the toolsets of a run name.
  mcpToolsets: string[];
  // The servers the runner itself gives the agent (not the team library's).
  runtimeServers: string[];
  // Whether the managed configuration had to be written.
  managedChanged: boolean;
}

// What writes the policy into the agent's profile: the runner itself, or, for an isolated
// agent, the runner's profile helper run as the project's user (see IsolatedProfile).
export interface PolicyMaterializer {
  readonly managedDir: string;
  apply(snapshot: RuntimePolicySnapshot, options?: ApplyOptions): Promise<MaterializeResult>;
  ensurePlugins(): Promise<string[]>;
  // The actions a revision carries (learning), run once after it applied.
  runActions(actions: RuntimeAction[]): Promise<RuntimeActionResult[]>;
  // What Hermes will load, read back; the settings named by `keys` with their values.
  probe(keys: string[]): Promise<HermesProbe>;
  // The model and reasoning a session ran with.
  sessionFacts(sessionId: string): Promise<SessionFacts | null>;
}

export interface LoginVault {
  sync(logins: WebLogin[]): Promise<Map<string, number>>;
}

export interface SynchronizerOptions {
  inventory?: () => Promise<HermesInventory>;
  // The content of the skills the agent created, of those the inventory lists.
  learned?: (skills: InventorySkill[]) => Promise<LearnedSkill[]>;
  profile?: HermesProfile;
  now?: () => number;
  // The agent's Hermes vault, which receives its website logins.
  vault?: LoginVault;
}

// An isolated agent's profile belongs to the project's user, and the runner never opens a
// file in it: a folder the agent replaced with a link would otherwise lead the runner's
// writes and reads into another project. The same code runs instead in a helper unit as the
// project's user (cli.ts `profile-helper`), where such a link leads nowhere it may go.
export class IsolatedProfile implements PolicyMaterializer {
  readonly managedDir: string;
  private learned: LearnedSkill[] | undefined;

  constructor(
    private readonly isolation: AgentIsolation,
    private readonly cwd: string,
    hermesHome: string,
    private readonly profile: HermesProfile | undefined,
    private readonly helper: typeof profileHelper = profileHelper,
    // Only Helena's address: the helper runs with the environment the launcher gives it.
    private readonly context: Pick<MaterializerContext, 'url'> = {},
  ) {
    this.managedDir = join(assertRoot(hermesHome, 'HERMES_HOME'), 'run', 'itsaplan-managed');
  }

  private run<T>(operation: Record<string, unknown>): Promise<T> {
    return this.helper<T>(this.isolation, this.cwd, {
      ...operation,
      profile: this.profile ?? null,
      context: this.context,
    });
  }

  apply(snapshot: RuntimePolicySnapshot, options: ApplyOptions = {}): Promise<MaterializeResult> {
    return this.run({ op: 'materialize', snapshot, options });
  }

  probe(keys: string[]): Promise<HermesProbe> {
    return this.run({ op: 'probe', keys });
  }

  sessionFacts(sessionId: string): Promise<SessionFacts | null> {
    return this.run({ op: 'session', sessionId });
  }

  ensurePlugins(): Promise<string[]> {
    return this.run({ op: 'plugins' });
  }

  runActions(actions: RuntimeAction[]): Promise<RuntimeActionResult[]> {
    return actions.length === 0 ? Promise.resolve([]) : this.run({ op: 'actions', actions });
  }

  // One helper run reads the inventory and the content of the skills the agent made.
  async inventory(): Promise<HermesInventory> {
    const read = await this.run<{ inventory: HermesInventory; learned: LearnedSkill[] }>({
      op: 'inventory',
    });
    this.learned = read.learned;
    return read.inventory;
  }

  learnedSkills(): Promise<LearnedSkill[]> {
    return Promise.resolve(this.learned ?? []);
  }

  vault(): LoginVault {
    return {
      sync: async (logins) =>
        new Map(await this.run<[string, number][]>({ op: 'vault-sync', logins })),
    };
  }
}

// Each path once, the most recent last.
function latest(paths: string[]): string[] {
  return [...new Set(paths.reverse())].reverse().slice(-MAX_RESTORED);
}

const RESTORED_DETAIL =
  'Files or plugin links changed outside Plan were restored; a changed file is kept next to it.';

// How often the runner reads back what Hermes loads when nothing it knows of changed: the
// shared configuration can change under it. A new revision, a run or chat answer, a restored
// file and "Neu schreiben" check at once.
const PROBE_INTERVAL_MS = 5 * 60_000;

const PROFILE_DRIFT_DETAIL = "The agent's profile differs from Helena's settings.";

// Hermes behind the runtime adapter interface (runtime.ts): brings the agent's Hermes home to
// the policy Helena keeps for it, checks it again every minute, reads back what Hermes will
// load, and reports the result with the agent's status.
export class HermesPolicySynchronizer implements RuntimeAdapter {
  readonly runtime = 'hermes' as const;
  private appliedRevision: string | null = null;
  // The snapshot of the applied revision, which each check applies again.
  private applied: RuntimePolicySnapshot | null = null;
  private failed: { revision: string; at: number } | null = null;
  private checkFailed = false;
  private active: Promise<void> | null = null;
  // What the last applied or failed revision reported, with what was restored since. A
  // changed inventory is reported with it again, since a report replaces the whole state
  // Plan keeps.
  private state: ReportedState | null = null;
  // Restored before any revision applied, reported with the first one.
  private pendingRestored: string[] = [];
  // A report that did not reach Plan is sent again with the next sync.
  private unreported = false;
  private deniedToolsets: string[] = [];
  private learning: RuntimeLearning | undefined;
  private webLogins = false;
  // Helena's MCP servers that are on and the secrets they name, as the last applied
  // revision wrote them. mcpSecrets is null while the managed configuration names no secret.
  private mcpToolsets: string[] = [];
  private runtimeServers: string[] = [];
  private mcpSecrets: number[] | null = null;
  private managedConfig: Record<string, unknown> | null = null;
  private vaultAccess: VaultAccess | null = null;
  private inventory: HermesInventory | undefined;
  private learnedSkills: LearnedSkill[] | undefined;
  private inventoryDigest: string | null = null;
  private checkedAt = -Infinity;
  // The last read-back of the profile, and when the next one is due.
  private probe: HermesProbe | null = null;
  private probeDue = true;
  private probedAt = -Infinity;
  private profile: ProfileReport | null = null;
  private profileDigest: string | null = null;
  private readonly now: () => number;

  constructor(
    private readonly client: RuntimePolicyClient,
    private readonly materializer: PolicyMaterializer,
    private readonly options: SynchronizerOptions = {},
  ) {
    this.now = options.now ?? Date.now;
  }

  // Never throws: the agent keeps working with the policy it applied last, and Plan
  // shows why a newer one did not apply.
  async ensure(): Promise<void> {
    if (this.active) return this.active;
    this.active = this.sync().finally(() => {
      this.active = null;
    });
    return this.active;
  }

  // A run or a chat answer may have changed the skills, the memory or a managed file, so
  // the next sync checks them again.
  inventoryChanged(): void {
    this.checkedAt = -Infinity;
    this.probeDue = true;
  }

  toolsets(): string[] | null {
    return allowedToolsets(this.profileWithoutServers(), this.denied(), this.mcpToolsets);
  }

  // The servers of the shared configuration are Helena's to turn on, not the profile's:
  // the toolsets name Helena's servers that are on, and nothing else.
  private profileWithoutServers(): HermesProfile | undefined {
    return this.options.profile && { ...this.options.profile, mcpServers: [] };
  }

  // An agent that does not learn has no memory tool.
  private denied(): string[] {
    return this.learning?.enabled === false
      ? [...this.deniedToolsets, 'memory']
      : this.deniedToolsets;
  }

  defaults(): RuntimeDefaults | null {
    return this.probe?.defaults ?? null;
  }

  // Best effort: a session the store no longer has, or a store that cannot be read, is
  // reported as unknown rather than failing the run.
  async sessionFacts(sessionId: string | undefined): Promise<SessionFacts | null> {
    if (!sessionId) return null;
    try {
      return await this.materializer.sessionFacts(sessionId);
    } catch {
      return null;
    }
  }

  // Read before each run and chat answer, so a secret changed in Plan applies at once.
  // Plan answers with the secrets of the agent's current servers, which also covers a
  // revision the other feed applies before Hermes reads the managed configuration. For a
  // run or chat answer the vault is brought to the logins granted now; a login revoked in
  // Plan is removed from it before Hermes starts. A required plugin that cannot be put
  // back throws, which fails the run instead of running it without the plugin.
  async runSettings(work?: WorkRef): Promise<RunSettings> {
    const restored = await this.materializer.ensurePlugins();
    if (restored.length > 0) this.noteRestored(restored, []);
    const settings = {
      toolsets: this.toolsets(),
      env: { ...this.vaultAccessEnv(), ...(await this.mcpEnv(work)) },
    };
    if (!work || !this.options.vault) return settings;
    const granted = this.webLogins ? await this.client.webLogins(work) : [];
    const logins = await this.options.vault.sync(granted);
    if (logins.size === 0) return { ...settings, logins };
    const toolsets = toolsetsWithBrowser(
      this.profileWithoutServers(),
      this.denied(),
      this.mcpToolsets,
    );
    return { ...settings, toolsets, logins };
  }

  // The knowledge vault paths the agent's file tools may reach, for the approval plugin.
  private vaultAccessEnv(): Record<string, string> {
    return this.vaultAccess ? { VOLITION_VAULT_ACCESS: JSON.stringify(this.vaultAccess) } : {};
  }

  // Hermes reads the managed configuration from HERMES_MANAGED_DIR, and the values of the
  // secrets its MCP servers name from the environment.
  private async mcpEnv(work?: WorkRef): Promise<Record<string, string>> {
    const env: Record<string, string> = { HERMES_MANAGED_DIR: this.materializer.managedDir };
    if (this.mcpSecrets === null) return env;
    const values = await this.client.mcpSecrets(work);
    for (const [id, value] of Object.entries(values)) {
      if (/^\d+$/.test(id)) env[mcpSecretVariable(Number(id))] = value;
    }
    // A secret deleted in Plan reaches its server empty.
    for (const id of this.mcpSecrets) env[mcpSecretVariable(id)] ??= '';
    return env;
  }

  private async sync(): Promise<void> {
    let snapshot: RuntimePolicySnapshot;
    try {
      snapshot = await this.client.runtimePolicy();
    } catch {
      // The claim that follows reports a server that cannot be reached.
      return;
    }
    // The restrictions write no file, so they hold even while a revision fails to apply.
    this.deniedToolsets = snapshot.runtimePolicy?.toolDeny ?? [];
    this.learning = snapshot.learning;
    this.webLogins = snapshot.webLogins === true;
    this.vaultAccess = snapshot.vaultAccess ?? null;
    const applied = await this.apply(snapshot);
    let changed = applied;
    if (applied || this.now() - this.checkedAt >= CHECK_INTERVAL_MS) {
      this.checkedAt = this.now();
      if (!applied) changed = (await this.verify()) || changed;
      changed = (await this.readInventory()) || changed;
    }
    changed = (await this.checkProfile()) || changed;
    if ((changed || this.unreported) && this.state) await this.report(this.state);
  }

  private applyOptions(force = false): ApplyOptions {
    return { force, sharedMcpServers: this.probe?.sharedMcpServers ?? [] };
  }

  // Takes what a materialization wrote as the agent's current MCP servers and settings.
  private take(result: MaterializeResult): void {
    this.mcpToolsets = result.mcpToolsets;
    this.runtimeServers = result.runtimeServers;
    this.mcpSecrets = result.mcpSecrets;
    this.managedConfig = result.managedConfig;
    if (result.managedChanged || result.restored.length > 0) this.probeDue = true;
  }

  // True when the revision was applied or failed to apply, either of which is reported.
  // The actions it carries run once, after it applied; "Neu schreiben" (rewrite-profile)
  // is the apply itself, with every file written again and the profile read back at once.
  private async apply(snapshot: RuntimePolicySnapshot): Promise<boolean> {
    if (snapshot.revision === this.appliedRevision) return false;
    if (
      this.failed?.revision === snapshot.revision &&
      this.now() - this.failed.at < RETRY_FAILED_MS
    ) {
      return false;
    }
    try {
      const actions = snapshot.actions ?? [];
      const rewrites = actions.filter((action) => action.kind === 'rewrite-profile');
      const result = await this.materializer.apply(
        snapshot,
        this.applyOptions(rewrites.length > 0),
      );
      const results = [
        ...rewrites.map((action) => ({ id: action.id, error: null })),
        ...(await this.materializer.runActions(
          actions.filter((action) => action.kind !== 'rewrite-profile'),
        )),
      ];
      // The links (shared configuration, plugins) belong to the profile as much as its files.
      const links = await this.materializer.ensurePlugins();
      this.appliedRevision = result.revision;
      this.applied = snapshot;
      this.take(result);
      this.probeDue = true;
      this.failed = null;
      this.checkFailed = false;
      const restored = latest([...this.pendingRestored, ...result.restored, ...links]);
      this.pendingRestored = [];
      this.state = {
        status: 'online',
        detail: result.conflicts.length > 0 || restored.length > 0 ? RESTORED_DETAIL : null,
        conflicts: result.conflicts,
        restored,
        actions: results,
      };
    } catch (error) {
      this.failed = { revision: snapshot.revision, at: this.now() };
      this.state = {
        status: 'degraded',
        detail: `Runtime policy sync failed: ${describeFailure(error)}`,
        conflicts: [],
        restored: this.state?.restored ?? [],
        actions: [],
      };
    }
    return true;
  }

  // Applies the applied revision again, which puts back a managed file or a plugin link
  // that was changed or removed since. True when that changed what Plan is told.
  private async verify(): Promise<boolean> {
    if (!this.applied || this.failed) return false;
    try {
      const result = await this.materializer.apply(this.applied, this.applyOptions());
      this.take(result);
      const restored = [...result.restored, ...(await this.materializer.ensurePlugins())];
      const recovered = this.checkFailed;
      this.checkFailed = false;
      if (restored.length > 0) {
        this.probeDue = true;
        this.noteRestored(restored, result.conflicts);
      } else if (recovered && this.state)
        this.state = { ...this.state, status: 'online', detail: null };
      return restored.length > 0 || recovered;
    } catch (error) {
      this.checkFailed = true;
      if (this.state) {
        this.state = {
          ...this.state,
          status: 'degraded',
          detail: `Runtime policy check failed: ${describeFailure(error)}`,
        };
      }
      return true;
    }
  }

  // Reads back what Hermes will load and compares it with what the runner wrote. A server
  // the shared configuration gained since is turned off at once. True when the report
  // changed.
  private async checkProfile(): Promise<boolean> {
    if (!this.applied || !this.managedConfig) return false;
    if (!this.probeDue && this.now() - this.probedAt < PROBE_INTERVAL_MS) return false;
    this.probeDue = false;
    this.probedAt = this.now();
    const { mcp_servers: _servers, ...settings } = this.managedConfig;
    const keys = leaves(settings).map(([path]) => path);
    let report: ProfileReport;
    try {
      let probe = await this.materializer.probe(keys);
      const known = new Set(this.probe?.sharedMcpServers ?? []);
      this.probe = probe;
      if (probe.sharedMcpServers.some((name) => !known.has(name)) && !this.failed) {
        this.take(await this.materializer.apply(this.applied, this.applyOptions()));
        probe = await this.materializer.probe(keys);
        this.probe = probe;
      }
      const { drift, mcpServers } = hermesDrift(
        { managedConfig: this.managedConfig, sharedConfig: this.options.profile?.sharedConfig },
        probe,
      );
      report = {
        hash: profileDigest({
          revision: this.appliedRevision,
          managed: this.managedConfig,
          link: probe.configLink,
          servers: probe.mcpServers,
          values: probe.values,
          approvals: probe.approvals,
        }),
        checkedAt: new Date(this.now()).toISOString(),
        drift,
        defaults: probe.defaults,
        mcpServers,
      };
    } catch (error) {
      report = {
        hash: this.profile?.hash ?? '',
        checkedAt: new Date(this.now()).toISOString(),
        drift: [{ key: 'profile', code: 'probe-failed', detail: describeFailure(error) }],
        defaults: this.probe?.defaults ?? null,
        mcpServers: this.profile?.mcpServers ?? [],
      };
    }
    this.profile = report;
    if (this.state && this.state.status === 'online') {
      const drifted = report.drift.length > 0;
      if (drifted && this.state.detail === null) {
        this.state = { ...this.state, detail: PROFILE_DRIFT_DETAIL };
      } else if (!drifted && this.state.detail === PROFILE_DRIFT_DETAIL) {
        this.state = { ...this.state, detail: null };
      }
    }
    // The time of the check alone is no reason to report again.
    const digestOfReport = digest(JSON.stringify({ ...report, checkedAt: null }));
    if (digestOfReport === this.profileDigest) return false;
    this.profileDigest = digestOfReport;
    return true;
  }

  private noteRestored(restored: string[], conflicts: RuntimeConflict[]): void {
    if (!this.state) {
      this.pendingRestored = latest([...this.pendingRestored, ...restored]);
      return;
    }
    // A revision that failed to apply, or a check that failed, still says so.
    const degraded = this.state.status === 'degraded';
    this.state = {
      ...this.state,
      detail: degraded ? this.state.detail : RESTORED_DETAIL,
      conflicts: [...(this.state.conflicts ?? []), ...conflicts].slice(-MAX_CONFLICTS),
      restored: latest([...(this.state.restored ?? []), ...restored]),
    };
    this.unreported = true;
  }

  // True when the inventory was read and differs from the one reported last.
  private async readInventory(): Promise<boolean> {
    if (!this.options.inventory) return false;
    try {
      this.inventory = await this.options.inventory();
      this.learnedSkills = await this.options.learned?.(this.inventory.skills);
    } catch {
      // Plan keeps showing the inventory it received last.
      return false;
    }
    const inventoryDigest = digest(JSON.stringify([this.inventory, this.learnedSkills ?? null]));
    if (inventoryDigest === this.inventoryDigest) return false;
    this.inventoryDigest = inventoryDigest;
    return true;
  }

  // The MCP servers the owner turns off per agent are the runner's own (Helena's server,
  // the project browser); the team library's are shown with the library.
  private reportedInventory(): HermesInventory | undefined {
    if (!this.inventory) return undefined;
    return this.applied ? { ...this.inventory, mcpServers: this.runtimeServers } : this.inventory;
  }

  private async report(state: ReportedState): Promise<void> {
    const inventory = this.reportedInventory();
    try {
      await this.client.reportRuntimeStatus({
        adapter: 'hermes',
        ...state,
        appliedRevision: this.appliedRevision,
        capabilities: CAPABILITIES,
        ...(inventory && { inventory }),
        ...(this.learnedSkills && { learnedSkills: this.learnedSkills }),
        ...(this.profile && { profile: this.profile }),
      });
      this.unreported = false;
    } catch (error) {
      // Plan refuses the same report again, so only one that did not arrive is sent again.
      this.unreported = !(error instanceof RequestError && error.status < 500);
    }
  }
}

// Hermes' Python: the one of its venv, which the wrapper puts first on PATH.
function hermesPython(config: RunnerConfig): string {
  return config.env.HERMES_PYTHON ?? process.env.HERMES_PYTHON ?? 'python3';
}

export function hermesPolicySynchronizer(
  config: RunnerConfig,
  client: RuntimePolicyClient,
): HermesPolicySynchronizer | null {
  if (config.agent !== 'hermes') return null;
  const hermesHome = config.env.HERMES_HOME ?? process.env.HERMES_HOME;
  if (!hermesHome) throw new Error('Hermes policy sync requires HERMES_HOME');
  if (isolationEnabled()) {
    if (!config.isolation || !config.cwd) {
      throw new Error('Agent isolation is on and this agent has no isolated project');
    }
    const profile = new IsolatedProfile(
      config.isolation,
      config.cwd,
      hermesHome,
      config.hermes,
      profileHelper,
      { url: config.url },
    );
    return new HermesPolicySynchronizer(client, profile, {
      inventory: () => profile.inventory(),
      learned: () => profile.learnedSkills(),
      profile: config.hermes,
      vault: profile.vault(),
    });
  }
  const python = hermesPython(config);
  const materializer = new HermesPolicyMaterializer({
    hermesHome,
    profile: config.hermes,
    context: { url: config.url, env: config.env, python },
  });
  return new HermesPolicySynchronizer(client, materializer, {
    inventory: async () =>
      readHermesInventory(materializer.hermesHome, config.hermes, await materializer.planSkills()),
    learned: (skills) => readLearnedSkills(materializer.hermesHome, skills),
    profile: config.hermes,
    vault: new WebLoginVault(
      materializer.hermesHome,
      pythonVaultStore(materializer.hermesHome, python, config.env),
    ),
  });
}
