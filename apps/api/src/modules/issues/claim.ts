import { agentRun, aiAgent, db, issueWorkClaim, user } from '@repo/db';
import { and, eq, gt } from 'drizzle-orm';

export interface IssueClaim {
  agent: { id: number; name: string; username: string };
  runId: number;
  since: string;
  expiresAt: string;
}

// Who works on a task right now (owner, 28.09.: "bearbeitet von …" in the task detail): the
// agent whose run holds the task's work lease (issue_work_claim, shared by heartbeats,
// routines and delegated runs), since when. Null while no live lease is held — an expired
// one is free for the next run.
export async function issueClaim(issueId: number): Promise<IssueClaim | null> {
  const [row] = await db
    .select({
      runId: issueWorkClaim.runId,
      expiresAt: issueWorkClaim.expiresAt,
      startedAt: agentRun.startedAt,
      createdAt: agentRun.createdAt,
      agentId: aiAgent.id,
      username: aiAgent.username,
      name: user.name,
    })
    .from(issueWorkClaim)
    .innerJoin(agentRun, eq(agentRun.id, issueWorkClaim.runId))
    .innerJoin(aiAgent, eq(aiAgent.id, agentRun.agentId))
    .innerJoin(user, eq(user.id, aiAgent.userId))
    .where(and(eq(issueWorkClaim.issueId, issueId), gt(issueWorkClaim.expiresAt, new Date())));
  if (!row) return null;
  return {
    agent: { id: row.agentId, name: row.name, username: row.username },
    runId: row.runId,
    since: (row.startedAt ?? row.createdAt).toISOString(),
    expiresAt: row.expiresAt.toISOString(),
  };
}
