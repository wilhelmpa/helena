import {
  db,
  agentChatMessage,
  agentRun,
  integrationCredential,
  integrationCredentialGrant,
  integrationCredentialUse,
  projectMember,
  user,
} from '@repo/db';
import { and, eq, gt, inArray, isNotNull, isNull, or, sql } from 'drizzle-orm';
import { decryptSecret } from '@repo/crypto';
import { HttpError } from '#shared/lib';
import type { RunnerAgent } from '../runner/service';
import { mcpSecretServers } from '../mcp-servers/service';
import { loginOrigins } from './kinds';

// What an agent's runner receives for the run or chat answer it holds, and the audit log
// entries that receiving and using a credential writes.

export type WorkRef = { runId: number } | { messageId: number };

interface ClaimedWork {
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

async function record(
  agent: RunnerAgent,
  work: ClaimedWork,
  action: 'delivered' | 'used',
  entries: { credentialId: number; label: string; purpose: string }[],
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
      purpose: entry.purpose,
    })),
  );
}

// A credential limited to a project reaches a run in that project, and a chat answer of
// an agent that works there.
function inScope(agent: RunnerAgent, work: ClaimedWork) {
  const projectId = integrationCredential.projectId;
  return or(
    isNull(projectId),
    work.projectId !== null
      ? eq(projectId, work.projectId)
      : sql`exists (select 1 from ${projectMember} where ${projectMember.projectId} = ${projectId} and ${projectMember.userId} = ${agent.userId})`,
  );
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
    .innerJoin(
      integrationCredentialGrant,
      and(
        eq(integrationCredentialGrant.credentialId, integrationCredential.id),
        eq(integrationCredentialGrant.agentId, agent.id),
      ),
    )
    .where(
      and(
        eq(integrationCredential.teamId, agent.teamId),
        eq(integrationCredential.integrationKey, 'web_login'),
        inScope(agent, work),
      ),
    )
    .orderBy(integrationCredential.id);
  const logins = rows.map((row): DeliveredLogin => {
    const readable = row.redacted as {
      loginUrl: string;
      allowedDomains?: string[];
      username: string;
    };
    const secrets = JSON.parse(decryptSecret(row)) as { password: string; totpSecret?: string };
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
    .innerJoin(
      integrationCredentialGrant,
      and(
        eq(integrationCredentialGrant.credentialId, integrationCredential.id),
        eq(integrationCredentialGrant.agentId, agent.id),
      ),
    )
    .where(
      and(
        inArray(integrationCredential.id, ids),
        eq(integrationCredential.integrationKey, 'web_login'),
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
