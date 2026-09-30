import { beforeEach, expect, it } from 'bun:test';
import { mkdir, readFile, utimes, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { aiAgent, db, helenaFact, helenaSchedule, issue, pipelineRun } from '@repo/db';
import { eq, sql } from 'drizzle-orm';
import { signUpTestUser } from '#tests/helpers/auth';
import { authedApi } from '#tests/helpers/app';
import { createAgent } from '#tests/helpers/agents';
import { resetDb } from '#tests/helpers/db';
import { cleanupBattleTests } from '../cleanup-battle-tests';

beforeEach(resetDb);

it('lists marked September 30 objects without writes and applies only that selection', async () => {
  const owner = await signUpTestUser();
  const api = authedApi(owner.cookie);
  await api.projects.post({ key: 'VOL', name: 'Volition' });
  const view = (await api.projects({ projectKey: 'VOL' }).get()).data!;
  const create = async (title: string) =>
    (
      await api
        .projects({ projectKey: 'VOL' })
        .issues.post({ title, columnId: view.columns[0]!.id })
    ).data!;
  const test = await create('[Battle-Test] Remove me');
  const real = await create('Keep the Battle-Test findings');
  const older = await create('[Battle-Test] Earlier test');
  const today = new Date('2026-09-30T10:00:00Z');
  await db.execute(sql`select setval(pg_get_serial_sequence('ai_agent', 'id'), 11)`);
  const agent = await createAgent(api, 'VOL', { name: 'Test agent', username: 'test-agent' });
  expect(agent.data!.agent.id).toBe(12);
  const skill = {
    path: 'battle-test-meta-description',
    name: 'battle-test-meta-description',
    markdown: '# Test skill',
    files: [],
    otherFiles: 0,
    truncated: false,
    createdAt: today.toISOString(),
  };
  await db
    .update(aiAgent)
    .set({
      runtimePolicy: { runtime: 'helena' },
      volitionLearnedSkills: [skill, { ...skill, path: 'genuine-skill', name: 'genuine-skill' }],
    })
    .where(eq(aiAgent.id, 12));

  await db.update(issue).set({ createdAt: today }).where(eq(issue.id, test.id));
  await db
    .update(issue)
    .set({ createdAt: new Date('2026-09-29T10:00:00Z') })
    .where(eq(issue.id, older.id));
  await db.insert(helenaSchedule).values({
    id: 'battle-routine',
    kind: 'routine',
    projectId: view.project.id,
    taskId: test.id,
    title: '[Battle-Test] Routine',
    mode: 'reopen',
    cron: '0 0 * * *',
    enabled: false,
  });
  await db.insert(pipelineRun).values({
    id: 'battle-run',
    kind: 'routine',
    projectId: view.project.id,
    issueId: test.id,
    scheduleId: 'battle-routine',
    definition: { steps: [] },
    trigger: 'schedule',
    status: 'succeeded',
  });
  await db.insert(helenaFact).values([
    { teamId: view.project.teamId, content: '[Battle-Test] temporary fact', createdAt: today },
    { teamId: view.project.teamId, content: 'Keep genuine knowledge', createdAt: today },
  ]);
  const inbox = join(process.env.PROJECT_VAULT_ROOT!, 'Projects/VOL/Inbox');
  await mkdir(inbox, { recursive: true });
  const testFile = join(inbox, 'battle-test-result.md');
  const realFile = join(inbox, 'real.md');
  await writeFile(testFile, '[Battle-Test] transient result');
  await utimes(testFile, today, today);
  await writeFile(realFile, 'Keep genuine knowledge');
  const logs: string[] = [];
  const plan = await cleanupBattleTests({ log: (line) => logs.push(line) });
  expect(plan.tasks.map((row) => Number(row.id))).toEqual([test.id]);
  expect(plan.routines.map((row) => row.id)).toEqual(['battle-routine']);
  expect(plan.runs.map((row) => row.id)).toEqual(['battle-run']);
  expect(plan.facts).toHaveLength(1);
  expect(plan.nativeSkills.map((row) => row.id)).toEqual(['battle-test-meta-description']);
  expect(plan.files).toEqual(['Projects/VOL/Inbox/battle-test-result.md']);
  expect((await api.issues({ issueId: test.id }).get()).status).toBe(200);
  expect(await readFile(testFile, 'utf8')).toContain('[Battle-Test]');
  await cleanupBattleTests({ apply: true, log: (line) => logs.push(line) });
  expect((await api.issues({ issueId: test.id }).get()).status).toBe(404);
  expect((await api.issues({ issueId: real.id }).get()).status).toBe(200);
  expect((await api.issues({ issueId: older.id }).get()).status).toBe(200);
  expect(await readFile(realFile, 'utf8')).toBe('Keep genuine knowledge');
  const skills = (
    await api
      .teams({ teamId: view.project.teamId })
      ['ai-agents']({ agentId: 12 })
      ['learned-skills'].history.get()
  ).data!;
  expect(skills.find((entry) => entry.name === 'battle-test-meta-description')?.archived).toBe(
    true,
  );
  expect(skills.find((entry) => entry.name === 'genuine-skill')?.archived).not.toBe(true);

  expect((await cleanupBattleTests({ log: () => {} })).tasks).toHaveLength(0);
  expect(logs.every((line) => JSON.parse(line).mode)).toBe(true);
});
