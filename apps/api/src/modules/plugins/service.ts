import { resolve, sep } from 'node:path';
import {
  resolveText,
  uiSlotDescriptor,
  type LocalizedText,
  type UiSlotDescriptor,
} from '@helena/sdk';
import {
  approvalProblem,
  discoverPlugins,
  loadExternalPlugins,
  type LoadedPlugin,
} from '@helena/sdk/server';
import { getPluginSettings, pluginsDir, setPluginSettings } from '@repo/db';
import { HttpError } from '#shared/lib';
import { host, registries } from '#shared/helena';

// External plugins in the API process: loading them at start, what the Administrator
// sees and decides, and serving their UI pages. A decision takes effect on the next start
// of the API and the worker (plugins register at start; docs/helena-framework.md §7).

// Loads the approved plugins of HELENA_PLUGINS_DIR. Called once at start (index.ts).
export async function loadExternalServerPlugins(): Promise<LoadedPlugin[]> {
  const root = pluginsDir();
  if (!root) return [];
  const settings = await getPluginSettings();
  const loaded = await loadExternalPlugins(host, {
    root,
    entry: 'server',
    policy: { enabled: settings.externalEnabled, approved: settings.approved },
  });
  await host.start();
  for (const plugin of loaded) {
    console.log(
      `[plugins] ${plugin.manifest.id} ${plugin.manifest.version}: ${plugin.status}` +
        (plugin.error ? ` (${plugin.error})` : ''),
    );
  }
  return loaded;
}

function text(value: LocalizedText | undefined): string | null {
  return value === undefined ? null : resolveText(value, 'en');
}

export interface PluginView {
  id: string;
  name: string;
  version: string;
  description: string | null;
  author: string | null;
  license: string | null;
  homepage: string | null;
  source: 'builtin' | 'external';
  // loaded | failed | disabled (found, not loaded) | not-loaded (found after start)
  status: string;
  error: string | null;
  digest: string | null;
  approved: boolean;
  // The decision differs from what runs: a restart applies it.
  restartRequired: boolean;
  provides: Record<string, string[]>;
  permissions: {
    actions: string[];
    events: string[];
    network: string[];
    credentials: boolean;
  };
}

function view(
  plugin: LoadedPlugin,
  current: { digest?: string; running?: LoadedPlugin; approved: boolean; problem: string | null },
): PluginView {
  const { manifest } = plugin;
  const provides: Record<string, string[]> = {};
  for (const [key, value] of Object.entries(manifest.provides)) {
    if (key === 'mcpServers') {
      provides.mcpServers = (manifest.provides.mcpServers ?? []).map((server) => server.name);
    } else if (Array.isArray(value)) {
      provides[key] = value as string[];
    }
  }
  const runningLoaded = current.running?.status === 'loaded';
  const shouldRun = plugin.source === 'builtin' || current.problem === null;
  return {
    id: manifest.id,
    name: resolveText(manifest.name, 'en'),
    version: manifest.version,
    description: text(manifest.description),
    author: manifest.author ?? null,
    license: manifest.license ?? null,
    homepage: manifest.homepage ?? null,
    source: plugin.source,
    status: current.running?.status ?? 'not-loaded',
    error: current.running?.error ?? current.problem,
    digest: current.digest ?? plugin.digest ?? null,
    approved: current.approved,
    restartRequired:
      plugin.source === 'external' &&
      (shouldRun !== runningLoaded ||
        (runningLoaded && current.running?.digest !== current.digest)),
    provides,
    permissions: {
      actions: manifest.permissions?.actions ?? [],
      events: manifest.permissions?.events ?? [],
      network: manifest.permissions?.network ?? [],
      credentials: manifest.permissions?.credentials === true,
    },
  };
}

export interface PluginsOverview {
  externalEnabled: boolean;
  // Where external plugins are looked for; null while the instance names no folder.
  pluginsDir: string | null;
  plugins: PluginView[];
}

