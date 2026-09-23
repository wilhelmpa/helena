import { beforeEach, describe, expect, it } from 'bun:test';
import { apiKeyApi, app, authedApi, type Api } from '#tests/helpers/app';
import { signUpTestUser } from '#tests/helpers/auth';
import { resetDb } from '#tests/helpers/db';
import { createAgent, setAgentProjectRole } from '#tests/helpers/agents';
import { addProjectMember } from '#tests/helpers/members';
import { controlPlane } from '#tests/helpers/control';
import { createRole } from '#tests/helpers/roles';

// An agent asks before it acts outside Plan: the request records the run and the issue
// it came from, the people who may decide are told, and the decision queues a run of
// the agent that carries it.

async function setup() {
  const owner = await signUpTestUser({ name: 'Owner' });
  const asOwner = authedApi(owner.cookie);
  await asOwner.projects.post({ key: 'MKT', name: 'Marketing' });
  const view = await asOwner.projects({ projectKey: 'MKT' }).get();
  const columnId = view.data!.columns[0].id;
  const created = await createAgent(asOwner, 'MKT', {
    name: 'Ext Bot',
    username: 'ext',
    kind: 'external',
    triggerOnMention: true,
  });
  const apiKey = created.data!.apiKey!;
  return {
    owner,
    asOwner,
    columnId,
    agent: created.data!.agent,
    apiKey,
    asAgent: apiKeyApi(apiKey),
  };
}

// Mentions the agent on a new issue and claims the run it starts, which leaves the
// agent executing it.
async function startRun(asOwner: Api, asAgent: Api, columnId: number) {
  const issue = (
    await asOwner.projects({ projectKey: 'MKT' }).issues.post({ columnId, title: 'Offer' })
  ).data!;
  await asOwner.issues({ issueId: issue.id }).comments.post({ body: 'send the offer @ext' });
  const run = (await asAgent['agent-runs'].claim.post()).data!.run!;
  return { issue, run };
}

function requestApproval(asAgent: Api, body: Record<string, unknown> = {}) {
  return asAgent.projects({ projectKey: 'MKT' }).approvals.post({
    kind: 'send',
    action: 'Send the offer to jane@example.com',
    details: 'Subject: Offer\n\nHello Jane, ...',
    ...body,
  } as never);
}

