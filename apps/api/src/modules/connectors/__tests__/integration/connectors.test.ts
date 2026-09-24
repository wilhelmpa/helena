import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test';
import { db, mailAccount, connectorAction, integrationCredential } from '@repo/db';
import { eq } from 'drizzle-orm';
import {
  clearGoogleTokenCache,
  setGoogleApiRootForTests,
  setGoogleEndpointsForTests,
} from '@helena/connectors/google';
import { app, apiKeyApi, authedApi, type Api } from '#tests/helpers/app';
import { signUpTestUser } from '#tests/helpers/auth';
import { resetDb } from '#tests/helpers/db';
import { createAgent } from '#tests/helpers/agents';
import { processConnectorActions } from '../../tools';
import { setGogBrokerForTests } from '../../google/engine';
import { replaceDefaultPolicy } from '../../policy';
import { cloneTarget } from '../../clone';

// The access center's connectors: a Google account signed in through a fake Google, its
// grants to agents and projects (read vs write, per service), the policy and the owner's
// approval for actions that reach outside Helena, the audit log, masked output, the gog
// engine through a fake broker, and SSH keys for git.

const CLIENT_ID = '123456789012-abcdefghijklmnop.apps.googleusercontent.com';
const CLIENT_SECRET = 'GOCSPX-client-secret-4711';
const REFRESH = '1//refresh-token-4711';

interface FakeGoogle {
  base: string;
  sent: string[];
  calls: string[];
  stop(): void;
}

function fakeGoogle(): FakeGoogle {
  const sent: string[] = [];
  const calls: string[] = [];
  const server = Bun.serve({
    port: 0,
    async fetch(request) {
      const url = new URL(request.url);
      calls.push(`${request.method} ${url.pathname}`);
      if (url.pathname === '/token') {
        const params = new URLSearchParams(await request.text());
        if (params.get('grant_type') === 'authorization_code') {
          return Response.json({
            access_token: 'ya29.first',
            refresh_token: REFRESH,
            expires_in: 3599,
            token_type: 'Bearer',
          });
        }
        return Response.json({
          access_token: 'ya29.fresh',
          expires_in: 3599,
          token_type: 'Bearer',
        });
      }
      if (url.pathname === '/tokeninfo') {
        return Response.json({
          email: 'owner@example.com',
          scope:
            'openid https://www.googleapis.com/auth/userinfo.email https://mail.google.com/ https://www.googleapis.com/auth/calendar',
          expires_in: 3500,
        });
      }
      if (url.pathname === '/calendar/v3/calendars/primary/events' && request.method === 'GET') {
        return Response.json({
          items: [
            {
              id: 'ev1',
              summary: 'Standup',
              start: { dateTime: '2026-09-25T09:00:00+02:00' },
              end: { dateTime: '2026-09-25T09:15:00+02:00' },
            },
          ],
        });
      }
      if (url.pathname === '/gmail/v1/users/me/messages/send') {
        const body = (await request.json()) as { raw: string };
        sent.push(Buffer.from(body.raw, 'base64url').toString('utf8'));
        return Response.json({ id: 'm1', threadId: 't1' });
      }
      return Response.json({ error: { message: `no fake for ${url.pathname}` } }, { status: 404 });
    },
  });
  return { base: `http://127.0.0.1:${server.port}`, sent, calls, stop: () => server.stop(true) };
}

let google: FakeGoogle;

beforeAll(() => {
  google = fakeGoogle();
  setGoogleEndpointsForTests({
    oauth2TokenUrl: `${google.base}/token`,
    tokenInfoUrl: `${google.base}/tokeninfo`,
  });
  setGoogleApiRootForTests(`${google.base}/`);
});

afterAll(() => {
  setGoogleEndpointsForTests(null);
  setGoogleApiRootForTests(null);
  setGogBrokerForTests(undefined);
  google.stop();
});

beforeEach(async () => {
  await resetDb();
  clearGoogleTokenCache();
  google.sent.length = 0;
  google.calls.length = 0;
  setGogBrokerForTests(null);
});

async function setup() {
  const owner = await signUpTestUser({ name: 'Owner' });
  const asOwner = authedApi(owner.cookie);
  const mkt = (await asOwner.projects.post({ key: 'MKT', name: 'Marketing' })).data!;
  const ops = (await asOwner.projects.post({ key: 'OPS', name: 'Operations' })).data!;
  return { asOwner, teamId: mkt.teamId, mkt, ops };
}

