import { createHash, randomUUID } from 'node:crypto';
import { chmod, lstat, mkdir, open, readFile, rename, rm, unlink } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import type { RunnerConfig } from './config';
import { readHermesInventory, type HermesInventory, type HermesProfile } from './inventory';
import { pythonVaultStore, WebLoginVault, type WebLogin, type WorkRef } from './logins';

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
  inventory?: HermesInventory;
}

export interface RuntimePolicyClient {
  runtimePolicy(): Promise<RuntimePolicySnapshot>;
  reportRuntimeStatus(status: RuntimeStatus): Promise<void>;
  mcpSecrets(work?: WorkRef): Promise<Record<string, string>>;
  webLogins(work: WorkRef): Promise<WebLogin[]>;
}

// What a run or a chat answer hands Hermes besides the task. `logins` names the Plan
// credential of each vault handle the runner wrote, for a run or chat answer.
export interface HermesRunSettings {
  toolsets: string[] | null;
  env: Record<string, string>;
  logins?: Map<string, number>;
}

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
const MCP_SERVER_NAME = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const CAPABILITIES = [
  'model',
  'reasoning',
  'managed-markdown',
  'managed-skills',
  'managed-mcp-servers',
];
// A revision that failed to apply is tried again after this long, not on every claim.
const RETRY_FAILED_MS = 60_000;
// Skills and memory change while the agent works. They are read again after this long, and
// after every run and chat answer.
const INVENTORY_INTERVAL_MS = 60_000;

function digest(content: string | Buffer): string {
  return createHash('sha256').update(content).digest('hex');
}

function byteLengthWithin(content: string, limit: number): boolean {
  return Buffer.byteLength(content, 'utf8') <= limit;
}

function assertRoot(path: string, label: string): string {
  if (!isAbsolute(path)) throw new Error(`${label} must be an absolute path`);
  return resolve(path);
}

async function ensureRoot(path: string): Promise<void> {
  await mkdir(path, { recursive: true, mode: 0o700 });
  const info = await lstat(path);
  if (info.isSymbolicLink() || !info.isDirectory()) throw new Error('managed root is unsafe');
}

function assertInside(root: string, target: string): void {
  const rel = relative(root, target);
  if (!rel || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    if (target !== root) throw new Error('managed path escapes its root');
  }
}

