// The "projekt-browser" MCP server of the agentic browser eval (apps/api/src/scripts/
// agentic-browser): the same tools, instructions, dispatcher and patchright session a Helena
// agent gets through /usr/local/libexec/helena-browser-mcp, but on a throwaway Chromium and with
// Helena replaced by a stand-in (like e2e/gateway-e2e.manual.ts). The stand-in allows what a
// project on Autopilot level 3 allows and asks for approval where Helena's hard blocks are
// (payments, deletions). No logins are granted. Started by Hermes over stdio:
//
//   HELENA_EVAL_CDP_URL=http://127.0.0.1:<port> [HELENA_EVAL_STATS=<file>] \
//     bun packages/browser-gateway/eval/hermes-mcp.ts
import { appendFileSync } from 'node:fs';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { mcpToolOf } from '../src/agent-tool.ts';
import type { HelenaClient } from '../src/helena-client.ts';
import { ProjectBrowserLocks } from '../src/lock.ts';
import { GatewayDispatcher } from '../src/server.ts';
import { PatchrightGatewaySession } from '../src/session.ts';
import { toolResult } from '../src/shim-protocol.ts';
import { BROWSER_INSTRUCTIONS, BROWSER_TOOLS, TASK_TOOLS } from '../src/tools.ts';

const cdpUrl = process.env.HELENA_EVAL_CDP_URL;
const statsFile = process.env.HELENA_EVAL_STATS;
if (!cdpUrl || !/^http:\/\/127\.0\.0\.1:\d+$/.test(cdpUrl)) {
  process.stderr.write('HELENA_EVAL_CDP_URL must be http://127.0.0.1:<port>\n');
  process.exit(2);
}

// Helena's defaults for a project browser (apps/api/src/modules/agent-browser-gateway/model.ts),
// with local addresses opened for the fixture site on 127.0.0.1.
const settings = {
  domainBlocklist: [] as string[],
  domainAllowlist: [] as string[],
  humanInput: true,
  lockTimeoutSec: 120,
  allowLocalAddresses: true,
};

const helena = {
  resolve: async () => ({
    agentId: 1,
    agentName: 'eval-agent',
    teamId: 1,
    projectId: 1,
    projectKey: 'EVAL',
    browserGatewayEnabled: true,
    settings,
  }),
  login: async () => ({ status: 'none' }),
  loginCode: async () => {
    throw new Error('No login is granted in this eval.');
  },
  audit: async () => {},
  handover: async () => ({ approvalId: null }),
  handoverDone: async () => {},
  decide: async (body: { category: string }) =>
    body.category === 'pay' || body.category === 'delete' || body.category === 'credentials'
      ? { effect: 'needs-approval', reason: `${body.category} needs the owner`, approvalId: null }
      : { effect: 'allow', reason: 'Autopilot level 3' },
  download: async () => ({ path: 'Projects/EVAL/Inbox/download' }),
  policy: async () => ({}),
} as unknown as HelenaClient;

let session: Promise<PatchrightGatewaySession> | null = null;
const dispatcher = new GatewayDispatcher({
  ownSlug: 'eval',
  helena,
  locks: new ProjectBrowserLocks(120_000),
  sessions: {
    get: () => {
      session ??= PatchrightGatewaySession.connect(cdpUrl, { humanInput: settings.humanInput });
      session.catch(() => {
        session = null;
      });
      return session;
    },
  },
});

const server = new Server(
  { name: 'projekt-browser', title: 'Projekt-Browser', version: '1.0.0' },
  { capabilities: { tools: {} }, instructions: BROWSER_INSTRUCTIONS },
);

// Browser-Steuerung "Standard": the step tools, without browser_task/check/choose.
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: BROWSER_TOOLS.filter((tool) => !TASK_TOOLS.has(tool.name)).map(mcpToolOf),
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const response = await dispatcher.handle({
    tool: request.params.name,
    args: request.params.arguments ?? {},
    agentKey: 'eval',
  });
  if (statsFile) {
    const chars = response.ok ? response.content.length : response.error.length;
    try {
      appendFileSync(
        statsFile,
        `${JSON.stringify({ tool: request.params.name, ok: response.ok, chars })}\n`,
      );
    } catch {
      // statistics are optional
    }
  }
  return toolResult(response);
});

server.connect(new StdioServerTransport()).catch((error: unknown) => {
  process.stderr.write(
    `projekt-browser (eval): ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exit(1);
});
