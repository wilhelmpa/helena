import { projectRoot } from '#modules/project-files/roots';
import {
  db,
  agentChatMessage,
  agentRun,
  integrationCredential,
  integrationCredentialGrant,
  integrationCredentialUse,
  openCredential,
  project,
  user,
} from '@repo/db';
import { and, eq, gt, inArray, isNotNull, sql } from 'drizzle-orm';
import { HttpError } from '#shared/lib';
import type { RunnerAgent } from '../runner/service';
import { mcpSecretServers } from '../mcp-servers/service';
import { loginOrigins } from './kinds';
import {
  credentialInScope,
  grantReaches,
  grantsOf,
  type GrantEntry,
  type GrantSubject,
} from './grants';

// What an agent's runner receives for the run or chat answer it holds, and the audit log
// entries that receiving and using a credential writes.

export type WorkRef = { runId: number } | { messageId: number };

export interface ClaimedWork {
  runId: number | null;
  chatMessageId: number | null;
  // The project of a run. A chat answer has none.
  projectId: number | null;
}

export function workRefOf(query: { runId?: number; messageId?: number }): WorkRef | null {
  if (query.runId !== undefined && query.messageId !== undefined) {
    throw new HttpError(400, 'Name a run or a chat answer, not both.');
  }
  if (query.runId !== undefined) return { runId: query.runId };
  if (query.messageId !== undefined) return { messageId: query.messageId };
  return null;
}

// The run or chat answer that this agent's runner holds under a live lease. Anything
// else, including work the runner finished or lost, is a 404.
export async function claimedWork(agentId: number, ref: WorkRef): Promise<ClaimedWork> {
  if ('runId' in ref) {
    const [run] = await db
      .select({ id: agentRun.id, projectId: agentRun.projectId })
      .from(agentRun)
      .where(
        and(
          eq(agentRun.id, ref.runId),
          eq(agentRun.agentId, agentId),
          eq(agentRun.status, 'pending'),
          isNotNull(agentRun.startedAt),
          gt(agentRun.nextAttemptAt, sql`now()`),
        ),
      );
    if (!run) throw new HttpError(404, 'Run not found');
    return { runId: run.id, chatMessageId: null, projectId: run.projectId };
  }
  const [message] = await db
    .select({ id: agentChatMessage.id })
    .from(agentChatMessage)
    .where(
      and(
        eq(agentChatMessage.id, ref.messageId),
        eq(agentChatMessage.agentId, agentId),
        eq(agentChatMessage.role, 'assistant'),
        eq(agentChatMessage.status, 'streaming'),
        gt(agentChatMessage.nextAttemptAt, sql`now()`),
      ),
    );
  if (!message) throw new HttpError(404, 'Chat answer not found');
  return { runId: null, chatMessageId: message.id, projectId: null };
}

export type UseAction = 'delivered' | 'used' | 'called' | 'denied' | 'approval' | 'changed';

export interface UseEntry {
  credentialId: number;
  label: string;
  purpose: string;
  category?: string | null;
}

// Writes audit log entries for an agent. The agent's name is copied, so an entry outlives
// the agent.
export async function recordAgentUses(
  agent: Pick<RunnerAgent, 'id' | 'teamId' | 'userId' | 'username'>,
  work: Pick<ClaimedWork, 'runId' | 'chatMessageId'>,
  action: UseAction,
  entries: UseEntry[],
): Promise<void> {
  if (entries.length === 0) return;
  const [row] = await db.select({ name: user.name }).from(user).where(eq(user.id, agent.userId));
  await db.insert(integrationCredentialUse).values(
    entries.map((entry) => ({
      teamId: agent.teamId,
      credentialId: entry.credentialId,
      credentialLabel: entry.label,
      agentId: agent.id,
      agentName: row?.name ?? agent.username,
      runId: work.runId,
      chatMessageId: work.chatMessageId,
      action,
      category: entry.category ?? null,
      purpose: entry.purpose.slice(0, 500),
    })),
  );
}

const record = recordAgentUses;

