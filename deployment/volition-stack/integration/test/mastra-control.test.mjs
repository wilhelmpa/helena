import assert from 'node:assert/strict';
import test from 'node:test';
import { createMastraControlService, MastraControlError } from '../mastra-control.mjs';

function service(handler) {
  return createMastraControlService(
    { mastraControlUrl: 'http://172.30.95.2:4111/mastra/api/', mastraControlOwnerEmail: 'owner@example.test' },
    { fetch: handler },
  );
}

function json(value, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
}

test('start creates the run in the project and starts it without waiting for it', async () => {
  const calls = [];
  const control = service(async (url, init) => {
    calls.push({ url: String(url), init });
    if (String(url).endsWith('/runs/123e4567-e89b-42d3-a456-426614174000')) return json({}, 404);
    return json({ runId: '123e4567-e89b-42d3-a456-426614174000', status: 'pending' });
  });
  const result = await control.execute({
    schemaVersion: 1,
    operation: 'start',
    workflowId: 'inbox-triage',
    projectRef: 'project:PRIV',
    organizationRef: 'organization:1',
    eventId: '123e4567-e89b-42d3-a456-426614174000',
    occurredAt: '2026-09-22T00:00:00Z',
    actorId: 'user-1',
    dryRun: true,
    payload: {},
    capabilityRefs: ['inbox-triage.v1'],
    connectionRefs: [],
  });
  const [created, started] = calls.slice(-2);
  assert.match(created.url, /\/workflows\/inbox-triage\/create-run\?runId=123e4567-e89b-42d3-a456-426614174000$/);
  assert.equal(JSON.parse(created.init.body).resourceId, 'project:PRIV');
  assert.match(started.url, /\/workflows\/inbox-triage\/start\?runId=123e4567-e89b-42d3-a456-426614174000$/);
  const body = JSON.parse(started.init.body);
  assert.equal(body.inputData.context.projectRef, 'project:PRIV');
  assert.deepEqual(body.inputData.context.capabilityRefs, ['inbox-triage.v1']);
  assert.deepEqual(result, {
    runId: '123e4567-e89b-42d3-a456-426614174000',
    resourceId: 'project:PRIV',
    status: 'running',
  });
});

test('an existing idempotency key cannot cross projects', async () => {
  const control = service(async () => json({ runId: 'same', resourceId: 'project:OTHER' }));
  await assert.rejects(
    () =>
      control.execute({
        schemaVersion: 1,
        operation: 'start',
        workflowId: 'support',
        projectRef: 'project:PRIV',
        eventId: 'same',
      }),
    (error) => error instanceof MastraControlError && error.status === 409,
  );
});

test('run controls reject a run from another project', async () => {
  const control = service(async () => json({ runId: 'run-1', resourceId: 'project:OTHER', status: 'failed' }));
  await assert.rejects(
    () =>
      control.execute({
        schemaVersion: 1,
        operation: 'retry',
        workflowId: 'support',
        projectRef: 'project:PRIV',
        runId: 'run-1',
      }),
    (error) => error instanceof MastraControlError && error.status === 404,
  );
});

test('schedule listing filters by the stored project context', async () => {
  const control = service(async (url) => {
    assert.match(String(url), /schedules\?workflowId=support$/);
    return json({
      schedules: [
        { id: 'one', requestContext: { projectRef: 'project:PRIV' } },
        { id: 'two', requestContext: { projectRef: 'project:OTHER' } },
      ],
    });
  });
  const result = await control.execute({
    schemaVersion: 1,
    operation: 'schedules',
    workflowId: 'support',
    projectRef: 'project:PRIV',
  });
  assert.deepEqual(result.schedules.map((item) => item.id), ['one']);
});

test('schedule creation is idempotent within one project and schedule key', async () => {
  const calls = [];
  const control = service(async (url, init = {}) => {
    calls.push({ url: String(url), init });
    if (String(url).endsWith('schedules?workflowId=agent-team')) {
      return json({
        schedules: [{
          id: 'existing',
          requestContext: { projectRef: 'project:PRIV' },
          metadata: { scheduleKey: 'daily-review' },
        }],
      });
    }
    throw new Error('unexpected mutation');
  });
  const result = await control.execute({
    schemaVersion: 1,
    operation: 'create-schedule',
    workflowId: 'agent-team',
    projectRef: 'project:PRIV',
    organizationRef: 'organization:1',
    capabilityRefs: ['hermes-team.v1'],
    connectionRefs: [],
    scheduleKey: 'daily-review',
    cron: '0 9 * * *',
    timezone: 'Europe/Berlin',
    payload: {},
  });
  assert.equal(result.id, 'existing');
  assert.equal(result.replayed, true);
  assert.equal(calls.length, 1);
});

