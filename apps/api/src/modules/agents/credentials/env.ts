import {
  db,
  agentChatMessage,
  agentChatThread,
  aiAgent,
  integrationCredential,
  integrationCredentialGrant,
  openCredential,
  project,
  projectMember,
  user,
} from '@repo/db';
import { and, asc, eq, inArray, isNotNull, or, sql } from 'drizzle-orm';
import { SecretMask } from '@helena/sdk';
import { HttpError } from '#shared/lib';
import type { RunnerAgent } from '../runner/service';
import { credentialInScope, grantReaches, type GrantSubject } from './grants';
import { recordAgentUses, type ClaimedWork } from './delivery';

// Credentials as environment variables (docs/helena-decisions/agent-env.md): an API key or
// secret with an environment variable name, and a plain variable, reach the processes of
// the agents they are granted to (a CLI such as wrangler reads CLOUDFLARE_API_TOKEN) for one
// run or chat answer at a time. The value is only ever in the answer to the runner that
// holds the work and in the environment of its command; everything Helena stores from
// the agents is masked with the team's secret values (teamSecretMask).

// The kinds that can carry a variable name. A `variable` always has one; its value is not
// secret and is stored readable.
export const ENV_KINDS = ['api_key', 'secret', 'variable'] as const;

export const ENV_NAME = /^[A-Z_][A-Z0-9_]{0,63}$/;

// Names a credential may not set: the ones the shell, the loader, the runtimes and Helena's
// own runner and sandbox decide, and those that would change where the agent's traffic goes
// or which certificates it trusts. A delivered variable adds a credential to an agent's
// commands; it never reconfigures them.
const DENIED_NAMES = new Set([
  'PATH',
  'HOME',
  'USER',
  'LOGNAME',
  'SHELL',
  'PWD',
  'OLDPWD',
  'TMPDIR',
  'TMP',
  'TEMP',
  'TERM',
  'LANG',
  'LANGUAGE',
  'TZ',
  'IFS',
  'ENV',
  'CDPATH',
  'GLOBIGNORE',
  'PS1',
  'PS2',
  'PS3',
  'PS4',
  'PROMPT_COMMAND',
  'MAIL',
  'MAILPATH',
  'HOSTNAME',
  'HOSTALIASES',
  'SHLVL',
  'EDITOR',
  'VISUAL',
  'PAGER',
  'BROWSER',
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'ALL_PROXY',
  'NO_PROXY',
  'FTP_PROXY',
  'SSL_CERT_FILE',
  'SSL_CERT_DIR',
  'REQUESTS_CA_BUNDLE',
  'CURL_CA_BUNDLE',
  'CREDENTIALS_DIRECTORY',
  'NOTIFY_SOCKET',
  'INVOCATION_ID',
  'JOURNAL_STREAM',
  'DBUS_SESSION_BUS_ADDRESS',
  'DISPLAY',
  'XAUTHORITY',
  'WAYLAND_DISPLAY',
  'AGENT_ISOLATION',
  'BU_CDP_URL',
  'GNUPGHOME',
  'LOCPATH',
  'NLSPATH',
  'RES_OPTIONS',
  'LOCALDOMAIN',
  'JAVA_TOOL_OPTIONS',
  '_JAVA_OPTIONS',
  'JDK_JAVA_OPTIONS',
  'RUBYOPT',
  'RUBYLIB',
  'PERL5OPT',
  'PERL5LIB',
  'PERLLIB',
]);

const DENIED_PREFIXES = [
  // The dynamic loader and interpreters' own start-up switches.
  'LD_',
  'DYLD_',
  'PYTHON',
  'NODE_',
  'BUN_',
  'DENO_',
  'BASH_',
  'GCONV_',
  'MALLOC_',
  'GLIBC_',
  'OPENSSL_',
  'KRB5',
  // Package managers' configuration (registry, scripts, cache).
  'NPM_CONFIG_',
  'UV_',
  'PIP_',
  // git and ssh: GIT_SSH_COMMAND carries the delivered SSH keys (ssh.ts).
  'GIT_',
  'SSH_',
  // Locale, session and service manager.
  'LC_',
  'XDG_',
  'SYSTEMD_',
  'LISTEN_',
  // Helena, its runner and sandbox, and the runtimes' own configuration and logins.
  'ITSAPLAN_',
  'HELENA_',
  'VOLITION_',
  'HERMES_',
  'TERMINAL_',
  'BROWSER_',
  'CLAUDE_',
  'CODEX_',
  'ANTHROPIC_',
  'OPENAI_',
];

