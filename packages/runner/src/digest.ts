import type { RunSettings } from '@helena/sdk';
import { presetOf, type RunnerConfig } from './config';

// A digest run (trigger 'digest'): Helena's update center has a small model summarize
// release notes (docs/helena-decisions/update-center.md §4.3). The notes are untrusted text
// from the internet, so the run is text only:
//   - Hermes starts with --ignore-rules: no SOUL, AGENTS, memory or preloaded skills;
//   - its toolsets are limited to `todo`, Hermes' one toolset that reaches nothing outside
//     the turn, so no terminal, file, browser or web tool exists and no MCP server starts;
//   - the agent's standing instructions, skills arguments and vault logins are left out,
//     and the MCP secrets of the agent's servers are not handed to the command.
// The model and reasoning come with the run (Helena's settings for summaries).

export const DIGEST_TOOLSETS = ['todo'];
export const DIGEST_ARGS = ['--ignore-rules'];

export function isDigestRun(run: { trigger: string }): boolean {
  return run.trigger === 'digest';
}

// Only Hermes has the switches that make a run text only.
export function digestRuntimeError(config: Pick<RunnerConfig, 'agent' | 'command'>): string | null {
  return presetOf(config)?.bin === 'hermes' ? null : 'A digest run needs a Hermes agent';
}

export function digestSettings(settings: RunSettings | null): RunSettings {
  const env = Object.fromEntries(
    Object.entries(settings?.env ?? {}).filter(
      ([name]) => !name.startsWith('ITSAPLAN_MCP_SECRET_'),
    ),
  );
  return {
    toolsets: DIGEST_TOOLSETS,
    env,
    args: DIGEST_ARGS,
    ...(settings?.hooks && { hooks: settings.hooks }),
  };
}