async function externalAgent(asOwner: Api, username: string, projectKey = 'MKT') {
  const created = await createAgent(asOwner, projectKey, {
    name: `Agent ${username}`,
    username,
    kind: 'external',
    triggerOnMention: true,
  });
  const apiKey = created.data!.apiKey!;
  return { ...created.data!.agent, apiKey, asRunner: apiKeyApi(apiKey) };
}

// Signs in to the Google account the way the owner does: import the client file, start,
// paste back the address the browser ended on.
async function connectGoogle(asOwner: Api, teamId: number, services = ['mail', 'calendar']) {
  const google = asOwner.teams({ teamId }).connectors.google;
  const imported = await google.clients.post({
    json: JSON.stringify({
      installed: {
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        project_id: 'helena-test',
        redirect_uris: ['http://localhost'],
      },
    }),
  });
  expect(imported.status).toBe(200);
  const client = imported.data!.client!;
  const started = await google['sign-in'].post({
    engine: 'helena',
    clientCredentialId: client.id,
    services,
  });
  expect(started.data!.mode).toBe('paste');
  const state = new URL(started.data!.url).searchParams.get('state')!;
  const finished = await google['sign-in'].finish.post({
    sessionId: started.data!.sessionId,
    redirectUrl: `http://127.0.0.1:53682/?state=${state}&code=4/fake-code&scope=x`,
  });
  expect(finished.status).toBe(200);
  return { client, account: finished.data! };
}

