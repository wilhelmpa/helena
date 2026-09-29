import { beforeEach, describe, expect, it } from 'bun:test';
import { authedApi } from '#tests/helpers/app';
import { addProjectMember } from '#tests/helpers/members';
import { signUpTestUser } from '#tests/helpers/auth';
import { resetDb } from '#tests/helpers/db';

// The fields a task view shows by default: a project admin saves the project's, every
// member saves their own for all projects, any member reads both.

async function setup() {
  const owner = await signUpTestUser({ name: 'Owner' });
  const api = authedApi(owner.cookie);
  await api.projects.post({ key: 'MKT', name: 'Marketing' });
  await api.projects.post({ key: 'OPS', name: 'Operations' });
  return { api };
}

describe('display defaults', () => {
  beforeEach(resetDb);

  it('starts empty and keeps what a project admin saves, per layout', async () => {
    const { api } = await setup();
    const mkt = api.projects({ projectKey: 'MKT' })['display-defaults'];
    expect((await mkt.get()).data).toEqual({ project: null, global: null });

    const saved = await mkt.put({
      defaults: { kanban: ['id', 'goal', 'goal', 'priority'], table: ['dueDate'] },
    });
    expect(saved.status).toBe(200);
    // Repeated keys collapse; the order stays.
    expect(saved.data!.project).toEqual({ kanban: ['id', 'goal', 'priority'], table: ['dueDate'] });
    expect((await mkt.get()).data!.project?.table).toEqual(['dueDate']);
    // Another project is untouched.
    const ops = await api.projects({ projectKey: 'OPS' })['display-defaults'].get();
    expect(ops.data!.project).toBeNull();

    const removed = await mkt.put({ defaults: null });
    expect(removed.data!.project).toBeNull();
  });

  it('refuses keys that are not property names', async () => {
    const { api } = await setup();
    const mkt = api.projects({ projectKey: 'MKT' })['display-defaults'];
    expect((await mkt.put({ defaults: { kanban: ['not valid!'] } })).status).toBe(422);
  });

  it('lets a member read the project default but only an admin save it', async () => {
    const { api } = await setup();
    const member = await addProjectMember(api, 'MKT');
    await api
      .projects({ projectKey: 'MKT' })
      ['display-defaults'].put({ defaults: { list: ['id', 'assignee'] } });
    const read = await member.projects({ projectKey: 'MKT' })['display-defaults'].get();
    expect(read.data!.project).toEqual({ list: ['id', 'assignee'] });
    const refused = await member
      .projects({ projectKey: 'MKT' })
      ['display-defaults'].put({ defaults: { list: ['id'] } });
    expect(refused.status).toBe(403);
  });

  it('keeps a member’s own default for every project, apart from the project’s', async () => {
    const { api } = await setup();
    const member = await addProjectMember(api, 'MKT');
    const mine = member.projects({ projectKey: 'MKT' })['display-defaults'].global;
    const saved = await mine.put({ defaults: { kanban: ['id', 'dueDate'] } });
    expect(saved.status).toBe(200);
    expect(saved.data!.global).toEqual({ kanban: ['id', 'dueDate'] });
    // The owner's own default is separate, and the project has none.
    const owner = await api.projects({ projectKey: 'MKT' })['display-defaults'].get();
    expect(owner.data).toEqual({ project: null, global: null });
    // Saving again replaces it.
    const again = await mine.put({ defaults: { table: ['priority'] } });
    expect(again.data!.global).toEqual({ table: ['priority'] });
    expect((await mine.put({ defaults: null })).data!.global).toBeNull();
  });
});