describe('approval requests', () => {
  beforeEach(async () => {
    await resetDb();
    controlPlane.reset();
  });

  it('records the run and the issue the request came from', async () => {
    const { asOwner, asAgent, columnId, agent } = await setup();
    const { issue, run } = await startRun(asOwner, asAgent, columnId);

    const res = await requestApproval(asAgent);
    expect(res.status).toBe(201);
    expect(res.data).toMatchObject({
      projectKey: 'MKT',
      agentId: agent.id,
      agentName: 'Ext Bot',
      agentUsername: 'ext',
      runId: run.id,
      issueId: issue.id,
      issueIdentifier: `MKT-${issue.sequenceNumber}`,
      issueTitle: 'Offer',
      kind: 'send',
      action: 'Send the offer to jane@example.com',
      details: 'Subject: Offer\n\nHello Jane, ...',
      status: 'pending',
      decidedByUserId: null,
      note: null,
      followUpRunId: null,
    });
  });

  it('answers a repeated request of the same run with the first one', async () => {
    const { asOwner, asAgent, columnId } = await setup();
    await startRun(asOwner, asAgent, columnId);

    const first = await requestApproval(asAgent);
    const again = await requestApproval(asAgent);
    expect(again.status).toBe(200);
    expect(again.data!.id).toBe(first.data!.id);

    const other = await requestApproval(asAgent, { action: 'Send the invoice' });
    expect(other.status).toBe(201);
    expect(other.data!.id).not.toBe(first.data!.id);
  });

  it('takes a request without a run and without an issue', async () => {
    const { asAgent } = await setup();
    const res = await requestApproval(asAgent, { kind: 'pay' });
    expect(res.status).toBe(201);
    expect(res.data).toMatchObject({ runId: null, issueId: null, kind: 'pay' });
  });

  it('validates the request', async () => {
    const { asOwner, asAgent, columnId } = await setup();
    expect((await requestApproval(asAgent, { kind: 'transfer' })).status).toBe(400);
    expect((await requestApproval(asAgent, { action: '' })).status).toBe(400);
    expect((await requestApproval(asAgent, { action: 'x'.repeat(301) })).status).toBe(400);
    expect((await requestApproval(asAgent, { action: 'x'.repeat(300) })).status).toBe(201);
    expect((await requestApproval(asAgent, { details: 'x'.repeat(8001) })).status).toBe(400);

    await asOwner.projects.post({ key: 'OPS', name: 'Ops' });
    const view = await asOwner.projects({ projectKey: 'OPS' }).get();
    const foreign = (
      await asOwner
        .projects({ projectKey: 'OPS' })
        .issues.post({ columnId: view.data!.columns[0].id, title: 'Elsewhere' })
    ).data!;
    expect((await requestApproval(asAgent, { issueId: foreign.id })).status).toBe(400);

    const own = (
      await asOwner.projects({ projectKey: 'MKT' }).issues.post({ columnId, title: 'Here' })
    ).data!;
    const named = await requestApproval(asAgent, { issueId: own.id, action: 'Publish it' });
    expect(named.data!.issueId).toBe(own.id);
  });

  it('refuses a person and an unknown project', async () => {
    const { asOwner, asAgent } = await setup();
    expect((await requestApproval(asOwner)).status).toBe(403);
    const res = await asAgent.projects({ projectKey: 'NOPE' }).approvals.post({
      kind: 'send',
      action: 'Send it',
    });
    expect(res.status).toBe(404);
  });

  it('tells the people who may decide on the issue', async () => {
    const { asOwner, asAgent, columnId } = await setup();
    const asMember = await addProjectMember(asOwner, 'MKT');
    const { issue } = await startRun(asOwner, asAgent, columnId);
    await requestApproval(asAgent);

    const inbox = await asOwner.notifications.get({ query: { types: 'approval_requested' } });
    expect(inbox.data!.items).toHaveLength(1);
    expect(inbox.data!.items[0]).toMatchObject({
      type: 'approval_requested',
      actorName: 'Ext Bot',
      issueId: issue.id,
    });
    const memberInbox = await asMember.notifications.get({
      query: { types: 'approval_requested' },
    });
    expect(memberInbox.data!.items).toHaveLength(0);
  });

  it('lists and counts the pending requests for the people who may decide', async () => {
    const { asOwner, asAgent } = await setup();
    const asMember = await addProjectMember(asOwner, 'MKT');
    const created = (await requestApproval(asAgent)).data!;

    const pending = await asOwner.approvals.get({ query: {} });
    expect(pending.data).toMatchObject({ total: 1, page: 1, pageSize: 25 });
    expect(pending.data!.items[0].id).toBe(created.id);
    expect((await asOwner.approvals['pending-count'].get()).data).toEqual({ count: 1 });
    expect((await asOwner.approvals.get({ query: { status: 'decided' } })).data!.total).toBe(0);

    expect((await asMember.approvals.get({ query: {} })).data!.total).toBe(0);
    expect((await asMember.approvals['pending-count'].get()).data).toEqual({ count: 0 });
  });

  it('lets the agent that asked and the people who may decide read a request', async () => {
    const { asOwner, asAgent } = await setup();
    const asMember = await addProjectMember(asOwner, 'MKT');
    const created = (await requestApproval(asAgent)).data!;

    expect((await asAgent.approvals({ approvalId: created.id }).get()).status).toBe(200);
    expect((await asOwner.approvals({ approvalId: created.id }).get()).data!.id).toBe(created.id);
    expect((await asMember.approvals({ approvalId: created.id }).get()).status).toBe(403);
    const stranger = authedApi((await signUpTestUser({ name: 'Stranger' })).cookie);
    expect((await stranger.approvals({ approvalId: created.id }).get()).status).toBe(403);
    expect((await asOwner.approvals({ approvalId: created.id + 1000 }).get()).status).toBe(404);
  });

  it('decides once and queues a run of the agent with the decision and the note', async () => {
    const { asOwner, asAgent, columnId } = await setup();
    const { issue, run } = await startRun(asOwner, asAgent, columnId);
    const created = (await requestApproval(asAgent)).data!;
    await asAgent['agent-runs']({ runId: run.id }).result.post({
      status: 'success',
      output: 'Asked for approval.',
    });

    const decided = await asOwner
      .approvals({ approvalId: created.id })
      .decision.post({ approved: true, note: ' CC me on it ' });
    expect(decided.status).toBe(200);
    expect(decided.data).toMatchObject({
      status: 'approved',
      decidedByName: 'Owner',
      note: 'CC me on it',
      followUpRunId: expect.any(Number),
    });
    expect(decided.data!.decidedAt).toBeInstanceOf(Date);

    const again = await asOwner
      .approvals({ approvalId: created.id })
      .decision.post({ approved: false });
    expect(again.status).toBe(409);

    const next = (await asAgent['agent-runs'].claim.post()).data!.run!;
    expect(next).toMatchObject({
      id: decided.data!.followUpRunId,
      trigger: 'approval',
      issueId: issue.id,
    });
    expect(next.prompt).toContain('A person decided on an approval request you made earlier.');
    expect(next.prompt).toContain(
      `Approval request #${created.id} (send): Send the offer to jane@example.com`,
    );
    expect(next.prompt).toContain('Hello Jane');
    expect(next.prompt).toContain('Decision: approved by Owner');
    expect(next.prompt).toContain('Note: CC me on it');
    expect(next.systemPrompt).toContain('decided on your approval request');

    expect((await asOwner.approvals['pending-count'].get()).data).toEqual({ count: 0 });
    const decidedList = await asOwner.approvals.get({ query: { status: 'decided' } });
    expect(decidedList.data!.items.map((item) => item.id)).toEqual([created.id]);
  });

  it('queues the run of a rejected request made outside an issue', async () => {
    const { asOwner, asAgent } = await setup();
    const created = (await requestApproval(asAgent, { kind: 'delete' })).data!;

    const decided = await asOwner
      .approvals({ approvalId: created.id })
      .decision.post({ approved: false });
    expect(decided.data).toMatchObject({ status: 'rejected', note: null });

    const next = (await asAgent['agent-runs'].claim.post()).data!.run!;
    expect(next).toMatchObject({ trigger: 'approval', issueId: null });
    expect(next.prompt).toContain('Decision: rejected by Owner');
    expect(next.prompt).not.toContain('add_comment');
  });

  it('leaves the decision to the people who may decide', async () => {
    const { asOwner, asAgent, agent } = await setup();
    const asMember = await addProjectMember(asOwner, 'MKT');
    const created = (await requestApproval(asAgent)).data!;

    const decide = (api: Api) =>
      api.approvals({ approvalId: created.id }).decision.post({ approved: true });
    expect((await decide(asMember)).status).toBe(403);
    // Not even an agent whose role may decide.
    const role = await createRole(asOwner, 'MKT', {
      name: 'Agent Admin',
      permissions: { ai_agents: { create: true, read: true, edit: true, delete: true } },
    });
    await setAgentProjectRole(asOwner, 'MKT', agent.userId, role.data!.id);
    expect((await decide(asAgent)).status).toBe(403);
    expect(
      (
        await asOwner
          .approvals({ approvalId: created.id })
          .decision.post({ approved: true, note: 'x'.repeat(2001) })
      ).status,
    ).toBe(400);
    expect((await decide(asOwner)).status).toBe(200);
  });
});

