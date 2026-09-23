import { beforeEach, describe, expect, it } from 'bun:test';
import { createHash } from 'node:crypto';
import { apiKeyApi, authedApi, type Api } from '#tests/helpers/app';
import { signUpTestUser } from '#tests/helpers/auth';
import { resetDb } from '#tests/helpers/db';
import { createAgent } from '#tests/helpers/agents';
import { controlApi, controlPlane, type ControlRequest } from '#tests/helpers/control';
import { processAgentTeamStarts } from '../../agent-team-starts';

// The agent team of a project, started from Plan: delegating an issue to a coordinator
// of a project that runs agent-team, or starting it on the issue directly. The Mastra
// control endpoint is a stand-in that records the requests Plan sends it.

const CAPABILITIES = ['hermes-team.v1', 'plan-task-sync.v1'];

async function setup() {
  const owner = await signUpTestUser({ name: 'Owner' });
  const asOwner = authedApi(owner.cookie);
  const created = await asOwner.projects.post({ key: 'MKT', name: 'Marketing' });
  const teamId = created.data!.teamId;
  const view = await asOwner.projects({ projectKey: 'MKT' }).get();
  const organization = asOwner.teams({ teamId }).organization;
  const coordinator = (await organization.get()).data!.agents.find(
    (agent) => agent.username === 'hermes-mkt-coordinator',
  )!;
  await organization.agents({ agentId: coordinator.id }).put({ role: 'coordinator' });
  return {
    owner,
    asOwner,
    teamId,
    organization,
    coordinator,
    columnId: view.data!.columns[0].id,
  };
}

async function specialist(asOwner: Api, teamId: number, username: string, capabilities: string[]) {
  const agent = (
    await createAgent(asOwner, 'MKT', {
      name: username,
      username,
      kind: 'external',
      triggerOnAssign: true,
    })
  ).data!.agent;
  await asOwner
    .teams({ teamId })
    .organization.agents({ agentId: agent.id })
    .put({ role: 'specialist', capabilities });
  return agent;
}

function enableAgentTeam(asOwner: Api, configuration: Record<string, unknown> = {}) {
  return asOwner
    .projects({ projectKey: 'MKT' })
    ['control-plane'].workflows({ workflowId: 'agent-team' })
    .put({ enabled: true, capabilityRefs: CAPABILITIES, configuration: configuration as never });
}

async function createIssue(asOwner: Api, columnId: number, body: Record<string, unknown> = {}) {
  return (
    await asOwner
      .projects({ projectKey: 'MKT' })
      .issues.post({ columnId, title: 'Launch page', ...body })
  ).data!;
}

// The key the agent-team workflow sends with a stage (teamIdempotencyKey in Mastra).
function stageKey(eventId: string, taskRef: string, phase: string, subject: string) {
  return createHash('sha256')
    .update(`agent-team\0${eventId}\0${taskRef}\0${phase}\0${subject}`)
    .digest('hex');
}

async function runsOf(asOwner: Api, teamId: number, agentId: number) {
  return (await asOwner.teams({ teamId })['ai-agents']({ agentId }).runs.get()).data!.items;
}

