import { beforeEach, describe, expect, it } from 'bun:test';
import { mkdir } from 'node:fs/promises';
import { db, project, projectProvisioningJob } from '@repo/db';
import { absoluteVaultPath } from '@repo/vault';
import { and, eq } from 'drizzle-orm';
import { app } from '#tests/helpers/app';
import { signUpTestUser } from '#tests/helpers/auth';
import { resetDb } from '#tests/helpers/db';
import { routeTools } from '#mcp/generate';
import { bootstrapHomeAgent } from '../../../../scripts/bootstrap-home-agent';

interface BlueprintResult {
  teamId: number;
  applied: boolean;
  plan: { changes: { kind: string }[] };
}

async function result(response: Response): Promise<BlueprintResult> {
  return (await response.json()) as BlueprintResult;
}

beforeEach(resetDb);

async function blueprint(
  credential: { cookie?: string; apiKey?: string },
  mode: 'preview' | 'apply',
  blueprintName = 'family',
  teamId?: number,
) {
  return app.handle(
    new Request(`http://localhost/project-blueprints/${mode}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(credential.cookie
          ? { cookie: credential.cookie }
          : { 'x-api-key': credential.apiKey! }),
      },
      body: JSON.stringify({ blueprint: blueprintName, sections: ['project'], teamId }),
    }),
  );
}

async function provisionWhileApplying(applying: Promise<Response>): Promise<Response> {
  let finished = false;
  void applying.then(
    () => {
      finished = true;
    },
    () => {
      finished = true;
    },
  );
  const adapter = (async () => {
    for (let attempt = 0; attempt < 250 && !finished; attempt++) {
      const [created] = await db
        .select({ id: project.id })
        .from(project)
        .where(eq(project.key, 'FAM'));
      if (created) {
        const [job] = await db
          .select({ status: projectProvisioningJob.status })
          .from(projectProvisioningJob)
          .where(eq(projectProvisioningJob.projectId, created.id));
        if (job?.status === 'pending') {
          await mkdir(absoluteVaultPath('Projects/FAM'), { recursive: true });
          await db
            .update(projectProvisioningJob)
            .set({ status: 'succeeded', completedAt: new Date() })
            .where(
              and(
                eq(projectProvisioningJob.projectId, created.id),
                eq(projectProvisioningJob.status, 'pending'),
              ),
            );
        }
      }
      await Bun.sleep(20);
    }
    if (!finished) throw new Error('Blueprint apply did not finish after test provisioning');
  })();
  const [response] = await Promise.all([applying, adapter]);
  return response;
}

describe('project blueprints through MCP routes', () => {
  it('publishes a read preview and a workspace write apply', () => {
    const preview = routeTools(app).find((tool) => tool.name === 'preview_project_blueprint');
    const apply = routeTools(app).find((tool) => tool.name === 'apply_project_blueprint');
    expect(preview).toMatchObject({ category: 'read', annotations: { readOnlyHint: true } });
    expect(apply).toMatchObject({ category: 'write' });
    expect(apply?.scope).toBeUndefined();
  });

  it('previews without writing and applies idempotently for the owner', async () => {
    const owner = await signUpTestUser();
    const first = await blueprint({ cookie: owner.cookie }, 'preview');
    expect(first.status).toBe(200);
    const dry = await result(first);
    expect(dry.applied).toBe(false);
    expect(dry.plan.changes.some((change) => change.kind === 'project')).toBe(true);
    const second = await blueprint({ cookie: owner.cookie }, 'preview');
    expect((await result(second)).plan.changes).toEqual(dry.plan.changes);
    const applied = await provisionWhileApplying(blueprint({ cookie: owner.cookie }, 'apply'));
    expect(applied.status).toBe(200);
    expect((await blueprint({ cookie: owner.cookie }, 'preview')).status).toBe(200);
    expect(
      (await result(await blueprint({ cookie: owner.cookie }, 'preview'))).plan.changes,
    ).toEqual([]);
  });

  it('refuses a user who does not own the target team', async () => {
    const owner = await signUpTestUser();
    const first = await result(await blueprint({ cookie: owner.cookie }, 'preview'));
    const other = await signUpTestUser();
    expect(
      (await blueprint({ cookie: other.cookie }, 'apply', 'family', first.teamId)).status,
    ).toBe(403);
  });

  it('lets Home use its own team and rejects a different team', async () => {
    await signUpTestUser();
    const home = await bootstrapHomeAgent();
    if (home.status !== 'ready') throw new Error('Home agent unavailable');
    const asHome = { apiKey: home.apiKey };
    expect((await blueprint(asHome, 'preview')).status).toBe(200);
    const other = await signUpTestUser();
    const otherTeam = await result(await blueprint({ cookie: other.cookie }, 'preview'));
    expect((await blueprint(asHome, 'apply', 'family', otherTeam.teamId)).status).toBe(403);
  });
});
