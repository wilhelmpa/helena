import {
  db,
  aiAgent,
  integrationCredential,
  integrationCredentialGrant,
  openCredential,
} from '@repo/db';
import { and, desc, eq, sql } from 'drizzle-orm';
import type { RunnerAgent } from '../runner/service';
import { claimedWork, recordAgentUses, subjectOf, type WorkRef } from './delivery';
import { credentialInScope, grantReaches } from './grants';
import type { LoginMethod, LoginRuntime } from './kinds';

// The runtime login ("Laufzeit-Anmeldung") of an agent that runs on Claude Code or Codex:
// the newest runtime_login of the agent's runtime that reaches it through the access
// center's grants (to the agent, or to the project it works in), within its project. The
// runner asks for it before each run and chat answer and hands the value to that one
// command in its environment (packages/runner/src/cli-login.ts); asked without work, it
// only learns whether one is granted, for the agent's health ("Laufzeit nicht angemeldet").

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
  const work = ref
    ? await claimedWork(agent.id, ref)
    : { runId: null, chatMessageId: null, projectId: null };
  const runtime = await agentRuntime(agent.id);
  if (!runtime) return null;
  const subject = subjectOf(agent, work);
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
    .where(
      and(
        eq(integrationCredential.integrationKey, 'runtime_login'),
        eq(integrationCredential.teamId, agent.teamId),
        sql`${integrationCredential.redacted}->>'runtime' = ${runtime}`,
        credentialInScope(subject),
        sql`exists (select 1 from ${integrationCredentialGrant} where ${integrationCredentialGrant.credentialId} = ${integrationCredential.id} and ${grantReaches(subject)})`,
      ),
    )
    .orderBy(desc(integrationCredential.updatedAt), desc(integrationCredential.id))
    .limit(1);
  if (!row) return null;
  const readable = (row.redacted ?? {}) as { method?: string };
  const method: LoginMethod = readable.method === 'api_key' ? 'api_key' : 'oauth_token';
  const login: RuntimeLogin = { credentialId: row.id, runtime, method };
  if (!ref) return login;
  const secrets = JSON.parse(openCredential(row)) as { value?: string };
  await recordAgentUses(agent, work, 'delivered', [
    { credentialId: row.id, label: row.label ?? '', purpose: `runtime:${runtime}` },
  ]);
  return { ...login, value: secrets.value ?? '' };
}
