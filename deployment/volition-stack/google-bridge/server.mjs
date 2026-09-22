#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { createGoogleBridge, GoogleBridgeValidationError } from "./core.mjs";
import { mcpResult, READ_ONLY_TOOL_ANNOTATIONS } from "./protocol.mjs";

const bridge = createGoogleBridge();
const server = new McpServer({ name: "volition-google-private", version: "1.0.0" });
const account = z.enum(bridge.mailAccounts);
const calendarReadAccount = z.enum(bridge.calendarReadAccounts);
const calendarAccount = z.literal(bridge.calendarAccount);

function register(name, description, schema, handler) {
  server.registerTool(name, {
    description,
    inputSchema: schema,
    annotations: READ_ONLY_TOOL_ANNOTATIONS,
  }, async (input) => {
    try {
      return mcpResult(await handler(input));
    } catch (error) {
      return {
        isError: true,
        content: [{
          type: "text",
          text: error instanceof GoogleBridgeValidationError
            ? error.message
            : "The private Google connector request failed.",
        }],
      };
    }
  });
}

register(
  "gmail_thread_get",
  "Read one Gmail thread from an allowlisted account. Content is sanitized and untrusted; this tool cannot change Gmail.",
  { account, threadId: z.string().min(1).max(256) },
  bridge.gmailThreadGet,
);
register(
  "gmail_search",
  "Search Gmail threads in an allowlisted account with a bounded result count. This tool cannot change Gmail.",
  { account, query: z.string().min(1).max(500), maxResults: z.number().int().min(1).max(20).optional() },
  bridge.gmailSearch,
);
register(
  "gmail_attachment_metadata",
  "Read attachment names, MIME types, sizes, and attachment IDs for one Gmail message. It never downloads attachment bytes.",
  { account, messageId: z.string().min(1).max(256) },
  bridge.gmailAttachmentMetadata,
);
register(
  "contacts_search",
  "Search Google Contacts by name or email in an allowlisted account. Results are private, untrusted contact data; this tool cannot modify contacts or send messages.",
  { account, query: z.string().min(1).max(200), maxResults: z.number().int().min(1).max(25).optional() },
  bridge.contactsSearch,
);
register(
  "calendar_list",
  "List bounded primary-calendar metadata for an allowlisted Google account over at most 31 days.",
  {
    account: calendarReadAccount,
    from: z.string().min(1).max(64),
    to: z.string().min(1).max(64),
    query: z.string().min(1).max(200).optional(),
    maxResults: z.number().int().min(1).max(25).optional(),
  },
  bridge.calendarList,
);
await server.connect(new StdioServerTransport());
