import type { ActionCategory } from './actions';
import type { LocalizedText } from './text';

// The plugin manifest, `helena.plugin.json` at the root of a plugin package. Like VS
// Code's `contributes` and Directus' extension manifest it is declarative: Helena reads
// what a plugin provides and asks for before running any of its code, and shows it in
// the Administrator. The JSON Schema is in @helena/sdk/plugin.schema.json.

export interface McpServerContribution {
  // The server's name in agents' MCP configs: `[a-z0-9][a-z0-9_-]*`.
  name: string;
  title?: LocalizedText;
  description?: LocalizedText;
  transport: 'stdio' | 'http';
  // stdio: the command, relative to the plugin folder or on PATH.
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  // http: the Streamable HTTP endpoint.
  url?: string;
  // The action category of each tool the server lists, where its MCP annotations do not
  // say enough. Tools not named here get the category their annotations imply.
  toolCategories?: Record<string, ActionCategory>;
}

export interface PluginProvides {
  runtimes?: string[];
  connectors?: string[];
  tools?: string[];
  stepTypes?: string[];
  triggerTypes?: string[];
  policies?: string[];
  // `<slot>:<id>`, e.g. `panel-tool:hello`.
  uiSlots?: string[];
  knowledgeSources?: string[];
  captureTargets?: string[];
  // Template bundles offered for import (agent templates, skills, MCP servers).
  bundles?: string[];
  // Contributions to every agent's runtime profile (runner).
  profileContributions?: string[];
  // Usage-limit sources (how much of a subscription's limits is used).
  usageLimitSources?: string[];
  // Runtime login sources (whether the model logins agents share are usable).
  runtimeLoginSources?: string[];
  // Update sources (whether a newer version of something Helena runs on exists).
  updateSources?: string[];
  // Event types the plugin publishes; always under its own id.
  events?: string[];
  mcpServers?: McpServerContribution[];
}

export interface PluginPermissions {
  // The action categories the plugin's tools, steps and services may have. A tool of a
  // category not listed here is refused at registration.
  actions?: ActionCategory[];
  // Event types (patterns like `helena.issue.*`) the plugin subscribes to.
  events?: string[];
  // Hosts the plugin talks to. Declared and shown to the operator; not enforced (see the
  // security model in docs/helena-framework.md).
  network?: string[];
  // The plugin's tools receive decrypted credentials of its own connectors.
  credentials?: boolean;
}

export interface PluginEntries {
  // Loaded by the API and the worker.
  server?: string;
  // Loaded by the runner.
  runner?: string;
}

export interface PluginManifest {
  $schema?: string;
  // Lowercase, dot-separated words: `hello-helena`, `acme.jira`. `helena.*` is reserved
  // for the built-in plugins.
  id: string;
  name: LocalizedText;
  version: string;
  description?: LocalizedText;
  author?: string;
  license?: string;
  homepage?: string;
  // The @helena/sdk versions the plugin works with, as a semver range: `^0.1.0`.
  sdk: string;
  main?: PluginEntries;
  provides: PluginProvides;
  permissions?: PluginPermissions;
  // The settings form, as JSON Schema; the Administrator renders it and hands the values
  // to the plugin as `ctx.settings`.
  settings?: Record<string, unknown>;
}