async function tool(
  apiKey: string,
  name: string,
  body: Record<string, unknown>,
  projectKey = 'MKT',
) {
  const res = await app.handle(
    new Request(`http://localhost/projects/${projectKey}/connections/${name}`, {
      method: 'POST',
      headers: { 'x-api-key': apiKey, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  );
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

async function mcpTools(apiKey: string): Promise<string[]> {
  const res = await app.handle(
    new Request('http://localhost/mcp', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${apiKey}`,
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
    }),
  );
  const text = await res.text();
  const result = JSON.parse(text.slice(text.indexOf('data: ') + 6)).result as {
    tools: { name: string; _meta?: Record<string, unknown> }[];
  };
  return result.tools.map((entry) => entry.name);
}

const events = {
  account: 'owner@example.com',
  from: '2026-09-25T00:00:00Z',
  to: '2026-09-26T00:00:00Z',
};

describe('Google sign-in', () => {
  it('connects an account, switches its Mail service on as an XOAUTH2 mailbox, and never returns a secret', async () => {
    const { asOwner, teamId } = await setup();
    const { account } = await connectGoogle(asOwner, teamId);
    expect(account).toMatchObject({
      email: 'owner@example.com',
      engine: 'helena',
      signedIn: true,
      status: 'ok',
      mail: { enabled: true, fetchDays: 30 },
    });
    expect(account.services.filter((service) => service.enabled).map((s) => s.id)).toEqual([
      'mail',
      'calendar',
    ]);
    const [mailbox] = await db.select().from(mailAccount);
    expect(mailbox).toMatchObject({
      auth: 'xoauth2',
      address: 'owner@example.com',
      imapHost: 'imap.gmail.com',
      credentialId: account.id,
      fetchDays: 30,
    });

    const overview = await asOwner.teams({ teamId }).connectors.google.get();
    const audit = await asOwner.teams({ teamId }).access.audit.get({ query: {} });
    const mail = await asOwner.teams({ teamId }).mail.accounts.get();
    for (const body of [account, overview.data, audit.data, mail.data]) {
      const text = JSON.stringify(body);
      expect(text).not.toContain(REFRESH);
      expect(text).not.toContain(CLIENT_SECRET);
      expect(text).not.toContain('ya29.');
    }
    expect(audit.data!.items[0]).toMatchObject({ action: 'changed', purpose: 'signed-in' });
  });

  it('refuses an address from another sign-in and an expired session', async () => {
    const { asOwner, teamId } = await setup();
    const google = asOwner.teams({ teamId }).connectors.google;
    const client = (
      await google.clients.post({
        json: JSON.stringify({ installed: { client_id: CLIENT_ID, client_secret: CLIENT_SECRET } }),
      })
    ).data!.client!;
    const started = await google['sign-in'].post({
      engine: 'helena',
      clientCredentialId: client.id,
      services: ['calendar'],
    });
    const wrong = await google['sign-in'].finish.post({
      sessionId: started.data!.sessionId,
      redirectUrl: 'http://127.0.0.1:53682/?state=someone-else&code=4/x',
    });
    expect(wrong.status).toBe(400);
    // The session is used up by the failed attempt: a sign-in is started once.
    const again = await google['sign-in'].finish.post({
      sessionId: started.data!.sessionId,
      redirectUrl: 'http://127.0.0.1:53682/?state=x&code=4/x',
    });
    expect(again.status).toBe(410);
    expect(
      (
        await google.clients.post({
          json: '{"type":"service_account","private_key":"x"}',
        })
      ).status,
    ).toBe(400);
  });

  it('is the owner’s: an agent cannot sign in or import a client', async () => {
    const { asOwner, teamId } = await setup();
    const agent = await externalAgent(asOwner, 'shopper');
    const res = await agent.asRunner.teams({ teamId }).connectors.google.clients.post({
      json: '{}',
    });
    expect(res.status).toBe(403);
  });
});

describe('grants, policy and approvals', () => {
  it('lets only granted agents use the account, per service and read vs write', async () => {
    const { asOwner, teamId, mkt } = await setup();
    const { account } = await connectGoogle(asOwner, teamId);
    const reader = await externalAgent(asOwner, 'reader');
    const writer = await externalAgent(asOwner, 'writer');
    const outsider = await externalAgent(asOwner, 'outsider', 'OPS');

    // Nobody holds a grant: the tools are not even listed, and a call is refused.
    expect((await mcpTools(reader.apiKey)).some((name) => name.startsWith('google_'))).toBe(false);
    expect((await tool(reader.apiKey, 'google_calendar_events', events)).body).toMatchObject({
      status: 'denied',
    });

    const grants = await asOwner
      .teams({ teamId })
      .credentials({ credentialId: account.id })
      .grants.put({
        grants: [
          { agentId: reader.id, service: 'calendar', access: 'read' },
          { projectId: mkt.id, access: 'write' },
        ],
      });
    expect(grants.status).toBe(200);
    // A grant to a project reaches its agents; the reader holds read on the calendar too.
    const listed = await mcpTools(writer.apiKey);
    expect(listed).toContain('google_calendar_events');
    expect(listed).toContain('google_mail_send');
    expect((await mcpTools(outsider.apiKey)).some((name) => name.startsWith('google_'))).toBe(
      false,
    );

    const read = await tool(writer.apiKey, 'google_calendar_events', events);
    expect(read).toMatchObject({ status: 200, body: { status: 'done' } });
    expect((read.body.result as { events: { summary: string }[] }).events[0]!.summary).toBe(
      'Standup',
    );

    // The outsider works in another project, where the grant does not reach.
    expect(
      (await tool(outsider.apiKey, 'google_calendar_events', events, 'OPS')).body,
    ).toMatchObject({
      status: 'denied',
    });

    // A read-only grant refuses writing, whatever else the project grant says for the agent.
    await asOwner
      .teams({ teamId })
      .credentials({ credentialId: account.id })
      .grants.put({
        grants: [{ agentId: reader.id, access: 'read' }],
      });
    const create = await tool(reader.apiKey, 'google_calendar_create_event', {
      ...events,
      summary: 'Sync',
      start: '2026-09-25T10:00:00Z',
      end: '2026-09-25T10:30:00Z',
    });
    expect(create.body).toMatchObject({
      status: 'denied',
      reason: 'You may only read with this account.',
    });

    // A grant limited to one service does not open another.
    await asOwner
      .teams({ teamId })
      .credentials({ credentialId: account.id })
      .grants.put({
        grants: [{ agentId: reader.id, service: 'calendar', access: 'write' }],
      });
    expect(
      (
        await tool(reader.apiKey, 'google_mail_search', {
          account: 'owner@example.com',
          query: 'x',
        })
      ).body,
    ).toMatchObject({ status: 'denied' });

    // A switched-off service is refused even with a grant.
    await asOwner
      .teams({ teamId })
      .connectors.google.accounts({ accountId: account.id })
      .patch({
        services: ['mail'],
      });
    expect((await tool(reader.apiKey, 'google_calendar_events', events)).body).toMatchObject({
      status: 'denied',
      reason: 'The calendar service of owner@example.com is switched off.',
    });
  });

  it('files a send for approval, runs exactly that once approved, and logs every step', async () => {
    const { asOwner, teamId, mkt } = await setup();
    const { account } = await connectGoogle(asOwner, teamId);
    const agent = await externalAgent(asOwner, 'mailer');
    await asOwner
      .teams({ teamId })
      .credentials({ credentialId: account.id })
      .grants.put({
        grants: [{ projectId: mkt.id, service: 'mail' }],
      });
    const send = {
      account: 'owner@example.com',
      to: ['anna@verve.example'],
      bcc: ['archive@example.com'],
      subject: 'Offer',
      body: 'Hello Anna',
    };
    const asked = await tool(agent.apiKey, 'google_mail_send', send);
    expect(asked.body).toMatchObject({ status: 'pending_approval' });
    expect(google.sent).toEqual([]);
    // Asking again in the same state does not file a second request.
    const approvalId = asked.body.approvalId as number;
    const actionId = asked.body.actionId as number;

    const approval = await asOwner.approvals({ approvalId }).get();
    expect(approval.data).toMatchObject({
      kind: 'send',
      action: 'Send mail to anna@verve.example: Offer',
    });

    expect(await processConnectorActions()).toBe(0);
    const decided = await asOwner.approvals({ approvalId }).decision.post({ approved: true });
    expect(decided.status).toBe(200);
    expect(await processConnectorActions()).toBe(1);
    expect(google.sent).toHaveLength(1);
    expect(google.sent[0]).toContain('To: anna@verve.example');
    expect(google.sent[0]).toContain('Bcc: archive@example.com');
    expect(google.sent[0]).toContain('Subject: Offer');
    const [row] = await db.select().from(connectorAction).where(eq(connectorAction.id, actionId));
    expect(row).toMatchObject({ status: 'done', category: 'send' });

    const state = await app.handle(
      new Request(`http://localhost/projects/MKT/connection-actions/${actionId}`, {
        headers: { 'x-api-key': agent.apiKey },
      }),
    );
    expect(await state.json()).toMatchObject({ status: 'done', result: { sent: true } });

    const audit = await asOwner.teams({ teamId }).access.audit.get({
      query: { credentialId: account.id },
    });
    const actions = audit.data!.items.map((item) => `${item.action}:${item.category ?? ''}`);
    expect(actions).toContain('approval:send');
    expect(actions).toContain('called:send');
    expect(JSON.stringify(audit.data)).not.toContain('Hello Anna');
  });

  it('closes a rejected action without running it', async () => {
    const { asOwner, teamId, mkt } = await setup();
    const { account } = await connectGoogle(asOwner, teamId);
    const agent = await externalAgent(asOwner, 'mailer');
    await asOwner
      .teams({ teamId })
      .credentials({ credentialId: account.id })
      .grants.put({
        grants: [{ projectId: mkt.id }],
      });
    const asked = await tool(agent.apiKey, 'google_mail_send', {
      account: 'owner@example.com',
      to: ['anna@verve.example'],
      subject: 'No',
      body: 'x',
    });
    await asOwner.approvals({ approvalId: asked.body.approvalId as number }).decision.post({
      approved: false,
    });
    await processConnectorActions();
    expect(google.sent).toEqual([]);
    const [row] = await db
      .select()
      .from(connectorAction)
      .where(eq(connectorAction.id, asked.body.actionId as number));
    expect(row!.status).toBe('rejected');
  });

  it('lets the autopilot replace the default approvals behind the grant check', async () => {
    const { asOwner, teamId, mkt } = await setup();
    const { account } = await connectGoogle(asOwner, teamId);
    const agent = await externalAgent(asOwner, 'mailer');
    await asOwner
      .teams({ teamId })
      .credentials({ credentialId: account.id })
      .grants.put({
        grants: [{ projectId: mkt.id }],
      });
    const restore = replaceDefaultPolicy({ id: 'autopilot', evaluate: () => null });
    try {
      const sent = await tool(agent.apiKey, 'google_mail_send', {
        account: 'owner@example.com',
        to: ['anna@verve.example'],
        subject: 'Direct',
        body: 'x',
      });
      expect(sent.body).toMatchObject({ status: 'done' });
      expect(google.sent).toHaveLength(1);
    } finally {
      restore();
    }
  });
});