describe('agent team', () => {
  beforeEach(async () => {
    await resetDb();
    controlPlane.reset();
  });

  it('validates and completes the agent-team configuration', async () => {
    const { asOwner } = await setup();
    const listed = async () =>
      (
        (await asOwner.projects({ projectKey: 'MKT' })['control-plane'].workflows.get()).data as {
          id: string;
          assignment: { configuration: unknown };
        }[]
      ).find((flow) => flow.id === 'agent-team')!.assignment.configuration;

    expect(await listed()).toEqual({
      autonomy: 'review',
      reviewRequired: true,
      maxTurns: null,
      runBudgetSeconds: null,
    });
    for (const configuration of [
      { maxTurns: 0 },
      { maxTurns: 201 },
      { runBudgetSeconds: 59 },
      { runBudgetSeconds: 7_201 },
      { autonomy: 'always' },
      { autonomy: 'done', reviewRequired: false },
    ])
      expect((await enableAgentTeam(asOwner, configuration)).status).toBe(400);

    expect(
      (
        await enableAgentTeam(asOwner, {
          autonomy: 'done',
          maxTurns: 200,
          runBudgetSeconds: 7_200,
          instructions: 'Keep the scope small.',
        })
      ).status,
    ).toBe(200);
    expect(await listed()).toEqual({
      autonomy: 'done',
      reviewRequired: true,
      maxTurns: 200,
      runBudgetSeconds: 7_200,
      instructions: 'Keep the scope small.',
    });
    expect(
      (await enableAgentTeam(asOwner, { reviewRequired: false, maxTurns: 1, runBudgetSeconds: 60 }))
        .status,
    ).toBe(200);
  });

  it('hands an issue delegated to the coordinator to the agent team', async () => {
    const { asOwner, teamId, columnId, coordinator } = await setup();
    const designer = await specialist(asOwner, teamId, 'designer', ['frontend']);
    const writer = await specialist(asOwner, teamId, 'writer', ['docs', 'copy']);
    await enableAgentTeam(asOwner, { maxTurns: 40, runBudgetSeconds: 900, autonomy: 'done' });
    const labelId = (
      await asOwner.projects({ projectKey: 'MKT' }).labels.post({ name: 'Frontend' })
    ).data!.id;
    const issue = await createIssue(asOwner, columnId, {
      description:
        'Build the page.\n\n- [ ] Hero section\n  - [x] Mobile layout\n* [ ] No regressions',
      labelIds: [labelId],
    });

    await asOwner.issues({ issueId: issue.id }).patch({ delegateUserId: coordinator.userId });

    const [start] = controlPlane.started();
    expect(start).toMatchObject({
      workflowId: 'agent-team',
      projectRef: 'project:MKT',
      correlationId: `task:MKT-${issue.sequenceNumber}`,
      dryRun: false,
      capabilityRefs: CAPABILITIES,
      payload: {
        schemaVersion: 1,
        task: {
          taskRef: `task:MKT-${issue.sequenceNumber}`,
          title: 'Launch page',
          objective:
            'Build the page.\n\n- [ ] Hero section\n  - [x] Mobile layout\n* [ ] No regressions',
          acceptanceCriteria: ['Hero section', 'Mobile layout', 'No regressions'],
          labels: ['Frontend'],
        },
        coordinator: {
          agentRef: 'agent:hermes-mkt-coordinator',
          role: 'coordinator',
          capabilities: [],
        },
        specialists: [
          {
            agentRef: `agent:${designer.username}`,
            role: 'specialist',
            capabilities: ['frontend'],
          },
          {
            agentRef: `agent:${writer.username}`,
            role: 'specialist',
            capabilities: ['docs', 'copy'],
          },
        ],
        policy: { reviewRequired: true, autonomy: 'done', maxTurns: 40, runBudgetSeconds: 900 },
      },
    });
    expect(await runsOf(asOwner, teamId, coordinator.id)).toEqual([]);
  });

  it('lets the coordinator do the work when the project has no specialist', async () => {
    const { asOwner, teamId, columnId, coordinator } = await setup();
    await enableAgentTeam(asOwner);
    const issue = await createIssue(asOwner, columnId, { title: 'Write the brief' });

    await asOwner.issues({ issueId: issue.id }).patch({ delegateUserId: coordinator.userId });

    const [start] = controlPlane.started();
    const payload = start.payload as Record<string, unknown>;
    expect(payload).toMatchObject({
      task: {
        objective: 'Write the brief',
        acceptanceCriteria: ['The work item is done as its description asks.'],
        labels: [],
      },
      specialists: [{ agentRef: 'agent:hermes-mkt-coordinator', role: 'coordinator' }],
      policy: { reviewRequired: true, autonomy: 'review' },
    });
    expect(payload.policy).not.toHaveProperty('maxTurns');
    expect(await runsOf(asOwner, teamId, coordinator.id)).toEqual([]);
  });

  it('queues a direct run when the team does not apply or cannot start', async () => {
    const { asOwner, teamId, columnId, coordinator, organization } = await setup();
    const designer = await specialist(asOwner, teamId, 'designer', ['frontend']);

    const disabled = await createIssue(asOwner, columnId);
    await asOwner.issues({ issueId: disabled.id }).patch({ delegateUserId: coordinator.userId });
    expect(controlPlane.started()).toEqual([]);
    expect(await runsOf(asOwner, teamId, coordinator.id)).toHaveLength(1);

    await enableAgentTeam(asOwner);
    const toSpecialist = await createIssue(asOwner, columnId);
    await asOwner.issues({ issueId: toSpecialist.id }).patch({ delegateUserId: designer.userId });
    expect(controlPlane.started()).toEqual([]);
    expect(await runsOf(asOwner, teamId, designer.id)).toHaveLength(1);

    controlPlane.answer = (request) =>
      request.operation === 'start'
        ? Response.json({ message: 'The run belongs to another project' }, { status: 409 })
        : {};
    const refused = await createIssue(asOwner, columnId);
    await asOwner.issues({ issueId: refused.id }).patch({ delegateUserId: coordinator.userId });
    expect(controlPlane.started()).toHaveLength(1);
    expect(await runsOf(asOwner, teamId, coordinator.id)).toHaveLength(2);

    controlPlane.reset();
    await organization.agents({ agentId: coordinator.id }).put({ role: null });
    const notCoordinator = await createIssue(asOwner, columnId);
    await asOwner
      .issues({ issueId: notCoordinator.id })
      .patch({ delegateUserId: coordinator.userId });
    expect(controlPlane.started()).toEqual([]);
    expect(await runsOf(asOwner, teamId, coordinator.id)).toHaveLength(3);
  });

  it('starts the agent team on request and replays the same idempotency key', async () => {
    const { asOwner, columnId, organization, coordinator } = await setup();
    const issue = await createIssue(asOwner, columnId);
    const start = (idempotencyKey?: string) =>
      asOwner.issues({ issueId: issue.id })['agent-team'].post({ idempotencyKey });

    const notEnabled = await start();
    expect(notEnabled.status).toBe(409);

    await enableAgentTeam(asOwner);
    const key = crypto.randomUUID();
    const started = await start(key);
    expect(started.status).toBe(200);
    expect(started.data).toEqual({
      runId: key,
      status: 'running',
      taskRef: `task:MKT-${issue.sequenceNumber}`,
    });
    expect(controlPlane.started()[0]).toMatchObject({
      eventId: key,
      payload: { coordinator: { agentRef: 'agent:hermes-mkt-coordinator' } },
    });
    expect((await start('not-a-uuid')).status).toBe(400);

    await organization.agents({ agentId: coordinator.id }).put({ role: null });
    const noCoordinator = await start();
    expect(noCoordinator.status).toBe(409);
    expect(noCoordinator.error?.value).toMatchObject({
      error: 'The project has no coordinator agent',
    });
  });

  it('leaves a paused specialist out and refuses a paused coordinator', async () => {
    const { asOwner, teamId, columnId, organization, coordinator } = await setup();
    const designer = await specialist(asOwner, teamId, 'designer', ['frontend']);
    const writer = await specialist(asOwner, teamId, 'writer', ['docs']);
    await enableAgentTeam(asOwner);
    const issue = await createIssue(asOwner, columnId);
    const start = () => asOwner.issues({ issueId: issue.id })['agent-team'].post({});

    await organization.agents({ agentId: writer.id }).pause.post({});
    expect((await start()).status).toBe(200);
    expect(controlPlane.started()[0]).toMatchObject({
      payload: { specialists: [{ agentRef: `agent:${designer.username}` }] },
    });
    expect(
      (controlPlane.started()[0].payload as { specialists: unknown[] }).specialists,
    ).toHaveLength(1);

    await organization.agents({ agentId: coordinator.id }).pause.post({});
    const refused = await start();
    expect(refused.status).toBe(409);
    expect(refused.error?.value).toMatchObject({
      error: 'The coordinator @hermes-mkt-coordinator is paused',
    });
  });

  it('needs the delegate to choose between several coordinators', async () => {
    const { asOwner, teamId, columnId } = await setup();
    const second = (
      await createAgent(asOwner, 'MKT', { name: 'Lead', username: 'lead', kind: 'external' })
    ).data!.agent;
    await asOwner
      .teams({ teamId })
      .organization.agents({ agentId: second.id })
      .put({ role: 'coordinator' });
    await enableAgentTeam(asOwner);
    const issue = await createIssue(asOwner, columnId);
    const start = () => asOwner.issues({ issueId: issue.id })['agent-team'].post({});

    expect((await start()).status).toBe(409);
    await asOwner.issues({ issueId: issue.id }).patch({ delegateUserId: second.userId });
    controlPlane.reset();
    expect((await start()).status).toBe(200);
    expect(controlPlane.started()[0]).toMatchObject({
      payload: { coordinator: { agentRef: 'agent:lead' } },
    });
  });

  it('lists the agent-team runs of the issue', async () => {
    const { asOwner, columnId } = await setup();
    const issue = await createIssue(asOwner, columnId);
    controlPlane.answer = (request) =>
      request.operation === 'runs'
        ? {
            runs: [
              {
                runId: 'run-2',
                status: 'running',
                createdAt: '2026-09-23T10:00:00.000Z',
                updatedAt: '2026-09-23T10:05:00.000Z',
                snapshot: {
                  status: 'running',
                  context: {
                    input: {},
                    'prepare-team': { status: 'success' },
                    coordinate: { status: 'running' },
                  },
                },
              },
              {
                runId: 'run-1',
                status: 'failed',
                createdAt: '2026-09-22T10:00:00.000Z',
                updatedAt: '2026-09-22T10:01:00.000Z',
                snapshot: {
                  status: 'failed',
                  context: { input: {}, 'prepare-team': { status: 'failed' } },
                  error: { message: 'Agent team execution requires a project context' },
                },
              },
            ],
            total: 2,
          }
        : {};

    const res = await asOwner.issues({ issueId: issue.id })['agent-team'].runs.get();
    expect(res.status).toBe(200);
    expect(res.data).toMatchObject([
      {
        runId: 'run-2',
        status: 'running',
        steps: [
          { id: 'prepare-team', status: 'success' },
          { id: 'coordinate', status: 'running' },
        ],
        stages: [],
        result: null,
        error: null,
      },
      {
        runId: 'run-1',
        status: 'failed',
        steps: [{ id: 'prepare-team', status: 'failed' }],
        error: 'Agent team execution requires a project context',
      },
    ]);
    expect(controlPlane.requests.at(-1)).toMatchObject({
      operation: 'runs',
      workflowId: 'agent-team',
      projectRef: 'project:MKT',
      taskRef: `task:MKT-${issue.sequenceNumber}`,
    });
  });

  it('shows the Hermes run behind each stage with its duration and tokens', async () => {
    const { asOwner, columnId } = await setup();
    const created = await createAgent(asOwner, 'MKT', {
      name: 'Designer',
      username: 'designer',
      kind: 'external',
    });
    const asRunner = apiKeyApi(created.data!.apiKey!);
    const issue = await createIssue(asOwner, columnId);
    const taskRef = `task:MKT-${issue.sequenceNumber}`;
    const queue = async (phase: string, subject: string) => {
      const res = await controlApi().internal.orchestration['agent-run'].post({
        projectRef: 'project:MKT',
        task: { taskRef },
        agent: { agentRef: 'agent:designer' },
        idempotencyKey: stageKey('run-1', taskRef, phase, subject),
        prompt: `Run the ${phase} stage.`,
        policy: { leaseSeconds: 300, heartbeatSeconds: 60, maxAttempts: 3 },
      });
      return (res.data as unknown as { runId: number }).runId;
    };
    const coordinated = await queue('coordinate', taskRef);
    await asRunner['agent-runs'].claim.post();
    await asRunner['agent-runs']({ runId: coordinated }).result.post({
      status: 'success',
      output: '{}',
      usage: { inputTokens: 900, outputTokens: 100 },
    });
    const specialized = await queue('specialize', 'assignment-1');
    await asRunner['agent-runs'].claim.post();
    controlPlane.answer = (request) =>
      request.operation === 'runs'
        ? {
            runs: [
              {
                runId: 'run-1',
                status: 'running',
                createdAt: '2026-09-23T10:00:00.000Z',
                snapshot: {
                  status: 'running',
                  context: {
                    input: {
                      eventId: 'run-1',
                      correlationId: taskRef,
                      payload: { task: { taskRef } },
                    },
                    coordinate: {
                      status: 'success',
                      output: {
                        delegations: [
                          { assignmentId: 'assignment-1' },
                          { assignmentId: 'assignment-2' },
                        ],
                      },
                    },
                    specialize: { status: 'running' },
                  },
                },
              },
            ],
          }
        : {};

    const res = await asOwner.issues({ issueId: issue.id })['agent-team'].runs.get();
    expect(res.status).toBe(200);
    const agent = { id: created.data!.agent.id, username: 'designer', name: 'Designer' };
    expect(res.data![0]!.stages).toEqual([
      {
        phase: 'coordinate',
        assignmentId: null,
        agentRunId: coordinated,
        agent,
        status: 'success',
        startedAt: expect.anything(),
        finishedAt: expect.anything(),
        durationMs: expect.any(Number),
        inputTokens: 900,
        outputTokens: 100,
      },
      {
        phase: 'specialize',
        assignmentId: 'assignment-1',
        agentRunId: specialized,
        agent,
        status: 'running',
        startedAt: expect.anything(),
        finishedAt: null,
        durationMs: null,
        inputTokens: null,
        outputTokens: null,
      },
    ]);
  });

  it('keeps the agent team of an issue to its project members', async () => {
    const { asOwner, columnId } = await setup();
    await enableAgentTeam(asOwner);
    const issue = await createIssue(asOwner, columnId);
    const outsider = authedApi((await signUpTestUser({ name: 'Outsider' })).cookie);

    expect((await outsider.issues({ issueId: issue.id })['agent-team'].post({})).status).toBe(403);
    expect((await outsider.issues({ issueId: issue.id })['agent-team'].runs.get()).status).toBe(
      403,
    );
    expect((await asOwner.issues({ issueId: 999_999 })['agent-team'].post({})).status).toBe(404);
    expect(controlPlane.started()).toEqual([]);
  });
});

