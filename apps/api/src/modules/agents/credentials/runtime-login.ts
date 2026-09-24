import {
  db,
  aiAgent,
  integrationCredential,
  integrationCredentialGrant,
  integrationCredentialUse,
  projectMember,
  user,
} from '@repo/db';
import { and, desc, eq, isNull, or, sql } from 'drizzle-orm';
import { decryptSecret } from '@repo/crypto';
import type { RunnerAgent } from '../runner/service';
import { claimedWork, type WorkRef } from './delivery';
import type { LoginMethod, LoginRuntime } from './kinds';

// The runtime login ("Laufzeit-Anmeldung") of an agent that runs on Claude Code or Codex:
// the newest runtime_login of the agent's runtime granted to it, within its project. The
// runner asks for it before each run and chat answer and hands the value to that one
// command in its environment (packages/runner/src/cli-login.ts); asked without work, it
// only learns whether one is granted, for the agent's health ("Laufzeit nicht angemeldet").
//
// Grants are the Credentials page's agent grants today. hub/access-center widens them to
// project grants and one audit helper; on its merge this reads through its grantReaches()
// and recordAgentUses() instead of the two queries below.

export interface RuntimeLogin {
  credentialId: number;
  runtime: LoginRuntime;
  method: LoginMethod;
  value?: string;
}

async function agentRuntime(agentId: number): Promise<LoginRuntime | null> {
  const [row] = await db
    .select({ runtime: sql<string | null>`${aiAgent.runtimePolicy}->>'runtime'` })
    .from(aiAgent)
    .where(eq(aiAgent.id, agentId));
  return row?.runtime === 'claude' || row?.runtime === 'codex' ? row.runtime : null;
}

export async function runtimeLoginOf(
  agent: RunnerAgent,
  ref: WorkRef | null,
): Promise<RuntimeLogin | null> {
  const work = ref ? await claimedWork(agent.id, ref) : null;
  const runtime = await agentRuntime(agent.id);
  if (!runtime) return null;
  const projectId = integrationCredential.projectId;
  const [row] = await db
    .select({
      id: integrationCredential.id,
      label: integrationCredential.label,
      redacted: integrationCredential.redacted,
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
        eq(integrationCredential.integrationKey, 'runtime_login'),
        eq(integrationCredential.teamId, agent.teamId),
        sql`${integrationCredential.redacted}->>'runtime' = ${runtime}`,
        // One of a project reaches only the agents that work there.
        or(
          isNull(projectId),
          work?.projectId != null
            ? eq(projectId, work.projectId)
            : sql`exists (select 1 from ${projectMember} where ${projectMember.projectId} = ${projectId} and ${projectMember.userId} = ${agent.userId})`,
        ),
      ),
    )
    .orderBy(desc(integrationCredential.updatedAt), desc(integrationCredential.id))
    .limit(1);
  if (!row) return null;
  const readable = (row.redacted ?? {}) as { method?: string };
  const method: LoginMethod = readable.method === 'api_key' ? 'api_key' : 'oauth_token';
  const login: RuntimeLogin = { credentialId: row.id, runtime, method };
  if (!work) return login;
  const secrets = JSON.parse(decryptSecret(row)) as { value?: string };
  const [person] = await db.select({ name: user.name }).from(user).where(eq(user.id, agent.userId));
  await db.insert(integrationCredentialUse).values({
    teamId: agent.teamId,
    credentialId: row.id,
    credentialLabel: row.label ?? '',
    agentId: agent.id,
    agentName: person?.name ?? agent.username,
    runId: work.runId,
    chatMessageId: work.chatMessageId,
    action: 'delivered',
    purpose: `runtime:${runtime}`,
  });
  return { ...login, value: secrets.value ?? '' };
}
