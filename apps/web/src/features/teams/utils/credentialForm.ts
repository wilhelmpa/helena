import type { AiAgent } from '@/lib/api/endpoints/agents';
import type {
  CredentialEntry,
  CredentialInput,
  CredentialKind,
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
}

export const CREDENTIAL_KINDS: CredentialKind[] = [
  'web_login',
  'api_key',
  'ssh_key',
  'secret',
  'runtime_login',
];

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
  };
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
      return filled(value.value, 'value');
    case 'runtime_login':
      return LOGIN_METHODS[value.runtime].includes(value.method) && filled(value.value, 'value');
    case 'ssh_key':
      return true;
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
      return { notes, ...(value.value !== '' && { value: value.value }) };
    case 'runtime_login':
      return {
        runtime: value.runtime,
        method: value.method,
        notes,
        ...(value.value.trim() !== '' && { value: value.value.trim() }),
      };
    case 'ssh_key':
      return { notes };
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

// The Home agent is `master`, a project's coordinator `hermes-<slug>-coordinator`.
export function agentRole(agent: Pick<AiAgent, 'username'>): AgentRole {
  if (agent.username.toLowerCase() === 'master') return 'home';
  return agent.username.endsWith('-coordinator') ? 'coordinator' : 'specialist';
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
    .filter((agent) => agent.kind === 'external' && !agent.template)
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
