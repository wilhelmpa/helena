import { beforeEach, describe, expect, it } from 'bun:test';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  agentRun,
  db,
  janitorRun,
  pipelineRun,
  recordJanitorRun,
  recordServiceCheck,
} from '@repo/db';
import { eq, sql } from 'drizzle-orm';
import { apiKeyApi } from '#tests/helpers/app';
import { createAgent } from '#tests/helpers/agents';
import { resetDb } from '#tests/helpers/db';
import { addUser, setup } from '../helpers';
import { RESUME_LIMIT_ERROR } from '#modules/agents/runner/service';
import { queueStepRun } from '#modules/engine/agent-runs';
import { registerBuiltins } from '#modules/engine/builtin/index';

// The owner's overview of the services around Helena: when each was last seen working,
// the agent runs that wait or overran, and what the engine does (queued, active,
// stalled and failed runs, enabled schedules).

registerBuiltins();

async function project(god: Awaited<ReturnType<typeof setup>>['god']) {
  const createdProject = await god.api.projects.post({ key: 'MKT', name: 'Marketing' });
  const view = (await god.api.projects({ projectKey: 'MKT' }).get()).data!;
  const created = await createAgent(god.api, 'MKT', { name: 'Ext Bot', username: 'ext' } as never);
  const issue = (
    await god.api.projects({ projectKey: 'MKT' }).issues.post({
      columnId: view.columns[0]!.id,
      title: 'Team task',
    })
  ).data!;
  const queueStage = () =>
    queueStepRun({
      agentId: created.data!.agent.id,
      projectId: createdProject.data!.id,
      issueId: issue.id,
      prompt: 'Complete the assignment.',
    });
  return {
    asRunner: apiKeyApi(created.data!.apiKey!),
    queueStage,
    projectId: createdProject.data!.id,
    issueId: issue.id,
  };
}

const service = (
  health: { services: { service: string }[] },
  name: string,
): Record<string, unknown> => health.services.find((item) => item.service === name)!;

