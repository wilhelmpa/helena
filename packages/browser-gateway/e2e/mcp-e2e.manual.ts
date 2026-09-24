// The whole chain an agent uses, against the real Chromium of run.sh: an MCP client (as
// Claude Code, Codex or Hermes are) starts the built shim, which talks to the gateway the
// router runs (browser-gateway-server.mjs: sockets, sessions, locks), which asks a stand-in
// for Helena's internal routes over HTTP. Run by run.sh after gateway-e2e.manual.ts.
//
//   bun e2e/mcp-e2e.manual.ts <cdp-port> <site-port> <work-dir> <shim-file>
import { chmod, mkdir, stat, writeFile } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const [cdpPort, sitePort] = process.argv.slice(2, 4).map(Number) as [number, number];
const work = process.argv[4]!;
const shim = process.argv[5]!;
const SITE = `http://127.0.0.1:${sitePort}`;
const PLAN_PORT = 18568;
const TOKEN = 'mcp-e2e-gateway-token-0123456789abcdef0123456789';

let failures = 0;
function check(name: string, ok: boolean, detail = ''): void {
  console.log(`${ok ? 'PASS' : 'FAIL'} mcp: ${name}${detail ? ` — ${detail.slice(0, 250)}` : ''}`);
  if (!ok) failures++;
}

// A project browser's state as provisioning writes it: the router only reads runtime.json.
const stateRoot = path.join(work, 'state');
await mkdir(path.join(stateRoot, 'e2e'), { recursive: true, mode: 0o700 });
await writeFile(
  path.join(stateRoot, 'e2e', 'runtime.json'),
  JSON.stringify({ schemaVersion: 1, slug: 'e2e', noVncPort: 16999, cdpPort }),
  { mode: 0o600 },
);
const tokenFile = path.join(work, 'gateway.token');
await writeFile(tokenFile, TOKEN, { mode: 0o600 });

// The stand-in for Helena's internal routes: checks the token, answers like the real ones.
const seen: string[] = [];
const plan = http.createServer((request, response) => {
  let body = '';
  request.on('data', (chunk) => (body += chunk));
  request.on('end', () => {
    const route = (request.url ?? '').replace('/internal/browser-gateway/', '');
    seen.push(route);
    const answer = (status: number, value: unknown) => {
      response.writeHead(status, { 'content-type': 'application/json' });
      response.end(JSON.stringify(value));
    };
    if (request.headers.authorization !== `Bearer ${TOKEN}`)
      return answer(401, { error: 'Unauthorized' });
    const input = body ? JSON.parse(body) : {};
    if (route === 'resolve') {
      if (input.agentKey !== 'agent-key') return answer(403, { error: 'Unknown agent key' });
      return answer(200, {
        agentId: 3,
        agentName: 'mcp-agent',
        teamId: 1,
        projectId: 1,
        projectKey: 'E2E',
        browserGatewayEnabled: true,
        settings: {
          domainBlocklist: [],
          domainAllowlist: [],
          humanInput: false,
          lockTimeoutSec: 120,
        },
      });
    }
    if (route === 'audit') return answer(200, { stored: true });
    if (route === 'download') return answer(200, { path: `Projects/E2E/Inbox/${input.fileName}` });
    return answer(404, { error: 'unexpected' });
  });
});
await new Promise<void>((resolve) => plan.listen(PLAN_PORT, '127.0.0.1', () => resolve()));

process.env.BROWSER_GATEWAY_TOKEN_FILE = tokenFile;
process.env.BROWSER_GATEWAY_SOCKET_ROOT = path.join(work, 'sockets');
process.env.BROWSER_GATEWAY_PLAN_URL = `http://127.0.0.1:${PLAN_PORT}`;
const root = path.resolve(import.meta.dir, '../../..');
const { startBrowserGateway } = await import(
  path.join(root, 'deployment/volition-stack/browser/browser-gateway-server.mjs')
);
const { listProjectBrowsers } = await import(
  path.join(root, 'deployment/volition-stack/browser/project-router.mjs')
);
const gateway = await startBrowserGateway({ listBrowsers: () => listProjectBrowsers(stateRoot) });

