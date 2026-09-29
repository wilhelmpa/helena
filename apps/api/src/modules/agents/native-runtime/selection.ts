import { createHash } from 'node:crypto';
import {
  aiAgent,
  agentRun,
  agentChatMessage,
  db,
  projectMember,
  projectProvisioningJob,
} from '@repo/db';
import { and, eq, inArray, sql } from 'drizzle-orm';
import type { TeamMembership } from '#shared/access';
import { HttpError } from '#shared/lib';
import { agentForPerson } from '../people-access';
import { nativeRuntimeEnabled, type AgentRuntimePolicy } from '../core/service';

type Runtime = 'helena' | 'hermes' | 'claude' | 'codex';

export async function selectRuntimes(
  membership: TeamMembership,
  input: {
    agentIds: number[];
    runtime: Runtime;
    apply?: boolean;
    revision?: string;
  },
) {
  const ids = [...new Set(input.agentIds)].sort((a, b) => a - b);
  if (input.runtime === 'helena' && !nativeRuntimeEnabled())
    throw new HttpError(409, 'Native runtime is disabled');
  for (const id of ids) await agentForPerson(id, membership);
  return db.transaction(async (tx) => {
    // Cutover requires drained work; prevent a new claim or message between the check and commit.
    if (input.apply)
      await tx.execute(sql`LOCK TABLE agent_run, agent_chat_message IN SHARE ROW EXCLUSIVE MODE`);
    const agents = await tx
      .select()
      .from(aiAgent)
      .where(and(eq(aiAgent.teamId, membership.teamId), inArray(aiAgent.id, ids)))
      .orderBy(aiAgent.id)
      .for('update');
    if (agents.length !== ids.length) throw new HttpError(404, 'Agent not found');
    if (agents.some((agent) => agent.kind !== 'external'))
      throw new HttpError(409, 'Only external agents have a selectable runtime');
    const rollback = agents.map((agent) => ({
      agentId: agent.id,
      model: agent.model,
      runtimePolicy: agent.runtimePolicy,
    }));
    const revision = createHash('sha256').update(JSON.stringify(rollback)).digest('hex');
    const runs = await tx
      .select({ id: agentRun.agentId })
      .from(agentRun)
      .where(and(inArray(agentRun.agentId, ids), eq(agentRun.status, 'pending')));
    const chats = await tx
      .select({ id: agentChatMessage.agentId })
      .from(agentChatMessage)
      .where(
        and(
          inArray(agentChatMessage.agentId, ids),
          inArray(agentChatMessage.status, ['pending', 'streaming']),
        ),
      );
    const busyAgentIds = [
      ...new Set(
        [...runs, ...chats].map((row) => row.id).filter((id): id is number => id !== null),
      ),
    ];
    if (input.apply) {
      if (input.revision !== revision)
        throw new HttpError(409, 'Selection changed; repeat the dry run');
      if (busyAgentIds.length)
        throw new HttpError(409, 'Drain pending runs and chats before changing runtimes');
      for (const agent of agents)
        await tx
          .update(aiAgent)
          .set({
            runtimePolicy: {
              ...(agent.runtimePolicy as AgentRuntimePolicy),
              runtime: input.runtime,
            },
          })
          .where(eq(aiAgent.id, agent.id));
      const projects = await tx
        .select({ id: projectMember.projectId })
        .from(projectMember)
        .where(
          inArray(
            projectMember.userId,
            agents.map((agent) => agent.userId),
          ),
        );
      const projectIds = [...new Set(projects.map((project) => project.id))];
      if (projectIds.length)
        await tx
          .update(projectProvisioningJob)
          .set({
            id: sql`gen_random_uuid()`,
            status: 'pending',
            attempts: 0,
            nextAttemptAt: new Date(),
            lastError: null,
            result: null,
            completedAt: null,
            updatedAt: new Date(),
          })
          .where(inArray(projectProvisioningJob.projectId, projectIds));
    }
    return {
      applied: input.apply === true,
      revision,
      runtime: input.runtime,
      agentIds: ids,
      busyAgentIds,
      rollback,
    };
  });
}
