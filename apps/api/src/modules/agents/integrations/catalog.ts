import { declaredCategory, resolveText, type ActionCategory, type Connector } from '@helena/sdk';
import type { ConfigField } from '@repo/agent-tools';
import { registries } from '#shared/helena';
import { AI_PROVIDERS } from './llm-providers';

// The unified integration catalog: every service a project can store a credential
// for. Two kinds:
//   - "llm"  — the AI providers whose models an internal agent runs on. Their
//              credential is an API key (plus a base URL for OpenAI-compatible
//              endpoints). They expose no tools.
//   - "tool" — the connectors of the connector registry (@helena/sdk): the built-in
//              integrations of @repo/agent-tools (Jina, Firecrawl, Telegram, Threads …)
//              and those of plugins. Their credential schema and tool list come from the
//              connector, each tool with its action category.
// The credential form and, for tool integrations, the tool picker are built from a
// descriptor on the frontend. The web logins, API keys, SSH keys and secrets of the
// Credentials page are stored in the same table but are not integrations (see
// modules/agents/credentials).

export type IntegrationKind = 'llm' | 'tool';

export interface UnifiedIntegration {
  key: string;
  label: string;
  kind: IntegrationKind;
  credentialSchema: ConfigField[];
  tools: {
    key: string;
    label: string;
    description: string;
    scopes?: string[];
    category?: ActionCategory;
  }[];
}

// The credential fields of an LLM provider: an API key, plus a base URL for the
// OpenAI-compatible providers that require one.
function llmCredentialSchema(requiresBaseUrl: boolean): ConfigField[] {
  const fields: ConfigField[] = [
    { key: 'apiKey', label: 'API key', type: 'secret', required: true, placeholder: 'sk-…' },
  ];
  if (requiresBaseUrl) {
    fields.push({
      key: 'baseUrl',
      label: 'Base URL',
      type: 'url',
      required: true,
      placeholder: 'https://your-endpoint/v1',
    });
  }
  return fields;
}

const LLM_INTEGRATIONS: UnifiedIntegration[] = AI_PROVIDERS.map((p) => ({
  key: p.key,
  label: p.label,
  kind: 'llm',
  credentialSchema: llmCredentialSchema(p.requiresBaseUrl),
  tools: [],
}));

// A connector as the catalog lists it. Labels a plugin gives per locale are shown in
// English here; the catalog has no locale of its own yet.
function connectorEntry(connector: Connector): UnifiedIntegration {
  return {
    key: connector.id,
    label: resolveText(connector.label, 'en'),
    kind: 'tool',
    credentialSchema: connector.credentialSchema.map((field) => ({
      key: field.key,
      label: resolveText(field.label, 'en'),
      type: field.type === 'text' ? 'string' : field.type,
      required: field.required,
      ...(field.placeholder ? { placeholder: field.placeholder } : {}),
      ...(field.help ? { help: resolveText(field.help, 'en') } : {}),
    })),
    tools: (connector.tools ?? []).map((tool) => ({
      key: tool.name,
      label: tool.title ?? tool.name,
      description: tool.description,
      ...(tool.scopes ? { scopes: tool.scopes } : {}),
      category: declaredCategory(tool),
    })),
  };
}

// Read at call time: a plugin's connectors join the registry at start.
export function integrationCatalog(): UnifiedIntegration[] {
  return [...LLM_INTEGRATIONS, ...registries.connectors.list().map(connectorEntry)];
}

function byKey(key: string): UnifiedIntegration | undefined {
  const connector = registries.connectors.get(key);
  if (connector) return connectorEntry(connector);
  return LLM_INTEGRATIONS.find((integration) => integration.key === key);
}

// The credential schema for an integration, or undefined for an unknown key.
export function credentialSchemaFor(key: string): ConfigField[] | undefined {
  return byKey(key)?.credentialSchema;
}

// The kind of an integration, or undefined for a key the catalog no longer carries.
export function integrationKind(key: string): IntegrationKind | undefined {
  return byKey(key)?.kind;
}