test('concurrent schedule creation shares one Mastra mutation', async () => {
  let mutations = 0;
  const control = service(async (url, init = {}) => {
    if (String(url).endsWith('schedules?workflowId=system-audit')) {
      await new Promise(resolve => setTimeout(resolve, 5));
      return json({ schedules: [] });
    }
    if (String(url).endsWith('/schedules') && init.method === 'POST') {
      mutations += 1;
      return json({ id: 'new-schedule' });
    }
    throw new Error('unexpected request');
  });
  const request = {
    schemaVersion: 1,
    operation: 'create-schedule',
    workflowId: 'system-audit',
    projectRef: 'project:PRIV',
    organizationRef: 'organization:1',
    capabilityRefs: [],
    connectionRefs: [],
    scheduleKey: 'daily',
    cron: '0 7 * * *',
    timezone: 'Europe/Berlin',
    payload: {},
  };
  const [first, second] = await Promise.all([control.execute(request), control.execute(request)]);
  assert.equal(first.id, 'new-schedule');
  assert.deepEqual(second, first);
  assert.equal(mutations, 1);
});

test('run listing exposes the status stored in Mastra snapshots', async () => {
  const control = service(async () => json({ runs: [{ runId: 'run-1', snapshot: { status: 'success' } }], total: 1 }));
  const result = await control.execute({
    schemaVersion: 1,
    operation: 'runs',
    workflowId: 'system-audit',
    projectRef: 'project:PRIV',
  });
  assert.equal(result.runs[0].status, 'success');
});

test('run listing by task searches the newest project runs for that task', async () => {
  const urls = [];
  const run = (runId, taskRef) => ({
    runId,
    snapshot: { status: 'running', context: { input: { payload: { task: { taskRef } } } } },
  });
  const control = service(async (url) => {
    urls.push(String(url));
    const page = Number(new URL(String(url)).searchParams.get('page'));
    if (page === 0) return json({ runs: [run('r1', 'task:PRIV-1'), ...Array.from({ length: 19 }, (_, index) => run(`o${index}`, 'task:PRIV-2'))] });
    return json({ runs: [run('r2', 'task:PRIV-1'), run('r3', 'task:PRIV-10')] });
  });
  const result = await control.execute({
    schemaVersion: 1,
    operation: 'runs',
    workflowId: 'agent-team',
    projectRef: 'project:PRIV',
    taskRef: 'task:PRIV-1',
  });
  assert.deepEqual(result.runs.map((item) => item.runId), ['r1', 'r2']);
  assert.equal(result.total, 2);
  assert.equal(result.runs[0].status, 'running');
  assert.equal(urls.length, 2);
  assert.ok(urls.every((url) => url.includes('resourceId=project:PRIV') && url.includes('perPage=20')));
  await assert.rejects(
    () =>
      control.execute({
        schemaVersion: 1,
        operation: 'runs',
        workflowId: 'agent-team',
        projectRef: 'project:PRIV',
        taskRef: 'PRIV-1',
      }),
    (error) => error instanceof MastraControlError && error.status === 400,
  );
});

test('resume requires an explicit approval for a suspended owned run', async () => {
  const control = service(async () => json({ runId: 'run-1', resourceId: 'project:PRIV', status: 'suspended' }));
  await assert.rejects(
    () =>
      control.execute({
        schemaVersion: 1,
        operation: 'resume',
        workflowId: 'application',
        projectRef: 'project:PRIV',
        runId: 'run-1',
      }),
    (error) => error instanceof MastraControlError && error.status === 400,
  );
});

test("deleting a project's schedules leaves other projects and agent schedules alone", async () => {
  const deleted = [];
  const control = service(async (url, init = {}) => {
    const target = new URL(String(url));
    if (init.method === 'DELETE') {
      deleted.push(target.pathname.split('/').at(-1));
      return target.pathname.endsWith('/gone') ? json({ error: 'not found' }, 404) : json({});
    }
    assert.equal(target.pathname, '/mastra/api/schedules');
    assert.equal(target.search, '');
    return json({
      schedules: [
        { id: 'daily', workflowId: 'report', requestContext: { projectRef: 'project:PRIV' } },
        { id: 'gone', workflowId: 'report', requestContext: { projectRef: 'project:PRIV' } },
        { id: 'other', workflowId: 'report', requestContext: { projectRef: 'project:VOL' } },
        { id: 'agent_1', agentId: 'home', requestContext: { projectRef: 'project:PRIV' } },
      ],
    });
  });
  assert.equal(await control.deleteProjectSchedules('project:PRIV'), 2);
  assert.deepEqual(deleted, ['daily', 'gone']);
  await assert.rejects(control.deleteProjectSchedules('PRIV'), MastraControlError);
});
