import { createHash, randomUUID } from 'node:crypto';
import { chmod, lstat, mkdir, open, readFile, rename, rm, unlink } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import type { RunnerConfig } from './config';

export interface RuntimePolicyFile {
  kind: 'instructions' | 'memory';
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

export interface RuntimePolicySnapshot {
  revision: string;
  runtimePolicy: {
    files: RuntimePolicyFile[];
  };
  skills: RuntimeSkill[];
}

export interface RuntimeStatus {
  adapter: string;
  status: 'online' | 'degraded';
  appliedRevision: string | null;
  capabilities: string[];
  detail: string | null;
}

export interface RuntimePolicyClient {
  runtimePolicy(): Promise<RuntimePolicySnapshot>;
  reportRuntimeStatus(status: RuntimeStatus): Promise<void>;
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

const RUNTIME_PATH =
  /^(?:AGENTS\.md|SOUL\.md|MEMORY\.md|(?:instructions|memory)\/(?:[A-Za-z0-9][A-Za-z0-9._-]*\/){0,6}[A-Za-z0-9][A-Za-z0-9._-]*\.md)$/;
const SKILL_SLUG = /^[a-z0-9][a-z0-9-]{0,63}$/;
const SKILL_PATH =
  /^(?:SKILL\.md|(?:[A-Za-z0-9][A-Za-z0-9._-]*\/){0,7}[A-Za-z0-9][A-Za-z0-9._-]*\.(?:md|markdown))$/i;
const SHA256 = /^[a-f0-9]{64}$/;
const MAX_RUNTIME_BYTES = 128 * 1024;
const MAX_SKILL_BYTES = 1024 * 1024;
const CAPABILITIES = ['model', 'reasoning', 'managed-markdown', 'managed-skills'];

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

function runtimeTarget(
  path: string,
  cwd: string,
  hermesHome: string,
): { root: string; target: string } {
  if (!RUNTIME_PATH.test(path)) throw new Error('runtime policy contains an unsafe path');
  if (path === 'AGENTS.md' || path.startsWith('instructions/')) {
    return { root: cwd, target: join(cwd, path) };
  }
  if (path === 'SOUL.md') return { root: hermesHome, target: join(hermesHome, path) };
  const memoryPath = path === 'MEMORY.md' ? 'MEMORY.md' : path.slice('memory/'.length);
  const root = join(hermesHome, 'memories');
  return { root, target: join(root, memoryPath) };
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

function targetOf(entry: ManifestEntry, cwd: string, hermesHome: string) {
  return entry.source === 'runtime'
    ? runtimeTarget(entry.path, cwd, hermesHome)
    : skillTarget(entry.slug, entry.path, hermesHome);
}

function desiredEntries(
  snapshot: RuntimePolicySnapshot,
  cwd: string,
  hermesHome: string,
): DesiredEntry[] {
  if (!snapshot.revision || !Array.isArray(snapshot.runtimePolicy?.files)) {
    throw new Error('runtime policy snapshot is invalid');
  }
  const desired: DesiredEntry[] = [];
  for (const file of snapshot.runtimePolicy.files) {
    const mapped = runtimeTarget(file.path, cwd, hermesHome);
    if (!byteLengthWithin(file.content, MAX_RUNTIME_BYTES)) {
      throw new Error('runtime policy file is too large');
    }
    const expectedKind =
      file.path === 'MEMORY.md' || file.path.startsWith('memory/') ? 'memory' : 'instructions';
    if (file.kind !== expectedKind)
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

async function loadManifest(
  path: string,
  cwd: string,
  hermesHome: string,
): Promise<Manifest | null> {
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
    const entries = value.entries as ManifestEntry[];
    const keys = new Set<string>();
    for (const entry of entries) {
      if (!entry || !SHA256.test(entry.sha256))
        throw new Error('runtime policy manifest is invalid');
      targetOf(entry, cwd, hermesHome);
      const key = entryKey(entry);
      if (keys.has(key)) throw new Error('runtime policy manifest has duplicate paths');
      keys.add(key);
    }
    return { schemaVersion: 1, revision: value.revision, entries };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

export class HermesPolicyMaterializer {
  readonly cwd: string;
  readonly hermesHome: string;
  readonly manifestPath: string;

  constructor(options: { cwd: string; hermesHome: string }) {
    this.cwd = assertRoot(options.cwd, 'Hermes cwd');
    this.hermesHome = assertRoot(options.hermesHome, 'HERMES_HOME');
    this.manifestPath = join(this.hermesHome, 'run', 'itsaplan-policy-manifest.json');
  }

  async apply(snapshot: RuntimePolicySnapshot): Promise<string> {
    await ensureRoot(this.cwd);
    await ensureRoot(this.hermesHome);
    await ensureSafeParent(this.hermesHome, this.manifestPath);
    const previous = await loadManifest(this.manifestPath, this.cwd, this.hermesHome);
    const desired = desiredEntries(snapshot, this.cwd, this.hermesHome);
    const oldByKey = new Map((previous?.entries ?? []).map((entry) => [entryKey(entry), entry]));
    const desiredByKey = new Map(desired.map((entry) => [entryKey(entry.manifest), entry]));

    for (const entry of desired) {
      const old = oldByKey.get(entryKey(entry.manifest));
      const current = await existingHash(entry.target);
      if (
        current !== null &&
        current !== entry.manifest.sha256 &&
        (!old || current !== old.sha256)
      ) {
        throw new Error('refusing to replace an unmanaged runtime file');
      }
    }
    for (const old of previous?.entries ?? []) {
      if (desiredByKey.has(entryKey(old))) continue;
      const { target } = targetOf(old, this.cwd, this.hermesHome);
      const current = await existingHash(target);
      if (current !== null && current !== old.sha256) {
        throw new Error('refusing to remove a modified runtime file');
      }
    }

    for (const entry of desired) {
      const current = await existingHash(entry.target);
      if (current === entry.manifest.sha256) continue;
      const old = oldByKey.get(entryKey(entry.manifest));
      if (current !== null && (!old || current !== old.sha256)) {
        throw new Error('refusing to replace an unmanaged runtime file');
      }
      await atomicWrite(entry.root, entry.target, entry.content);
    }
    for (const old of previous?.entries ?? []) {
      if (desiredByKey.has(entryKey(old))) continue;
      const { target } = targetOf(old, this.cwd, this.hermesHome);
      const current = await existingHash(target);
      if (current === null) continue;
      if (current !== old.sha256) throw new Error('refusing to remove a modified runtime file');
      await unlink(target);
    }

    const manifest: Manifest = {
      schemaVersion: 1,
      revision: snapshot.revision,
      entries: desired.map(({ manifest }) => manifest),
    };
    await atomicWrite(this.hermesHome, this.manifestPath, `${JSON.stringify(manifest)}\n`);
    return snapshot.revision;
  }
}

export class HermesPolicySynchronizer {
  private appliedRevision: string | null = null;
  private active: Promise<void> | null = null;

  constructor(
    private readonly client: RuntimePolicyClient,
    private readonly materializer: HermesPolicyMaterializer,
  ) {}

  async ensure(): Promise<void> {
    if (this.active) return this.active;
    this.active = this.sync().finally(() => {
      this.active = null;
    });
    return this.active;
  }

  private async sync(): Promise<void> {
    try {
      const snapshot = await this.client.runtimePolicy();
      if (snapshot.revision === this.appliedRevision) return;
      const revision = await this.materializer.apply(snapshot);
      await this.client.reportRuntimeStatus({
        adapter: 'hermes',
        status: 'online',
        appliedRevision: revision,
        capabilities: CAPABILITIES,
        detail: null,
      });
      this.appliedRevision = revision;
    } catch {
      await this.client
        .reportRuntimeStatus({
          adapter: 'hermes',
          status: 'degraded',
          appliedRevision: this.appliedRevision,
          capabilities: CAPABILITIES,
          detail: 'Runtime policy sync failed',
        })
        .catch(() => {});
      throw new Error('Hermes runtime policy sync failed');
    }
  }
}

export function hermesPolicySynchronizer(
  config: RunnerConfig,
  client: RuntimePolicyClient,
): HermesPolicySynchronizer | null {
  if (config.agent !== 'hermes') return null;
  const cwd = config.cwd;
  const hermesHome = config.env.HERMES_HOME ?? process.env.HERMES_HOME;
  if (!cwd || !hermesHome) throw new Error('Hermes policy sync requires cwd and HERMES_HOME');
  return new HermesPolicySynchronizer(client, new HermesPolicyMaterializer({ cwd, hermesHome }));
}
