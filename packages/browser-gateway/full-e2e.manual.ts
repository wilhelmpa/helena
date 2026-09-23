// Full-stack live end-to-end: a real running Plan API (this project's own test Postgres),
// the real internal browser-gateway routes, a real PlanClient (HTTP, not a fake), the real
// GatewayDispatcher, and the real patchright-backed session against the spike's headed
// Chromium. Not part of `bun test` — needs the API server and Chromium already running
// (see the orchestrator's report for the exact commands used).
import {
  GatewayDispatcher,
  ProjectBrowserLocks,
  PatchrightGatewaySession,
  PlanClient,
} from '@repo/browser-gateway';

const API_URL = process.env.API_URL || 'http://127.0.0.1:39100';
const GATEWAY_TOKEN = process.env.GATEWAY_TOKEN!;
const CDP_URL = process.argv[2] || 'http://127.0.0.1:19566';
const PAGE_URL = process.argv[3] || 'http://127.0.0.1:18566/';

const PASSWORD = 'fake-password-4711-full-e2e';
const TOTP = 'JBSWY3DPEHPK3PXP';

let failures = 0;
function check(name: string, ok: boolean, detail?: string) {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures++;
}

async function api(path: string, init: RequestInit & { cookie?: string; apiKey?: string } = {}) {
  const { cookie, apiKey, ...rest } = init;
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (cookie) headers.cookie = cookie;
  if (apiKey) headers['x-api-key'] = apiKey;
  const res = await fetch(`${API_URL}${path}`, {
    ...rest,
    headers: { ...headers, ...(rest.headers as Record<string, string>) },
  });
  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    /* not json */
  }
  return { status: res.status, json, text, headers: res.headers };
}

