// Manual live end-to-end test of the actual runtime-facing surface: spawns the real stdio
// MCP shim (browser-gateway-mcp-shim.mjs) as a child process — exactly how the runner starts
// it for Hermes/Claude Code/Codex — and drives it with the MCP SDK's own Client over stdio,
// against a real gateway socket (browser-gateway-server.mjs, this repo) backed by a real Plan
// API and a real headed Chromium. This is the "bis zum MCP-Tool-Aufruf mit einem Test-Modell/
// Stub" proof the acceptance criteria ask for: nothing here is a stub of the shim or the
// gateway, only the "model" driving the MCP client is a stand-in (a plain script, since
// Claude Code/Codex cannot log in in this environment).
//
// Not part of `bun test`. Needs (see the orchestrator's report for exact commands):
//  - a real Plan API running against a private test Postgres, with BROWSER_GATEWAY_TOKEN_FILE
//    set to a token file both it and this script read;
//  - a real, already-running headed Chromium reachable over CDP;
//  - `npm install` done in deployment/volition-stack/browser (for the shim's own
//    @modelcontextprotocol/sdk — see its package.json).
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { mkdirSync, rmSync } from 'node:fs';

const API_URL = process.env.API_URL || 'http://127.0.0.1:39100';
const CDP_URL = process.argv[2] || 'http://127.0.0.1:19599';
const PAGE_URL = process.argv[3] || 'http://127.0.0.1:18599/';
const SOCKET_DIR =
  process.env.SOCKET_DIR || `${process.env.HOME}/agent-work/tmp/bgw-mcp-e2e-sockets`;
const SHIM_PATH = `${process.env.REPO_ROOT}/deployment/volition-stack/browser/browser-gateway-mcp-shim.mjs`;

const PASSWORD = 'fake-password-4711-mcp-e2e';

let failures = 0;
function check(name: string, ok: boolean, detail?: string) {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures++;
}

async function api(path: string, init: RequestInit & { cookie?: string } = {}) {
  const { cookie, ...rest } = init;
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (cookie) headers.cookie = cookie;
  const res = await fetch(`${API_URL}${path}`, {
    ...rest,
    headers: { ...headers, ...(rest.headers as Record<string, string>) },
  });
  const text = await res.text();
  return { status: res.status, json: text ? JSON.parse(text) : null, headers: res.headers };
}

