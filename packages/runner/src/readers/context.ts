import type { RunnerConfig } from '../config';
import { Redactor } from '../redact';
import type { ReaderContext } from './types';

// Where the adapter of an unisolated agent reads: Hermes' profile, or the home directory
// Claude Code and Codex keep their sessions in.
export function readerContext(config: RunnerConfig): ReaderContext {
  const runtime = config.agent ?? 'custom';
  const home =
    runtime === 'hermes'
      ? (config.env.HERMES_HOME ?? process.env.HERMES_HOME ?? '')
      : (config.env.HOME ?? process.env.HOME ?? '');
  if (!home) throw new Error(`The ${runtime} runtime has no home directory to read`);
  return {
    runtime,
    home,
    cwd: config.cwd ?? null,
    env: { ...config.env, ITSAPLAN_URL: config.url, ITSAPLAN_API_KEY: config.apiKey },
  };
}

const SECRET_NAME = /(KEY|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL)/i;

// The values the runner itself holds that must never reach Helena's views: the agent's key
// and the secrets of its configuration.
export function runnerRedactor(config: RunnerConfig): Redactor {
  const secrets = Object.entries(config.env)
    .filter(([name]) => SECRET_NAME.test(name))
    .map(([, value]) => value);
  return new Redactor([config.apiKey, ...secrets]);
}
