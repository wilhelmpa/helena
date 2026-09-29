import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it } from 'bun:test';
import { db, helenaGoalTask, initiative, issue as issueTable } from '@repo/db';
import { eq, sql } from 'drizzle-orm';
import { authedApi } from '#tests/helpers/app';
import { addProjectMember } from '#tests/helpers/members';
import { signUpTestUser } from '#tests/helpers/auth';
import { resetDb } from '#tests/helpers/db';

// The task field "Ziel" names an organization goal (helena_goal_task), not a project
// initiative: the pick list comes from goal-options, the task carries `goal`, a patch and a
// bulk patch set it, the list filters by it, and the migration keeps what tasks inherited.

async function setup() {
  const owner = await signUpTestUser({ name: 'Owner' });
  const api = authedApi(owner.cookie);
  const mkt = (await api.projects.post({ key: 'MKT', name: 'Marketing' })).data!;
  const ops = (await api.projects.post({ key: 'OPS', name: 'Operations' })).data!;
  const teamId = mkt.teamId;
  const organization = api.teams({ teamId }).organization;
  const department = (await organization.departments.post({ name: 'Growth' })).data!;
  await organization.projects({ projectId: mkt.id }).put({ departmentId: department.id });
  const goal = async (body: Parameters<typeof organization.goals.post>[0]) =>
    (await organization.goals.post(body)).data!;
  const team = await goal({ title: 'Grow the company', status: 'active' });
  const growth = await goal({
    title: 'More leads',
    status: 'active',
    departmentId: department.id,
    parentGoalId: team.id,
  });
  const launch = await goal({
    title: 'Launch the website',
    status: 'active',
    projectId: mkt.id,
    parentGoalId: growth.id,
  });
  const foreign = await goal({ title: 'Cheaper hosting', status: 'active', projectId: ops.id });
  const view = await api.projects({ projectKey: 'MKT' }).get();
  const columnId = view.data!.columns.find((c) => c.stateType === 'unstarted')!.id;
  const task = async (title: string, body: Record<string, unknown> = {}) =>
    (await api.projects({ projectKey: 'MKT' }).issues.post({ title, columnId, ...body })).data!;
  return { api, owner, mkt, ops, teamId, goals: { team, growth, launch, foreign }, columnId, task };
}

