import { requeueAllProjectProvisioning } from '#modules/projects/provisioning-queue';
import { db, projectProvisioningJob } from '@repo/db';

// Queues every project's provisioning again, once, after the texts the provisioning writes
// into the workspaces changed (docs/helena-decisions/agent-context.md §1): the host's
// integration service then rewrites each PROJECT.json and the Helena blocks of the
// workspace's and the areas' AGENTS.md, and leaves everything else in them alone. Dry run by
// default; `--apply` queues.
//
//   bun src/scripts/refresh-project-context.ts [--apply]

const apply = process.argv.includes('--apply');
const jobs = await db
  .select({ projectId: projectProvisioningJob.projectId, status: projectProvisioningJob.status })
  .from(projectProvisioningJob);
console.log(`${jobs.length} project(s) with a provisioning job:`);
for (const job of jobs) console.log(`  project ${job.projectId}: ${job.status}`);
if (!apply) {
  console.log('Dry run: nothing queued. Run again with --apply.');
  process.exit(0);
}
const queued = await requeueAllProjectProvisioning();
console.log(`Queued ${queued} provisioning job(s); the worker delivers them within a minute.`);
process.exit(0);
