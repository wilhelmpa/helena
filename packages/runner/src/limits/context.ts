import type { UsageLimitAgentContext, UsageLimitSnapshot } from '@helena/sdk';
import { CliRuntimeAdapter } from '../cli-runtime';
import type { RunnerConfig } from '../config';
import type { RuntimeAdapter } from '../runtime';
import { limitsStream, type LimitsStream } from './index';

// What the usage-limit sources are told about an agent this runner serves: its runtime, the
// home its login lives in, and the providers it uses.

// The providers a Hermes agent reaches: its profile's default provider, the one its config
// names, and those of the models its chat may pick.
export function agentProviders(config: RunnerConfig, adapter: RuntimeAdapter | null): string[] {
  const providers = [
    adapter?.defaults()?.provider,
    config.provider,
    ...config.models.map((model) => model.provider),
  ].filter((provider): provider is string => typeof provider === 'string' && !!provider.trim());
  return [...new Set(providers.map((provider) => provider.trim()))];
}

export function limitsContext(
  config: RunnerConfig,
  adapter: RuntimeAdapter | null,
): UsageLimitAgentContext | null {
  const runtime = config.command ? null : (config.agent ?? null);
  if (!runtime) return null;
  if (adapter instanceof CliRuntimeAdapter) {
    const login = adapter.limitsLogin();
    return {
      runtime,
      home: login.dir,
      env: { ...config.env, ...login.env },
      providers: runtime === 'claude' ? ['anthropic'] : ['openai-codex'],
      gate: login.gate,
      loginRef: login.ref,
    };
  }
  const home =
    runtime === 'hermes'
      ? (config.env.HERMES_HOME ?? process.env.HERMES_HOME)
      : (config.env.HOME ?? process.env.HOME);
  if (!home) return null;
  return {
    runtime,
    home,
    env: config.env,
    providers: runtime === 'hermes' ? agentProviders(config, adapter) : [],
  };
}

// The stream that reads one command's output for plan limits and sends them to Helena, or
// null where no source reads this runtime's output.
export function observeLimits(
  config: RunnerConfig,
  adapter: RuntimeAdapter | null,
  client: { postLimits(snapshots: UsageLimitSnapshot[]): Promise<void> },
): LimitsStream | null {
  const context = limitsContext(config, adapter);
  if (!context) return null;
  return limitsStream(config.outputFormat, context, (snapshots) => client.postLimits(snapshots));
}
