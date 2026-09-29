import { lstat } from 'node:fs/promises';
import { getDisplayName } from '@repo/db';
import { setTimeout as sleep } from 'node:timers/promises';
import { absoluteVaultPath, assertNoSymlink, projectFolder } from '@repo/vault';
import { getProvisioningJob } from '#modules/projects/service';

// The native provisioner owns the project root and grants the runner its ACLs. Creating
// that root as the API user first makes the launcher correctly refuse its foreign owner.
// Always inspect the current job: area/agent changes replace an earlier successful job.
export async function waitForBlueprintProvisioning(
  projectId: number,
  key: string,
  log: (line: string) => void,
  timeoutMs = 300_000,
  signal?: AbortSignal,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let waiting = false;
  while (true) {
    signal?.throwIfAborted();
    const job = await getProvisioningJob(projectId);
    if (!job || job.status === 'failed') {
      throw new Error(
        `Project ${key} provisioning ${job ? 'failed' : 'is missing'}. ` +
          `Resolve its setup status in ${await getDisplayName()}, then rerun the blueprint; existing changes are preserved.`,
      );
    }
    if (job.status === 'succeeded') break;
    if (!waiting) {
      log(`[WAIT] Project ${key}: waiting for project resources and runner descriptors.`);
      waiting = true;
    }
    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      throw new Error(
        `Project ${key} provisioning is still pending. Check the worker and project setup ` +
          `in ${await getDisplayName()}, then rerun the blueprint; no project root was created by the blueprint.`,
      );
    }
    await sleep(Math.min(500, remaining), undefined, { signal });
  }
  const root = projectFolder(key);
  await assertNoSymlink(root);
  const info = await lstat(absoluteVaultPath(root)).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return null;
    throw error;
  });
  if (!info?.isDirectory()) {
    throw new Error(
      `Project ${key} provisioning completed without its vault directory. Repair project setup before rerunning the blueprint.`,
    );
  }
}
