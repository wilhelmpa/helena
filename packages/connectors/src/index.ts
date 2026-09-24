import { BUILTIN_CREDENTIALS } from './builtin';
import { googleConnector } from './google';
import { Registry, type Connector } from './sdk';

export * from './sdk';
export { BUILTIN_CREDENTIALS } from './builtin';

// The connectors Helena knows. The built-ins register here; a plugin registers its own
// through the same call once the plugin loader (hub/framework) is in place.
export const connectors = new Registry<Connector>('connector');

for (const connector of [...BUILTIN_CREDENTIALS, googleConnector]) connectors.register(connector);

// The connector of an MCP server that signs in with OAuth. Its tools are the server's own;
// Helena holds the token and hands it to the runner as the server's Authorization header.
connectors.register({
  id: 'mcp_oauth',
  label: { en: 'MCP server (OAuth)', de: 'MCP-Server (OAuth)' },
  icon: 'plug',
  kind: 'account',
  credentialSchema: [
    { key: 'serverUrl', label: { en: 'Server', de: 'Server' }, type: 'url', required: true },
  ],
  services: [],
  tools: [],
});