// A delegation to a coordinator is recorded before Mastra is asked. A start Mastra does
// not answer is asked for again with the same event id, and never falls back to a run of
// the coordinator, which would do the work a second time if Mastra had started the team.
describe('agent team start', () => {
  beforeEach(async () => {
    await resetDb();
    controlPlane.reset();
    process.env.AGENT_TEAM_START_RETRY_SECONDS = '1';
  });

  // Mastra down for starts only; everything else is answered as before.
  function mastraDown() {
    const answers = controlPlane.answer;
    return (request: ControlRequest) =>
      request.operation === 'start'
        ? Response.json({ message: 'Workflow control plane is unavailable' }, { status: 502 })
        : answers(request);
  }
  const retryIsDue = () => Bun.sleep(1_100);
  const eventIds = () => controlPlane.started().map((request) => request.eventId);

  async function delegated() {
    const context = await setup();
    await enableAgentTeam(context.asOwner);
    const issue = await createIssue(context.asOwner, context.columnId);
    const delegate = (userId: string | null) =>
      context.asOwner.issues({ issueId: issue.id }).patch({ delegateUserId: userId });
    return { ...context, issue, delegate };
  }

  it('asks a Mastra that did not answer again with the same event id', async () => {
    const { asOwner, teamId, coordinator, delegate } = await delegated();
    controlPlane.answer = mastraDown();
    await delegate(coordinator.userId);
    expect(eventIds()).toHaveLength(1);
    expect(await runsOf(asOwner, teamId, coordinator.id)).toEqual([]);

    await processAgentTeamStarts();
    expect(eventIds()).toHaveLength(1);

    controlPlane.answer = (request) =>
      request.operation === 'start'
        ? { runId: request.eventId, resourceId: request.projectRef, status: 'running' }
        : {};
    await retryIsDue();
    await processAgentTeamStarts();
    const [first, second] = eventIds();
    expect(second).toBe(first);
    await retryIsDue();
    await processAgentTeamStarts();
    expect(eventIds()).toHaveLength(2);
    expect(await runsOf(asOwner, teamId, coordinator.id)).toEqual([]);
  });

  it('queues the coordinator run when Mastra refuses a start it was asked for again', async () => {
    const { asOwner, teamId, coordinator, delegate } = await delegated();
    controlPlane.answer = mastraDown();
    await delegate(coordinator.userId);

    await asOwner
      .projects({ projectKey: 'MKT' })
      ['control-plane'].workflows({ workflowId: 'agent-team' })
      .put({ enabled: false, capabilityRefs: CAPABILITIES });
    await retryIsDue();
    await processAgentTeamStarts();
    expect(await runsOf(asOwner, teamId, coordinator.id)).toHaveLength(1);
  });

  it('keeps one start for an issue delegated again while it waits for Mastra', async () => {
    const { coordinator, delegate } = await delegated();
    controlPlane.answer = mastraDown();
    await delegate(coordinator.userId);
    await delegate(null);
    await delegate(coordinator.userId);
    expect(eventIds()).toHaveLength(1);
  });

  it('drops a waiting start when the issue is delegated to someone else', async () => {
    const { asOwner, teamId, coordinator, delegate } = await delegated();
    const designer = await specialist(asOwner, teamId, 'designer', ['frontend']);
    controlPlane.answer = mastraDown();
    await delegate(coordinator.userId);
    await delegate(designer.userId);

    controlPlane.reset();
    await retryIsDue();
    await processAgentTeamStarts();
    expect(controlPlane.started()).toEqual([]);
    expect(await runsOf(asOwner, teamId, coordinator.id)).toEqual([]);
    expect(await runsOf(asOwner, teamId, designer.id)).toHaveLength(1);
  });

  it('starts no second team run while the first one works on the issue', async () => {
    const { coordinator, delegate } = await delegated();
    await delegate(coordinator.userId);
    const [first] = eventIds();

    let status = 'running';
    controlPlane.answer = (request) =>
      request.operation === 'run' && request.runId === first
        ? { runId: first, status }
        : request.operation === 'start'
          ? { runId: request.eventId, status: 'running' }
          : {};
    await delegate(null);
    await delegate(coordinator.userId);
    expect(eventIds()).toEqual([first]);

    status = 'success';
    await delegate(null);
    await delegate(coordinator.userId);
    expect(eventIds()).toHaveLength(2);
    expect(eventIds()[1]).not.toBe(first);
  });
});
