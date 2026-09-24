#!/usr/bin/env node
// The stdio MCP server every runtime (Hermes, Claude Code, Codex) reaches the browser gateway
// through (design volition-design-browser-gateway.md §3: "Der Shim reicht nur weiter und hat
// selbst keine Rechte"). Built into one file and installed, owned by root, at
// /usr/local/libexec/helena-browser-mcp (deployment/volition-stack/native/
// install-browser-gateway.sh): outside /srv/volition, so an isolated agent's unit, which
// hides that tree, can still run it, and outside anything an agent could write.
//
// The runner names this path as the "projekt-browser" MCP server of each runtime
// (packages/runner/src/policy.ts, BROWSER_GATEWAY_SHIM_PATH); Helena's library row carries the
// same path (apps/api/src/modules/agents/mcp-servers/service.ts).
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { BROWSER_INSTRUCTIONS, BROWSER_TOOLS } from './tools.ts';
import { callGateway } from './shim-protocol.ts';

const server = new Server(
  { name: 'projekt-browser', title: 'Projekt-Browser', version: '1.0.0' },
  { capabilities: { tools: {} }, instructions: BROWSER_INSTRUCTIONS },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: BROWSER_TOOLS.map((tool) => ({
    name: tool.name,
    title: tool.title,
    description: tool.description,
    inputSchema: tool.inputSchema,
  })),
}));

server.setRequestHandler(CallToolRequestSchema, async (request) =>
  callGateway(request.params.name, request.params.arguments ?? {}),
);

// Built as CommonJS (no top-level await): the installed file has no extension, which Node
// reads as CommonJS.
server.connect(new StdioServerTransport()).catch((error: unknown) => {
  process.stderr.write(
    `projekt-browser: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exit(1);
});
