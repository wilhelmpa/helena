import assert from 'node:assert/strict';
import test from 'node:test';
import { createMastraControlService, MastraControlError } from '../mastra-control.mjs';

const catalog = { flows: [{ id: 'inbox-triage' }, { id: 'agent-team' }, { id: 'agent-routine' }] };

function service(handler) {
  return createMastraControlService(
    { mastraApiUrl: 'http://127.0.0.1:4112/mastra/api/', mastraApiToken: 'upstream-token', catalog },
    { fetch: handler },
  );
}

function json(value, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
}

test('every Mastra request carries the upstream token and no identity headers', async () => {
  const calls = [];
  const control = service(async (url, init) => {
    calls.push(init.headers);
    return json({ runs: [] });
  });
  await control.execute({ schemaVersion: 1, operation: 'runs', workflowId: 'agent-team', projectRef: 'project:PRIV' });
  assert.deepEqual(calls, [{ accept: 'application/json', authorization: 'Bearer upstream-token' }]);
});

test('the catalog is answered without a Mastra request', async () => {
  const control = service(async () => assert.fail('Mastra was called'));
  assert.deepEqual(await control.execute({ schemaVersion: 1, operation: 'catalog' }), { catalog });
});

test('a workflow outside the catalog has no runs and Mastra is not asked', async () => {
  const control = service(async () => assert.fail('Mastra was called'));
  assert.deepEqual(
    await control.execute({ schemaVersion: 1, operation: 'runs', workflowId: 'support', projectRef: 'project:PRIV' }),
    { runs: [], total: 0 },
  );
});

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

function startRequest(eventId) {
  return {
    schemaVersion: 1,
    operation: 'start',
    workflowId: 'agent-team',
    projectRef: 'project:PRIV',
    organizationRef: 'organization:1',
    eventId,
    occurredAt: '2026-09-22T00:00:00Z',
    actorId: 'user-1',
    payload: {},
    capabilityRefs: [],
    connectionRefs: [],
  };
}

test('a start asked for again answers the run it started', async () => {
  const calls = [];
  const control = service(async (url, init) => {
    calls.push(`${init?.method ?? 'GET'} ${new URL(url).pathname}`);
    return json({ runId: 'event-1', resourceId: 'project:PRIV', status: 'running' });
  });
  const result = await control.execute(startRequest('event-1'));
  assert.equal(result.status, 'running');
  assert.deepEqual(calls, ['GET /mastra/api/workflows/agent-team/runs/event-1']);
});

test('a run created by a start that failed before starting it is started by the next start', async () => {
  const calls = [];
  const control = service(async (url, init) => {
    calls.push(`${init?.method ?? 'GET'} ${new URL(url).pathname}`);
    return json({ runId: 'event-2', resourceId: 'project:PRIV', status: 'pending' });
  });
  const result = await control.execute(startRequest('event-2'));
  assert.equal(result.status, 'running');
  assert.deepEqual(calls, [
    'GET /mastra/api/workflows/agent-team/runs/event-2',
    'POST /mastra/api/workflows/agent-team/start',
  ]);
});

