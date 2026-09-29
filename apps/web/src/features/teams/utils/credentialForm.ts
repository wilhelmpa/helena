import type { AiAgent } from '@/lib/api/endpoints/agents';
import type {
  CredentialEntry,
  CredentialInput,
  CredentialKind,
  DecisionKeySource,
  LoginMethod,
  LoginRuntime,
  NewCredentialInput,
} from '@/lib/api/endpoints/credentials';

// The form of a credential. A secret field holds what the reader typed: on edit an empty
// one keeps the stored value, a typed one replaces it.
export interface CredentialFormValue {
  kind: CredentialKind;
  label: string;
  projectId: number | null;
  loginUrl: string;
  // One domain per line.
  allowedDomains: string;
  username: string;
  password: string;
  totpSecret: string;
  removeTotp: boolean;
  value: string;
  notes: string;
  runtime: LoginRuntime;
  method: LoginMethod;
  // decision_model: the kind of service, its address and model, the local address allowance,
  // and where the key comes from.
  provider: string;
  baseUrl: string;
  model: string;
  allowPrivateAddress: boolean;
  keySource: DecisionKeySource;
  sourceCredentialId: number | null;
  // api_key, secret: whether the granted agents' commands get it as an environment variable,
  // and its name; a variable always has a name.
  envEnabled: boolean;
  envName: string;
}

// A variable name as the API takes it (apps/api/src/modules/agents/credentials/env.ts
// checks it in full, including the names Helena and the system keep for themselves).
export const ENV_NAME_PATTERN = /^[A-Z_][A-Z0-9_]{0,63}$/;

// Typed names become capitals, with anything that cannot be in one as an underscore.
export function envNameOf(text: string): string {
  return text
    .toUpperCase()
    .replace(/[^A-Z0-9_]/g, '_')
    .slice(0, 64);
}

// The decision services in the cloud: a key is required, and their address is never local.
export const CLOUD_DECISION_PROVIDERS = ['typesafe', 'vercel'];

export const CREDENTIAL_KINDS: CredentialKind[] = [
  'web_login',
  'api_key',
  'ssh_key',
  'secret',
  'runtime_login',
  'decision_model',
  'variable',
];

// The kinds that can reach the agents' commands as an environment variable.
export const ENV_KINDS: CredentialKind[] = ['api_key', 'secret', 'variable'];

// How each runtime can be signed in here: Claude Code with a token from `claude
// setup-token` or an API key, Codex with an API key (its ChatGPT login is made on the
// agent's runtime itself).
export const LOGIN_METHODS: Record<LoginRuntime, LoginMethod[]> = {
  claude: ['oauth_token', 'api_key'],
  codex: ['api_key'],
};

export function emptyCredentialValue(kind: CredentialKind): CredentialFormValue {
  return {
    kind,
    label: '',
    projectId: null,
    loginUrl: '',
    allowedDomains: '',
    username: '',
    password: '',
    totpSecret: '',
    removeTotp: false,
    value: '',
    notes: '',
    runtime: 'claude',
    method: 'oauth_token',
    provider: 'typesafe',
    baseUrl: '',
    model: '',
    allowPrivateAddress: false,
    keySource: 'stored',
    sourceCredentialId: null,
    envEnabled: kind === 'variable',
    envName: '',
  };
}