export function subjectOf(
  agent: Pick<RunnerAgent, 'id' | 'userId'>,
  work: ClaimedWork,
): GrantSubject {
  return { agentId: agent.id, userId: agent.userId, projectId: work.projectId };
}

export interface DeliveredLogin {
  id: number;
  label: string;
  updatedAt: string;
  origins: string[];
  username: string;
  password: string;
  totpSecret: string | null;
}

export async function deliverWebLogins(
  agent: RunnerAgent,
  work: ClaimedWork,
): Promise<DeliveredLogin[]> {
  const rows = await db
    .select({
      id: integrationCredential.id,
      label: integrationCredential.label,
      redacted: integrationCredential.redacted,
      updatedAt: integrationCredential.updatedAt,
      ciphertext: integrationCredential.ciphertext,
      iv: integrationCredential.iv,
      authTag: integrationCredential.authTag,
    })
    .from(integrationCredential)
    .where(
      and(
        eq(integrationCredential.teamId, agent.teamId),
        eq(integrationCredential.integrationKey, 'web_login'),
        credentialInScope(subjectOf(agent, work)),
        sql`exists (select 1 from ${integrationCredentialGrant} where ${integrationCredentialGrant.credentialId} = ${integrationCredential.id} and ${grantReaches(subjectOf(agent, work))})`,
      ),
    )
    .orderBy(integrationCredential.id);
  const logins = rows.map((row): DeliveredLogin => {
    const readable = row.redacted as {
      loginUrl: string;
      allowedDomains?: string[];
      username: string;
    };
    const secrets = JSON.parse(openCredential(row)) as { password: string; totpSecret?: string };
    return {
      id: row.id,
      label: row.label ?? '',
      updatedAt: row.updatedAt.toISOString(),
      origins: loginOrigins(readable.loginUrl, readable.allowedDomains ?? []),
      username: readable.username,
      password: secrets.password,
      totpSecret: secrets.totpSecret ?? null,
    };
  });
  await record(
    agent,
    work,
    'delivered',
    logins.map((login) => ({
      credentialId: login.id,
      label: login.label,
      purpose: 'Hermes vault',
    })),
  );
  return logins;
}

// The logins the agent filled, as its runner read them from Hermes' output. A credential
// not granted to the agent is left out.
export async function recordWebLoginUses(
  agent: RunnerAgent,
  work: ClaimedWork,
  uses: { credentialId: number; tool: string; origin: string }[],
): Promise<void> {
  const ids = [...new Set(uses.map((use) => use.credentialId))];
  if (ids.length === 0) return;
  const granted = await db
    .select({ id: integrationCredential.id, label: integrationCredential.label })
    .from(integrationCredential)
    .where(
      and(
        inArray(integrationCredential.id, ids),
        eq(integrationCredential.integrationKey, 'web_login'),
        sql`exists (select 1 from ${integrationCredentialGrant} where ${integrationCredentialGrant.credentialId} = ${integrationCredential.id} and ${grantReaches(subjectOf(agent, work))})`,
      ),
    );
  const labels = new Map(granted.map((row) => [row.id, row.label ?? '']));
  await record(
    agent,
    work,
    'used',
    uses
      .filter((use) => labels.has(use.credentialId))
      .map((use) => ({
        credentialId: use.credentialId,
        label: labels.get(use.credentialId)!,
        purpose: `${use.tool} ${use.origin}`.trim(),
      })),
  );
}

// The secrets of the agent's MCP servers that its runner received for one run or chat
// answer.
export async function recordMcpSecretDelivery(
  agent: RunnerAgent,
  work: ClaimedWork,
  secretIds: number[],
): Promise<void> {
  if (secretIds.length === 0) return;
  const [servers, labels] = await Promise.all([
    mcpSecretServers(agent.id),
    db
      .select({ id: integrationCredential.id, label: integrationCredential.label })
      .from(integrationCredential)
      .where(inArray(integrationCredential.id, secretIds)),
  ]);
  await record(
    agent,
    work,
    'delivered',
    labels.map((row) => ({
      credentialId: row.id,
      label: row.label ?? '',
      purpose: `MCP server ${(servers.get(row.id) ?? []).join(', ')}`.trim(),
    })),
  );
}