test('concurrent starts of one event share one pair of Mastra calls', async () => {
  const calls = [];
  const control = service(async (url, init) => {
    calls.push(`${init?.method ?? 'GET'} ${new URL(url).pathname}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
    if (!init?.method) return json({}, 404);
    return json({ runId: 'event-3', status: 'pending' });
  });
  const [first, second] = await Promise.all([
    control.execute(startRequest('event-3')),
    control.execute(startRequest('event-3')),
  ]);
  assert.deepEqual(first, second);
  assert.deepEqual(calls, [
    'GET /mastra/api/workflows/agent-team/runs/event-3',
    'POST /mastra/api/workflows/agent-team/create-run',
    'POST /mastra/api/workflows/agent-team/start',
  ]);
});

test('an existing idempotency key cannot cross projects', async () => {
  const control = service(async () => json({ runId: 'same', resourceId: 'project:OTHER' }));
  await assert.rejects(
    () =>
      control.execute({
        schemaVersion: 1,
        operation: 'start',
        workflowId: 'inbox-triage',
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
        workflowId: 'inbox-triage',
        projectRef: 'project:PRIV',
        runId: 'run-1',
      }),
    (error) => error instanceof MastraControlError && error.status === 404,
  );
});

test('retry runs a failed run again from its failed step without waiting for it', async () => {
  const calls = [];
  const control = service(async (url, init = {}) => {
    calls.push({ url: String(url), init });
    if (init.method === 'POST') return json({ message: 'Workflow run time travel started' });
    return json({
      runId: 'run-1',
      resourceId: 'project:PRIV',
      status: 'failed',
      steps: {
        'prepare-team': { status: 'success' },
        coordinate: { status: 'success' },
        specialize: { status: 'failed' },
      },
    });
  });
  const result = await control.execute({
    schemaVersion: 1,
    operation: 'retry',
    workflowId: 'agent-team',
    projectRef: 'project:PRIV',
    runId: 'run-1',
  });
  const traveled = calls.at(-1);
  assert.match(traveled.url, /\/workflows\/agent-team\/time-travel\?runId=run-1$/);
  assert.deepEqual(JSON.parse(traveled.init.body), {
    step: 'specialize',
    requestContext: { projectRef: 'project:PRIV' },
  });
  assert.deepEqual(result, { runId: 'run-1', resourceId: 'project:PRIV', status: 'running' });
});

test('retry refuses a run that did not fail or has no failed step', async () => {
  for (const run of [
    { status: 'success', steps: {} },
    { status: 'failed', steps: { 'prepare-team': { status: 'success' } } },
  ]) {
    const control = service(async () => json({ runId: 'run-1', resourceId: 'project:PRIV', ...run }));
    await assert.rejects(
      () =>
        control.execute({
          schemaVersion: 1,
          operation: 'retry',
          workflowId: 'agent-team',
          projectRef: 'project:PRIV',
          runId: 'run-1',
        }),
      (error) => error instanceof MastraControlError && error.status === 409,
    );
  }
});

test('schedule listing filters by the stored project context', async () => {
  const control = service(async (url) => {
    if (String(url).endsWith('/triggers?limit=1')) return json({ triggers: [] });
    assert.match(String(url), /schedules\?workflowId=inbox-triage$/);
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
    workflowId: 'inbox-triage',
    projectRef: 'project:PRIV',
  });
  assert.deepEqual(result.schedules.map((item) => item.id), ['one']);
});

test('schedule listing across projects reports the newest fire of each schedule', async () => {
  const urls = [];
  const control = service(async (url) => {
    urls.push(String(url));
    const path = new URL(String(url)).pathname + new URL(String(url)).search;
    if (path.endsWith('schedules?workflowId=agent-routine')) {
      return json({
        schedules: [
          { id: 'one', requestContext: { projectRef: 'project:PRIV' } },
          { id: 'two', requestContext: { projectRef: 'project:VOL' } },
          { id: 'three', requestContext: { projectRef: 'project:VOL' } },
          { id: 'other', requestContext: { projectRef: 'project:OTHER' } },
        ],
      });
    }
    if (path.endsWith('/schedules/one/triggers?limit=1')) {
      return json({ triggers: [{ runId: 'manual_one', actualFireAt: 1790000000000, outcome: 'published' }] });
    }
    if (path.endsWith('/schedules/two/triggers?limit=1')) {
      return json({ triggers: [{ runId: 'sched_two_1', actualFireAt: 1790000000001, outcome: 'published' }] });
    }
    if (path.endsWith('/schedules/three/triggers?limit=1')) return json({ triggers: [] });
    if (path.endsWith('/runs/manual_one?fields=result,error')) {
      return json({
        runId: 'manual_one',
        status: 'success',
        result: { status: 'success', output: { status: 'created', taskRef: 'task:PRIV-4' }, payload: {} },
      });
    }
    return json({ error: 'not found' }, 404);
  });
  const result = await control.execute({
    schemaVersion: 1,
    operation: 'schedules',
    workflowId: 'agent-routine',
    projectRefs: ['project:PRIV', 'project:VOL'],
  });
  assert.deepEqual(result.schedules.map((item) => item.id), ['one', 'two', 'three']);
  assert.deepEqual(result.schedules.map((item) => item.lastRun), [
    {
      runId: 'manual_one',
      firedAt: 1790000000000,
      status: 'success',
      result: { status: 'created', taskRef: 'task:PRIV-4' },
      error: null,
    },
    { runId: 'sched_two_1', firedAt: 1790000000001, status: 'pending', result: null, error: null },
    null,
  ]);
  assert.equal(urls.filter((url) => url.includes('OTHER') || url.includes('/other/')).length, 0);
  await assert.rejects(
    () =>
      control.execute({
        schemaVersion: 1,
        operation: 'schedules',
        workflowId: 'agent-routine',
        projectRefs: ['PRIV'],
      }),
    (error) => error instanceof MastraControlError && error.status === 400,
  );
});

test('one schedule is read only through its own project and workflow', async () => {
  const control = service(async (url) => {
    const path = new URL(String(url)).pathname;
    if (path.endsWith('/triggers')) return json({ triggers: [] });
    return json({ id: 'one', workflowId: 'agent-routine', requestContext: { projectRef: 'project:PRIV' } });
  });
  const request = {
    schemaVersion: 1,
    operation: 'schedule',
    workflowId: 'agent-routine',
    projectRef: 'project:PRIV',
    scheduleId: 'one',
  };
  assert.equal((await control.execute(request)).lastRun, null);
  for (const other of [{ projectRef: 'project:VOL' }, { workflowId: 'agent-team' }]) {
    await assert.rejects(
      () => control.execute({ ...request, ...other }),
      (error) => error instanceof MastraControlError && error.status === 404,
    );
  }
});

test('schedule creation stores the scope and key without policies Mastra does not have', async () => {
  let created;
  const control = service(async (url, init = {}) => {
    if (init.method === 'POST') {
      created = JSON.parse(init.body);
      return json({ id: 'schedule_new' });
    }
    return json({ schedules: [] });
  });
  await control.execute({
    schemaVersion: 1,
    operation: 'create-schedule',
    workflowId: 'agent-routine',
    projectRef: 'project:PRIV',
    organizationRef: 'organization:1',
    capabilityRefs: [],
    connectionRefs: [],
    scheduleKey: '123e4567-e89b-42d3-a456-426614174000',
    cron: '0 9 * * 1',
    timezone: 'Europe/Berlin',
    payload: { eventId: 'template' },
    missedRunPolicy: 'run-once',
    concurrencyPolicy: 'replace',
  });
  assert.deepEqual(created.metadata, {
    projectRef: 'project:PRIV',
    source: 'itsaplan',
    scheduleKey: '123e4567-e89b-42d3-a456-426614174000',
  });
  assert.deepEqual(created.inputData, { eventId: 'template' });
  assert.equal(created.timezone, 'Europe/Berlin');
});

test('a schedule update replaces the stored input when a payload is given and keeps an unnamed time zone', async () => {
  const patches = [];
  const control = service(async (url, init = {}) => {
    if (init.method === 'PATCH') {
      patches.push(JSON.parse(init.body));
      return json({ id: 'schedule_one' });
    }
    return json({ id: 'schedule_one', workflowId: 'agent-routine', requestContext: { projectRef: 'project:PRIV' } });
  });
  const request = {
    schemaVersion: 1,
    operation: 'update-schedule',
    workflowId: 'agent-routine',
    projectRef: 'project:PRIV',
    scheduleId: 'schedule_one',
    cron: '0 9 * * 1',
    timezone: 'Europe/Berlin',
  };
  await control.execute(request);
  await control.execute({ ...request, payload: { eventId: 'changed' } });
  await control.execute({ ...request, timezone: undefined });
  assert.deepEqual(patches, [
    { cron: '0 9 * * 1', timezone: 'Europe/Berlin' },
    { cron: '0 9 * * 1', timezone: 'Europe/Berlin', inputData: { eventId: 'changed' } },
    { cron: '0 9 * * 1' },
  ]);
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
    if (String(url).endsWith('schedules?workflowId=inbox-triage')) {
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
    workflowId: 'inbox-triage',
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
    workflowId: 'inbox-triage',
    projectRef: 'project:PRIV',
  });
  assert.equal(result.runs[0].status, 'success');
});

test('runs of a schedule fire report their output like any other run', async () => {
  const evented = { status: 'success', output: { status: 'created', taskRef: 'task:PRIV-2' }, payload: {} };
  const control = service(async (url) =>
    String(url).includes('/runs?')
      ? json({ runs: [{ runId: 'sched_one_1', snapshot: { status: 'success', result: evented } }], total: 1 })
      : json({ runId: 'sched_one_1', resourceId: 'project:PRIV', status: 'success', result: evented }),
  );
  const request = { schemaVersion: 1, workflowId: 'agent-routine', projectRef: 'project:PRIV' };
  const listed = await control.execute({ ...request, operation: 'runs' });
  assert.deepEqual(listed.runs[0].snapshot.result, evented.output);
  const run = await control.execute({ ...request, operation: 'run', runId: 'sched_one_1' });
  assert.deepEqual(run.result, evented.output);
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
        workflowId: 'inbox-triage',
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
  const request = { schemaVersion: 1, operation: 'delete-project-schedules' };
  assert.deepEqual(await control.execute({ ...request, projectRef: 'project:PRIV' }), { deleted: 2 });
  assert.deepEqual(deleted, ['daily', 'gone']);
  await assert.rejects(control.execute({ ...request, projectRef: 'PRIV' }), MastraControlError);
});

test('active runs lists the running and waiting runs of every project', async () => {
  const paths = [];
  const control = service(async (url) => {
    const parsed = new URL(url);
    paths.push(`${parsed.pathname}${parsed.search}`);
    const status = parsed.searchParams.get('status');
    return json({
      runs: status === 'running'
        ? [{ runId: 'run-a', resourceId: 'project:A', updatedAt: '2026-09-23T10:00:00.000Z', snapshot: {} }]
        : [{ runId: 'run-b', resourceId: 'project:B', updatedAt: '2026-09-23T11:00:00.000Z' }],
    });
  });
  const result = await control.execute({ schemaVersion: 1, operation: 'active-runs', workflowId: 'agent-team' });
  assert.deepEqual(paths, [
    '/mastra/api/workflows/agent-team/runs?status=running&perPage=50',
    '/mastra/api/workflows/agent-team/runs?status=waiting&perPage=50',
  ]);
  assert.deepEqual(result.runs, [
    { runId: 'run-a', resourceId: 'project:A', status: 'running', updatedAt: '2026-09-23T10:00:00.000Z' },
    { runId: 'run-b', resourceId: 'project:B', status: 'waiting', updatedAt: '2026-09-23T11:00:00.000Z' },
  ]);
});