describe('system health', () => {
  beforeEach(resetDb);

  it('shows the latest Vault check only to the owner and marks stale checks red', async () => {
    const dir = await mkdtemp(join(process.env.TMPDIR ?? tmpdir(), 'vault-health-'));
    const saved = process.env.VOLITION_VAULT_INTEGRITY_REPORT;
    process.env.VOLITION_VAULT_INTEGRITY_REPORT = join(dir, 'report.json');
    try {
      await writeFile(
        process.env.VOLITION_VAULT_INTEGRITY_REPORT,
        JSON.stringify({
          state: 'ok',
          checkedAt: new Date().toISOString(),
          findings: [],
        }),
      );
      const { god } = await setup();
      const member = await addUser({ email: 'member@example.com' });
      expect((await god.api.god['vault-integrity'].get()).data?.state).toBe('ok');
      expect((await member.api.god['vault-integrity'].get()).status).toBe(403);
      await writeFile(
        process.env.VOLITION_VAULT_INTEGRITY_REPORT,
        JSON.stringify({
          state: 'ok',
          checkedAt: '2020-01-01T00:00:00Z',
          findings: [],
        }),
      );
      const stale = (await god.api.god['vault-integrity'].get()).data;
      expect(stale?.state).toBe('down');
      expect(stale?.findings[0]?.code).toBe('stale_report');
    } finally {
      if (saved === undefined) delete process.env.VOLITION_VAULT_INTEGRITY_REPORT;
      else process.env.VOLITION_VAULT_INTEGRITY_REPORT = saved;
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('requires an exact dry run before the owner purges old Vault trash', async () => {
    const root = await mkdtemp(join(process.env.TMPDIR ?? tmpdir(), 'vault-purge-'));
    const saved = process.env.PROJECT_VAULT_ROOT;
    process.env.PROJECT_VAULT_ROOT = root;
    try {
      const { god } = await setup();
      const member = await addUser({ email: 'member@example.com' });
      const original = 'Home/Docs/Old.md';
      await god.api.knowledge.notes.put({ path: original, content: 'old' });
      await god.api.knowledge.trash.post({ path: original });
      const records = join(root, '.trash/.records');
      for (const name of await readdir(records)) {
        const file = join(records, name);
        const value = JSON.parse(await readFile(file, 'utf8'));
        value.trashedAt = '2020-01-01T00:00:00Z';
        await writeFile(file, JSON.stringify(value));
      }
      const preview = await god.api.god['vault-trash'].purge.post({ olderThanDays: 30 });
      expect(preview.data?.targets).toEqual([`.trash/${original}`]);
      expect((await member.api.god['vault-trash'].purge.post({ olderThanDays: 30 })).status).toBe(
        403,
      );
      expect(
        (
          await god.api.god['vault-trash'].purge.post({
            olderThanDays: 30,
            apply: true,
            confirmTargets: [],
          })
        ).status,
      ).toBe(409);
      const applied = await god.api.god['vault-trash'].purge.post({
        olderThanDays: 30,
        apply: true,
        confirmTargets: preview.data!.targets,
      });
      expect(applied.data?.applied).toBe(true);
    } finally {
      if (saved === undefined) delete process.env.PROJECT_VAULT_ROOT;
      else process.env.PROJECT_VAULT_ROOT = saved;
      await rm(root, { recursive: true, force: true });
    }
  });

  it('shows the shared model logins the token keeper reports, with the owners command', async () => {
    const dir = await mkdtemp(join(process.env.TMPDIR ?? tmpdir(), 'logins-'));
    const saved = process.env.HELENA_LOGIN_STATUS_DIR;
    process.env.HELENA_LOGIN_STATUS_DIR = dir;
    try {
      await writeFile(
        join(dir, 'hermes.json'),
        JSON.stringify({
          version: 1,
          reporter: 'helena-token-keeper',
          checkedAt: new Date().toISOString(),
          intervalSeconds: 600,
          logins: [
            {
              store: 'hermes',
              provider: 'anthropic',
              id: 'abc123',
              label: 'anthropic-oauth-1',
              managed: true,
              state: 'invalid',
              expiresAt: null,
              refreshedAt: null,
              error: 'HTTP 400 invalid_grant',
              command: 'hermes auth add anthropic --type oauth',
            },
          ],
          errors: [],
        }),
      );
      const { god } = await setup();
      const health = (await god.api.god['system-health'].get()).data!;
      expect(health.logins.problems).toBe(1);
      expect(health.logins.reports[0]).toMatchObject({ source: 'token-keeper', stale: false });
      expect(health.logins.reports[0]!.logins[0]).toMatchObject({
        provider: 'anthropic',
        state: 'invalid',
        command: 'hermes auth add anthropic --type oauth',
      });
    } finally {
      if (saved === undefined) delete process.env.HELENA_LOGIN_STATUS_DIR;
      else process.env.HELENA_LOGIN_STATUS_DIR = saved;
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('shows who reported and who was never seen', async () => {
    const { god } = await setup();
    await recordServiceCheck('engine', null);
    const health = (await god.api.god['system-health'].get()).data!;
    expect(health.services.map((item) => item.service)).toEqual([
      'runner',
      'engine',
      'provisioning',
      'worker',
    ]);
    expect(service(health, 'engine')).toMatchObject({ state: 'ok', error: null });
    expect(service(health, 'worker')).toMatchObject({ state: 'unknown', lastSeenAt: null });
    expect(service(health, 'runner')).toMatchObject({ state: 'unknown' });
  });

  it('counts the agent runs that wait and overran, and the runs of the engine', async () => {
    const { god } = await setup();
    const { asRunner, queueStage, projectId, issueId } = await project(god);
    await queueStage();
    await queueStage();
    const claimed = (await asRunner['agent-runs'].claim.post()).data!.run!;
    // A claim fifty minutes old, still leased: past the runner's 30-minute stop.
    await db
      .update(agentRun)
      .set({ claimedAt: sql`now() - interval '50 minutes'` })
      .where(eq(agentRun.id, claimed.id));
    const definition = { schemaVersion: 1, trigger: { type: 'delegation' }, roles: [], steps: [] };
    const run = (id: string, status: string, extra: Record<string, unknown> = {}) => ({
      id,
      kind: 'agent_team',
      definition,
      title: 'Agent team',
      projectId,
      issueId,
      trigger: 'manual',
      status,
      ...extra,
    });
    await db.insert(pipelineRun).values([
      run('queued', 'pending', { issueId: null }),
      run('stalled', 'running', {
        updatedAt: sql`now() - interval '1 hour'` as never,
        issueId: null,
      }),
      run('waiting', 'waiting', { issueId: null }),
      run('failed', 'failed', { error: 'Boom', finishedAt: new Date(), issueId: null }),
    ] as never);

    const health = (await god.api.god['system-health'].get()).data!;
    expect(service(health, 'runner')).toMatchObject({ state: 'ok' });
    expect(health.runs).toMatchObject({ waiting: 1, overdue: 1, failedLastDay: 0 });
    expect(health.runs.oldestWaitingSince).not.toBeNull();
    expect(health.engine).toMatchObject({
      queued: 1,
      active: 1,
      waiting: 1,
      failedLastDay: 1,
      stalled: 1,
      schedules: 0,
      lastErrors: [{ runId: 'failed', projectKey: 'MKT', name: 'Agent team', error: 'Boom' }],
    });
  });

  it("shows each janitor's last run, and stays down until one runs again", async () => {
    const { god } = await setup();
    const unknown = (await god.api.god['system-health'].get()).data!;
    expect(unknown.janitors).toEqual([
      { job: 'run-janitor', state: 'unknown', ranAt: null, cleaned: null, error: null },
      { job: 'resume-janitor', state: 'unknown', ranAt: null, cleaned: null, error: null },
      { job: 'engine-maintenance', state: 'unknown', ranAt: null, cleaned: null, error: null },
      { job: 'runtime-janitor', state: 'unknown', ranAt: null, cleaned: null, error: null },
    ]);

    await recordJanitorRun('run-janitor', 3, null);
    const ok = (await god.api.god['system-health'].get()).data!;
    const runJanitor = ok.janitors.find((j) => j.job === 'run-janitor')!;
    expect(runJanitor).toMatchObject({ state: 'ok', cleaned: 3, error: null });
    expect(runJanitor.ranAt).not.toBeNull();

    // A run that fails keeps the last count it found rather than resetting it.
    await recordJanitorRun('run-janitor', null, 'connection refused');
    const failed = (await god.api.god['system-health'].get()).data!;
    expect(failed.janitors.find((j) => j.job === 'run-janitor')).toMatchObject({
      state: 'down',
      cleaned: 3,
      error: 'connection refused',
    });

    // Stale: it ran once, long enough ago that it counts as stopped.
    await db.insert(janitorRun).values({
      job: 'engine-maintenance',
      ranAt: new Date(Date.now() - 86_400_000),
      cleaned: 5,
      error: null,
    });
    const stale = (await god.api.god['system-health'].get()).data!;
    expect(stale.janitors.find((j) => j.job === 'engine-maintenance')).toMatchObject({
      state: 'down',
      cleaned: 5,
      error: null,
    });
  });

  it('counts runs resuming a session and ones that reached the resume limit', async () => {
    const { god } = await setup();
    const { asRunner, queueStage } = await project(god);
    await queueStage();
    const claimed = (await asRunner['agent-runs'].claim.post()).data!.run!;
    await db
      .update(agentRun)
      .set({ sessionId: 'sess-health-1' })
      .where(eq(agentRun.id, claimed.id));
    const resuming = (await god.api.god['system-health'].get()).data!;
    expect(resuming.runs).toMatchObject({ resuming: 1, needsResumeReview: 0 });
    await db
      .update(agentRun)
      .set({ status: 'failed', lastError: RESUME_LIMIT_ERROR })
      .where(eq(agentRun.id, claimed.id));
    const needsReview = (await god.api.god['system-health'].get()).data!;
    expect(needsReview.runs).toMatchObject({ resuming: 0, needsResumeReview: 1 });
  });

  it("names why the runner could not start until an agent is seen again, and each agent's sync", async () => {
    const { god } = await setup();
    const { asRunner } = await project(god);
    // The runner polled and reported, but has not applied the current settings yet.
    await asRunner['agent-runs'].claim.post();
    await asRunner['agent-runtime'].status.post({
      adapter: 'hermes',
      status: 'online',
      appliedRevision: 'sha256:older',
      capabilities: [],
      detail: null,
    });
    const pending = (await god.api.god['system-health'].get()).data!;
    // The project's coordinator has no runner here.
    expect(pending.agents).toMatchObject({ total: 2, pending: 1, offline: 1, synced: 0 });
    expect(pending.agents.agents).toContainEqual(
      expect.objectContaining({ username: 'ext', state: 'pending', drift: [] }),
    );

    const failed = await asRunner['agent-runtime']['runner-health'].post({
      error: 'The isolated Hermes home conflicts with its global provider reference',
    });
    expect(failed.status).toBe(204);
    expect(service((await god.api.god['system-health'].get()).data!, 'runner')).toMatchObject({
      state: 'down',
      error: 'The isolated Hermes home conflicts with its global provider reference',
    });

    await asRunner['agent-runtime']['runner-health'].post({ error: null });
    await asRunner['agent-runs'].claim.post();
    expect(service((await god.api.god['system-health'].get()).data!, 'runner')).toMatchObject({
      state: 'ok',
      error: null,
    });
  });

  it('is for the instance owner only', async () => {
    await setup();
    const member = await addUser({ name: 'Member' });
    expect((await member.api.god['system-health'].get()).status).toBe(403);
  });
});