async function rpc(apiKey: string, method: string, params: Record<string, unknown> = {}) {
  const res = await app.handle(
    new Request('http://localhost/mcp', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${apiKey}`,
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    }),
  );
  const text = await res.text();
  return JSON.parse(text.slice(text.indexOf('data: ') + 6)).result;
}

describe('approval tools over MCP', () => {
  beforeEach(resetDb);

  it('lets an agent request an approval and read its status', async () => {
    const { asOwner, apiKey } = await setup();
    const { tools } = await rpc(apiKey, 'tools/list');
    const names = tools.map((tool: { name: string }) => tool.name);
    expect(names).toContain('request_approval');
    expect(names).toContain('get_approval');

    const requested = await rpc(apiKey, 'tools/call', {
      name: 'request_approval',
      arguments: { projectKey: 'MKT', kind: 'publish', action: 'Publish the launch post' },
    });
    expect(requested.isError).toBeFalsy();
    const { id, status } = JSON.parse(requested.content[0].text);
    expect(status).toBe('pending');

    await asOwner.approvals({ approvalId: id }).decision.post({ approved: false, note: 'Wait' });
    const read = await rpc(apiKey, 'tools/call', {
      name: 'get_approval',
      arguments: { approvalId: id },
    });
    expect(JSON.parse(read.content[0].text)).toMatchObject({
      status: 'rejected',
      note: 'Wait',
    });
  });
});

describe('workflow approval gates', () => {
  beforeEach(async () => {
    await resetDb();
    controlPlane.reset();
  });

  const suspendedRun = {
    runId: 'run-1',
    status: 'suspended',
    createdAt: '2026-09-20T10:00:00.000Z',
    snapshot: {
      status: 'suspended',
      context: {
        'prepare-plan': {
          status: 'success',
          output: {
            summary: 'Reply prepared',
            effects: [
              { description: 'Classify the support request', requiresApproval: false },
              { description: 'Send the prepared reply', requiresApproval: true },
            ],
          },
        },
        'approval-gate': {
          status: 'suspended',
          suspendPayload: { reason: 'External writes and sends require explicit human approval.' },
        },
      },
    },
  };

  function answer(runs: (request: Record<string, unknown>) => unknown) {
    controlPlane.answer = (request) => {
      if (request.operation === 'catalog')
        return {
          catalog: {
            flows: [
              { id: 'support', name: 'Support', externalEffects: true, capabilityRefs: [] },
              { id: 'system-audit', name: 'System audit', externalEffects: false },
            ],
          },
        };
      if (request.operation === 'runs') return runs(request);
      return {};
    };
  }

  async function enable(asOwner: Api, workflowId: string) {
    await asOwner
      .projects({ projectKey: 'MKT' })
      ['control-plane'].workflows({ workflowId })
      .put({ enabled: true, capabilityRefs: [] });
  }

  it('lists the runs suspended at their gate in the projects the caller may decide', async () => {
    const { asOwner } = await setup();
    const asMember = await addProjectMember(asOwner, 'MKT');
    answer(() => ({
      runs: [suspendedRun, { ...suspendedRun, runId: 'run-2', status: 'success' }],
    }));
    await enable(asOwner, 'support');
    await enable(asOwner, 'system-audit');

    const gates = (await asOwner.approvals['workflow-gates'].get()).data!;
    expect(gates.complete).toBe(true);
    expect(gates.items).toHaveLength(1);
    expect(gates.items[0]).toMatchObject({
      projectKey: 'MKT',
      projectName: 'Marketing',
      workflowId: 'support',
      workflowName: 'Support',
      runId: 'run-1',
      reason: 'External writes and sends require explicit human approval.',
      summary: 'Reply prepared',
      effects: ['Send the prepared reply'],
    });
    expect(new Date(gates.items[0].createdAt!)).toEqual(new Date('2026-09-20T10:00:00.000Z'));
    // Only the workflow with external effects is asked for its runs.
    const asked = controlPlane.requests.filter((request) => request.operation === 'runs');
    expect(asked.map((request) => request.workflowId)).toEqual(['support']);

    expect((await asMember.approvals['workflow-gates'].get()).data).toEqual({
      complete: true,
      items: [],
    });
  });

  it('says when the workflows of a project could not be read', async () => {
    const { asOwner } = await setup();
    answer(() => new Response('down', { status: 500 }));
    await enable(asOwner, 'support');

    expect((await asOwner.approvals['workflow-gates'].get()).data).toEqual({
      complete: false,
      items: [],
    });
  });

  it('asks the control plane nothing without an enabled workflow', async () => {
    const { asOwner } = await setup();
    expect((await asOwner.approvals['workflow-gates'].get()).data).toEqual({
      complete: true,
      items: [],
    });
    expect(controlPlane.requests).toHaveLength(0);
  });
});