// Why a name cannot be used, or null. The reason is the API's message.
export function envNameProblem(name: string): string | null {
  if (!ENV_NAME.test(name)) {
    return 'A variable name has capital letters, digits and underscores, starts with a letter or an underscore and is at most 64 characters long.';
  }
  if (DENIED_NAMES.has(name) || DENIED_PREFIXES.some((prefix) => name.startsWith(prefix))) {
    return `${name} is set by Helena, the runtime or the system and cannot come from a credential.`;
  }
  return null;
}

export function assertEnvName(name: string): string {
  const problem = envNameProblem(name);
  if (problem) throw new HttpError(400, problem);
  return name;
}

// A name is used once per scope: by one credential of the whole team, and by one of each
// project. A project's own credential overrides the team's for that project's work.
export async function assertEnvNameFree(
  teamId: number,
  projectId: number | null,
  name: string,
  exceptId: number | null,
): Promise<void> {
  const [taken] = await db
    .select({ label: integrationCredential.label })
    .from(integrationCredential)
    .where(
      and(
        eq(integrationCredential.teamId, teamId),
        inArray(integrationCredential.integrationKey, [...ENV_KINDS]),
        sql`${integrationCredential.redacted}->>'envName' = ${name}`,
        projectId === null
          ? sql`${integrationCredential.projectId} is null`
          : eq(integrationCredential.projectId, projectId),
        exceptId === null ? undefined : sql`${integrationCredential.id} <> ${exceptId}`,
      ),
    )
    .limit(1);
  if (taken) {
    throw new HttpError(409, `${name} is already the variable of "${taken.label ?? ''}".`);
  }
}

export interface DeliveredVariable {
  id: number;
  label: string;
  name: string;
  value: string;
  // A secret's value is masked wherever Helena shows what the agent did.
  secret: boolean;
  updatedAt: string;
}

// The project a piece of work is in: a run's own, or the project of the chat it answers.
// A chat outside any project (Start) has none.
async function workProject(work: ClaimedWork): Promise<number | null> {
  if (work.projectId !== null || work.chatMessageId === null) return work.projectId;
  const [row] = await db
    .select({ projectId: agentChatThread.projectId })
    .from(agentChatMessage)
    .innerJoin(agentChatThread, eq(agentChatThread.id, agentChatMessage.threadId))
    .where(eq(agentChatMessage.id, work.chatMessageId));
  return row?.projectId ?? null;
}

export interface EnvCandidate {
  id: number;
  name: string;
  // The project the credential is limited to, null for the team.
  projectId: number | null;
  // Granted to the agent by name, rather than through a project.
  byAgent: boolean;
}

// How closely a credential fits the work: its own project's credential first, then one
// granted to the agent by name, then the team's. A credential of another project the agent
// works in (a chat outside any project) fits least.
function specificity(candidate: EnvCandidate, projectId: number | null): number {
  if (candidate.projectId !== null && candidate.projectId === projectId) return 3;
  if (candidate.byAgent) return 2;
  if (candidate.projectId === null) return 1;
  return 0;
}

// One credential per name. Two that fit equally well are left out, rather than one picked
// at random: which account an agent's command runs against must never be a guess.
export function resolveEnvCandidates<T extends EnvCandidate>(
  candidates: T[],
  projectId: number | null,
): { chosen: T[]; ambiguous: T[] } {
  const byName = new Map<string, T[]>();
  for (const candidate of candidates) {
    const list = byName.get(candidate.name) ?? [];
    list.push(candidate);
    byName.set(candidate.name, list);
  }
  const chosen: T[] = [];
  const ambiguous: T[] = [];
  for (const list of byName.values()) {
    const best = Math.max(...list.map((candidate) => specificity(candidate, projectId)));
    const top = list.filter((candidate) => specificity(candidate, projectId) === best);
    if (top.length === 1) chosen.push(top[0]!);
    else ambiguous.push(...top);
  }
  chosen.sort((a, b) => a.name.localeCompare(b.name));
  return { chosen, ambiguous };
}

const envName = sql<string>`${integrationCredential.redacted}->>'envName'`;