async function main() {
  // --- setup: owner, project, builtin server, agent, credential, grant ---
  const signup = await api('/api/auth/sign-up/email', {
    method: 'POST',
    body: JSON.stringify({
      email: `full-e2e-${Date.now()}@example.com`,
      password: 'test-password-123',
      name: 'Full E2E Owner',
    }),
  });
  const cookie = signup.headers.get('set-cookie')!.split(';')[0];
  check('signed up an owner', signup.status === 200, JSON.stringify(signup.json));

  const project = await api('/projects', {
    method: 'POST',
    cookie,
    body: JSON.stringify({ key: 'MKT', name: 'Marketing' }),
  });
  check(
    'created project MKT',
    project.status === 201 || project.status === 200,
    JSON.stringify(project.json),
  );
  const teamId = (project.json as { teamId: number }).teamId;

  const server = await api(`/teams/${teamId}/mcp-servers`, {
    method: 'POST',
    cookie,
    body: JSON.stringify({
      name: 'projekt-browser',
      transport: 'stdio',
      command: '/usr/local/libexec/volition-browser-gateway-mcp',
    }),
  });
  check('created projekt-browser mcp server', server.status === 201, JSON.stringify(server.json));
  const serverId = (server.json as { id: number }).id;

  const agent = await api(`/teams/${teamId}/ai-agents`, {
    method: 'POST',
    cookie,
    body: JSON.stringify({
      name: 'Full E2E Writer',
      username: 'writer-e2e',
      kind: 'external',
      projectIds: [(project.json as { id: number }).id],
    }),
  });
  check('created agent', agent.status === 201, JSON.stringify(agent.json));
  const agentId = (agent.json as { agent: { id: number } }).agent.id;
  const agentKey = (agent.json as { apiKey: string }).apiKey;

  const linked = await api(`/teams/${teamId}/ai-agents/${agentId}/mcp-servers`, {
    method: 'PUT',
    cookie,
    body: JSON.stringify({ mcpServerIds: [serverId] }),
  });
  check(
    'enabled projekt-browser for the agent',
    linked.status === 200,
    JSON.stringify(linked.json),
  );

  const credential = await api(`/teams/${teamId}/credentials`, {
    method: 'POST',
    cookie,
    body: JSON.stringify({
      kind: 'web_login',
      label: 'Leak test login',
      loginUrl: PAGE_URL,
      allowedDomains: [],
      username: 'bot@example.com',
      password: PASSWORD,
      totpSecret: TOTP,
    }),
  });
  check(
    'created a web_login credential',
    credential.status === 201,
    JSON.stringify(credential.json),
  );
  const credentialId = (credential.json as { id: number }).id;

  const grant = await api(`/teams/${teamId}/credentials/${credentialId}/grants`, {
    method: 'PUT',
    cookie,
    body: JSON.stringify({ agentIds: [agentId] }),
  });
  check('granted the credential to the agent', grant.status === 200, JSON.stringify(grant.json));

  // --- the real thing: PlanClient -> internal routes -> dispatcher -> patchright ---
  const planClient = new PlanClient({ baseUrl: API_URL, serviceToken: GATEWAY_TOKEN });
  const resolved = await planClient.resolve(agentKey, 'mkt');
  check(
    'PlanClient.resolve reports the real agent and enabled=true',
    resolved.browserGatewayEnabled === true && resolved.agentName === 'writer-e2e',
    JSON.stringify(resolved),
  );

  const session = await PatchrightGatewaySession.connect(CDP_URL, {
    vaultInbox: '/tmp',
    humanInput: true,
  });
  const locks = new ProjectBrowserLocks(120_000);
  const gateway = new GatewayDispatcher({
    ownSlug: 'mkt',
    planClient,
    locks,
    sessions: { get: async () => session },
  });

  check(
    'browser_acquire (real Plan)',
    (await gateway.handle({ tool: 'browser_acquire', agentKey })).ok === true,
  );
  const nav = await gateway.handle({ tool: 'browser_navigate', agentKey, args: { url: PAGE_URL } });
  check('browser_navigate (real Plan)', nav.ok === true, nav.ok ? nav.content : nav.error);

  const snap = await gateway.handle({ tool: 'browser_snapshot', agentKey });
  const userRef = snap.ok
    ? snap.content.match(/\[e(\d+)\] textbox:text/)?.[0].match(/e\d+/)?.[0]
    : null;
  const passRef = snap.ok
    ? snap.content.match(/\[e(\d+)\] textbox:password/)?.[0].match(/e\d+/)?.[0]
    : null;
  check(
    'snapshot found both fields (real Plan)',
    !!userRef && !!passRef,
    snap.ok ? snap.content : snap.error,
  );

  const login = await gateway.handle({
    tool: 'browser_login',
    agentKey,
    args: { usernameRef: userRef, passwordRef: passRef },
  });
  check(
    'browser_login fills the real granted credential',
    login.ok === true,
    login.ok ? login.content : login.error,
  );
  check(
    'the real password never appears in the response',
    JSON.stringify(login).includes(PASSWORD) === false,
  );

  const code = await gateway.handle({
    tool: 'browser_login_code',
    agentKey,
    args: { ref: passRef, credentialId },
  });
  check(
    'browser_login_code computes and fills the real TOTP code',
    code.ok === true,
    code.ok ? code.content : code.error,
  );
  check(
    'the real TOTP secret never appears in the response',
    JSON.stringify(code).includes(TOTP) === false,
  );

  // Audit trail: this credential-tool activity is in integration_credential_use, not
  // browser_gateway_event — check the events list is still empty for login/login_code, and
  // a non-credential tool call (already exercised above via navigate) did write one.
  const events = await api(`/projects/MKT/browser-gateway/events`, { cookie });
  const items = (events.json as { items: { tool: string }[] }).items;
  check(
    'browser_navigate is in the Aktivität audit trail (real Plan, real DB)',
    items.some((i) => i.tool === 'browser_navigate'),
    JSON.stringify(items),
  );
  check(
    'browser_login is NOT duplicated into browser_gateway_event (it has its own audit)',
    !items.some((i) => i.tool === 'browser_login'),
  );

  await gateway.handle({ tool: 'browser_release', agentKey });
  await session.close();

  console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error('full e2e crashed:', error);
  process.exit(1);
});
