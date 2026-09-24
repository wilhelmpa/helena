import { CliRuntimeAdapter } from './cli-runtime';
import type { RunnerConfig } from './config';
import { hermesPolicySynchronizer, type RuntimePolicyClient } from './policy';
import type { RuntimeAdapter } from './runtime';

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
  return null;
}
