import { describe, it, expect, beforeEach } from 'bun:test';
import { resetDb } from '#tests/helpers/db';
import { addUser, setup } from '../helpers';
import { createAgent } from '#tests/helpers/agents';
import { resolveLevel } from '#modules/autopilot/levels';

// The instance-wide project defaults under god mode: what a project starts with
// when it is created. Only the instance owner may read or change them, and a
// change reaches new projects only — the ones that already exist keep whatever
// they were set to.

describe('god project defaults', () => {
  beforeEach(async () => {
    await resetDb();
  });

  describe('access', () => {
    it('refuses both routes for a user who is not the instance owner', async () => {
      await setup();
      const outsider = await addUser();

      expect((await outsider.api.god['project-defaults'].get()).status).toBe(403);
      expect((await outsider.api.god['project-defaults'].put({ mcpEnabled: false })).status).toBe(
        403,
      );
    });
  });

  describe('settings — GET/PUT /god/project-defaults', () => {
    it('starts with MCP on, so an instance driven through MCP needs no toggle', async () => {
      const { god } = await setup();

      const res = await god.api.god['project-defaults'].get();

      expect(res.status).toBe(200);
      expect(res.data?.mcpEnabled).toBe(true);
      expect(res.data?.autopilotLevel).toBe(3);
      expect(await resolveLevel(null, null)).toMatchObject({ level: 3, source: 'default' });
    });

    it('stores a change and reads it back', async () => {
      const { god } = await setup();

      const put = await god.api.god['project-defaults'].put({ mcpEnabled: false });
      const get = await god.api.god['project-defaults'].get();

      expect(put.status).toBe(200);
      expect(put.data?.mcpEnabled).toBe(false);
      expect(get.data?.mcpEnabled).toBe(false);
    });

    it('validates all four levels and preserves the configured level on a partial update', async () => {
      const { god } = await setup();
      for (const autopilotLevel of [0, 1, 2, 3] as const) {
        const updated = await god.api.god['project-defaults'].put({ autopilotLevel });
        expect(updated.status).toBe(200);
        expect(updated.data?.autopilotLevel).toBe(autopilotLevel);
      }
      await god.api.god['project-defaults'].put({ autopilotLevel: 0 });
      expect(
        (await god.api.god['project-defaults'].put({ mcpEnabled: false })).data?.autopilotLevel,
      ).toBe(0);
      for (const autopilotLevel of [-1, 4, 1.5, '3'])
        expect(
          (await god.api.god['project-defaults'].put({ autopilotLevel } as never)).status,
        ).toBe(400);
    });

    it('uses the instance level for new projects, copies and Home without changing existing levels', async () => {
      const { god } = await setup();
      await god.api.projects.post({ key: 'OLD', name: 'Existing project' });
      expect((await god.api.projects({ projectKey: 'OLD' }).autopilot.get()).data?.level).toBe(3);
      await god.api.projects({ projectKey: 'OLD' }).autopilot.put({ level: 1 });
      await god.api.god['project-defaults'].put({ autopilotLevel: 2 });
      await god.api.projects.post({ key: 'NEW', name: 'New project' });
      await god.api
        .projects({ projectKey: 'OLD' })
        .copy.post({ key: 'COPY', name: 'Copied project' });
      expect((await god.api.projects({ projectKey: 'OLD' }).autopilot.get()).data?.level).toBe(1);
      expect((await god.api.projects({ projectKey: 'NEW' }).autopilot.get()).data?.level).toBe(2);
      expect((await god.api.projects({ projectKey: 'COPY' }).autopilot.get()).data?.level).toBe(2);
      expect(await resolveLevel(null, null)).toMatchObject({ level: 2, source: 'default' });
    });

    it('retains an explicit Home agent level and follows the default only when unset', async () => {
      const { god } = await setup();
      await god.api.projects.post({ key: 'HMT', name: 'Home agent test' });
      const { agent } = (await createAgent(god.api, 'HMT', { name: 'Home', username: 'home' }))
        .data!;
      const route = god.api
        .teams({ teamId: agent.teamId })
        ['ai-agents']({ agentId: agent.id }).autopilot;
      await route.put({ level: 1 });
      await god.api.god['project-defaults'].put({ autopilotLevel: 0 });
      expect(await resolveLevel(agent.id, null)).toMatchObject({ level: 1, source: 'agent' });
      await route.put({ level: null });
      expect(await resolveLevel(agent.id, null)).toMatchObject({ level: 0, source: 'default' });
    });
  });

  describe('default budgets (Vorgaben für Projekte)', () => {
    it('stores one budget per metric and period and gives them to new projects only', async () => {
      const { god } = await setup();
      await god.api.projects.post({ key: 'OLD', name: 'Existing project' });
      const put = await god.api.god['project-defaults'].put({
        budgets: [
          { metric: 'cost', period: 'day', limit: 5 },
          { metric: 'cost', period: 'day', limit: 7 },
          { metric: 'tokens', period: 'month', limit: 100000 },
        ],
      });
      expect(put.status).toBe(200);
      expect(put.data?.budgets).toEqual([
        { metric: 'cost', period: 'day', limit: 7 },
        { metric: 'tokens', period: 'month', limit: 100000 },
      ]);
      expect((await god.api.god['project-defaults'].get()).data?.budgets).toHaveLength(2);
      // A partial change keeps them.
      expect(
        (await god.api.god['project-defaults'].put({ mcpEnabled: false })).data?.budgets,
      ).toHaveLength(2);

      await god.api.projects.post({ key: 'NEW', name: 'New project' });
      const created = (await god.api.projects({ projectKey: 'NEW' }).autopilot.get()).data!;
      expect(
        created.budgets.map((budget) => [budget.metric, budget.period, budget.limit]).sort(),
      ).toEqual([
        ['cost', 'day', 7],
        ['tokens', 'month', 100000],
      ]);
      const existing = (await god.api.projects({ projectKey: 'OLD' }).autopilot.get()).data!;
      expect(existing.budgets).toEqual([]);
    });

    it('refuses a budget without a positive limit', async () => {
      const { god } = await setup();
      const res = await god.api.god['project-defaults'].put({
        budgets: [{ metric: 'cost', period: 'day', limit: 0 }],
      });
      expect(res.status).toBe(400);
    });
  });

  describe('effect on project creation', () => {
    it('creates a project with MCP on under the default', async () => {
      const { god } = await setup();

      const created = await god.api.projects.post({ key: 'MKT', name: 'Marketing' });
      const settings = await god.api.projects({ projectKey: 'MKT' }).settings.get();

      expect(created.status).toBe(201);
      expect(settings.data?.mcpEnabled).toBe(true);
    });

    it('creates a project with MCP off once the default is turned off', async () => {
      const { god } = await setup();
      await god.api.god['project-defaults'].put({ mcpEnabled: false });

      await god.api.projects.post({ key: 'MKT', name: 'Marketing' });
      const settings = await god.api.projects({ projectKey: 'MKT' }).settings.get();

      expect(settings.data?.mcpEnabled).toBe(false);
    });

    it('leaves projects that already exist untouched', async () => {
      const { god } = await setup();
      await god.api.projects.post({ key: 'MKT', name: 'Marketing' });
      const before = await god.api.projects({ projectKey: 'MKT' }).settings.get();
      expect(before.data?.mcpEnabled).toBe(true);

      await god.api.god['project-defaults'].put({ mcpEnabled: false });

      const after = await god.api.projects({ projectKey: 'MKT' }).settings.get();
      expect(after.data?.mcpEnabled).toBe(true);
    });

    it('applies the default to a project created by any member, not just the owner', async () => {
      const { god } = await setup();
      await god.api.god['project-defaults'].put({ mcpEnabled: false });
      const alice = await addUser();

      await alice.api.projects.post({ key: 'ALC', name: 'Alice Only' });
      const settings = await alice.api.projects({ projectKey: 'ALC' }).settings.get();

      expect(settings.data?.mcpEnabled).toBe(false);
    });
  });
});
