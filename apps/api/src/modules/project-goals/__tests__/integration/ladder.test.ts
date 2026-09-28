import { beforeEach, describe, expect, it } from 'bun:test';
import { authedApi } from '#tests/helpers/app';
import { signUpTestUser } from '#tests/helpers/auth';
import { resetDb } from '#tests/helpers/db';
import { issueWhySection } from '../../ladder';

describe('effective task goal ladder', () => {
  beforeEach(resetDb);

  it('inherits through department, initiative and parent while preserving an explicit child choice', async () => {
    const owner = await signUpTestUser();
    const api = authedApi(owner.cookie);
    const project = (await api.projects.post({ key: 'MKT', name: 'Marketing' })).data!;
    const org = api.teams({ teamId: project.teamId }).organization;
    const department = (await org.departments.post({ name: 'Growth' })).data!;
    await org.projects({ projectId: project.id }).put({ departmentId: department.id });
    const departmentGoal = (
      await org.goals.post({ title: 'Grow reach', status: 'active', departmentId: department.id })
    ).data!;
    const linkedGoal = (
      await org.goals.post({
        title: 'Grow signups',
        status: 'active',
        departmentId: department.id,
        parentGoalId: departmentGoal.id,
      })
    ).data!;
    const explicitGoal = (
      await org.goals.post({
        title: 'Improve trust',
        status: 'active',
        departmentId: department.id,
      })
    ).data!;
    const initiative = (
      await api
        .projects({ projectKey: 'MKT' })
        .initiatives.post({ title: 'Launch campaign', status: 'active' })
    ).data!;
    await api
      .initiatives({ initiativeId: initiative.id })
      ['pool-goal'].put({ goalId: linkedGoal.id });
    const view = (await api.projects({ projectKey: 'MKT' }).get()).data!;
    const columnId = view.columns[0].id;
    const parent = (
      await api
        .projects({ projectKey: 'MKT' })
        .issues.post({ title: 'Prepare launch', columnId, initiativeId: initiative.id })
    ).data!;
    const child = (
      await api
        .projects({ projectKey: 'MKT' })
        .issues.post({ title: 'Write copy', columnId, parentId: parent.id })
    ).data!;
    const why = api.issues({ issueId: child.id }).why;
    const inherited = await why.get();
    expect(inherited.status).toBe(200);
    expect(inherited.data).toMatchObject({
      goal: { id: linkedGoal.id, title: 'Grow signups', path: ['Grow reach'] },
      initiative: { id: initiative.id, title: 'Launch campaign' },
      parents: [{ id: parent.id, title: 'Prepare launch' }],
      source: 'initiative',
    });
    expect(issueWhySection(inherited.data!)).toContain(
      'Grow reach → Grow signups → Launch campaign → MKT-1 Prepare launch → MKT-2 Write copy',
    );
    const context = await api.projects({ projectKey: 'MKT' })['goal-context'].get();
    expect(context.data!.goals.find((goal) => goal.id === linkedGoal.id)?.progress?.total).toBe(2);
    const chains = await api.projects({ projectKey: 'MKT' })['why-chains'].get();
    expect(chains.status).toBe(200);
    expect(chains.data?.map((chain) => chain.why.task.identifier)).toEqual(['MKT-2', 'MKT-1']);
    const stranger = authedApi((await signUpTestUser()).cookie);
    expect((await stranger.issues({ issueId: child.id }).why.get()).status).toBe(403);
    expect((await stranger.projects({ projectKey: 'MKT' })['why-chains'].get()).status).toBe(403);
    await api.issues({ issueId: parent.id }).goal.put({ goalId: explicitGoal.id });
    expect((await why.get()).data!.source).toBe('parent');
    expect((await why.get()).data!.goal?.id).toBe(explicitGoal.id);
    await api.issues({ issueId: child.id }).goal.put({ goalId: linkedGoal.id });
    expect((await why.get()).data!.source).toBe('explicit');
    await api.issues({ issueId: child.id }).goal.put({ goalId: null });
    await api.issues({ issueId: parent.id }).goal.put({ goalId: null });
    await api.initiatives({ initiativeId: initiative.id })['pool-goal'].put({ goalId: null });
    expect((await why.get()).data).toMatchObject({
      source: 'department',
      goal: { id: departmentGoal.id },
    });
    const fallback = await api.projects({ projectKey: 'MKT' })['goal-context'].get();
    expect(
      fallback.data!.goals.find((goal) => goal.id === departmentGoal.id)?.progress?.total,
    ).toBe(2);
  });
});