// The variables the agent's runner sets for the run or chat answer it holds, recorded in
// the credential's audit log like every delivery.
export async function deliverEnvVariables(
  agent: RunnerAgent,
  work: ClaimedWork,
): Promise<DeliveredVariable[]> {
  const projectId = await workProject(work);
  const subject: GrantSubject = { agentId: agent.id, userId: agent.userId, projectId };
  const rows = await db
    .select({
      id: integrationCredential.id,
      kind: integrationCredential.integrationKey,
      label: integrationCredential.label,
      projectId: integrationCredential.projectId,
      redacted: integrationCredential.redacted,
      updatedAt: integrationCredential.updatedAt,
      ciphertext: integrationCredential.ciphertext,
      iv: integrationCredential.iv,
      authTag: integrationCredential.authTag,
      name: envName,
      byAgent: sql<boolean>`exists (select 1 from ${integrationCredentialGrant} where ${integrationCredentialGrant.credentialId} = ${integrationCredential.id} and ${integrationCredentialGrant.agentId} = ${agent.id})`,
    })
    .from(integrationCredential)
    .where(
      and(
        eq(integrationCredential.teamId, agent.teamId),
        inArray(integrationCredential.integrationKey, [...ENV_KINDS]),
        isNotNull(envName),
        credentialInScope(subject),
        sql`exists (select 1 from ${integrationCredentialGrant} where ${integrationCredentialGrant.credentialId} = ${integrationCredential.id} and ${grantReaches(subject)})`,
      ),
    )
    .orderBy(asc(integrationCredential.id));
  const { chosen, ambiguous } = resolveEnvCandidates(
    rows.filter((row) => !envNameProblem(row.name)),
    projectId,
  );
  const variables = chosen.flatMap((row): DeliveredVariable[] => {
    const readable = (row.redacted ?? {}) as { value?: unknown };
    const value =
      row.kind === 'variable'
        ? typeof readable.value === 'string'
          ? readable.value
          : ''
        : ((JSON.parse(openCredential(row)) as { value?: string }).value ?? '');
    if (!value) return [];
    return [
      {
        id: row.id,
        label: row.label ?? '',
        name: row.name,
        value,
        secret: row.kind !== 'variable',
        updatedAt: row.updatedAt.toISOString(),
      },
    ];
  });
  await recordAgentUses(
    agent,
    work,
    'delivered',
    variables.map((variable) => ({
      credentialId: variable.id,
      label: variable.label,
      purpose: `env ${variable.name}`,
    })),
  );
  await recordAgentUses(
    agent,
    work,
    'denied',
    ambiguous.map((row) => ({
      credentialId: row.id,
      label: row.label ?? '',
      purpose: `env ${row.name}: another credential sets the same variable for this work`,
    })),
  );
  return variables;
}

// ── What Helena shows: the names a run receives ─────────────────────────────────────────

export interface EnvironmentGrant {
  agentId: number | null;
  agentName: string | null;
  projectId: number | null;
  projectKey: string | null;
}

export interface EnvironmentEntry {
  name: string;
  credentialId: number;
  label: string;
  kind: (typeof ENV_KINDS)[number];
  secret: boolean;
  // The project the credential is limited to, null for the whole team.
  projectId: number | null;
  projectKey: string | null;
  // The grants through which it reaches the agent or the project.
  grants: EnvironmentGrant[];
}

