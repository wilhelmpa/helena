import { createHash } from 'node:crypto';
import { readFile, readdir, stat } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { PluginManifest } from '../manifest-types';
import type { HelenaPlugin } from '../plugin';
import type { LoadedPlugin, PluginHost } from './host';
import { parseManifest } from './manifest';

// External plugins live in one folder (HELENA_PLUGINS_DIR), one sub-folder per plugin
// with its `helena.plugin.json`. Nothing there runs unless the operator switched external
// plugins on in the Administrator and approved the plugin at this exact version and
// digest: a plugin whose files change after approval is not loaded until it is approved
// again (the model Grafana uses for unsigned plugins, with a content hash instead of a
// signature).

export const MANIFEST_FILE = 'helena.plugin.json';

export interface DiscoveredPlugin {
  dir: string;
  manifest?: PluginManifest;
  digest?: string;
  error?: string;
}

export interface PluginApproval {
  id: string;
  version: string;
  digest: string;
}

export interface ExternalPluginPolicy {
  // The Administrator's switch for external plugins as a whole.
  enabled: boolean;
  approved: PluginApproval[];
}

export type PluginEntry = 'server' | 'runner';

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

function inside(dir: string, file: string): string {
  const root = resolve(dir);
  const target = resolve(root, file);
  if (!target.startsWith(root + sep)) throw new Error(`${file} is outside the plugin folder`);
  return target;
}

// A sha256 over the manifest and the code entries, which is what an approval pins.
export async function pluginDigest(dir: string, manifest: PluginManifest): Promise<string> {
  const hash = createHash('sha256');
  hash.update(await readFile(join(dir, MANIFEST_FILE)));
  for (const entry of [manifest.main?.server, manifest.main?.runner]) {
    if (!entry) continue;
    hash.update('\0');
    hash.update(entry);
    hash.update('\0');
    hash.update(await readFile(inside(dir, entry)));
  }
  return `sha256:${hash.digest('hex')}`;
}

export async function discoverPlugins(root: string): Promise<DiscoveredPlugin[]> {
  if (!(await isDirectory(root))) return [];
  const names = (await readdir(root)).filter((name) => !name.startsWith('.')).sort();
  const found: DiscoveredPlugin[] = [];
  for (const name of names) {
    const dir = join(root, name);
    if (!(await isDirectory(dir))) continue;
    try {
      const raw = JSON.parse(await readFile(join(dir, MANIFEST_FILE), 'utf8')) as unknown;
      const manifest = parseManifest(raw);
      found.push({ dir, manifest, digest: await pluginDigest(dir, manifest) });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
      found.push({ dir, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return found;
}

function isPlugin(value: unknown): value is HelenaPlugin {
  return !!value && typeof (value as HelenaPlugin).register === 'function';
}

async function importPlugin(dir: string, entry: string): Promise<HelenaPlugin> {
  const mod = (await import(pathToFileURL(inside(dir, entry)).href)) as {
    default?: unknown;
    plugin?: unknown;
  };
  const plugin = mod.default ?? mod.plugin;
  if (!isPlugin(plugin)) throw new Error(`${entry} does not export a plugin with register()`);
  return plugin;
}

// Why a discovered plugin is not loaded, or null when it may be.
export function approvalProblem(
  plugin: { manifest: PluginManifest; digest: string },
  policy: ExternalPluginPolicy,
): string | null {
  if (!policy.enabled) return 'External plugins are switched off';
  const approval = policy.approved.find((entry) => entry.id === plugin.manifest.id);
  if (!approval) return 'Not approved';
  if (approval.version !== plugin.manifest.version) {
    return `Approved at version ${approval.version}, found ${plugin.manifest.version}`;
  }
  if (approval.digest !== plugin.digest) return 'Changed since it was approved';
  return null;
}

// Loads every approved plugin from `root` into the host, and records the others with the
// reason they were not loaded.
export async function loadExternalPlugins(
  host: PluginHost,
  options: { root: string; policy: ExternalPluginPolicy; entry: PluginEntry },
): Promise<LoadedPlugin[]> {
  const results: LoadedPlugin[] = [];
  for (const found of await discoverPlugins(options.root)) {
    if (!found.manifest || !found.digest) {
      const loaded: LoadedPlugin = {
        manifest: invalidManifest(found.dir),
        source: 'external',
        status: 'failed',
        error: found.error ?? 'Unreadable manifest',
        dir: found.dir,
      };
      host.record(loaded);
      results.push(loaded);
      continue;
    }
    const meta = { source: 'external' as const, dir: found.dir, digest: found.digest };
    const problem = approvalProblem(
      { manifest: found.manifest, digest: found.digest },
      options.policy,
    );
    if (problem) {
      const loaded: LoadedPlugin = {
        manifest: found.manifest,
        status: 'disabled',
        error: problem,
        ...meta,
      };
      host.record(loaded);
      results.push(loaded);
      continue;
    }
    const entry = found.manifest.main?.[options.entry];
    try {
      const plugin = entry ? await importPlugin(found.dir, entry) : { register() {} };
      results.push(await host.load(plugin, found.manifest, meta));
    } catch (error) {
      const loaded: LoadedPlugin = {
        manifest: found.manifest,
        status: 'failed',
        error: error instanceof Error ? error.message : String(error),
        ...meta,
      };
      host.record(loaded);
      results.push(loaded);
    }
  }
  return results;
}

// A stand-in manifest for a folder whose own could not be read, so the Administrator can
// still list it by folder name.
function invalidManifest(dir: string): PluginManifest {
  const name = dir.split(sep).pop() ?? dir;
  return {
    id: name.toLowerCase().replace(/[^a-z0-9.-]/g, '-'),
    name,
    version: '0.0.0',
    sdk: '*',
    provides: {},
  };
}
