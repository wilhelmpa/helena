import { randomUUID } from 'node:crypto';
import {
  db,
  project,
  projectDeprovisioningJob,
  projectProvisioningJob,
  projectView,
  projectViewFolder,
} from '@repo/db';
import { and, eq } from 'drizzle-orm';
import { workerConfig } from './config';
import { projectAgentIds } from './project-provisioning';

interface ProvisionedProject {
  project: { id: number; teamId: number; key: string; name: string; description: string };
  requestedResources: string[];
  boards: number[];
  agents: number[];
  // The areas whose folders exist in the workspace and in the vault.
  areas: { id: number; folder: string }[];
  // Null when the project has no browser.
  browserActive: boolean | null;
}

// Compares what the integration service has provisioned with the projects in the
// database and queues the idempotent run that repairs a difference: a project whose
// registry entry, browser units, board folders, area folders or agent runtimes do not
// match is provisioned again, and a registry entry without a project is deprovisioned.
// Pending and failed jobs are left to their own retries and to the retry routes.
export async function reconcileProjectProvisioning(): Promise<void> {
  const config = workerConfig();
  if (!config.projectProvisioningUrl || !config.projectProvisioningToken) return;
  // Read before the database: a project created in between then counts as not yet
  // provisioned instead of a registry entry without a project.
  const provisioned = await readProvisionedProjects(
    `${config.projectProvisioningUrl.replace(/\/+$/, '')}/state`,
    config.projectProvisioningToken,
  );
  const [projects, jobs, views, areas, agents] = await Promise.all([
    db.select({ id: project.id }).from(project),
    db
      .select({
        projectId: projectProvisioningJob.projectId,
        status: projectProvisioningJob.status,
        requestedResources: projectProvisioningJob.requestedResources,
      })
      .from(projectProvisioningJob),
    db.select({ id: projectView.id, projectId: projectView.projectId }).from(projectView),
    db
      .select({
        id: projectViewFolder.id,
        projectId: projectViewFolder.projectId,
        folder: projectViewFolder.folder,
      })
      .from(projectViewFolder),
    projectAgentIds(),
  ]);
  const byProject = new Map(provisioned.map((entry) => [entry.project.id, entry]));
  const liveViews = new Set(views.map((view) => `${view.projectId}:${view.id}`));
  const areaFolders = new Map<number, string[]>();
  for (const area of areas) {
    areaFolders.set(area.projectId, [
      ...(areaFolders.get(area.projectId) ?? []),
      `${area.id}:${area.folder}`,
    ]);
  }

  for (const job of jobs) {
    if (job.status !== 'succeeded') continue;
    const requested = boardIds(job.requestedResources);
    const boards = requested.filter((id) => liveViews.has(`${job.projectId}:${id}`));
    const entry = byProject.get(job.projectId);
    if (
      entry &&
      entry.browserActive !== false &&
      boards.length === requested.length &&
      sameMembers(entry.boards, boards) &&
      sameMembers(entry.agents, agents.get(job.projectId) ?? []) &&
      sameMembers(
        entry.areas.map((area) => `${area.id}:${area.folder}`),
        areaFolders.get(job.projectId) ?? [],
      )
    ) {
      continue;
    }
    await requeueProvisioning(job.projectId, [
      ...job.requestedResources.filter((resource) => !resource.startsWith('board:')),
      ...boards.map((id) => `board:${id}`),
    ]);
  }

  const projectIds = new Set(projects.map((row) => row.id));
  for (const entry of provisioned) {
    if (!projectIds.has(entry.project.id)) await requeueDeprovisioning(entry);
  }
}

async function readProvisionedProjects(url: string, token: string): Promise<ProvisionedProject[]> {
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`provisioning state returned HTTP ${response.status}`);
  const body = (await response.json()) as { projects?: unknown };
  if (!Array.isArray(body.projects)) throw new Error('provisioning state is invalid');
  return body.projects.flatMap((value): ProvisionedProject[] => {
    const entry = value as Partial<ProvisionedProject> | null;
    const target = entry?.project;
    if (
      !target ||
      !Number.isSafeInteger(target.id) ||
      !Number.isSafeInteger(target.teamId) ||
      typeof target.key !== 'string' ||
      typeof target.name !== 'string'
    ) {
      return [];
    }
    return [
      {
        project: {
          id: target.id,
          teamId: target.teamId,
          key: target.key,
          name: target.name,
          description: typeof target.description === 'string' ? target.description : '',
        },
        requestedResources: Array.isArray(entry.requestedResources)
          ? entry.requestedResources.filter((item): item is string => typeof item === 'string')
          : [],
        boards: Array.isArray(entry.boards) ? entry.boards.filter(Number.isSafeInteger) : [],
        agents: Array.isArray(entry.agents) ? entry.agents.filter(Number.isSafeInteger) : [],
        areas: Array.isArray(entry.areas)
          ? entry.areas.filter(
              (area) => Number.isSafeInteger(area?.id) && typeof area?.folder === 'string',
            )
          : [],
        browserActive: typeof entry.browserActive === 'boolean' ? entry.browserActive : null,
      },
    ];
  });
}

function boardIds(resources: readonly string[]): number[] {
  return resources.flatMap((resource) => {
    const match = /^board:([1-9][0-9]{0,9})$/.exec(resource);
    return match ? [Number(match[1])] : [];
  });
}

function sameMembers<T>(left: readonly T[], right: readonly T[]): boolean {
  const expected = new Set(right);
  return left.length === expected.size && left.every((member) => expected.has(member));
}

// The integration service answers a known event id from its ledger, so a new run
// needs a new id.
async function requeueProvisioning(projectId: number, requestedResources: string[]) {
  const [row] = await db
    .update(projectProvisioningJob)
    .set({
      id: randomUUID(),
      requestedResources,
      status: 'pending',
      attempts: 0,
      nextAttemptAt: new Date(),
      lastError: null,
      result: null,
      completedAt: null,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(projectProvisioningJob.projectId, projectId),
        eq(projectProvisioningJob.status, 'succeeded'),
      ),
    )
    .returning({ projectId: projectProvisioningJob.projectId });
  if (row) console.log(`[worker] provisioning project ${projectId} again to repair drift`);
}

async function requeueDeprovisioning(entry: ProvisionedProject) {
  const [row] = await db
    .insert(projectDeprovisioningJob)
    .values({
      projectId: entry.project.id,
      project: entry.project,
      requestedResources: entry.requestedResources,
    })
    .onConflictDoUpdate({
      target: projectDeprovisioningJob.projectId,
      set: {
        id: randomUUID(),
        status: 'pending',
        attempts: 0,
        nextAttemptAt: new Date(),
        lastError: null,
        result: null,
        completedAt: null,
        updatedAt: new Date(),
      },
      setWhere: eq(projectDeprovisioningJob.status, 'succeeded'),
    })
    .returning({ projectId: projectDeprovisioningJob.projectId });
  if (row) console.log(`[worker] deprovisioning deleted project ${entry.project.id}`);
}
