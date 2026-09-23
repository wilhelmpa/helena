import { describe, it, expect, beforeEach } from 'bun:test';
import { db, projectActionRun } from '@repo/db';
import { eq } from 'drizzle-orm';
import { authedApi } from '#tests/helpers/app';
import { signUpTestUser } from '#tests/helpers/auth';
import { resetDb } from '#tests/helpers/db';
import { updateIssue } from '#modules/issues/service';
import { processActionRuns } from '../../runner';
import { claimActionRuns, createManualActionRun } from '../../queue';

async function setupOwnerProject() {
  const owner = await signUpTestUser();
  const asOwner = authedApi(owner.cookie);
  const project = await asOwner.projects.post({ key: 'MKT', name: 'Marketing' });
  return { asOwner, projectId: project.data!.id, ownerUserId: owner.userId };
}

async function projectColumns(asOwner: ReturnType<typeof authedApi>) {
  const project = await asOwner.projects({ projectKey: 'MKT' }).get();
  return project.data!.columns;
}

async function createIssue(asOwner: ReturnType<typeof authedApi>, columnId: number) {
  return (
    await asOwner
      .projects({ projectKey: 'MKT' })
      .issues.post({ title: 'Automation target', columnId })
  ).data!;
}

// Adds a member on the default role, which grants no `actions` permission.
async function addDefaultMember(asOwner: ReturnType<typeof authedApi>) {
  const user = await signUpTestUser();
  const invite = await asOwner
    .projects({ projectKey: 'MKT' })
    .invites.post({ email: user.email, role: 'member' });
  const asMember = authedApi(user.cookie);
  await asMember.invites({ token: invite.data!.token }).accept.post();
  return asMember;
}

