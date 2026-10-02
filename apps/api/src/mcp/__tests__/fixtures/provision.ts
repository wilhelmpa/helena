import { mkdir } from 'node:fs/promises';
import { db, project, projectProvisioningJob } from '@repo/db';
import { absoluteVaultPath } from '@repo/vault';
import { and, eq } from 'drizzle-orm';

// The private stack has no provisioning worker. Complete its synthetic job, as the
// blueprint integration fixtures do, without creating a host stack or runner.
export async function provisionBlueprint<T>(work: Promise<T>): Promise<T> {
  let finished = false;
  void work
    .finally(() => {
      finished = true;
    })
    .catch(() => {});
  const worker = (async () => {
    for (let attempt = 0; attempt < 250 && !finished; attempt++) {
      const jobs = await db
        .select({ id: projectProvisioningJob.id, key: project.key })
        .from(projectProvisioningJob)
        .innerJoin(project, eq(project.id, projectProvisioningJob.projectId))
        .where(and(eq(project.key, 'FAM'), eq(projectProvisioningJob.status, 'pending')));
      for (const job of jobs) {
        await mkdir(absoluteVaultPath(`Projects/${job.key}`), { recursive: true });
        await db
          .update(projectProvisioningJob)
          .set({ status: 'succeeded', completedAt: new Date() })
          .where(eq(projectProvisioningJob.id, job.id));
      }
      await Bun.sleep(20);
    }
    if (!finished) throw new Error('ABSCHLUSSTEST blueprint provisioner did not finish');
  })();
  const [result] = await Promise.all([work, worker]);
  return result;
}
