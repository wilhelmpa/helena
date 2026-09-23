import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import {
  db,
  project,
  projectDeprovisioningJob,
  projectProvisioningJob,
  projectView,
  projectViewFolder,
  team,
} from '@repo/db';
import { eq } from 'drizzle-orm';
import { resetWorkerConfigForTests } from '../../config';
import { pruneFinishedDeprovisioningJobs } from '../../project-provisioning';
import { reconcileProjectProvisioning } from '../../project-reconciliation';
import { insertAgent } from '../helpers/agents';

let server: ReturnType<typeof Bun.serve> | null = null;
let teamId = 0;

beforeEach(async () => {
  resetWorkerConfigForTests();
  await db.delete(projectDeprovisioningJob);
  await db.delete(team);
  const [owner] = await db.insert(team).values({ name: 'Reconciliation' }).returning();
  teamId = owner.id;
});

afterEach(() => {
  server?.stop(true);
  server = null;
});

function serveState(projects: unknown[]) {
  server = Bun.serve({
    port: 0,
    fetch: (incoming) => {
      if (incoming.headers.get('authorization') !== 'Bearer integration-test-token') {
        return new Response(null, { status: 401 });
      }
      return new URL(incoming.url).pathname === '/api/provision/state'
        ? Response.json({ projects })
        : new Response(null, { status: 404 });
    },
  });
  process.env.PROJECT_PROVISIONING_URL = `http://127.0.0.1:${server.port}/api/provision`;
  process.env.PROJECT_PROVISIONING_TOKEN = 'integration-test-token';
}

// A project whose provisioning job has succeeded for its two boards.
async function provisionedProject(key: string, status = 'succeeded') {
  const [created] = await db
    .insert(project)
    .values({ teamId, key: `${key}${teamId}`, name: key })
    .returning();
  const views = await db
    .insert(projectView)
    .values([
      { projectId: created.id, name: 'Kanban' },
      { projectId: created.id, name: 'List' },
    ])
    .returning();
  const [job] = await db
    .insert(projectProvisioningJob)
    .values({
      projectId: created.id,
      requestedResources: ['workspace', 'browser', ...views.map((view) => `board:${view.id}`)],
      status,
      completedAt: new Date(),
    })
    .returning();
  const entry = {
    project: { id: created.id, teamId, key: created.key, name: key, description: '' },
    requestedResources: job.requestedResources,
    boards: views.map((view) => view.id),
    agents: [] as number[],
    browserActive: true,
  };
  return { id: created.id, views, job, entry };
}

async function jobOf(projectId: number) {
  const [job] = await db
    .select()
    .from(projectProvisioningJob)
    .where(eq(projectProvisioningJob.projectId, projectId));
  return job;
}