describe('actions', () => {
  beforeEach(async () => {
    await resetDb();
  });

  describe('create and list', () => {
    it('creates an action with default condition/effect and lists it', async () => {
      const { asOwner, projectId } = await setupOwnerProject();

      const created = await asOwner.projects({ projectKey: 'MKT' }).actions.post({
        name: 'Auto-close',
      });
      expect(created.status).toBe(201);
      expect(created.data).toMatchObject({
        name: 'Auto-close',
        projectId,
        icon: '',
        enabled: true,
        trigger: 'manual',
        condition: { conditions: [] },
        effect: {},
        position: 0,
      });
      expect(typeof created.data?.id).toBe('number');

      const list = await asOwner.projects({ projectKey: 'MKT' }).actions.get();
      expect(list.status).toBe(200);
      expect(list.data).toHaveLength(1);
      expect(list.data?.[0]).toMatchObject({ name: 'Auto-close' });
    });

    it('stores the icon and updates it', async () => {
      const { asOwner } = await setupOwnerProject();

      const created = await asOwner.projects({ projectKey: 'MKT' }).actions.post({
        name: 'Approve',
        icon: 'check',
      });
      expect(created.status).toBe(201);
      expect(created.data).toMatchObject({ name: 'Approve', icon: 'check' });

      const patched = await asOwner
        .actions({ actionId: created.data!.id })
        .patch({ icon: 'rocket' });
      expect(patched.data).toMatchObject({ icon: 'rocket' });
    });

    it('can disable and re-enable an action', async () => {
      const { asOwner } = await setupOwnerProject();
      const created = await asOwner.projects({ projectKey: 'MKT' }).actions.post({
        name: 'Approve',
        enabled: false,
      });
      expect(created.data).toMatchObject({ enabled: false });

      const patched = await asOwner
        .actions({ actionId: created.data!.id })
        .patch({ enabled: true });
      expect(patched.data).toMatchObject({ enabled: true });
    });

    it('stores a validated condition and effect', async () => {
      const { asOwner } = await setupOwnerProject();
      const condition = {
        conditions: [{ id: 'priority', field: 'priority', op: 'is' as const, values: ['high'] }],
      };
      const effect = { columnId: 3, assigneeUserId: 'user-7' };

      const created = await asOwner.projects({ projectKey: 'MKT' }).actions.post({
        name: 'Escalate',
        condition,
        effect,
      });
      expect(created.status).toBe(201);
      expect(created.data).toMatchObject({ condition, effect });
    });

    it('appends each new action after the existing ones', async () => {
      const { asOwner } = await setupOwnerProject();

      await asOwner.projects({ projectKey: 'MKT' }).actions.post({ name: 'First' });
      await asOwner.projects({ projectKey: 'MKT' }).actions.post({ name: 'Second' });

      const list = await asOwner.projects({ projectKey: 'MKT' }).actions.get();
      expect(list.data).toMatchObject([
        { name: 'First', position: 0 },
        { name: 'Second', position: 1 },
      ]);
    });
  });

  describe('runs', () => {
    it('previews and executes the selected workflow branch with durable step results', async () => {
      const { asOwner } = await setupOwnerProject();
      const [source] = await projectColumns(asOwner);
      const issue = await createIssue(asOwner, source.id);
      const workflow = {
        version: 1 as const,
        nodes: [
          {
            id: 'trigger',
            type: 'trigger' as const,
            config: { trigger: 'manual' as const },
            position: { x: 0, y: 0 },
          },
          {
            id: 'condition',
            type: 'condition' as const,
            config: {
              conditions: [
                { id: 'priority', field: 'priority', op: 'is' as const, values: ['high'] },
              ],
            },
            position: { x: 0, y: 100 },
          },
          {
            id: 'matched',
            type: 'action' as const,
            config: { priority: 'urgent' as const },
            position: { x: 0, y: 200 },
          },
          {
            id: 'other',
            type: 'action' as const,
            config: { priority: 'low' as const },
            position: { x: 200, y: 200 },
          },
        ],
        edges: [
          { id: 'start', source: 'trigger', target: 'condition', branch: 'always' as const },
          { id: 'yes', source: 'condition', target: 'matched', branch: 'true' as const },
          { id: 'no', source: 'condition', target: 'other', branch: 'false' as const },
        ],
      };
      const action = (
        await asOwner.projects({ projectKey: 'MKT' }).actions.post({ name: 'Branch', workflow })
      ).data!;

      const preview = await asOwner
        .actions({ actionId: action.id })
        .preview.post({ issueId: issue.id, workflow });
      expect(preview.status).toBe(200);
      expect(preview.data).toMatchObject({
        path: [
          { nodeId: 'trigger', outcome: 'manual' },
          { nodeId: 'condition', outcome: 'false' },
          { nodeId: 'other', outcome: 'would_apply' },
        ],
        effects: [{ priority: 'low' }],
      });
      expect((await asOwner.issues({ issueId: issue.id }).get()).data?.priority).toBeNull();

      const executed = await asOwner
        .actions({ actionId: action.id })
        .run.post({ issueId: issue.id });
      expect(executed.status).toBe(200);
      expect((await asOwner.issues({ issueId: issue.id }).get()).data?.priority).toBe('low');
      const detail = await asOwner['action-runs']({ runId: executed.data!.id }).get();
      expect(detail.status).toBe(200);
      expect(detail.data?.steps).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            nodeId: 'condition',
            status: 'succeeded',
            result: { matched: false },
          }),
          expect.objectContaining({
            nodeId: 'other',
            status: 'succeeded',
            result: { changedFields: ['priority'] },
          }),
          expect.objectContaining({ nodeId: 'trigger', status: 'succeeded' }),
        ]),
      );
    });

    it('branches on the area of the issue', async () => {
      const { asOwner } = await setupOwnerProject();
      const [source] = await projectColumns(asOwner);
      const areaId = (
        await asOwner.projects({ projectKey: 'MKT' })['view-folders'].post({ name: 'Backend' })
      ).data!.id;
      const inArea = (
        await asOwner
          .projects({ projectKey: 'MKT' })
          .issues.post({ title: 'In the area', columnId: source.id, folderId: areaId })
      ).data!;
      const outside = await createIssue(asOwner, source.id);
      const workflow = {
        version: 1 as const,
        nodes: [
          {
            id: 'trigger',
            type: 'trigger' as const,
            config: { trigger: 'manual' as const },
            position: { x: 0, y: 0 },
          },
          {
            id: 'condition',
            type: 'condition' as const,
            config: {
              conditions: [{ id: 'area', field: 'area', op: 'is' as const, values: [areaId] }],
            },
            position: { x: 0, y: 100 },
          },
          {
            id: 'matched',
            type: 'action' as const,
            config: { priority: 'urgent' as const },
            position: { x: 0, y: 200 },
          },
        ],
        edges: [
          { id: 'start', source: 'trigger', target: 'condition', branch: 'always' as const },
          { id: 'yes', source: 'condition', target: 'matched', branch: 'true' as const },
        ],
      };
      const created = await asOwner
        .projects({ projectKey: 'MKT' })
        .actions.post({ name: 'Area branch', workflow });
      expect(created.status).toBe(201);
      const actionId = created.data!.id;

      const matched = await asOwner
        .actions({ actionId })
        .preview.post({ issueId: inArea.id, workflow });
      expect(matched.data?.path).toContainEqual({
        type: 'condition',
        nodeId: 'condition',
        outcome: 'true',
      });
      const missed = await asOwner
        .actions({ actionId })
        .preview.post({ issueId: outside.id, workflow });
      expect(missed.data?.path).toContainEqual({
        type: 'condition',
        nodeId: 'condition',
        outcome: 'false',
      });
    });

    it('runs a manual action through the API and records the result', async () => {
      const { asOwner, ownerUserId } = await setupOwnerProject();
      const [source] = await projectColumns(asOwner);
      const issue = await createIssue(asOwner, source.id);
      const action = (
        await asOwner.projects({ projectKey: 'MKT' }).actions.post({
          name: 'Escalate',
          condition: {
            conditions: [{ id: 'status', field: 'status', op: 'is', values: [source.id] }],
          },
          effect: { priority: 'urgent' },
        })
      ).data!;

      const executed = await asOwner.actions({ actionId: action.id }).run.post({
        issueId: issue.id,
      });
      expect(executed.status).toBe(200);
      expect(executed.data).toMatchObject({
        actionId: action.id,
        issueId: issue.id,
        actorUserId: ownerUserId,
        trigger: 'manual',
        status: 'succeeded',
        attempts: 1,
        result: { changedFields: ['priority'] },
      });
      expect((await asOwner.issues({ issueId: issue.id }).get()).data?.priority).toBe('urgent');

      const history = await asOwner.projects({ projectKey: 'MKT' })['action-runs'].get();
      expect(history.status).toBe(200);
      expect(history.data).toHaveLength(1);
      expect(history.data?.[0]).toMatchObject({
        actionName: 'Escalate',
        issueIdentifier: issue.identifier,
        status: 'succeeded',
      });

      expect((await asOwner.issues({ issueId: issue.id }).delete()).status).toBe(204);
      const retained = await asOwner.projects({ projectKey: 'MKT' })['action-runs'].get();
      expect(retained.data?.[0]).toMatchObject({
        issueId: null,
        issueIdentifier: null,
        status: 'succeeded',
      });
    });

    it('never reclaims a manual run after its synchronous worker lease expires', async () => {
      const { asOwner, ownerUserId, projectId } = await setupOwnerProject();
      const [column] = await projectColumns(asOwner);
      const issue = await createIssue(asOwner, column.id);
      const action = (
        await asOwner.projects({ projectKey: 'MKT' }).actions.post({
          name: 'One shot',
          effect: { priority: 'high' },
        })
      ).data!;
      const run = await createManualActionRun({
        actionId: action.id,
        projectId,
        issueId: issue.id,
        actorUserId: ownerUserId,
        actionName: action.name,
        columnId: column.id,
        condition: action.condition,
        effect: action.effect,
      });
      await db
        .update(projectActionRun)
        .set({ nextAttemptAt: new Date(0) })
        .where(eq(projectActionRun.id, run.id));

      expect(await claimActionRuns()).toEqual([]);
      const [expired] = await db
        .select({ status: projectActionRun.status, lastError: projectActionRun.lastError })
        .from(projectActionRun)
        .where(eq(projectActionRun.id, run.id));
      expect(expired).toEqual({
        status: 'failed',
        lastError: 'Worker lease expired too many times',
      });
    });

    it('queues a status action transactionally and executes its snapshotted effect', async () => {
      const { asOwner, ownerUserId } = await setupOwnerProject();
      const [source, target] = await projectColumns(asOwner);
      const issue = await createIssue(asOwner, source.id);
      const action = (
        await asOwner.projects({ projectKey: 'MKT' }).actions.post({
          name: 'Prioritize review',
          trigger: 'issue_state_changed',
          condition: {
            conditions: [{ id: 'status', field: 'status', op: 'is', values: [target.id] }],
          },
          effect: { priority: 'high' },
        })
      ).data!;

      const moved = await asOwner.issues({ issueId: issue.id }).patch({ columnId: target.id });
      expect(moved.status).toBe(200);
      expect(moved.data).toMatchObject({ columnId: target.id, priority: null });

      const queued = await asOwner.projects({ projectKey: 'MKT' })['action-runs'].get();
      expect(queued.data).toHaveLength(1);
      expect(queued.data?.[0]).toMatchObject({
        actionId: action.id,
        actorUserId: ownerUserId,
        fromColumnId: source.id,
        toColumnId: target.id,
        status: 'pending',
        attempts: 0,
      });

      await processActionRuns();

      expect((await asOwner.issues({ issueId: issue.id }).get()).data?.priority).toBe('high');
      const finished = await asOwner.projects({ projectKey: 'MKT' })['action-runs'].get();
      expect(finished.data?.[0]).toMatchObject({
        status: 'succeeded',
        attempts: 1,
        result: { changedFields: ['priority'] },
      });
    });

    it('rechecks the initiating member permission before an automatic run', async () => {
      const { asOwner } = await setupOwnerProject();
      const [source, target] = await projectColumns(asOwner);
      const member = await signUpTestUser();
      const invite = await asOwner
        .projects({ projectKey: 'MKT' })
        .invites.post({ email: member.email, role: 'member' });
      const asMember = authedApi(member.cookie);
      await asMember.invites({ token: invite.data!.token }).accept.post();
      const issue = await createIssue(asOwner, source.id);
      await asOwner.projects({ projectKey: 'MKT' }).actions.post({
        name: 'Escalate after move',
        trigger: 'issue_state_changed',
        effect: { priority: 'urgent' },
      });

      expect(
        (await asMember.issues({ issueId: issue.id }).patch({ columnId: target.id })).status,
      ).toBe(200);
      expect(
        (await asOwner.projects({ projectKey: 'MKT' }).members({ userId: member.userId }).delete())
          .status,
      ).toBe(204);

      await processActionRuns();

      expect((await asOwner.issues({ issueId: issue.id }).get()).data?.priority).toBeNull();
      const [run] = (await asOwner.projects({ projectKey: 'MKT' })['action-runs'].get()).data!;
      expect(run).toMatchObject({ status: 'skipped', actorUserId: member.userId });
      expect(run.lastError).toContain('no longer has permission');
    });

    it('does not grant a named system actor implicit project permissions', async () => {
      const { asOwner } = await setupOwnerProject();
      const [source, target] = await projectColumns(asOwner);
      const issue = await createIssue(asOwner, source.id);
      await asOwner.projects({ projectKey: 'MKT' }).actions.post({
        name: 'System escalation',
        trigger: 'issue_state_changed',
        effect: { priority: 'urgent' },
      });

      await updateIssue(issue.id, { columnId: target.id }, { system: 'External integration' });

      const history = await asOwner.projects({ projectKey: 'MKT' })['action-runs'].get();
      expect(history.data).toHaveLength(0);
      expect((await asOwner.issues({ issueId: issue.id }).get()).data).toMatchObject({
        columnId: target.id,
        priority: null,
      });
    });

    it('bounds a two-action status loop to one run per action and target state', async () => {
      const { asOwner } = await setupOwnerProject();
      const [source, stateA, stateB] = await projectColumns(asOwner);
      const issue = await createIssue(asOwner, source.id);
      await asOwner.projects({ projectKey: 'MKT' }).actions.post({
        name: 'A to B',
        trigger: 'issue_state_changed',
        condition: {
          conditions: [{ id: 'a', field: 'status', op: 'is', values: [stateA.id] }],
        },
        effect: { columnId: stateB.id },
      });
      await asOwner.projects({ projectKey: 'MKT' }).actions.post({
        name: 'B to A',
        trigger: 'issue_state_changed',
        condition: {
          conditions: [{ id: 'b', field: 'status', op: 'is', values: [stateB.id] }],
        },
        effect: { columnId: stateA.id },
      });

      await asOwner.issues({ issueId: issue.id }).patch({ columnId: stateA.id });
      await processActionRuns();
      await processActionRuns();
      await processActionRuns();

      const history = (await asOwner.projects({ projectKey: 'MKT' })['action-runs'].get()).data!;
      expect(history).toHaveLength(4);
      expect(history.every((run) => ['succeeded', 'skipped'].includes(run.status))).toBe(true);
      expect(Math.max(...history.map((run) => run.depth))).toBe(1);
      expect((await asOwner.issues({ issueId: issue.id }).get()).data?.columnId).toBe(stateA.id);

      await processActionRuns();
      expect(
        (await asOwner.projects({ projectKey: 'MKT' })['action-runs'].get()).data,
      ).toHaveLength(4);
    });
  });

  describe('quick list', () => {
    it('lets a member without the actions permission read it, in saved order', async () => {
      const { asOwner } = await setupOwnerProject();
      const a = (await asOwner.projects({ projectKey: 'MKT' }).actions.post({ name: 'A' })).data!;
      const b = (await asOwner.projects({ projectKey: 'MKT' }).actions.post({ name: 'B' })).data!;
      await asOwner
        .projects({ projectKey: 'MKT' })
        .actions.reorder.put({ orderedIds: [b.id, a.id] });

      const asMember = await addDefaultMember(asOwner);

      const settingsList = await asMember.projects({ projectKey: 'MKT' }).actions.get();
      expect(settingsList.status).toBe(403);

      const quick = await asMember.projects({ projectKey: 'MKT' }).actions.quick.get();
      expect(quick.status).toBe(200);
      expect(quick.data?.map((r) => r.id)).toEqual([b.id, a.id]);
    });

    it('denies a non-member', async () => {
      const { asOwner } = await setupOwnerProject();
      await asOwner.projects({ projectKey: 'MKT' }).actions.post({ name: 'Secret' });

      const outsider = authedApi((await signUpTestUser()).cookie);
      const quick = await outsider.projects({ projectKey: 'MKT' }).actions.quick.get();
      expect(quick.status).toBe(403);
    });

    it('returns 404 for an unknown project', async () => {
      const { asOwner } = await setupOwnerProject();
      const res = await asOwner.projects({ projectKey: 'NOPE' }).actions.quick.get();
      expect(res.status).toBe(404);
    });
  });

  describe('update', () => {
    it('updates only the provided fields, replacing condition/effect wholesale', async () => {
      const { asOwner } = await setupOwnerProject();
      const created = await asOwner.projects({ projectKey: 'MKT' }).actions.post({
        name: 'Original',
        condition: {
          conditions: [{ id: 'priority', field: 'priority', op: 'is', values: ['high'] }],
        },
        effect: { priority: 'high' },
      });
      const id = created.data!.id;

      const patchedName = await asOwner.actions({ actionId: id }).patch({ name: 'Renamed' });
      expect(patchedName.status).toBe(200);
      expect(patchedName.data).toMatchObject({
        name: 'Renamed',
        condition: {
          conditions: [{ id: 'priority', field: 'priority', op: 'is', values: ['high'] }],
        },
        effect: { priority: 'high' },
      });

      const patchedEffect = await asOwner
        .actions({ actionId: id })
        .patch({ effect: { priority: 'urgent' } });
      expect(patchedEffect.status).toBe(200);
      expect(patchedEffect.data).toMatchObject({
        name: 'Renamed',
        effect: { priority: 'urgent' },
      });
    });

    it('returns 404 when patching a missing action', async () => {
      const { asOwner } = await setupOwnerProject();
      const res = await asOwner.actions({ actionId: 999999 }).patch({ name: 'Nope' });
      expect(res.status).toBe(404);
    });
  });

  describe('reorder', () => {
    it('sets the order to the ids given', async () => {
      const { asOwner } = await setupOwnerProject();
      const a = (await asOwner.projects({ projectKey: 'MKT' }).actions.post({ name: 'A' })).data!;
      const b = (await asOwner.projects({ projectKey: 'MKT' }).actions.post({ name: 'B' })).data!;
      const c = (await asOwner.projects({ projectKey: 'MKT' }).actions.post({ name: 'C' })).data!;

      const reordered = await asOwner
        .projects({ projectKey: 'MKT' })
        .actions.reorder.put({ orderedIds: [c.id, a.id, b.id] });
      expect(reordered.status).toBe(200);
      expect(reordered.data).toMatchObject([
        { id: c.id, position: 0 },
        { id: a.id, position: 1 },
        { id: b.id, position: 2 },
      ]);

      const list = await asOwner.projects({ projectKey: 'MKT' }).actions.get();
      expect(list.data?.map((r) => r.id)).toEqual([c.id, a.id, b.id]);
    });

    it('ignores ids that belong to another project', async () => {
      const { asOwner } = await setupOwnerProject();
      await asOwner.projects.post({ key: 'OPS', name: 'Operations' });
      const mkt = (await asOwner.projects({ projectKey: 'MKT' }).actions.post({ name: 'Mine' }))
        .data!;
      // The OPS action sits at position 0; the reorder below places its id at
      // index 1, so a scope leak would move it to position 1.
      const ops = (await asOwner.projects({ projectKey: 'OPS' }).actions.post({ name: 'Theirs' }))
        .data!;

      const reordered = await asOwner
        .projects({ projectKey: 'MKT' })
        .actions.reorder.put({ orderedIds: [mkt.id, ops.id] });
      expect(reordered.status).toBe(200);
      expect(reordered.data?.map((r) => r.id)).toEqual([mkt.id]);

      const opsList = await asOwner.projects({ projectKey: 'OPS' }).actions.get();
      expect(opsList.data).toMatchObject([{ id: ops.id, position: 0 }]);
    });
  });

  describe('delete', () => {
    it('deletes an action', async () => {
      const { asOwner } = await setupOwnerProject();
      const id = (await asOwner.projects({ projectKey: 'MKT' }).actions.post({ name: 'Gone' }))
        .data!.id;

      const del = await asOwner.actions({ actionId: id }).delete();
      expect(del.status).toBe(204);

      const list = await asOwner.projects({ projectKey: 'MKT' }).actions.get();
      expect(list.data).toHaveLength(0);
    });

    it('returns 404 when deleting a missing action', async () => {
      const { asOwner } = await setupOwnerProject();
      const res = await asOwner.actions({ actionId: 999999 }).delete();
      expect(res.status).toBe(404);
    });
  });

  describe('validation', () => {
    it('rejects an action with an empty name', async () => {
      const { asOwner } = await setupOwnerProject();
      const res = await asOwner.projects({ projectKey: 'MKT' }).actions.post({ name: '' });
      expect(res.status).toBe(400);
    });

    it('rejects a reorder with an empty list', async () => {
      const { asOwner } = await setupOwnerProject();
      const res = await asOwner
        .projects({ projectKey: 'MKT' })
        .actions.reorder.put({ orderedIds: [] });
      expect(res.status).toBe(400);
    });

    it('rejects a patch that sets an empty name', async () => {
      const { asOwner } = await setupOwnerProject();
      const id = (await asOwner.projects({ projectKey: 'MKT' }).actions.post({ name: 'Named' }))
        .data!.id;
      const res = await asOwner.actions({ actionId: id }).patch({ name: '' });
      expect(res.status).toBe(400);
    });

    it('rejects unsupported condition fields and strips unsupported effect keys', async () => {
      const { asOwner } = await setupOwnerProject();
      const projectActions = asOwner.projects({ projectKey: 'MKT' }).actions;
      const condition = await projectActions.post({
        name: 'Unsafe condition',
        condition: {
          conditions: [{ id: 'x', field: 'script', op: 'is', values: ['alert(1)'] }],
        },
      } as never);
      expect(condition.status).toBe(400);

      const effect = await projectActions.post({
        name: 'Unsafe effect',
        effect: { script: 'delete everything' },
      } as never);
      expect(effect.status).toBe(201);
      expect(effect.data?.effect).toEqual({});
    });

    it('bounds declarative workflow input size', async () => {
      const { asOwner } = await setupOwnerProject();
      const projectActions = asOwner.projects({ projectKey: 'MKT' }).actions;
      const tooManyConditions = Array.from({ length: 26 }, (_, index) => ({
        id: `condition-${index}`,
        field: 'priority',
        op: 'is',
        values: ['high'],
      }));
      const condition = await projectActions.post({
        name: 'Too large',
        condition: { conditions: tooManyConditions },
      } as never);
      expect(condition.status).toBe(400);

      const labels = await projectActions.post({
        name: 'Too many labels',
        effect: { labelIds: Array.from({ length: 51 }, (_, index) => index + 1) },
      } as never);
      expect(labels.status).toBe(400);
    });

    it('rejects a non-numeric action id', async () => {
      const { asOwner } = await setupOwnerProject();
      const res = await asOwner.actions({ actionId: 'abc' }).patch({ name: 'Nope' });
      expect(res.status).toBe(400);
    });
  });

  describe('access', () => {
    it('returns 404 for an unknown project', async () => {
      const { asOwner } = await setupOwnerProject();
      const res = await asOwner.projects({ projectKey: 'NOPE' }).actions.get();
      expect(res.status).toBe(404);
    });

    it('denies a non-member on project-scoped and entity routes', async () => {
      const { asOwner } = await setupOwnerProject();
      const actionId = (
        await asOwner.projects({ projectKey: 'MKT' }).actions.post({ name: 'Secret' })
      ).data!.id;

      const outsider = authedApi((await signUpTestUser()).cookie);

      // Guard-thrown 403 is not in Treaty's inferred error-status union, so
      // assert the top-level HTTP status (typed number) rather than error.status.
      const list = await outsider.projects({ projectKey: 'MKT' }).actions.get();
      expect(list.status).toBe(403);

      const create = await outsider
        .projects({ projectKey: 'MKT' })
        .actions.post({ name: 'Intruder' });
      expect(create.status).toBe(403);

      const patch = await outsider.actions({ actionId }).patch({ name: 'Hacked' });
      expect(patch.status).toBe(403);

      const reorder = await outsider
        .projects({ projectKey: 'MKT' })
        .actions.reorder.put({ orderedIds: [actionId] });
      expect(reorder.status).toBe(403);

      const del = await outsider.actions({ actionId }).delete();
      expect(del.status).toBe(403);
    });
  });
});
