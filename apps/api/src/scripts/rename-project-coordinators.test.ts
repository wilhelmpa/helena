import { beforeEach, describe, expect, it } from 'bun:test';
import {
  aiAgent,
  apikey,
  db,
  helenaSchedule,
  project,
  projectProvisioningJob,
  user,
} from '@repo/db';
import { eq, sql } from 'drizzle-orm';
import { authedApi } from '#tests/helpers/app';
import { signUpTestUser } from '#tests/helpers/auth';
import { resetDb } from '#tests/helpers/db';
import { renameProjectCoordinators } from './rename-project-coordinators';

describe('project coordinator rename', () => {
  beforeEach(resetDb);

  it('previews, applies, and repeats without changing agent identity or losing mentions', async () => {
    const owner = await signUpTestUser();
    const api = authedApi(owner.cookie);
    const created = await api.projects.post({ key: 'MKT', name: 'Marketing' });
    expect(created.status).toBe(201);
    const projectId = created.data!.id;
    const [agent] = await db.select().from(aiAgent).where(eq(aiAgent.username, 'mkt-koordinator'));
    expect(agent).toBeDefined();
    const old = 'hermes-mkt-coordinator';
    const mention = `Ask @${old} today; @${old}-extra stays`;
    await db
      .update(aiAgent)
      .set({
        username: old,
        instructions: mention,
        heartbeatInstructions: mention,
        runtimePolicy: { files: [{ path: 'SOUL.md', content: mention }] },
      })
      .where(eq(aiAgent.id, agent!.id));
    await db.update(user).set({ name: 'Hermes-Koordinator MKT' }).where(eq(user.id, agent!.userId));
    await db.insert(apikey).values({
      id: crypto.randomUUID(),
      referenceId: agent!.userId,
      key: crypto.randomUUID(),
      name: 'agent:Hermes-Koordinator MKT',
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await db.update(project).set({ description: mention }).where(eq(project.id, projectId));
    await db.insert(helenaSchedule).values({
      id: 'rename-test',
      projectId,
      kind: 'routine',
      title: 'Review',
      agentId: agent!.id,
      instructions: mention,
      cron: '0 9 * * *',
    });
    await db
      .update(projectProvisioningJob)
      .set({ status: 'succeeded' })
      .where(eq(projectProvisioningJob.projectId, projectId));

    const lines: string[] = [];
    const dryRun = await renameProjectCoordinators({ log: (line) => lines.push(line) });
    expect(dryRun.coordinators).toBe(1);
    expect(dryRun.displayNames).toBe(1);
    expect(dryRun.keyLabels).toBe(1);
    expect(lines.join('\n')).toContain('ai_agent.instructions');
    expect((await db.select().from(aiAgent).where(eq(aiAgent.id, agent!.id)))[0]?.username).toBe(
      old,
    );

    const applied = await renameProjectCoordinators({ apply: true, log: () => {} });
    expect(applied.coordinators).toBe(1);
    const [renamed] = await db.select().from(aiAgent).where(eq(aiAgent.id, agent!.id));
    expect(renamed!.userId).toBe(agent!.userId);
    expect(renamed!.username).toBe('mkt-koordinator');
    expect(renamed!.instructions).toBe(
      'Ask @mkt-koordinator today; @hermes-mkt-coordinator-extra stays',
    );
    expect(renamed!.heartbeatInstructions).toBe(renamed!.instructions!);
    expect(JSON.stringify(renamed!.runtimePolicy)).toContain('@mkt-koordinator');
    expect((await db.select().from(user).where(eq(user.id, agent!.userId)))[0]?.name).toBe(
      'Koordinator MKT',
    );
    expect(
      (await db.select().from(apikey).where(eq(apikey.referenceId, agent!.userId)))[0]?.name,
    ).toBe('agent:Koordinator MKT');
    expect(
      (await db.select().from(project).where(eq(project.id, projectId)))[0]?.description,
    ).toContain('@mkt-koordinator');
    expect(
      (await db.select().from(helenaSchedule).where(eq(helenaSchedule.id, 'rename-test')))[0]
        ?.instructions,
    ).toContain('@mkt-koordinator');
    expect(
      (
        await db
          .select()
          .from(projectProvisioningJob)
          .where(eq(projectProvisioningJob.projectId, projectId))
      )[0]?.status,
    ).toBe('pending');
    expect(await renameProjectCoordinators({ apply: true, log: () => {} })).toEqual({
      coordinators: 0,
      displayNames: 0,
      keyLabels: 0,
      replacements: 0,
    });
    const remaining = await db.execute(
      sql`select count(*)::int as n from ai_agent where username = ${old}`,
    );
    expect(remaining[0]?.n).toBe(0);
  });
});