const socketDir = path.join(work, 'sockets', 'e2e');
const socket = path.join(socketDir, 'gateway.sock');
check(
  'the project socket is in a directory of its own, 0750',
  ((await stat(socketDir)).mode & 0o777) === 0o750,
);
check('the socket is 0660', ((await stat(socket)).mode & 0o777) === 0o660);

await writeFile(path.join(work, 'angebot.txt'), 'Angebot 2026');
await chmod(path.join(work, 'angebot.txt'), 0o600);

async function agent(key: string) {
  const client = new Client({ name: 'mcp-e2e', version: '1.0.0' });
  await client.connect(
    new StdioClientTransport({
      command: process.execPath.endsWith('bun') ? 'node' : process.execPath,
      args: [shim],
      cwd: work,
      env: { PATH: process.env.PATH ?? '', ITSAPLAN_API_KEY: key, BROWSER_GATEWAY_SOCKET: socket },
    }),
  );
  return client;
}

type Content = { type: string; text?: string; data?: string; mimeType?: string };
const text = (result: { content?: unknown }) =>
  ((result.content as Content[] | undefined) ?? []).map((part) => part.text ?? '').join('');

try {
  const client = await agent('agent-key');
  const tools = await client.listTools();
  check('the shim lists the 24 tools', tools.tools.length === 24, String(tools.tools.length));
  const instructions = client.getInstructions() ?? '';
  check(
    'and tells the agent how to work',
    instructions.includes('browser_acquire'),
    instructions.slice(0, 80),
  );

  const stranger = await agent('someone-else');
  const refused = await stranger.callTool({ name: 'browser_status', arguments: {} });
  check(
    'an unknown key is refused by Helena',
    refused.isError === true && text(refused).includes('Unknown agent key'),
    text(refused),
  );
  await stranger.close();

  check('acquire', !(await client.callTool({ name: 'browser_acquire', arguments: {} })).isError);
  const navigated = await client.callTool({
    name: 'browser_navigate',
    arguments: { url: `${SITE}/upload` },
  });
  check('navigate', !navigated.isError, text(navigated));
  const snap = await client.callTool({ name: 'browser_snapshot', arguments: {} });
  const ref = text(snap).match(/button "Datei" \[ref=([a-z0-9]+)\]/)?.[1];
  check('snapshot through MCP', !!ref, text(snap).slice(0, 200));
  const uploaded = await client.callTool({
    name: 'browser_upload',
    arguments: { ref, path: 'angebot.txt' },
  });
  check('upload of a file the agent can read, by relative path', !uploaded.isError, text(uploaded));
  const after = await client.callTool({ name: 'browser_snapshot', arguments: {} });
  check(
    'the page got it',
    text(after).includes('Gewählt: angebot.txt (12 Bytes)'),
    text(after).slice(0, 300),
  );
  const missing = await client.callTool({
    name: 'browser_upload',
    arguments: { ref, path: '/etc/shadow' },
  });
  check('a file the agent cannot read is not sent', missing.isError === true, text(missing));
  const shot = await client.callTool({ name: 'browser_screenshot', arguments: {} });
  const parts = shot.content as Content[];
  check(
    'a screenshot is an image block',
    parts[0]?.type === 'image' &&
      parts[0]?.mimeType === 'image/png' &&
      (parts[0]?.data?.length ?? 0) > 1000,
  );
  check('release', !(await client.callTool({ name: 'browser_release', arguments: {} })).isError);
  await client.close();
  check(
    'Helena was asked for every call',
    seen.includes('resolve') && seen.includes('audit'),
    seen.join(','),
  );
} catch (error) {
  check(
    'no unexpected error',
    false,
    error instanceof Error ? `${error.message}\n${error.stack}` : String(error),
  );
} finally {
  gateway.stop();
  plan.close();
}

console.log(failures === 0 ? 'MCP ALL PASSED' : `MCP ${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
