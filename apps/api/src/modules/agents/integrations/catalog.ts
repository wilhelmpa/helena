import {
  declaredCategory,
  renderDisplayName,
  resolveText,
  type ActionCategory,
  type Connector,
} from '@helena/sdk';
import type { ConfigField } from '@repo/agent-tools';
import { registries } from '#shared/helena';

// The integration catalog: every service a team can store a credential for, which are
// the connectors of the connector registry (@helena/sdk): the built-in integrations of
// @repo/agent-tools (Jina, Firecrawl, Telegram, Threads …) and those of plugins. Their
// credential schema and tool list come from the connector, each tool with its action
// category. The credential form and the tool picker are built from a descriptor on the
// frontend. The web logins, API keys, SSH keys and secrets of the Credentials page are
// stored in the same table but are not integrations (see modules/agents/credentials).
// Helena runs no model, so there are no model providers to store a key for.

export type IntegrationKind = 'tool';

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

// A connector as the catalog lists it, its labels in the reader's language where the
// connector brings one (English otherwise).
function connectorEntry(connector: Connector, locale = 'en'): UnifiedIntegration {
  return {
    key: connector.id,
    label: resolveText(connector.label, locale),
    kind: 'tool',
    credentialSchema: connector.credentialSchema.map((field) => ({
      key: field.key,
      label: resolveText(field.label, locale),
      type: field.type === 'text' ? 'string' : field.type,
      required: field.required,
      ...(field.placeholder ? { placeholder: field.placeholder } : {}),
      ...(field.help ? { help: resolveText(field.help, locale) } : {}),
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
export function integrationCatalog(locale = 'en', displayName = 'Ava'): UnifiedIntegration[] {
  return renderDisplayName(
    registries.connectors.list().map((connector) => connectorEntry(connector, locale)),
    displayName,
  );
}

function byKey(key: string): UnifiedIntegration | undefined {
  const connector = registries.connectors.get(key);
  return connector ? connectorEntry(connector) : undefined;
}

// The credential schema for an integration, or undefined for an unknown key.
export function credentialSchemaFor(key: string): ConfigField[] | undefined {
  return byKey(key)?.credentialSchema;
}

// The kind of an integration, or undefined for a key the catalog no longer carries.
export function integrationKind(key: string): IntegrationKind | undefined {
  return byKey(key)?.kind;
}