export async function pluginsOverview(): Promise<PluginsOverview> {
  const settings = await getPluginSettings();
  const policy = { enabled: settings.externalEnabled, approved: settings.approved };
  const running = new Map(host.list().map((plugin) => [plugin.manifest.id, plugin]));
  const plugins: PluginView[] = host
    .list()
    .filter((plugin) => plugin.source === 'builtin')
    .map((plugin) => view(plugin, { running: plugin, approved: true, problem: null }));

  const root = pluginsDir();
  for (const found of root ? await discoverPlugins(root) : []) {
    if (!found.manifest || !found.digest) {
      plugins.push({
        ...view(
          {
            manifest: {
              id: found.dir.split(sep).pop() ?? found.dir,
              name: found.dir.split(sep).pop() ?? found.dir,
              version: '0.0.0',
              sdk: '*',
              provides: {},
            },
            source: 'external',
            status: 'failed',
          },
          { approved: false, problem: found.error ?? 'Unreadable manifest' },
        ),
        status: 'failed',
        restartRequired: false,
      });
      continue;
    }
    const approval = settings.approved.find((entry) => entry.id === found.manifest!.id);
    const problem = approvalProblem({ manifest: found.manifest, digest: found.digest }, policy);
    plugins.push(
      view(
        { manifest: found.manifest, source: 'external', status: 'disabled', dir: found.dir },
        {
          digest: found.digest,
          running: running.get(found.manifest.id),
          approved:
            !!approval &&
            approval.version === found.manifest.version &&
            approval.digest === found.digest,
          problem,
        },
      ),
    );
  }
  return { externalEnabled: settings.externalEnabled, pluginsDir: root, plugins };
}

export async function setExternalPluginsEnabled(enabled: boolean): Promise<PluginsOverview> {
  const settings = await getPluginSettings();
  await setPluginSettings({ ...settings, externalEnabled: enabled });
  return pluginsOverview();
}

// Approves the plugin as it is on disk now: its id, version and digest. Anything that
// changes afterwards (a new version, an edited file) needs a new approval.
export async function approvePlugin(pluginId: string): Promise<PluginsOverview> {
  const root = pluginsDir();
  if (!root) throw new HttpError(409, 'No plugin folder is configured (HELENA_PLUGINS_DIR)');
  const found = (await discoverPlugins(root)).find((entry) => entry.manifest?.id === pluginId);
  if (!found?.manifest || !found.digest) throw new HttpError(404, 'Plugin not found');
  const settings = await getPluginSettings();
  await setPluginSettings({
    ...settings,
    approved: [
      ...settings.approved.filter((entry) => entry.id !== pluginId),
      { id: pluginId, version: found.manifest.version, digest: found.digest },
    ],
  });
  return pluginsOverview();
}

export async function revokePlugin(pluginId: string): Promise<PluginsOverview> {
  const settings = await getPluginSettings();
  await setPluginSettings({
    ...settings,
    approved: settings.approved.filter((entry) => entry.id !== pluginId),
  });
  return pluginsOverview();
}

// The UI slots the web app cannot know from its own bundle: frame slots of loaded
// plugins. Built-in slots are components registered in the web app itself.
export function uiSlotDescriptors(): UiSlotDescriptor[] {
  return registries.uiSlots
    .entriesList()
    .flatMap((entry) => uiSlotDescriptor(entry.value, entry.pluginId) ?? []);
}

const CONTENT_TYPES: Record<string, string> = {
  html: 'text/html; charset=utf-8',
  js: 'text/javascript; charset=utf-8',
  mjs: 'text/javascript; charset=utf-8',
  css: 'text/css; charset=utf-8',
  json: 'application/json; charset=utf-8',
  svg: 'image/svg+xml',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  woff2: 'font/woff2',
};

// A file of a loaded external plugin's `ui/` folder, for its frame slots. The page runs
// sandboxed even when opened on its own: the CSP `sandbox` directive gives it an opaque
// origin, so it never acts with Helena's session.
export async function pluginUiFile(pluginId: string, path: string): Promise<Response> {
  const plugin = host.get(pluginId);
  if (!plugin || plugin.source !== 'external' || plugin.status !== 'loaded' || !plugin.dir) {
    return new Response('Not found', { status: 404 });
  }
  const root = resolve(plugin.dir, 'ui');
  const file = resolve(root, path);
  const extension = file.split('.').pop()?.toLowerCase() ?? '';
  if (!file.startsWith(root + sep) || !CONTENT_TYPES[extension]) {
    return new Response('Not found', { status: 404 });
  }
  const body = Bun.file(file);
  if (!(await body.exists())) return new Response('Not found', { status: 404 });
  return new Response(body, {
    headers: {
      'content-type': CONTENT_TYPES[extension]!,
      'content-security-policy':
        "sandbox allow-scripts allow-forms; default-src 'self' 'unsafe-inline' data:",
      'x-content-type-options': 'nosniff',
      'cache-control': 'no-cache',
    },
  });
}
