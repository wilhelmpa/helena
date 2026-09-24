import { beforeEach, describe, expect, it } from 'bun:test';
import { apiKeyApi, app, authedApi, type Api } from '#tests/helpers/app';
import { signUpTestUser } from '#tests/helpers/auth';
import { resetDb } from '#tests/helpers/db';
import { createAgent, setAgentProjectRole } from '#tests/helpers/agents';
import { addProjectMember } from '#tests/helpers/members';
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
      command: null,
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

  it('keeps the command apart when the same action is asked with another one', async () => {
    const { asOwner, asAgent, columnId } = await setup();
    await startRun(asOwner, asAgent, columnId);
    const ask = (command: string) =>
      requestApproval(asAgent, { kind: 'delete', action: 'Clean the build', command });

    const first = await ask('  rm -rf build\n');
    expect(first.status).toBe(201);
    expect(first.data!.command).toBe('rm -rf build');
    expect((await ask('rm -rf build')).data!.id).toBe(first.data!.id);

    const other = await ask('rm -rf dist');
    expect(other.status).toBe(201);
    expect(other.data!.id).not.toBe(first.data!.id);
  });

  it('ties a request to a run only when one run of the agent matches', async () => {
    const { asOwner, asAgent, columnId } = await setup();
    await startRun(asOwner, asAgent, columnId);
    const second = await startRun(asOwner, asAgent, columnId);

    const unnamed = await requestApproval(asAgent);
    expect(unnamed.data).toMatchObject({ runId: null, issueId: null });

    const named = await requestApproval(asAgent, { issueId: second.issue.id });
    expect(named.data).toMatchObject({ runId: second.run.id, issueId: second.issue.id });
  });

  it('records one request when the same call arrives twice at once', async () => {
    const { asOwner, asAgent, columnId } = await setup();
    await startRun(asOwner, asAgent, columnId);

    const [a, b] = await Promise.all([requestApproval(asAgent), requestApproval(asAgent)]);
    expect([a.status, b.status].sort()).toEqual([200, 201]);
    expect(a.data!.id).toBe(b.data!.id);
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
    expect((await requestApproval(asAgent, { command: '' })).status).toBe(400);
    expect((await requestApproval(asAgent, { command: 'x'.repeat(32001) })).status).toBe(400);
    // At the limit, and longer than a b-tree index entry can hold even compressed.
    const script = Array.from({ length: 3000 }, (_, i) => `print(${i * 7919})`)
      .join('\n')
      .slice(0, 32000);
    expect((await requestApproval(asAgent, { action: 'Run it', command: script })).status).toBe(
      201,
    );

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

  it('narrows the list and the pending count to one project', async () => {
    const { asOwner, asAgent } = await setup();
    const mkt = (await requestApproval(asAgent)).data!;

    await asOwner.projects.post({ key: 'OPS', name: 'Ops' });
    const opsAgent = (
      await createAgent(asOwner, 'OPS', {
        name: 'Ops Bot',
        username: 'opsbot',
        kind: 'external',
        triggerOnMention: true,
      })
    ).data!;
    const asOpsAgent = apiKeyApi(opsAgent.apiKey!);
    const ops = (
      await asOpsAgent
        .projects({ projectKey: 'OPS' })
        .approvals.post({ kind: 'send', action: 'Send the OPS update' } as never)
    ).data!;

    const mktOnly = await asOwner.approvals.get({ query: { projectKey: 'MKT' } });
    expect(mktOnly.data!.total).toBe(1);
    expect(mktOnly.data!.items.map((item) => item.id)).toEqual([mkt.id]);
    expect(
      (await asOwner.approvals['pending-count'].get({ query: { projectKey: 'MKT' } })).data,
    ).toEqual({ count: 1 });

    const opsOnly = await asOwner.approvals.get({ query: { projectKey: 'OPS' } });
    expect(opsOnly.data!.total).toBe(1);
    expect(opsOnly.data!.items.map((item) => item.id)).toEqual([ops.id]);

    expect((await asOwner.approvals.get({ query: {} })).data!.total).toBe(2);
  });

  it('filters to nothing rather than error for a project the caller may not decide in', async () => {
    const { asOwner, asAgent } = await setup();
    await requestApproval(asAgent);
    await asOwner.projects.post({ key: 'OPS', name: 'Ops' });
    const asMember = await addProjectMember(asOwner, 'MKT');

    // Not a member of OPS at all, and a project that does not exist: neither tells
    // the caller anything beyond "no requests here".
    for (const projectKey of ['OPS', 'NOPE']) {
      const list = await asMember.approvals.get({ query: { projectKey } });
      expect(list.status).toBe(200);
      expect(list.data!.total).toBe(0);
      expect(
        (await asMember.approvals['pending-count'].get({ query: { projectKey } })).data,
      ).toEqual({ count: 0 });
    }
  });

  it('lists only the projects the caller may decide approvals in', async () => {
    const { asOwner, asAgent } = await setup();
    await requestApproval(asAgent);
    await asOwner.projects.post({ key: 'OPS', name: 'Ops' });

    const ownerProjects = await asOwner.approvals.projects.get();
    expect(ownerProjects.data!.map((p) => p.key).sort()).toEqual(['MKT', 'OPS']);

    // A member of MKT only, even with a role that may decide there, never sees OPS:
    // the filter offers only what the caller could already see requests from.
    const role = await createRole(asOwner, 'MKT', {
      name: 'Decider',
      permissions: { ai_agents: { create: false, read: true, edit: true, delete: false } },
    });
    const asMember = await addProjectMember(asOwner, 'MKT', role.data!.id);
    const memberProjects = await asMember.approvals.projects.get();
    expect(memberProjects.data).toEqual([
      { id: expect.any(Number), key: 'MKT', name: 'Marketing' },
    ]);
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

  it('puts the command into the prompt of the run with the decision', async () => {
    const { asOwner, asAgent } = await setup();
    const created = (
      await requestApproval(asAgent, { kind: 'delete', command: 'git push --force' })
    ).data!;
    await asOwner.approvals({ approvalId: created.id }).decision.post({ approved: true });

    const next = (await asAgent['agent-runs'].claim.post()).data!.run!;
    expect(next.prompt).toContain('Command:\ngit push --force');
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

describe('approved commands of a run', () => {
  beforeEach(async () => {
    await resetDb();
  });

  // Asks for three commands in one run and decides them, which queues one follow-up run
  // per decision.
  async function decided() {
    const context = await setup();
    const { asOwner, asAgent, columnId } = context;
    const { run } = await startRun(asOwner, asAgent, columnId);
    const ask = (action: string, command?: string) =>
      requestApproval(asAgent, { kind: 'delete', action, command }).then((res) => res.data!);
    const approved = await ask('Clean the build', 'rm -rf build');
    const rejected = await ask('Clean the cache', 'rm -rf .cache');
    const withoutCommand = await ask('Delete the draft');
    const decide = (id: number, approvedDecision: boolean) =>
      asOwner
        .approvals({ approvalId: id })
        .decision.post({ approved: approvedDecision })
        .then((res) => res.data!.followUpRunId!);
    return {
      ...context,
      run,
      approvedRun: await decide(approved.id, true),
      rejectedRun: await decide(rejected.id, false),
      withoutCommandRun: await decide(withoutCommand.id, true),
    };
  }

  function approvedCommands(api: Api, runId: number) {
    return api['agent-runs']({ runId })['approved-commands'].get();
  }

  it('lists the approved command for the run its decision started', async () => {
    const { asAgent, run, approvedRun, rejectedRun, withoutCommandRun } = await decided();

    const res = await approvedCommands(asAgent, approvedRun);
    expect(res.status).toBe(200);
    expect(res.data).toEqual(['rm -rf build']);
    expect((await approvedCommands(asAgent, rejectedRun)).data).toEqual([]);
    expect((await approvedCommands(asAgent, withoutCommandRun)).data).toEqual([]);
    // The run that asked is not the run that got the approval.
    expect((await approvedCommands(asAgent, run.id)).data).toEqual([]);
  });

  it('answers only the agent the run belongs to', async () => {
    const { asOwner, approvedRun } = await decided();
    const other = await createAgent(asOwner, 'MKT', {
      name: 'Other Bot',
      username: 'other',
      kind: 'external',
    });
    const asOther = apiKeyApi(other.data!.apiKey!);

    expect((await approvedCommands(asOther, approvedRun)).data).toEqual([]);
    expect((await approvedCommands(asOwner, approvedRun)).status).toBe(403);
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