async function ensureSafeParent(root: string, target: string): Promise<void> {
  await ensureRoot(root);
  assertInside(root, target);
  const parent = dirname(target);
  const rel = relative(root, parent);
  let current = root;
  if (rel && rel !== '.') {
    for (const segment of rel.split(sep)) {
      current = join(current, segment);
      try {
        const info = await lstat(current);
        if (info.isSymbolicLink() || !info.isDirectory()) {
          throw new Error('managed path contains an unsafe directory');
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        await mkdir(current, { mode: 0o700 });
      }
    }
  }
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

async function atomicWrite(root: string, target: string, content: string): Promise<void> {
  await ensureSafeParent(root, target);
  const temp = join(dirname(target), `.itsaplan-${randomUUID()}.tmp`);
  const handle = await open(temp, 'wx', 0o600);
  try {
    await handle.writeFile(content, 'utf8');
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    await ensureSafeParent(root, target);
    const targetInfo = await lstat(target).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return null;
      throw error;
    });
    if (targetInfo?.isSymbolicLink() || (targetInfo && !targetInfo.isFile())) {
      throw new Error('managed target is unsafe');
    }
    await rename(temp, target);
    await chmod(target, 0o600);
  } catch (error) {
    await rm(temp, { force: true });
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

// The variable a secret reaches Hermes in. Hermes expands ${NAME} in its configuration
// with its own environment.
export function mcpSecretVariable(id: number): string {
  return `ITSAPLAN_MCP_SECRET_${id}`;
}

function hermesValues(values: RuntimeMcpValue[]): Record<string, string> {
  return Object.fromEntries(
    values.map((entry) => [
      entry.name,
      'secret' in entry ? `\${${mcpSecretVariable(entry.secret)}}` : entry.value,
    ]),
  );
}

// The mcp_servers Hermes layers over its config.yaml for this agent: the agent's own
// servers, and the servers of config.yaml the policy turns off. Null when there is neither.
// An own server may not take the name of a toolset or a server of the profile: Hermes names
// a server's toolset after it.
export function hermesMcpServers(
  servers: RuntimeMcpServer[],
  profile: HermesProfile | undefined,
  denied: string[],
): Record<string, unknown> | null {
  const config: Record<string, unknown> = {};
  const taken = [...(profile?.toolsets ?? []), ...(profile?.mcpServers ?? [])];
  for (const server of servers) {
    if (!MCP_SERVER_NAME.test(server.name) || server.name in config) {
      throw new Error('runtime policy contains an invalid MCP server name');
    }
    if (taken.includes(server.name)) {
      throw new Error(`MCP server ${server.name} has the name of a Hermes toolset or server`);
    }
    config[server.name] =
      server.transport === 'stdio'
        ? { command: server.command, args: server.args, env: hermesValues(server.env) }
        : {
            url: server.url,
            ...(server.transport === 'sse' && { transport: 'sse' }),
            headers: hermesValues(server.headers),
          };
  }
  for (const name of profile?.mcpServers ?? []) {
    if (denied.includes(name)) config[name] = { enabled: false };
  }
  return Object.keys(config).length > 0 ? config : null;
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

export class HermesPolicyMaterializer {
  readonly hermesHome: string;
  readonly manifestPath: string;
  // The directory Hermes reads as HERMES_MANAGED_DIR: its config.yaml is merged over the
  // profile's own, which the agents share, and cannot be changed from inside Hermes.
  readonly managedDir: string;
  private readonly profile: HermesProfile | undefined;

  constructor(options: { hermesHome: string; profile?: HermesProfile }) {
    this.hermesHome = assertRoot(options.hermesHome, 'HERMES_HOME');
    this.manifestPath = join(this.hermesHome, 'run', 'itsaplan-policy-manifest.json');
    this.managedDir = join(this.hermesHome, 'run', 'itsaplan-managed');
    this.profile = options.profile;
  }

  // Plan's version always wins. A file found changed outside Plan (an existing SOUL.md on
  // first sync, or one Hermes edited since) is kept next to it and returned as a conflict.
  // `mcpSecrets` lists the secrets the managed configuration names, and is null when there
  // is no managed configuration.
  async apply(snapshot: RuntimePolicySnapshot): Promise<{
    revision: string;
    conflicts: RuntimeConflict[];
    mcpSecrets: number[] | null;
  }> {
    await ensureRoot(this.hermesHome);
    await ensureSafeParent(this.hermesHome, this.manifestPath);
    const previous = await loadManifest(this.manifestPath, this.hermesHome);
    const desired = desiredEntries(snapshot, this.hermesHome);
    const servers = snapshot.mcpServers ?? [];
    const mcpServers = hermesMcpServers(
      servers,
      this.profile,
      snapshot.runtimePolicy.toolDeny ?? [],
    );
    const oldByKey = new Map((previous?.entries ?? []).map((entry) => [entryKey(entry), entry]));
    const desiredByKey = new Map(desired.map((entry) => [entryKey(entry.manifest), entry]));
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const conflicts: RuntimeConflict[] = [];

    for (const entry of desired) {
      const current = await existingHash(entry.target);
      if (current === entry.manifest.sha256) continue;
      const old = oldByKey.get(entryKey(entry.manifest));
      if (current !== null && current !== old?.sha256) {
        const content = await readFile(entry.target, 'utf8');
        await atomicWrite(entry.root, `${entry.target}.outside-${stamp}`, content);
        conflicts.push({
          path: conflictPath(entry.manifest),
          content: content.slice(0, MAX_CONFLICT_BYTES),
        });
      }
      await atomicWrite(entry.root, entry.target, entry.content);
    }
    for (const old of previous?.entries ?? []) {
      if (desiredByKey.has(entryKey(old))) continue;
      const { target } = targetOf(old, this.hermesHome);
      // A file changed outside Plan stays where it is and is no longer managed.
      if ((await existingHash(target)) === old.sha256) await unlink(target);
    }

    const managedConfig = join(this.managedDir, 'config.yaml');
    if (mcpServers) {
      // JSON is YAML, which is how Hermes reads it.
      const content = `${JSON.stringify({ mcp_servers: mcpServers }, null, 2)}\n`;
      if ((await existingHash(managedConfig)) !== digest(content)) {
        await atomicWrite(this.managedDir, managedConfig, content);
      }
    } else {
      await rm(managedConfig, { force: true });
    }

    const manifest: Manifest = {
      schemaVersion: 1,
      revision: snapshot.revision,
      entries: desired.map(({ manifest }) => manifest),
    };
    await atomicWrite(this.hermesHome, this.manifestPath, `${JSON.stringify(manifest)}\n`);
    return {
      revision: snapshot.revision,
      conflicts,
      mcpSecrets: mcpServers ? mcpSecretIds(servers) : null,
    };
  }
}

// The `--toolsets` list for Hermes: the profile's toolsets and MCP servers without the
// denied ones, plus the agent's own servers, which an explicit list has to name to keep.
// Null while nothing the profile enables is denied: Hermes then uses the profile's own
// selection, and the managed configuration adds the agent's servers to it. The list keeps
// a denied server out even while the managed configuration failed to apply. Without the
// profile the runner reports no toolsets, so Plan offers none to turn off.
export function allowedToolsets(
  profile: HermesProfile | undefined,
  denied: string[],
  ownMcpServers: string[] = [],
): string[] | null {
  if (!profile) return null;
  const enabled = [...profile.toolsets, ...profile.mcpServers];
  if (!enabled.some((name) => denied.includes(name))) return null;
  const toolsets = [...enabled, ...ownMcpServers].filter((name) => !denied.includes(name));
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
  if (!profile || profile.toolsets.includes('browser')) return toolsets;
  const enabled = [...profile.toolsets, ...profile.mcpServers, ...ownMcpServers];
  return [...(toolsets ?? enabled.filter((name) => !kept.includes(name))), 'browser'];
}

type ReportedState = Pick<RuntimeStatus, 'status' | 'detail' | 'conflicts'>;

export interface SynchronizerOptions {
  inventory?: () => Promise<HermesInventory>;
  profile?: HermesProfile;
  now?: () => number;
  // The agent's Hermes vault, which receives its website logins.
  vault?: WebLoginVault;
}

export class HermesPolicySynchronizer {
  private appliedRevision: string | null = null;
  private failed: { revision: string; at: number } | null = null;
  private active: Promise<void> | null = null;
  // What the last applied or failed revision reported. A changed inventory is reported
  // with it again, since a report replaces the whole state Plan keeps.
  private state: ReportedState | null = null;
  private deniedToolsets: string[] = [];
  private webLogins = false;
  // The agent's own MCP servers and the secrets they name, as the last applied revision
  // wrote them. mcpSecrets is null while there is no managed configuration.
  private mcpServerNames: string[] = [];
  private mcpSecrets: number[] | null = null;
  private inventory: HermesInventory | undefined;
  private inventoryDigest: string | null = null;
  private inventoryReadAt = -Infinity;
  private readonly now: () => number;

  constructor(
    private readonly client: RuntimePolicyClient,
    private readonly materializer: HermesPolicyMaterializer,
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

  // A run or a chat answer may have changed the skills or the memory, so the next sync
  // reads them again.
  inventoryChanged(): void {
    this.inventoryReadAt = -Infinity;
  }

  toolsets(): string[] | null {
    return allowedToolsets(this.options.profile, this.deniedToolsets, this.mcpServerNames);
  }

  // Read before each run and chat answer, so a secret changed in Plan applies at once.
  // Plan answers with the secrets of the agent's current servers, which also covers a
  // revision the other feed applies before Hermes reads the managed configuration. For a
  // run or chat answer the vault is brought to the logins granted now; a login revoked in
  // Plan is removed from it before Hermes starts.
  async runSettings(work?: WorkRef): Promise<HermesRunSettings> {
    const settings = { toolsets: this.toolsets(), env: await this.mcpEnv(work) };
    if (!work || !this.options.vault) return settings;
    const granted = this.webLogins ? await this.client.webLogins(work) : [];
    const logins = await this.options.vault.sync(granted);
    if (logins.size === 0) return { ...settings, logins };
    const toolsets = toolsetsWithBrowser(
      this.options.profile,
      this.deniedToolsets,
      this.mcpServerNames,
    );
    return { ...settings, toolsets, logins };
  }

  private async mcpEnv(work?: WorkRef): Promise<Record<string, string>> {
    if (this.mcpSecrets === null) return {};
    const env: Record<string, string> = { HERMES_MANAGED_DIR: this.materializer.managedDir };
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
    // The restriction writes no file, so it holds even while a revision fails to apply.
    this.deniedToolsets = snapshot.runtimePolicy?.toolDeny ?? [];
    this.webLogins = snapshot.webLogins === true;
    const applied = await this.apply(snapshot);
    const inventoryChanged = await this.readInventory();
    if ((applied || inventoryChanged) && this.state) await this.report(this.state);
  }

  // True when the revision was applied or failed to apply, either of which is reported.
  private async apply(snapshot: RuntimePolicySnapshot): Promise<boolean> {
    if (snapshot.revision === this.appliedRevision) return false;
    if (
      this.failed?.revision === snapshot.revision &&
      this.now() - this.failed.at < RETRY_FAILED_MS
    ) {
      return false;
    }
    try {
      const result = await this.materializer.apply(snapshot);
      this.appliedRevision = result.revision;
      this.mcpServerNames = (snapshot.mcpServers ?? []).map(({ name }) => name);
      this.mcpSecrets = result.mcpSecrets;
      this.failed = null;
      this.state = {
        status: 'online',
        detail:
          result.conflicts.length > 0
            ? 'Files changed outside Plan were replaced; the changed versions are kept next to them.'
            : null,
        conflicts: result.conflicts,
      };
    } catch (error) {
      this.failed = { revision: snapshot.revision, at: this.now() };
      this.state = {
        status: 'degraded',
        detail: `Runtime policy sync failed: ${describeFailure(error)}`,
        conflicts: [],
      };
    }
    return true;
  }

  // True when the inventory was read and differs from the one reported last.
  private async readInventory(): Promise<boolean> {
    if (!this.options.inventory || this.now() - this.inventoryReadAt < INVENTORY_INTERVAL_MS) {
      return false;
    }
    this.inventoryReadAt = this.now();
    try {
      this.inventory = await this.options.inventory();
    } catch {
      // Plan keeps showing the inventory it received last.
      return false;
    }
    const inventoryDigest = digest(JSON.stringify(this.inventory));
    if (inventoryDigest === this.inventoryDigest) return false;
    this.inventoryDigest = inventoryDigest;
    return true;
  }

  private async report(state: ReportedState): Promise<void> {
    await this.client
      .reportRuntimeStatus({
        adapter: 'hermes',
        ...state,
        appliedRevision: this.appliedRevision,
        capabilities: CAPABILITIES,
        ...(this.inventory && { inventory: this.inventory }),
      })
      .catch(() => {});
  }
}

export function hermesPolicySynchronizer(
  config: RunnerConfig,
  client: RuntimePolicyClient,
): HermesPolicySynchronizer | null {
  if (config.agent !== 'hermes') return null;
  const hermesHome = config.env.HERMES_HOME ?? process.env.HERMES_HOME;
  if (!hermesHome) throw new Error('Hermes policy sync requires HERMES_HOME');
  const materializer = new HermesPolicyMaterializer({ hermesHome, profile: config.hermes });
  const python = config.env.HERMES_PYTHON ?? process.env.HERMES_PYTHON ?? 'python3';
  return new HermesPolicySynchronizer(client, materializer, {
    inventory: () => readHermesInventory(materializer.hermesHome, config.hermes),
    profile: config.hermes,
    vault: new WebLoginVault(
      materializer.hermesHome,
      pythonVaultStore(materializer.hermesHome, python, config.env),
    ),
  });
}
