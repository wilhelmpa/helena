import { aiAgent, db, project, projectMember } from '@repo/db';
import { and, eq, ne, sql } from 'drizzle-orm';
import { deleteAgent } from '../src/modules/agents/core/service';

export interface OrphanAgent {
  id: number;
  teamId: number;
  username: string;
}

export async function findOrphanAgents(): Promise<OrphanAgent[]> {
  return db
    .select({ id: aiAgent.id, teamId: aiAgent.teamId, username: aiAgent.username })
    .from(aiAgent)
    .where(
      and(
        eq(aiAgent.template, false),
        ne(aiAgent.agentRole, 'home'),
        sql`not exists (
          select 1 from ${projectMember}
          inner join ${project} on ${project.id} = ${projectMember.projectId}
          where ${projectMember.userId} = ${aiAgent.userId}
        )`,
      ),
    )
    .orderBy(aiAgent.id);
}

// Re-read each candidate before deletion, so an agent assigned after the listing
// is preserved. Repeating --apply finds nothing once the first pass has succeeded.
export async function cleanupOrphanAgents(apply = false): Promise<{
  found: OrphanAgent[];
  deleted: number[];
}> {
  const found = await findOrphanAgents();
  const deleted: number[] = [];
  if (apply) {
    for (const agent of found) {
      if (!(await findOrphanAgents()).some((candidate) => candidate.id === agent.id)) continue;
      if (await deleteAgent(agent.id, agent.teamId)) deleted.push(agent.id);
    }
  }
  return { found, deleted };
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  if (args.length > 1 || (args.length === 1 && args[0] !== '--apply')) {
    console.error('Usage: bun --env-file=.env apps/api/scripts/cleanup-orphan-agents.ts [--apply]');
    process.exitCode = 2;
  } else {
    const apply = args[0] === '--apply';
    const result = await cleanupOrphanAgents(apply);
    for (const agent of result.found) {
      console.log(
        `${apply && result.deleted.includes(agent.id) ? 'DELETED' : 'FOUND'} ${agent.id} ${agent.username} (team ${agent.teamId})`,
      );
    }
    console.log(
      `${result.found.length} found, ${result.deleted.length} deleted${apply ? '' : ' (dry run)'}`,
    );
    // The shared database pool keeps a standalone Bun process alive otherwise.
    process.exit(0);
  }
}