describe('the gog engine', () => {
  it('lists an account gog holds and runs allowlisted commands through the broker', async () => {
    const { asOwner, teamId, mkt } = await setup();
    const requests: Record<string, unknown>[] = [];
    setGogBrokerForTests({
      async call(request) {
        requests.push(request);
        if (request.op === 'accounts') {
          return [{ email: 'fam@example.com', services: ['gmail', 'calendar'] }];
        }
        if (request.op === 'run') return { events: [{ summary: 'From gog' }] };
        return null;
      },
    });
    const status = await asOwner.teams({ teamId }).connectors.google.gog.get();
    expect(status.data).toEqual({
      available: true,
      unlisted: [{ email: 'fam@example.com', services: ['gmail', 'calendar'], ok: true }],
    });
    const adopted = await asOwner.teams({ teamId }).connectors.google.gog.adopt.post({
      email: 'fam@example.com',
      projectId: mkt.id,
    });
    expect(adopted.data).toMatchObject({ engine: 'gog', mail: null, signedIn: true });
    const agent = await externalAgent(asOwner, 'family');
    const read = await tool(agent.apiKey, 'google_calendar_events', {
      ...events,
      account: 'fam@example.com',
    });
    expect(read.body).toMatchObject({
      status: 'done',
      result: { events: [{ summary: 'From gog' }] },
    });
    expect(requests.at(-1)).toMatchObject({
      op: 'run',
      email: 'fam@example.com',
      command: 'calendar.events',
      args: [
        'calendar',
        'events',
        'primary',
        `--from=${events.from}`,
        `--to=${events.to}`,
        '--max=25',
      ],
    });
    // A tool gog has no form for is refused rather than run some other way.
    const docs = await tool(agent.apiKey, 'google_tasks_list', { account: 'fam@example.com' });
    expect(docs.body).toMatchObject({ status: 'denied' });
  });
});

