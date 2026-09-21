import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import {
  db,
  project,
  projectProvisioningJob,
  projectView,
  projectViewFolder,
  team,
} from '@repo/db';
import { eq } from 'drizzle-orm';
import { processProjectProvisioning } from '../../project-provisioning';
import { resetWorkerConfigForTests } from '../../config';

let server: ReturnType<typeof Bun.serve> | null = null;

beforeEach(async () => {
  resetWorkerConfigForTests();
  await db.delete(team);
});

afterEach(() => {
  server?.stop(true);
  server = null;
});

describe('project provisioning', () => {
  it('includes bounded project-owned board metadata for requested view ids', async () => {
    let receivedBody: { boards?: unknown } = {};
    server = Bun.serve({
      port: 0,
      fetch: async (incoming) => {
        receivedBody = (await incoming.json()) as { boards?: unknown };
        return Response.json({ resources: [] });
      },
    });
    process.env.OPENCLAW_PROVISIONING_URL = `http://127.0.0.1:${server.port}/api/provision`;
    process.env.OPENCLAW_PROVISIONING_TOKEN = 'integration-test-token';
    const [owner] = await db.insert(team).values({ name: 'Board provisioning' }).returning();
    const [created] = await db
      .insert(project)
      .values({ teamId: owner.id, key: `BRD${owner.id}`, name: 'Boards' })
      .returning();
    const [folder] = await db
      .insert(projectViewFolder)
      .values({ projectId: created.id, name: 'Leadership & Ops' })
      .returning();
    const [view] = await db
      .insert(projectView)
      .values({ projectId: created.id, folderId: folder.id, name: 'Risks / Q4' })
      .returning();
    await db.insert(projectProvisioningJob).values({
      projectId: created.id,
      requestedResources: [`board:${view.id}`, 'board:9999999999'],
    });

    await processProjectProvisioning();

    expect(receivedBody.boards).toEqual([
      {
        resource: `board:${view.id}`,
        id: view.id,
        name: 'Risks / Q4',
        slug: 'risks-q4',
        folder: { id: folder.id, name: 'Leadership & Ops', slug: 'leadership-ops' },
      },
    ]);
  });

  it('delivers the stable authenticated envelope and stores only allowed result fields', async () => {
    let receivedHeaders: Record<string, string> | null = null;
    let receivedBody: unknown = null;
    let boardId = 0;
    server = Bun.serve({
      port: 0,
      fetch: async (incoming) => {
        receivedHeaders = Object.fromEntries(incoming.headers.entries());
        receivedBody = await incoming.json();
        return Response.json({
          resources: [
            {
              kind: 'workspace',
              id: 'ws-1',
              url: 'https://code.volition.one/?folder=/projects/verve&token=must-not-be-stored',
            },
            {
              kind: 'files',
              id: 'files-1',
              url: 'https://cloud.volition.one/apps/files/?dir=/Projects/verve#private',
            },
            {
              kind: 'terminal',
              id: 'terminal-project:verve',
              url: 'https://openclaw.volition.one/focus/terminal-project/?arg=verve&token=must-not-be-stored',
            },
            {
              kind: `board:${boardId}`,
              id: `/projects/verve/boards/board-${boardId}`,
              url: `https://code.volition.one/?folder=/projects/verve/boards/board-${boardId}&token=must-not-be-stored`,
            },
            {
              kind: `board:${boardId}:files`,
              id: `/Projects/verve/Boards/board-${boardId}`,
              url: `https://cloud.volition.one/apps/files/files?dir=/Projects/verve/Boards/board-${boardId}&share=must-not-be-stored#private`,
            },
            {
              kind: `board:${boardId + 1}:files`,
              id: 'not-requested',
              url: `https://cloud.volition.one/apps/files/files?dir=/Projects/verve/Boards/board-${boardId + 1}`,
            },
            { kind: 'files', id: 'files-2', url: 'javascript:alert(1)' },
            { kind: 'secret', id: 'must-not-be-stored', url: 'https://example.com/secret' },
          ],
          warnings: ['Browser profile pending'],
          secret: 'must-not-be-stored',
        });
      },
    });
    process.env.OPENCLAW_PROVISIONING_URL = `http://127.0.0.1:${server.port}/api/provision`;
    process.env.OPENCLAW_PROVISIONING_TOKEN = 'integration-test-token';

    const [owner] = await db.insert(team).values({ name: 'Provisioning test' }).returning();
    const [created] = await db
      .insert(project)
      .values({ teamId: owner.id, key: `PRV${owner.id}`, name: 'Provision me' })
      .returning();
    const [view] = await db
      .insert(projectView)
      .values({ projectId: created.id, name: 'Board' })
      .returning();
    boardId = view.id;
    const [job] = await db
      .insert(projectProvisioningJob)
      .values({
        projectId: created.id,
        requestedResources: ['workspace', 'files', 'terminal', `board:${view.id}`],
      })
      .returning();

    await processProjectProvisioning();

    expect(receivedHeaders).not.toBeNull();
    expect(receivedHeaders!.authorization).toBe('Bearer integration-test-token');
    expect(receivedHeaders!['idempotency-key']).toBe(job.id);
    expect(receivedHeaders!['x-itsaplan-event']).toBe('project.provision');
    expect(receivedBody).toMatchObject({
      eventId: job.id,
      eventType: 'project.provision',
      project: { id: created.id, key: created.key, teamId: owner.id },
      requestedResources: ['workspace', 'files', 'terminal', `board:${view.id}`],
    });

    const [stored] = await db
      .select()
      .from(projectProvisioningJob)
      .where(eq(projectProvisioningJob.id, job.id));
    expect(stored).toMatchObject({
      status: 'succeeded',
      attempts: 1,
      lastError: null,
      result: {
        resources: [
          {
            kind: 'workspace',
            id: 'ws-1',
            url: 'https://code.volition.one/?folder=%2Fprojects%2Fverve',
          },
          {
            kind: 'files',
            id: 'files-1',
            url: 'https://cloud.volition.one/apps/files/?dir=%2FProjects%2Fverve',
          },
          {
            kind: 'terminal',
            id: 'terminal-project:verve',
            url: 'https://openclaw.volition.one/focus/terminal-project/?arg=verve',
          },
          {
            kind: `board:${view.id}`,
            id: `/projects/verve/boards/board-${view.id}`,
            url: `https://code.volition.one/?folder=%2Fprojects%2Fverve%2Fboards%2Fboard-${view.id}`,
          },
          {
            kind: `board:${view.id}:files`,
            id: `/Projects/verve/Boards/board-${view.id}`,
            url: `https://cloud.volition.one/apps/files/files?dir=%2FProjects%2Fverve%2FBoards%2Fboard-${view.id}`,
          },
          { kind: 'files', id: 'files-2' },
        ],
        warnings: ['Browser profile pending'],
      },
    });
  });

  it('rejects oversized integration responses without persisting their contents', async () => {
    server = Bun.serve({
      port: 0,
      fetch: () => new Response(JSON.stringify({ resources: [], secret: 'x'.repeat(300_000) })),
    });
    process.env.OPENCLAW_PROVISIONING_URL = `http://127.0.0.1:${server.port}/api/provision`;
    process.env.OPENCLAW_PROVISIONING_TOKEN = 'integration-test-token';

    const [owner] = await db.insert(team).values({ name: 'Provisioning test' }).returning();
    const [created] = await db
      .insert(project)
      .values({ teamId: owner.id, key: `BIG${owner.id}`, name: 'Large response' })
      .returning();
    const [job] = await db
      .insert(projectProvisioningJob)
      .values({ projectId: created.id, requestedResources: ['workspace'] })
      .returning();

    await processProjectProvisioning();

    const [stored] = await db
      .select()
      .from(projectProvisioningJob)
      .where(eq(projectProvisioningJob.id, job.id));
    expect(stored).toMatchObject({
      status: 'pending',
      attempts: 1,
      lastError: 'Response too large',
      result: null,
    });
  });

  it('does not let a stale leased response overwrite a retried job', async () => {
    let jobId = '';
    server = Bun.serve({
      port: 0,
      fetch: async () => {
        await db
          .update(projectProvisioningJob)
          .set({ attempts: 0, updatedAt: new Date(Date.now() + 1000) })
          .where(eq(projectProvisioningJob.id, jobId));
        return Response.json({ resources: [{ kind: 'workspace', id: 'stale' }] });
      },
    });
    process.env.OPENCLAW_PROVISIONING_URL = `http://127.0.0.1:${server.port}/api/provision`;
    process.env.OPENCLAW_PROVISIONING_TOKEN = 'integration-test-token';

    const [owner] = await db.insert(team).values({ name: 'Provisioning test' }).returning();
    const [created] = await db
      .insert(project)
      .values({ teamId: owner.id, key: `CAS${owner.id}`, name: 'Lease race' })
      .returning();
    const [job] = await db
      .insert(projectProvisioningJob)
      .values({ projectId: created.id, requestedResources: ['workspace'] })
      .returning();
    jobId = job.id;

    await processProjectProvisioning();

    const [stored] = await db
      .select()
      .from(projectProvisioningJob)
      .where(eq(projectProvisioningJob.id, job.id));
    expect(stored).toMatchObject({ status: 'pending', attempts: 0, result: null });
  });
});