describe('the goal of a task', () => {
  beforeEach(resetDb);

  it('lists the goals of the project, its department and the team, with this project’s progress', async () => {
    const { api, goals, task } = await setup();
    const first = await task('Write the copy');
    await api.issues({ issueId: first.id }).patch({ goalId: goals.launch.id });
    const options = await api.projects({ projectKey: 'MKT' })['goal-options'].get();
    expect(options.status).toBe(200);
    expect(options.data!.map((g) => g.title).sort()).toEqual([
      'Grow the company',
      'Launch the website',
      'More leads',
    ]);
    const launch = options.data!.find((g) => g.id === goals.launch.id)!;
    expect(launch.scope).toBe('project');
    expect(launch.path).toEqual(['Grow the company', 'More leads']);
    expect(launch.progress).toEqual({ total: 1, done: 0 });
    expect(options.data!.find((g) => g.id === goals.team.id)!.scope).toBe('team');
    expect(options.data!.find((g) => g.id === goals.growth.id)!.scope).toBe('department');
  });

  it('sets, shows and clears the goal through the task and its list', async () => {
    const { api, goals, task } = await setup();
    const created = await task('Write the copy');
    expect(created.goal).toBeNull();

    const set = await api.issues({ issueId: created.id }).patch({ goalId: goals.launch.id });
    expect(set.status).toBe(200);
    expect(set.data!.goal).toEqual({
      id: goals.launch.id,
      title: 'Launch the website',
      status: 'active',
    });
    const read = await api.issues({ issueId: created.id }).get();
    expect(read.data!.goal?.id).toBe(goals.launch.id);
    const board = await api.projects({ projectKey: 'MKT' }).issues.board.get();
    expect(board.data!.issues.find((i) => i.id === created.id)!.goal?.title).toBe(
      'Launch the website',
    );

    // Changing another field leaves the goal alone; null unlinks it.
    const renamed = await api.issues({ issueId: created.id }).patch({ title: 'Write copy' });
    expect(renamed.data!.goal?.id).toBe(goals.launch.id);
    const cleared = await api.issues({ issueId: created.id }).patch({ goalId: null });
    expect(cleared.data!.goal).toBeNull();
    expect(await db.select().from(helenaGoalTask)).toHaveLength(0);
  });

  it('refuses a goal that does not exist and creates a task with its goal', async () => {
    const { api, goals, task } = await setup();
    const created = await task('Write the copy');
    const missing = await api.issues({ issueId: created.id }).patch({ goalId: 999_999 });
    expect(missing.status).toBe(404);
    const unchanged = await api.issues({ issueId: created.id }).get();
    expect(unchanged.data!.goal).toBeNull();

    const withGoal = await task('Plan the launch', { goalId: goals.growth.id });
    expect((await api.issues({ issueId: withGoal.id }).get()).data!.goal?.id).toBe(goals.growth.id);
  });

  it('sets the goal of several tasks at once and filters the list by it', async () => {
    const { api, goals, task } = await setup();
    const a = await task('A');
    const b = await task('B');
    const c = await task('C');
    const bulk = await api
      .projects({ projectKey: 'MKT' })
      .issues.bulk.patch({ ids: [a.id, b.id], patch: { goalId: goals.launch.id } });
    expect(bulk.status).toBe(200);
    const mine = await api
      .projects({ projectKey: 'MKT' })
      .issues.get({ query: { goalId: goals.launch.id } });
    expect(mine.data!.map((hit) => hit.id).sort()).toEqual([a.id, b.id].sort());
    expect(c.id).not.toBe(a.id);
    const listed = await api.projects({ projectKey: 'MKT' }).issues.board.get();
    const goalIds = listed.data!.issues.map((i) => [i.id, i.goal?.id ?? null]);
    expect(goalIds).toContainEqual([a.id, goals.launch.id]);
    expect(goalIds).toContainEqual([c.id, null]);
  });

  it('lets a member without the goal pages still see the pick list', async () => {
    const { api, goals } = await setup();
    const member = await addProjectMember(api, 'MKT');
    const options = await member.projects({ projectKey: 'MKT' })['goal-options'].get();
    expect(options.status).toBe(200);
    expect(options.data!.map((g) => g.id)).toContain(goals.launch.id);
  });

  it('keeps the goal a task inherited from its initiative when the migration runs', async () => {
    const { api, mkt, goals, task, teamId } = await setup();
    // A goal of the project the initiative contributes to, and three tasks under it: one
    // plain, one whose parent already names a goal, one with a goal of its own.
    const ini = (
      await db
        .insert(initiative)
        .values({ projectId: mkt.id, title: 'Website relaunch', status: 'active' })
        .returning()
    )[0]!;
    await api.initiatives({ initiativeId: ini.id })['pool-goal'].put({ goalId: goals.launch.id });
    const plain = await task('Plain');
    const parent = await task('Parent');
    const child = await task('Child');
    const own = await task('Own');
    await db
      .update(issueTable)
      .set({ initiativeId: ini.id })
      .where(sql`${issueTable.id} in (${plain.id}, ${child.id}, ${own.id})`);
    await db.update(issueTable).set({ parentId: parent.id }).where(eq(issueTable.id, child.id));
    await api.issues({ issueId: parent.id }).patch({ goalId: goals.growth.id });
    await api.issues({ issueId: own.id }).patch({ goalId: goals.team.id });

    const migration = readFileSync(
      new URL(
        '../../../../../../../packages/db/drizzle/0221_work_items_goal_backfill.sql',
        import.meta.url,
      ),
      'utf8',
    );
    await db.execute(sql.raw(migration));
    // Running it twice changes nothing.
    await db.execute(sql.raw(migration));

    const links = await db.select().from(helenaGoalTask);
    const byIssue = new Map(links.map((l) => [l.issueId, l.goalId]));
    expect(byIssue.get(plain.id)).toBe(goals.launch.id);
    // The parent names a goal, which wins over the inherited one: the child gets none.
    expect(byIssue.has(child.id)).toBe(false);
    expect(byIssue.get(parent.id)).toBe(goals.growth.id);
    expect(byIssue.get(own.id)).toBe(goals.team.id);
    expect(links.every((l) => l.teamId === teamId)).toBe(true);
    // The initiative link stays on the tasks.
    const after = await db.select().from(issueTable).where(eq(issueTable.id, plain.id));
    expect(after[0]!.initiativeId).toBe(ini.id);
  });
});
