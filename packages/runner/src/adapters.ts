import { CliRuntimeAdapter } from './cli-runtime';
import { ExternalRuntimeAdapter } from './external-runtime';
import { HelenaRuntimeAdapter } from './helena-runtime';
import type { RunnerConfig } from './config';
import { hermesPolicySynchronizer, type RuntimePolicyClient } from './policy';
import type { RuntimeAdapter } from './runtime';
import { runtimeOf } from './runtimes';

// The runtime adapter of an agent the runner serves (runtime.ts), or null for a CLI the
// runner knows no adapter for and for the operator's own command: those run as configured.
export function runtimeAdapter(
  config: RunnerConfig,
  client: RuntimePolicyClient,
): RuntimeAdapter | null {
  if (config.command) return null;
  if (config.agent === 'hermes') return hermesPolicySynchronizer(config, client);
  if (config.agent === 'claude' || config.agent === 'codex') {
    return new CliRuntimeAdapter(config.agent, config, client);
  }
  if (config.agent === 'helena') return new HelenaRuntimeAdapter(config, client);
  if (config.agent === 'command' || config.agent === 'webhook') {
    return new ExternalRuntimeAdapter(config.agent, config, client);
  }
  // A plugin runtime (@helena/sdk RuntimeType) brings its own profile adapter.
  const type = runtimeOf(config.agent);
  if (type?.adapter) {
    return type.adapter({
      name: config.name,
      url: config.url,
      env: config.env,
      cwd: config.cwd ?? null,
      policy: () => client.runtimePolicy(),
    });
  }
  return null;
}
