import { db, projectProvisioningJob } from '@repo/db';
import { inArray, sql } from 'drizzle-orm';

type Executor = Pick<typeof db, 'update'>;

// Queues the provisioning of these projects again, so the host's integration service
// rewrites what it generates for them (the workspace's PROJECT.json and the Helena blocks of
// its AGENTS.md files among it) from what Helena holds now. The new id makes it a new
// request for the service's ledger. A project without a provisioning job has nothing on
// the host to refresh. Returns how many jobs were queued.
export async function requeueProjectProvisioning(
  projectIds: number[],
  executor: Executor = db,
): Promise<number> {
  const ids = [...new Set(projectIds)];
  if (ids.length === 0) return 0;
  const rows = await executor
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
    .where(inArray(projectProvisioningJob.projectId, ids))
    .returning({ projectId: projectProvisioningJob.projectId });
  return rows.length;
}

// Every project's job (there is one per live project), for a one-time refresh after the
// generated texts changed (scripts/refresh-project-context.ts).
export async function requeueAllProjectProvisioning(): Promise<number> {
  const jobs = await db
    .select({ projectId: projectProvisioningJob.projectId })
    .from(projectProvisioningJob);
  return requeueProjectProvisioning(jobs.map((row) => row.projectId));
}
