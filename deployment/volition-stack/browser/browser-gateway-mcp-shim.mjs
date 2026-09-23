#!/usr/bin/env node
// The stdio MCP server every runtime (Hermes, Claude Code, Codex) reaches the browser gateway
// through (design volition-design-browser-gateway.md §3: "Warum stdio-Shim? ... Der Shim
// reicht nur weiter und hat selbst keine Rechte."). Installed at the fixed path every runtime
// is given as its "projekt-browser" MCP server command -- BROWSER_GATEWAY_SHIM_PATH in
// apps/api/src/modules/agents/mcp-servers/service.ts and packages/runner/src/policy.ts, both
// of which must keep the same literal path as this file's install location.
//
// No HTTP, no auth of its own: every call is forwarded to the gateway's Unix socket exactly as
// browser-gateway-mcp-shim-protocol.mjs describes, carrying the caller's own ITSAPLAN_API_KEY;
// the gateway is what checks it against Plan. tools/list is BROWSER_TOOLS
// (packages/browser-gateway/src/tools.ts, the same list the gateway itself and its tests use),
// imported by a plain relative path rather than the "@repo/browser-gateway" package specifier:
// this directory is not (yet) wired into the bun workspace's node_modules, and Node runs a
// plain, erasable-syntax .ts file like this natively (no build step) -- see the report for
// what installing this file still needs (an @modelcontextprotocol/sdk node_modules next to
// it, e.g. via `npm install` in this directory, per package.json here).
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { BROWSER_TOOLS } from "../../../packages/browser-gateway/src/tools.ts";
import { callGateway } from "./browser-gateway-mcp-shim-protocol.mjs";

const server = new Server(
  { name: "projekt-browser", title: "Projekt-Browser", version: "1.0.0" },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: BROWSER_TOOLS.map((tool) => ({
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema,
  })),
}));

server.setRequestHandler(CallToolRequestSchema, async (request) =>
  callGateway(request.params.name, request.params.arguments ?? {}),
);

await server.connect(new StdioServerTransport());