async function main() {
  // --- setup: owner, project, agent, credential (same as full-e2e.manual.ts) ---
  const signup = await api('/api/auth/sign-up/email', {
    method: 'POST',
    body: JSON.stringify({
      email: `mcp-e2e-${Date.now()}@example.com`,
      password: 'test-password-123',
      name: 'MCP E2E Owner',
    }),
  });
  const cookie = signup.headers.get('set-cookie')!.split(';')[0];
  const project = await api('/projects', {
    method: 'POST',
    cookie,
    body: JSON.stringify({ key: 'MKT', name: 'Marketing' }),
  });
  const teamId = project.json.teamId;
  const server = await api(`/teams/${teamId}/mcp-servers`, {
    method: 'POST',
    cookie,
    body: JSON.stringify({ name: 'projekt-browser', transport: 'stdio', command: 'placeholder' }),
  });
  const agent = await api(`/teams/${teamId}/ai-agents`, {
    method: 'POST',
    cookie,
    body: JSON.stringify({
      name: 'MCP E2E Writer',
      username: 'mcp-writer',
      kind: 'external',
      projectIds: [project.json.id],
    }),
  });
  const agentId = agent.json.agent.id;
  const agentKey: string = agent.json.apiKey;
  await api(`/teams/${teamId}/ai-agents/${agentId}/mcp-servers`, {
    method: 'PUT',
    cookie,
    body: JSON.stringify({ mcpServerIds: [server.json.id] }),
  });
  const credential = await api(`/teams/${teamId}/credentials`, {
    method: 'POST',
    cookie,
    body: JSON.stringify({
      kind: 'web_login',
      label: 'MCP E2E login',
      loginUrl: PAGE_URL,
      allowedDomains: [],
      username: 'bot@example.com',
      password: PASSWORD,
    }),
  });
  await api(`/teams/${teamId}/credentials/${credential.json.id}/grants`, {
    method: 'PUT',
    cookie,
    body: JSON.stringify({ agentIds: [agentId] }),
  });
  check('setup: real project/agent/credential created', true);

  // --- start the real gateway, bound to a test socket dir, against the real Chromium ---
  // Env vars must be set BEFORE the dynamic import: browser-gateway-server.mjs reads them
  // into module-level constants at import time.
  rmSync(SOCKET_DIR, { recursive: true, force: true });
  mkdirSync(SOCKET_DIR, { recursive: true });
  process.env.BROWSER_GATEWAY_SOCKET_DIR = SOCKET_DIR;
  process.env.BROWSER_GATEWAY_TOKEN_FILE = process.env.TOKEN_FILE;
  process.env.BROWSER_GATEWAY_PLAN_URL = API_URL;
  const { startBrowserGateway } = await import(
    `${process.env.REPO_ROOT}/deployment/volition-stack/browser/browser-gateway-server.mjs`
  );
  const gateway = await startBrowserGateway({
    listBrowsers: async () => [{ slug: 'mkt', cdpPort: Number(new URL(CDP_URL).port) }],
  });
  check('gateway started and bound its test sockets', true);

  // --- spawn the REAL shim exactly as the runner would, and drive it with a real MCP client ---
  const transport = new StdioClientTransport({
    command: 'node',
    args: [SHIM_PATH],
    env: {
      ...process.env,
      ITSAPLAN_API_KEY: agentKey,
      BROWSER_GATEWAY_SOCKET: `${SOCKET_DIR}/gateway-mkt.sock`,
    } as Record<string, string>,
  });
  const client = new Client(
    { name: 'mcp-e2e-test-client', version: '1.0.0' },
    { capabilities: {} },
  );
  await client.connect(transport);
  check('MCP client connected to the real shim over stdio', true);

  const toolsList = await client.listTools();
  check(
    'tools/list returns the full browser_* tool set from the shim',
    toolsList.tools.some((t) => t.name === 'browser_navigate') &&
      toolsList.tools.some((t) => t.name === 'browser_login'),
    `${toolsList.tools.length} tools`,
  );
  check(
    'no evaluate/cookie/cdp tool is exposed',
    !toolsList.tools.some((t) => /evaluate|cookie|cdp/i.test(t.name)),
  );

  const acquire = await client.callTool({ name: 'browser_acquire', arguments: {} });
  check(
    'tools/call browser_acquire succeeds via the real shim',
    acquire.isError !== true,
    JSON.stringify(acquire.content),
  );

  const nav = await client.callTool({ name: 'browser_navigate', arguments: { url: PAGE_URL } });
  check(
    'tools/call browser_navigate succeeds via the real shim',
    nav.isError !== true,
    JSON.stringify(nav.content),
  );

  const snap = await client.callTool({ name: 'browser_snapshot', arguments: {} });
  const snapText = (snap.content as { type: string; text: string }[])[0]?.text ?? '';
  check(
    'tools/call browser_snapshot finds the login form via the real shim',
    snap.isError !== true && snapText.includes('textbox'),
    snapText.slice(0, 200),
  );

  const userRef = snapText.match(/\[e(\d+)\] textbox:text/)?.[0]?.match(/e\d+/)?.[0];
  const passRef = snapText.match(/\[e(\d+)\] textbox:password/)?.[0]?.match(/e\d+/)?.[0];
  if (userRef && passRef) {
    const login = await client.callTool({
      name: 'browser_login',
      arguments: { usernameRef: userRef, passwordRef: passRef },
    });
    const loginText = JSON.stringify(login.content);
    check(
      'tools/call browser_login fills the real credential via the real shim',
      login.isError !== true,
      loginText,
    );
    check('the password never crosses the MCP stdio channel', !loginText.includes(PASSWORD));
  } else {
    check('found refs to fill the login', false, snapText);
  }

  await client.callTool({ name: 'browser_release', arguments: {} });
  await client.close();
  await gateway.stop();

  console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error('mcp stdio e2e crashed:', error);
  process.exit(1);
});
