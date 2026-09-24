import { readFile } from 'node:fs/promises';
import { PluginHost, loadPluginDir, type LoadedPlugin } from '@helena/sdk/server';
import { runtimes } from './runtimes';

// Plugins give the runner runtimes it does not ship (an ACP agent, a CLI with a stream
// format of its own). The runner loads the `runner` entry of each plugin folder its config
// file names under `plugins`, or HELENA_RUNNER_PLUGINS names (folders separated by `:`).
// The operator who writes that file decides what runs; there is no approval step here as
// there is for the server's plugin folder.

async function pluginDirs(configPath: string): Promise<string[]> {
  const fromEnv = (process.env.HELENA_RUNNER_PLUGINS ?? '')
    .split(':')
    .map((dir) => dir.trim())
    .filter(Boolean);
  let fromFile: string[] = [];
  try {
    const file = JSON.parse(await readFile(configPath, 'utf8')) as { plugins?: unknown };
    if (Array.isArray(file.plugins)) {
      fromFile = file.plugins.filter((dir): dir is string => typeof dir === 'string' && !!dir);
    }
  } catch {
    // A missing or broken file is reported by loadConfig.
  }
  return [...new Set([...fromFile, ...fromEnv])].map((dir) =>
    dir.replace(/^~/, process.env.HOME ?? '~'),
  );
}

// Loads the plugins into the runner's runtime registry before the config is read, so an
// agent may name a plugin's runtime.
export async function loadRunnerPlugins(
  configPath: string,
  log: (message: string) => void,
): Promise<LoadedPlugin[]> {
  const dirs = await pluginDirs(configPath);
  if (dirs.length === 0) return [];
  const host = new PluginHost({ process: 'runner', registries: { runtimes } });
  const loaded: LoadedPlugin[] = [];
  for (const dir of dirs) {
    try {
      const plugin = await loadPluginDir(host, dir, 'runner');
      loaded.push(plugin);
      if (plugin.status === 'loaded')
        log(`plugin ${plugin.manifest.id} ${plugin.manifest.version} loaded`);
      else log(`plugin ${plugin.manifest.id} not loaded: ${plugin.error}`);
    } catch (error) {
      log(`plugin in ${dir} not loaded: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  await host.start();
  return loaded;
}
