import type { z } from 'zod';
import type { Connector } from './connectors';
import type { Logger } from './common';
import type { EventHandler, EventInit, HelenaEvent } from './events';
import type { LocalAiTaskClass, ModelServerType } from './local-ai';
import type { CaptureTarget, KnowledgeSource } from './knowledge';
import type { HostCapability } from './host';
import type { PluginManifest, McpServerContribution } from './manifest-types';
import type { PolicyEvaluator } from './policy';
import type { RuntimeType } from './runtime';
import type { ProfileContribution } from './runtime-policy';
import type { BundleOffer } from './templates';
import type { AnyAgentTool } from './tools';
import type { UiSlot } from './ui';
import type { RuntimeLoginSource } from './runtime-logins';
import type { UpdateSource } from './updates';
import type { DecisionBackendType } from './decision-backends';
import type { DecisionClass } from './decisions';
import type { UsageLimitSource } from './usage-limits';
import type { TriggerType, WorkflowStepType } from './workflows';

// A plugin is a module whose default export has a `register` function. Helena calls it
// once per process at start with a context scoped to the plugin: everything the plugin
// registers is checked against its manifest (it may only provide what it declared and
// only use the permissions it asked for) and stamped with its id.
//
// The lifecycle follows Strapi's and Backstage's: `register` adds extensions and must not
// do I/O it cannot undo; `start` runs once every plugin is registered (open connections,
// start timers); `stop` runs on shutdown.
//
// A plugin imports only types from '@helena/sdk'. What it needs at runtime (zod, the
// event bus, a logger) comes in the context, so a plugin never carries a second copy of
// the SDK and never depends on how Helena was built.

// The process a plugin is loaded into. The API and the worker load the `server` entry,
// the runner the `runner` entry.
export type HostProcess = 'api' | 'worker' | 'runner' | 'test';

export interface Registrar<T> {
  register(value: T): () => void;
}

export interface PluginContext {
  pluginId: string;
  manifest: PluginManifest;
  process: HostProcess;
  // The host's zod, for schemas. Any Standard Schema library works as well.
  z: typeof z;
  log: Logger;
  // The plugin's settings, as the Administrator saved them.
  settings: Record<string, unknown>;
  runtimes: Registrar<RuntimeType>;
  connectors: Registrar<Connector>;
  tools: Registrar<AnyAgentTool>;
  stepTypes: Registrar<WorkflowStepType<unknown>>;
  triggerTypes: Registrar<TriggerType<unknown>>;
  policies: Registrar<PolicyEvaluator>;
  uiSlots: Registrar<UiSlot>;
  knowledgeSources: Registrar<KnowledgeSource>;
  captureTargets: Registrar<CaptureTarget>;
  // Template bundles (agent templates, skills, MCP servers) offered for import.
  bundles: Registrar<BundleOffer>;
  // What the machine Helena runs on offers the Administrator (disks, backups, power, …).
  hostCapabilities: Registrar<HostCapability>;
  mcpServers: Registrar<McpServerContribution>;
  // What a runner writes into every agent's runtime profile (MCP servers, Hermes settings).
  profileContributions: Registrar<ProfileContribution>;
  // Where Helena reads how much of a subscription's limits is used (runner: probes and
  // observers over a runtime's login; API: polls).
  usageLimitSources: Registrar<UsageLimitSource>;
  // Where Helena reads whether the model logins agents share are usable (API: polls).
  runtimeLoginSources: Registrar<RuntimeLoginSource>;
  // Kinds of local model servers (Lemonade, any OpenAI-compatible server): how Helena lists
  // their models and reads their status (API).
  modelServers: Registrar<ModelServerType>;
  // Kinds of work local AI may take, each with the eval it must pass first (API).
  localAiTaskClasses: Registrar<LocalAiTaskClass>;
  // What Helena runs on and whether a newer version exists (the update center).
  updateSources: Registrar<UpdateSource>;
  // System One services the browser's fast path (browser_task) can ask (API).
  decisionBackends: Registrar<DecisionBackendType>;
  // Kinds of typed decisions a feature asks (the router, the mail classifier, a plugin's):
  // their questions' privacy, defaults and eval (API).
  decisionClasses: Registrar<DecisionClass>;
  events: {
    // Only event types under the plugin's own id: `<pluginId>.<name>`.
    publish(init: EventInit): Promise<HelenaEvent>;
    // Durable by default: delivered from the outbox in the worker, with retries.
    subscribe(
      patterns: string | string[],
      handler: EventHandler,
      options?: { id?: string; durable?: boolean },
    ): () => void;
  };
}

export interface HelenaPlugin {
  register(ctx: PluginContext): void | Promise<void>;
  start?(ctx: PluginContext): void | Promise<void>;
  stop?(): void | Promise<void>;
}

// Identity function that types a plugin object, for plugin authors.
export function definePlugin(plugin: HelenaPlugin): HelenaPlugin {
  return plugin;
}
