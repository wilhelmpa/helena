import { createHash } from 'node:crypto';
import { db, aiAgent } from '@repo/db';
import { eq } from 'drizzle-orm';

import { getAgentById, type AgentRuntimeState } from '../core/service';
import { listAgentRuntimeSkills } from '../skills/service';
import { listAgentToolLinks } from '../tools/service';

export async function runtimePolicySnapshot(agentRef: { id: number; teamId: number }) {
  const agent = await getAgentById(agentRef.id, agentRef.teamId);
  if (!agent) throw new Error('Agent not found');
  const [skills, tools] = await Promise.all([
    listAgentRuntimeSkills(agent.id),
    listAgentToolLinks(agent.id),
  ]);
  const snapshot = {
    agent: { id: agent.id, name: agent.name, username: agent.username },
    instructions: agent.instructions,
    model: agent.model,
    memory: { enabled: agent.memoryEnabled, lastMessages: agent.memoryLastMessages },
    runtimePolicy: agent.runtimePolicy,
    projects: agent.projects.map(({ id, key, name, instructions }) => ({
      id,
      key,
      name,
      instructions,
    })),
    skills,
    configuredTools: tools.map(({ id, toolKey, integrationKey }) => ({
      id,
      toolKey,
      integrationKey,
    })),
  };
  // Prefix the digest so API clients consistently keep this as an opaque string.
  // Eden's response parser treats a bare 64-character digest as an encoded value.
  const revision = `sha256:${createHash('sha256').update(JSON.stringify(snapshot)).digest('hex')}`;
  return { revision, ...snapshot };
}

export async function reportRuntimeState(
  agentId: number,
  state: Omit<AgentRuntimeState, 'reportedAt'>,
): Promise<AgentRuntimeState> {
  const value: AgentRuntimeState = { ...state, reportedAt: new Date().toISOString() };
  await db
    .update(aiAgent)
    .set({ runtimeState: value, lastSeenAt: new Date() })
    .where(eq(aiAgent.id, agentId));
  return value;
}