export function credentialValue(entry: CredentialEntry): CredentialFormValue {
  return {
    ...emptyCredentialValue(entry.kind as CredentialKind),
    label: entry.label,
    projectId: entry.projectId,
    loginUrl: entry.loginUrl ?? '',
    allowedDomains: entry.allowedDomains
      .map((origin) => origin.replace(/^https:\/\//, ''))
      .join('\n'),
    username: entry.username ?? '',
    notes: entry.notes,
    runtime: entry.runtime ?? 'claude',
    method: entry.method ?? 'oauth_token',
    provider: entry.provider ?? 'typesafe',
    baseUrl: entry.baseUrl ?? '',
    model: entry.model ?? '',
    allowPrivateAddress: entry.allowPrivateAddress,
    keySource: entry.keySource ?? 'stored',
    sourceCredentialId: entry.sourceCredentialId ?? null,
    envEnabled: entry.kind === 'variable' || entry.envName !== null,
    envName: entry.envName ?? '',
    value: entry.kind === 'variable' ? (entry.value ?? '') : '',
  };
}

// Whether the variable part of the form is complete: off, or a name of the right shape.
export function isEnvNameValid(
  value: Pick<CredentialFormValue, 'envEnabled' | 'envName'>,
): boolean {
  return !value.envEnabled || ENV_NAME_PATTERN.test(value.envName);
}

export function domainsOf(text: string): string[] {
  return text
    .split(/[\s,]+/)
    .map((domain) => domain.trim())
    .filter(Boolean);
}

// Whether the form can be saved: a name, and every field the kind needs, where a secret
// field already stored counts as filled.
export function isCredentialFormValid(
  value: CredentialFormValue,
  entry: CredentialEntry | null,
): boolean {
  const stored = (field: string) => entry?.secrets.includes(field) ?? false;
  const filled = (text: string, field?: string) =>
    text.trim() !== '' || (field !== undefined && stored(field));
  if (!filled(value.label)) return false;
  switch (value.kind) {
    case 'web_login':
      return filled(value.loginUrl) && filled(value.username) && filled(value.password, 'password');
    case 'api_key':
    case 'secret':
      return filled(value.value, 'value') && isEnvNameValid(value);
    case 'variable':
      return filled(value.value) && ENV_NAME_PATTERN.test(value.envName);
    case 'runtime_login':
      return LOGIN_METHODS[value.runtime].includes(value.method) && filled(value.value, 'value');
    case 'ssh_key':
      return true;
    case 'decision_model':
      // A cloud service needs a key; a server of the owner's own may run without one, and a
      // local AI model server supplies its own address and key.
      return (
        value.provider !== '' &&
        ((value.keySource !== 'stored' && value.keySource !== 'credential') ||
          CLOUD_DECISION_PROVIDERS.includes(value.provider) ||
          value.baseUrl.trim() !== '') &&
        (value.keySource !== 'stored' ||
          !CLOUD_DECISION_PROVIDERS.includes(value.provider) ||
          filled(value.value, 'value')) &&
        (value.keySource !== 'credential' ||
          (Number.isSafeInteger(value.sourceCredentialId) && Number(value.sourceCredentialId) > 0))
      );
  }
}

// The fields of the kind the reader filled in. A secret is sent as typed.
function fieldsOf(value: CredentialFormValue): CredentialInput {
  const notes = value.notes.trim();
  switch (value.kind) {
    case 'web_login':
      return {
        loginUrl: value.loginUrl.trim(),
        allowedDomains: domainsOf(value.allowedDomains),
        username: value.username.trim(),
        notes,
        ...(value.password !== '' && { password: value.password }),
        ...(value.removeTotp
          ? { totpSecret: null }
          : value.totpSecret.trim() !== '' && { totpSecret: value.totpSecret.trim() }),
      };
    case 'api_key':
    case 'secret':
      return {
        notes,
        ...(value.value !== '' && { value: value.value }),
        envName: value.envEnabled ? value.envName : null,
      };
    case 'variable':
      return { notes, value: value.value, envName: value.envName };
    case 'runtime_login':
      return {
        runtime: value.runtime,
        method: value.method,
        notes,
        ...(value.value.trim() !== '' && { value: value.value.trim() }),
      };
    case 'ssh_key':
      return { notes };
    case 'decision_model':
      return {
        provider: value.provider,
        ...(value.baseUrl.trim() !== '' && { baseUrl: value.baseUrl.trim() }),
        ...(value.model.trim() !== '' && { model: value.model.trim() }),
        allowPrivateAddress:
          !CLOUD_DECISION_PROVIDERS.includes(value.provider) && value.allowPrivateAddress,
        keySource: value.keySource,
        ...(value.keySource === 'credential' && { sourceCredentialId: value.sourceCredentialId }),
        notes,
        ...(value.keySource === 'stored' &&
          value.value.trim() !== '' && { value: value.value.trim() }),
      };
  }
}

export function toNewCredential(value: CredentialFormValue): NewCredentialInput {
  return {
    kind: value.kind,
    label: value.label.trim(),
    projectId: value.projectId,
    ...fieldsOf(value),
  };
}

export function toCredentialPatch(value: CredentialFormValue): CredentialInput {
  return { label: value.label.trim(), projectId: value.projectId, ...fieldsOf(value) };
}

export type AgentRole = 'home' | 'coordinator' | 'specialist';

// The Home role is persisted; a project's coordinator uses the coordinator handle.
export function agentRole(agent: Pick<AiAgent, 'username' | 'agentRole'>): AgentRole {
  if (agent.agentRole === 'home') return 'home';
  return agent.username.endsWith('-koordinator') ? 'coordinator' : 'specialist';
}

export interface AgentGroup {
  // Null for the Home agent and for agents that work in no project.
  project: { id: number; name: string } | null;
  agents: AiAgent[];
}

const ROLE_ORDER: AgentRole[] = ['home', 'coordinator', 'specialist'];

// The agents a credential can be granted to, for the picker: those that run in Hermes,
// and for a credential of one project those working there. A runtime login only goes to
// the agents running on its runtime. The Home agent comes first, then every project with
// its coordinator ahead of its specialists.
export function grantableAgentGroups(
  agents: AiAgent[],
  projectId: number | null,
  runtime: LoginRuntime | null = null,
): AgentGroup[] {
  const grantable = agents
    .filter((agent) => !agent.template)
    .filter((agent) => runtime === null || agent.runtimePolicy?.runtime === runtime)
    .filter(
      (agent) =>
        projectId === null ||
        agentRole(agent) === 'home' ||
        agent.projects.some((project) => project.id === projectId),
    )
    .sort(
      (a, b) =>
        ROLE_ORDER.indexOf(agentRole(a)) - ROLE_ORDER.indexOf(agentRole(b)) ||
        a.name.localeCompare(b.name),
    );
  const groups = new Map<string, AgentGroup>();
  for (const agent of grantable) {
    const project =
      agentRole(agent) === 'home'
        ? undefined
        : (agent.projects.find((p) => p.id === projectId) ?? agent.projects[0]);
    const key = project ? `project-${project.id}` : 'none';
    const group = groups.get(key) ?? {
      project: project ? { id: project.id, name: project.name } : null,
      agents: [],
    };
    group.agents.push(agent);
    groups.set(key, group);
  }
  return [...groups.values()].sort(
    (a, b) =>
      Number(a.project !== null) - Number(b.project !== null) ||
      (a.project?.name ?? '').localeCompare(b.project?.name ?? ''),
  );
}
