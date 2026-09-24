'use client';

import McpConnectionGuide from './McpConnectionGuide';
import McpOAuthGuide from './McpOAuthGuide';
import { MCP_URL } from '../utils/clients';

const discoveryUrl = `${new URL(MCP_URL).origin}/.well-known/oauth-authorization-server`;

export type McpMethod = 'oauth' | 'api-key';

// How to connect a client, for the method picked in the page's header row (OAuth or a
// personal API key).
export default function McpAuthConfiguration({ method }: { method: McpMethod }) {
  return method === 'oauth' ? (
    <McpOAuthGuide mcpUrl={MCP_URL} discoveryUrl={discoveryUrl} />
  ) : (
    <McpConnectionGuide />
  );
}
