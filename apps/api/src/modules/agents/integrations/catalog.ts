import type { ConfigField } from '@repo/agent-tools';
import { integrationDescriptors } from '@repo/agent-tools';

// The integration catalog: every service a team can store a credential for, which are
// the tool integrations (Jina, Firecrawl, Telegram, Threads …) from @repo/agent-tools.
// Their credential schema and tool list come from the package. The credential form and
// the tool picker are built from a descriptor on the frontend. The web logins, API
// keys, SSH keys and secrets of the Credentials page are stored in the same table but
// are not integrations (see modules/agents/credentials). Helena runs no model, so
// there are no model providers to store a key for.

export type IntegrationKind = 'tool';

export interface UnifiedIntegration {
  key: string;
  label: string;
  kind: IntegrationKind;
  credentialSchema: ConfigField[];
  tools: { key: string; label: string; description: string; scopes?: string[] }[];
}

export const INTEGRATION_CATALOG: UnifiedIntegration[] = integrationDescriptors().map((d) => ({
  key: d.key,
  label: d.label,
  kind: 'tool',
  credentialSchema: d.credentialSchema,
  tools: d.tools,
}));

const BY_KEY = new Map(INTEGRATION_CATALOG.map((i) => [i.key, i]));

// The credential schema for an integration, or undefined for an unknown key.
export function credentialSchemaFor(key: string): ConfigField[] | undefined {
  return BY_KEY.get(key)?.credentialSchema;
}

// The kind of an integration, or undefined for a key the catalog no longer carries.
export function integrationKind(key: string): IntegrationKind | undefined {
  return BY_KEY.get(key)?.kind;
}