export interface DeliveredSshKey {
  workspaces?: string[];
  id: number;
  label: string;
  updatedAt: string;
  privateKey: string;
}

// The key a workspace job (a clone) was started with, which its run receives whatever the
// agent's standing grants are: the owner picked it for this one job.
async function workspaceJobKey(work: ClaimedWork): Promise<number | null> {
  if (work.runId === null) return null;
  const [run] = await db
    .select({ trigger: agentRun.trigger, prompt: agentRun.prompt })
    .from(agentRun)
    .where(eq(agentRun.id, work.runId));
  if (run?.trigger !== 'workspace') return null;
  try {
    const job = JSON.parse(run.prompt) as { credentialId?: unknown };
    return typeof job.credentialId === 'number' ? job.credentialId : null;
  } catch {
    return null;
  }
}

// The SSH keys the agent's runner writes for git before the run or chat answer: the ones
// granted to the agent or its project, and the key of a workspace job.
export async function deliverSshKeys(
  agent: RunnerAgent,
  work: ClaimedWork,
): Promise<DeliveredSshKey[]> {
  const subject = subjectOf(agent, work);
  if (agent.agentRole === 'home') subject.projectId = null;
  const jobKey = await workspaceJobKey(work);
  const granted = sql`exists (select 1 from ${integrationCredentialGrant} where ${integrationCredentialGrant.credentialId} = ${integrationCredential.id} and ${grantReaches(subject)})`;
  const rows = await db
    .select({
      id: integrationCredential.id,
      projectId: integrationCredential.projectId,
      label: integrationCredential.label,
      updatedAt: integrationCredential.updatedAt,
      ciphertext: integrationCredential.ciphertext,
      iv: integrationCredential.iv,
      authTag: integrationCredential.authTag,
    })
    .from(integrationCredential)
    .where(
      and(
        eq(integrationCredential.teamId, agent.teamId),
        eq(integrationCredential.integrationKey, 'ssh_key'),
        credentialInScope(subject),
        jobKey === null ? granted : sql`(${granted} or ${integrationCredential.id} = ${jobKey})`,
      ),
    )
    .orderBy(integrationCredential.id);
  const workspaceProjects =
    agent.agentRole === 'home'
      ? await db
          .select({ id: project.id, key: project.key })
          .from(project)
          .where(eq(project.teamId, agent.teamId))
      : [];
  const homeGrants =
    agent.agentRole === 'home'
      ? await grantsOf(rows.map((row) => row.id))
      : new Map<number, GrantEntry[]>();
  const keys = rows.flatMap((row): DeliveredSshKey[] => {
    const secrets = JSON.parse(openCredential(row)) as { privateKey?: string };
    if (!secrets.privateKey) return [];
    let workspaces: string[] | undefined;
    if (agent.agentRole === 'home') {
      const grants = homeGrants.get(row.id) ?? [];
      const global = row.projectId == null && grants.some((grant) => grant.agentId === agent.id);
      const projectIds =
        row.projectId == null
          ? grants.flatMap((grant) => (grant.projectId == null ? [] : [grant.projectId]))
          : [row.projectId];
      workspaces = global
        ? []
        : workspaceProjects
            .filter((p) => projectIds.includes(p.id))
            .map((p) => projectRoot(p.key, 'code').directory);
      if (!global && !workspaces.length) return [];
    }
    return [
      {
        id: row.id,
        ...(workspaces !== undefined && { workspaces }),
        label: row.label ?? '',
        updatedAt: row.updatedAt.toISOString(),
        privateKey: secrets.privateKey,
      },
    ];
  });
  await record(
    agent,
    work,
    'delivered',
    keys.map((key) => ({
      credentialId: key.id,
      label: key.label,
      purpose: key.id === jobKey ? 'git (SSH), clone job' : 'git (SSH)',
    })),
  );
  return keys;
}