// The variables that reach an agent, or the agents of a project: names and where they
// come from, never a value. For an agent, every grant to it or to a project it works in;
// for a project, the grants to the project and to the agents working in it.
export async function listEnvironment(
  teamId: number,
  target: { agentId: number } | { projectId: number },
): Promise<EnvironmentEntry[]> {
  let reaches;
  let scope;
  if ('agentId' in target) {
    const [agent] = await db
      .select({ userId: aiAgent.userId })
      .from(aiAgent)
      .where(and(eq(aiAgent.id, target.agentId), eq(aiAgent.teamId, teamId)));
    if (!agent) throw new HttpError(404, 'Agent not found');
    const projects = sql`(select ${projectMember.projectId} from ${projectMember} where ${projectMember.userId} = ${agent.userId})`;
    reaches = or(
      eq(integrationCredentialGrant.agentId, target.agentId),
      sql`${integrationCredentialGrant.projectId} in ${projects}`,
    )!;
    scope = or(
      sql`${integrationCredential.projectId} is null`,
      sql`${integrationCredential.projectId} in ${projects}`,
    )!;
  } else {
    const [row] = await db
      .select({ id: project.id })
      .from(project)
      .where(and(eq(project.id, target.projectId), eq(project.teamId, teamId)));
    if (!row) throw new HttpError(404, 'Project not found');
    const agentsOfProject = sql`(select a.id from ${aiAgent} a join ${projectMember} pm on pm.user_id = a.user_id where pm.project_id = ${target.projectId})`;
    reaches = or(
      eq(integrationCredentialGrant.projectId, target.projectId),
      sql`${integrationCredentialGrant.agentId} in ${agentsOfProject}`,
    )!;
    scope = or(
      sql`${integrationCredential.projectId} is null`,
      eq(integrationCredential.projectId, target.projectId),
    )!;
  }
  const rows = await db
    .select({
      credentialId: integrationCredential.id,
      kind: integrationCredential.integrationKey,
      label: integrationCredential.label,
      name: envName,
      projectId: integrationCredential.projectId,
      projectKey: sql<
        string | null
      >`(select ${project.key} from ${project} where ${project.id} = ${integrationCredential.projectId})`,
      grantAgentId: integrationCredentialGrant.agentId,
      grantAgentName: user.name,
      grantProjectId: integrationCredentialGrant.projectId,
      grantProjectKey: sql<
        string | null
      >`(select p.key from ${project} p where p.id = ${integrationCredentialGrant.projectId})`,
    })
    .from(integrationCredential)
    .innerJoin(
      integrationCredentialGrant,
      eq(integrationCredentialGrant.credentialId, integrationCredential.id),
    )
    .leftJoin(aiAgent, eq(aiAgent.id, integrationCredentialGrant.agentId))
    .leftJoin(user, eq(user.id, aiAgent.userId))
    .where(
      and(
        eq(integrationCredential.teamId, teamId),
        inArray(integrationCredential.integrationKey, [...ENV_KINDS]),
        isNotNull(envName),
        reaches,
        scope,
      ),
    )
    .orderBy(asc(envName), asc(integrationCredential.id), asc(integrationCredentialGrant.id));
  const entries = new Map<number, EnvironmentEntry>();
  for (const row of rows) {
    const kind = row.kind as EnvironmentEntry['kind'];
    const entry = entries.get(row.credentialId) ?? {
      name: row.name,
      credentialId: row.credentialId,
      label: row.label ?? '',
      kind,
      secret: kind !== 'variable',
      projectId: row.projectId,
      projectKey: row.projectKey,
      grants: [],
    };
    entry.grants.push({
      agentId: row.grantAgentId,
      agentName: row.grantAgentName,
      projectId: row.grantProjectId,
      projectKey: row.grantProjectKey,
    });
    entries.set(row.credentialId, entry);
  }
  return [...entries.values()];
}

// ── Masking what the agents report ──────────────────────────────────────────────────────

// The values an agent's process can hold and print: the team's API keys, secrets and
// runtime logins, and the passwords of its web logins.
const MASKED_FIELDS: Record<string, string> = {
  api_key: 'value',
  secret: 'value',
  runtime_login: 'value',
  web_login: 'password',
};

const MASK_TTL_MS = 30_000;
const masks = new Map<number, { at: number; mask: Promise<SecretMask> }>();

async function loadTeamMask(teamId: number): Promise<SecretMask> {
  const rows = await db
    .select({
      id: integrationCredential.id,
      kind: integrationCredential.integrationKey,
      ciphertext: integrationCredential.ciphertext,
      iv: integrationCredential.iv,
      authTag: integrationCredential.authTag,
    })
    .from(integrationCredential)
    .where(
      and(
        eq(integrationCredential.teamId, teamId),
        inArray(integrationCredential.integrationKey, Object.keys(MASKED_FIELDS)),
      ),
    );
  const values: string[] = [];
  for (const row of rows) {
    try {
      const secrets = JSON.parse(openCredential(row)) as Record<string, unknown>;
      const value = secrets[MASKED_FIELDS[row.kind]!];
      if (typeof value === 'string') values.push(value, value.trim());
    } catch {
      // A row that cannot be opened has nothing to mask.
    }
  }
  return new SecretMask(values);
}

// The mask of every secret value of the team, applied to what the agents' runners report
// before it is stored: run results and timelines, chat answers, runtime answers
// (transcripts, logs). Read at most every half minute, and again at once after a change.
export function teamSecretMask(teamId: number): Promise<SecretMask> {
  const cached = masks.get(teamId);
  if (cached && Date.now() - cached.at < MASK_TTL_MS) return cached.mask;
  const mask = loadTeamMask(teamId);
  masks.set(teamId, { at: Date.now(), mask });
  mask.catch(() => masks.delete(teamId));
  return mask;
}

export function forgetTeamSecrets(teamId: number): void {
  masks.delete(teamId);
}

export async function maskForTeam<T>(teamId: number, value: T): Promise<T> {
  return (await teamSecretMask(teamId)).value(value);
}
