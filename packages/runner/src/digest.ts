import type { AgentRuntimeConfig } from '@helena/agent-runtime';
import type { RunSettings } from '@helena/sdk';
import { presetOf, type RunnerConfig } from './config';

// Digest runs handle untrusted release notes without tools, agent instructions,
// memory, skills or MCP secrets. Hermes uses command switches; the native loop
// receives a text-only configuration.

export const DIGEST_TOOLSETS = ['todo'];
export const DIGEST_ARGS = ['--ignore-rules'];

export function isDigestRun(run: { trigger: string }): boolean {
  return run.trigger === 'digest';
}

// Only runtimes with a dedicated text-only mode can receive untrusted release notes.
export function digestRuntimeError(config: Pick<RunnerConfig, 'agent' | 'command'>): string | null {
  return ['hermes', 'helena-agent'].includes(presetOf(config)?.bin ?? '')
    ? null
    : 'A digest run needs a native or Hermes agent';
}

export function digestSettings(
  settings: RunSettings | null,
  runner: Pick<RunnerConfig, 'agent' | 'command'> = { agent: 'hermes' },
): RunSettings {
  const env = Object.fromEntries(
    Object.entries(settings?.env ?? {}).filter(
      ([name]) => !name.startsWith('ITSAPLAN_MCP_SECRET_'),
    ),
  );
  if (presetOf(runner)?.bin === 'helena-agent') {
    const config = settings?.input?.config as AgentRuntimeConfig | undefined;
    if (!config) throw new Error('The native digest configuration is missing');
    return {
      toolsets: [],
      env,
      input: {
        config: {
          ...config,
          instructions: undefined,
          contextWarnings: [],
          tools: { textOnly: true },
          skills: [],
          mcpServers: [],
          memory: { enabled: false },
          escalation: { mode: 'never' },
          runtimeFallback: undefined,
        },
      },
    };
  }
  return {
    toolsets: DIGEST_TOOLSETS,
    env,
    args: DIGEST_ARGS,
    ...(settings?.hooks && { hooks: settings.hooks }),
  };
}