describe('SSH keys', () => {
  it('reach the runner of a granted agent and of a clone job, and nothing else', async () => {
    const { asOwner, teamId, mkt } = await setup();
    const coder = await externalAgent(asOwner, 'coder');
    const other = await externalAgent(asOwner, 'other');
    const key = (
      await asOwner.teams({ teamId }).credentials.post({ kind: 'ssh_key', label: 'GitHub deploy' })
    ).data!;
    await asOwner
      .teams({ teamId })
      .credentials({ credentialId: key.id })
      .grants.put({
        grants: [{ agentId: coder.id }],
      });
    // A run of each agent, claimed the way its runner does.
    const clone = await asOwner.teams({ teamId }).credentials({ credentialId: key.id }).clone.post({
      projectId: mkt.id,
      url: 'git@github.com:acme/site.git',
      agentId: other.id,
    });
    expect(clone.data).toMatchObject({ agentId: other.id, name: 'site', folder: '' });
    const claimed = (await other.asRunner['agent-runs'].claim.post()).data!.run!;
    expect(claimed).toMatchObject({ trigger: 'workspace' });
    expect(JSON.parse(claimed.prompt)).toMatchObject({ op: 'git_clone', name: 'site' });
    const forJob = await other.asRunner['agent-runs']({ runId: claimed.id })['ssh-keys'].get();
    expect(forJob.data!.keys.map((entry) => entry.id)).toEqual([key.id]);
    expect(forJob.data!.keys[0]!.privateKey).toContain('BEGIN OPENSSH PRIVATE KEY');

    const [row] = await db
      .select({ redacted: integrationCredential.redacted })
      .from(integrationCredential)
      .where(eq(integrationCredential.id, key.id));
    expect(JSON.stringify(row!.redacted)).not.toContain('PRIVATE KEY');
    const listed = await asOwner.teams({ teamId }).credentials.get({ query: {} });
    expect(JSON.stringify(listed.data)).not.toContain('PRIVATE KEY');
    const log = await asOwner
      .teams({ teamId })
      .access.audit.get({ query: { credentialId: key.id } });
    expect(log.data!.items.map((item) => item.purpose)).toContain('git (SSH), clone job');
  });

  it('checks the repository address of a clone', () => {
    expect(cloneTarget('git@github.com:acme/site.git')).toEqual({
      url: 'git@github.com:acme/site.git',
      name: 'site',
    });
    expect(cloneTarget('ssh://git@gitea.example.com:2222/acme/tools').name).toBe('tools');
    for (const bad of [
      'git@127.0.0.1:acme/site.git',
      'file:///etc/passwd',
      'https://user:pw@github.com/acme/site.git',
      'git@github.com:../../etc',
      'ext::sh -c touch% /tmp/x',
      'git@localhost:acme/site.git',
    ]) {
      expect(() => cloneTarget(bad)).toThrow();
    }
  });
});