describe('project reconciliation', () => {
  it('provisions a project again when its registry entry, browser or boards drifted', async () => {
    const intact = await provisionedProject('OK');
    const unregistered = await provisionedProject('GONE');
    const stopped = await provisionedProject('STOP');
    const deletedBoard = await provisionedProject('BRD');
    const failed = await provisionedProject('FAIL', 'failed');
    await db.delete(projectView).where(eq(projectView.id, deletedBoard.views[1].id));
    serveState([
      intact.entry,
      { ...stopped.entry, browserActive: false },
      deletedBoard.entry,
      { ...failed.entry, browserActive: false },
    ]);

    await reconcileProjectProvisioning();

    expect(await jobOf(intact.id)).toMatchObject({ id: intact.job.id, status: 'succeeded' });
    expect(await jobOf(failed.id)).toMatchObject({ id: failed.job.id, status: 'failed' });
    for (const drifted of [unregistered, stopped]) {
      const job = await jobOf(drifted.id);
      expect(job).toMatchObject({ status: 'pending', attempts: 0, completedAt: null });
      expect(job.id).not.toBe(drifted.job.id);
      expect(job.requestedResources).toEqual(drifted.job.requestedResources);
    }
    expect((await jobOf(deletedBoard.id)).requestedResources).toEqual([
      'workspace',
      'browser',
      `board:${deletedBoard.views[0].id}`,
    ]);
  });

  it('provisions a project again when its agent runtimes drifted', async () => {
    const intact = await provisionedProject('RUN');
    const joined = await provisionedProject('JOIN');
    const left = await provisionedProject('LEFT');
    const agentId = await insertAgent(teamId, 'coder', [intact.id]);
    await insertAgent(teamId, 'writer', [joined.id]);
    serveState([
      { ...intact.entry, agents: [agentId] },
      joined.entry,
      { ...left.entry, agents: [agentId + 100] },
    ]);

    await reconcileProjectProvisioning();

    expect(await jobOf(intact.id)).toMatchObject({ id: intact.job.id, status: 'succeeded' });
    for (const drifted of [joined, left]) {
      const job = await jobOf(drifted.id);
      expect(job).toMatchObject({ status: 'pending', attempts: 0 });
      expect(job.id).not.toBe(drifted.job.id);
    }
  });

  it('provisions a project again when its area folders drifted', async () => {
    const intact = await provisionedProject('AREA');
    const missing = await provisionedProject('MISS');
    const moved = await provisionedProject('MOVE');
    const removed = await provisionedProject('DROP');
    const areas = await db
      .insert(projectViewFolder)
      .values([
        { projectId: intact.id, name: 'Backend', folder: 'backend' },
        { projectId: missing.id, name: 'Backend', folder: 'backend' },
        { projectId: moved.id, name: 'Backend', folder: 'server' },
      ])
      .returning();
    const folder = (index: number, name = areas[index].folder) => ({
      id: areas[index].id,
      folder: name,
    });
    serveState([
      { ...intact.entry, areas: [folder(0)] },
      missing.entry,
      { ...moved.entry, areas: [folder(2, 'backend')] },
      { ...removed.entry, areas: [{ id: areas[2].id + 100, folder: 'old' }] },
    ]);

    await reconcileProjectProvisioning();

    expect(await jobOf(intact.id)).toMatchObject({ id: intact.job.id, status: 'succeeded' });
    for (const drifted of [missing, moved, removed]) {
      const job = await jobOf(drifted.id);
      expect(job).toMatchObject({ status: 'pending', attempts: 0 });
      expect(job.id).not.toBe(drifted.job.id);
    }
  });

  it('deprovisions a registry entry whose project no longer exists', async () => {
    const orphan = {
      project: { id: 900_001, teamId, key: 'OLD', name: 'Old', description: '' },
      requestedResources: ['workspace'],
      boards: [],
      browserActive: null,
    };
    const cleanedBefore = { ...orphan, project: { ...orphan.project, id: 900_002 } };
    const inProgress = { ...orphan, project: { ...orphan.project, id: 900_003 } };
    const [succeeded] = await db
      .insert(projectDeprovisioningJob)
      .values({ projectId: 900_002, project: cleanedBefore.project, status: 'succeeded' })
      .returning();
    const [pending] = await db
      .insert(projectDeprovisioningJob)
      .values({ projectId: 900_003, project: inProgress.project })
      .returning();
    serveState([orphan, cleanedBefore, inProgress]);

    await reconcileProjectProvisioning();

    const jobs = await db.select().from(projectDeprovisioningJob);
    const byProject = new Map(jobs.map((job) => [job.projectId, job]));
    expect(byProject.get(900_001)).toMatchObject({
      status: 'pending',
      project: orphan.project,
      requestedResources: ['workspace'],
    });
    expect(byProject.get(900_002)).toMatchObject({ status: 'pending', attempts: 0 });
    expect(byProject.get(900_002)?.id).not.toBe(succeeded.id);
    expect(byProject.get(900_003)?.id).toBe(pending.id);
  });

  it('changes nothing when the integration service cannot be read', async () => {
    const drifted = await provisionedProject('DOWN');
    server = Bun.serve({ port: 0, fetch: () => new Response(null, { status: 500 }) });
    process.env.PROJECT_PROVISIONING_URL = `http://127.0.0.1:${server.port}/api/provision`;
    process.env.PROJECT_PROVISIONING_TOKEN = 'integration-test-token';

    await expect(reconcileProjectProvisioning()).rejects.toThrow('HTTP 500');
    expect(await jobOf(drifted.id)).toMatchObject({ id: drifted.job.id, status: 'succeeded' });
  });
});

describe('deprovisioning job pruning', () => {
  it('removes finished cleanups older than 30 days and keeps the rest', async () => {
    const identity = { id: 1, teamId, key: 'OLD', name: 'Old', description: '' };
    const day = 24 * 60 * 60 * 1000;
    await db.insert(projectDeprovisioningJob).values([
      {
        projectId: 910_001,
        project: identity,
        status: 'succeeded',
        completedAt: new Date(Date.now() - 31 * day),
      },
      {
        projectId: 910_002,
        project: identity,
        status: 'succeeded',
        completedAt: new Date(Date.now() - 29 * day),
      },
      {
        projectId: 910_003,
        project: identity,
        status: 'failed',
        completedAt: new Date(Date.now() - 31 * day),
      },
    ]);

    expect(await pruneFinishedDeprovisioningJobs()).toBe(1);
    const left = await db
      .select({ projectId: projectDeprovisioningJob.projectId })
      .from(projectDeprovisioningJob);
    expect(left.map((row) => row.projectId).sort()).toEqual([910_002, 910_003]);
  });
});
