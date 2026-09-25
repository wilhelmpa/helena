import { SecretMask, type RunSettings } from '@helena/sdk';

// The environment variables Helena delivers for one run or chat answer (Zugänge → "Als
// Umgebungsvariable an Agenten geben", docs/helena-decisions/agent-env.md): fetched with the
// work the runner holds, set in the environment of that one command, and masked in
// everything the runner reports about it. They are never written to a file: an isolated
// agent's command gets them on the launcher's stdin header, like the rest of its variables.

export interface EnvVariable {
  id: number;
  label: string;
  name: string;
  value: string;
  // A secret's value is masked; a plain variable's (an account id) is not.
  secret: boolean;
  updatedAt: string;
}

export interface DeliveredEnv {
  env: Record<string, string>;
  names: string[];
  // The values to mask.
  secrets: string[];
}

export const NO_DELIVERED_ENV: DeliveredEnv = { env: {}, names: [], secrets: [] };

const NAME = /^[A-Z_][A-Z0-9_]{0,63}$/;

// What the runner, the launcher and the sandbox set themselves. Helena refuses these names
// already (apps/api/src/modules/agents/credentials/env.ts); the runner does not take them
// from any server either.
const OWN_NAMES = new Set([
  'PATH',
  'HOME',
  'USER',
  'LOGNAME',
  'SHELL',
  'TMPDIR',
  'TERM',
  'LANG',
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'ALL_PROXY',
  'NO_PROXY',
  'FTP_PROXY',
  'CREDENTIALS_DIRECTORY',
  'NOTIFY_SOCKET',
  'DISPLAY',
  'XAUTHORITY',
  'AGENT_ISOLATION',
  'BU_CDP_URL',
]);
const OWN_PREFIXES = [
  'ITSAPLAN_',
  'HELENA_',
  'VOLITION_',
  'HERMES_',
  'TERMINAL_',
  'BROWSER_',
  'GIT_',
  'SSH_',
  'LD_',
  'PYTHON',
  'NODE_',
  'SYSTEMD_',
  'XDG_',
  'CLAUDE_',
  'CODEX_',
  'ANTHROPIC_',
  'OPENAI_',
];

export function acceptedName(name: string): boolean {
  return (
    NAME.test(name) &&
    !OWN_NAMES.has(name) &&
    !OWN_PREFIXES.some((prefix) => name.startsWith(prefix))
  );
}

export function deliveredEnv(variables: EnvVariable[]): DeliveredEnv {
  const env: Record<string, string> = {};
  const secrets: string[] = [];
  for (const variable of variables) {
    if (typeof variable?.name !== 'string' || typeof variable.value !== 'string') continue;
    if (!acceptedName(variable.name) || variable.value.includes('\0')) continue;
    env[variable.name] = variable.value;
    if (variable.secret !== false) secrets.push(variable.value);
  }
  return { env, names: Object.keys(env).sort(), secrets };
}

// The mask of a piece of work: the runner's own secrets and the values delivered for it.
export function workMask(known: Iterable<string>, delivered?: DeliveredEnv | null): SecretMask {
  return new SecretMask([...known, ...(delivered?.secrets ?? [])]);
}

// The run settings with the SSH environment and the delivered variables. What the runner
// and its runtime adapter set wins over a delivered variable of the same name.
export function withEnv(
  settings: RunSettings | null,
  env: Record<string, string>,
  delivered: DeliveredEnv = NO_DELIVERED_ENV,
): RunSettings | null {
  if (Object.keys(env).length === 0 && delivered.names.length === 0) return settings;
  return {
    toolsets: settings?.toolsets ?? null,
    ...settings,
    env: { ...delivered.env, ...settings?.env, ...env },
    ...(delivered.names.length > 0 && {
      delivered: { names: delivered.names, secrets: delivered.secrets },
    }),
  };
}
