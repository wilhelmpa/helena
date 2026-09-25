import { z } from 'zod';
import { isActionCategory, type ActionCategory } from '../actions';
import { consoleLogger, type Logger } from '../common';
import type { Connector } from '../connectors';
import {
  createEvent,
  createEventBus,
  matchesEventPattern,
  type EventBus,
  type EventInit,
} from '../events';
import type { HostCapability } from '../host';
import type { CaptureTarget, KnowledgeSource } from '../knowledge';
import type { LocalAiTaskClass, ModelServerType } from '../local-ai';
import type { McpServerContribution, PluginManifest } from '../manifest-types';
import type { HelenaPlugin, HostProcess, PluginContext, Registrar } from '../plugin';
import { decide, type PolicyDecision, type PolicyEvaluator, type PolicyRequest } from '../policy';
import { Registry } from '../registry';
import { createRegistries, type HelenaRegistries } from '../registries';
import type { RuntimeType } from '../runtime';
import type { ProfileContribution } from '../runtime-policy';
import type { BundleOffer } from '../templates';
import { validateBundle } from '../templates';
import { declaredCategory, type AnyAgentTool } from '../tools';
import { uiSlotKey, type UiSlot } from '../ui';
import type { RuntimeLoginSource } from '../runtime-logins';
import type { UpdateSource } from '../updates';
import type { DecisionBackendType } from '../decision-backends';
import type { UsageLimitSource } from '../usage-limits';
import type { TriggerType, WorkflowStepType } from '../workflows';

// The plugin host of one process: every registry, the event bus, and the plugins loaded
// into them. Built-in features register through the same host as external plugins, as
// internal plugins with a manifest in code.

export type PluginSource = 'builtin' | 'external';
export type PluginStatus = 'loaded' | 'failed' | 'disabled';

export interface LoadedPlugin {
  manifest: PluginManifest;
  source: PluginSource;
  status: PluginStatus;
  error?: string;
  // Where an external plugin was found.
  dir?: string;
  // The digest the operator approved it under (see loader.ts).
  digest?: string;
}

export class PluginRegistrationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PluginRegistrationError';
  }
}

export interface PluginHostOptions {
  process: HostProcess;
  events?: EventBus;
  // Registries the process already holds (built-ins registered at import time); the
  // missing ones are created.
  registries?: Partial<HelenaRegistries>;
  logger?: (pluginId: string) => Logger;
  // Settings per plugin id, as the Administrator saved them.
  settings?: (pluginId: string) => Record<string, unknown>;
}

// `foo*` matches every id starting with `foo`; anything else only itself.
function declared(list: string[] | undefined, id: string): boolean {
  return (list ?? []).some((entry) =>
    entry.endsWith('*') ? id.startsWith(entry.slice(0, -1)) : entry === id,
  );
}

export class PluginHost {
  readonly process: HostProcess;
  readonly events: EventBus;
  readonly runtimes: Registry<RuntimeType>;
  readonly connectors: Registry<Connector>;
  readonly tools: Registry<AnyAgentTool>;
  readonly stepTypes: Registry<WorkflowStepType<unknown>>;
  readonly triggerTypes: Registry<TriggerType<unknown>>;
  readonly policies: Registry<PolicyEvaluator>;
  readonly uiSlots: Registry<UiSlot>;
  readonly knowledgeSources: Registry<KnowledgeSource>;
  readonly captureTargets: Registry<CaptureTarget>;
  readonly bundles: Registry<BundleOffer>;
  readonly hostCapabilities: Registry<HostCapability>;
  readonly mcpServers: Registry<McpServerContribution>;
  readonly profileContributions: Registry<ProfileContribution>;
  readonly usageLimitSources: Registry<UsageLimitSource>;
  readonly runtimeLoginSources: Registry<RuntimeLoginSource>;
  readonly modelServers: Registry<ModelServerType>;
  readonly localAiTaskClasses: Registry<LocalAiTaskClass>;
  readonly updateSources: Registry<UpdateSource>;
  readonly decisionBackends: Registry<DecisionBackendType>;

  private readonly plugins = new Map<string, { loaded: LoadedPlugin; plugin?: HelenaPlugin }>();
  private readonly contexts = new Map<string, PluginContext>();
  private readonly unsubscribe = new Map<string, () => void>();
  private readonly logger: (pluginId: string) => Logger;
  private readonly settingsOf: (pluginId: string) => Record<string, unknown>;

  constructor(options: PluginHostOptions) {
    this.process = options.process;
    this.events = options.events ?? createEventBus();
    const registries = createRegistries(options.registries);
    this.runtimes = registries.runtimes;
    this.connectors = registries.connectors;
    this.tools = registries.tools;
    this.stepTypes = registries.stepTypes;
    this.triggerTypes = registries.triggerTypes;
    this.policies = registries.policies;
    this.uiSlots = registries.uiSlots;
    this.knowledgeSources = registries.knowledgeSources;
    this.captureTargets = registries.captureTargets;
    this.bundles = registries.bundles;
    this.hostCapabilities = registries.hostCapabilities;
    this.mcpServers = registries.mcpServers;
    this.profileContributions = registries.profileContributions;
    this.usageLimitSources = registries.usageLimitSources;
    this.runtimeLoginSources = registries.runtimeLoginSources;
    this.modelServers = registries.modelServers;
    this.localAiTaskClasses = registries.localAiTaskClasses;
    this.updateSources = registries.updateSources;
    this.decisionBackends = registries.decisionBackends;
    this.logger = options.logger ?? ((id) => consoleLogger(`plugin ${id}`));
    this.settingsOf = options.settings ?? (() => ({}));
  }

  // Registers a plugin's extensions. A plugin that throws half way has everything it
  // registered removed again and is reported as failed; the host keeps running.
  async load(
    plugin: HelenaPlugin,
    manifest: PluginManifest,
    meta: { source: PluginSource; dir?: string; digest?: string } = { source: 'builtin' },
  ): Promise<LoadedPlugin> {
    if (this.plugins.has(manifest.id)) {
      throw new PluginRegistrationError(`Plugin ${manifest.id} is already loaded`);
    }
    const loaded: LoadedPlugin = { manifest, status: 'loaded', ...meta };
    this.plugins.set(manifest.id, { loaded, plugin });
    const ctx = this.contextFor(manifest);
    try {
      // MCP servers are declared, not coded: the manifest entry is the registration.
      for (const server of manifest.provides.mcpServers ?? []) ctx.mcpServers.register(server);
      await plugin.register(ctx);
      this.contexts.set(manifest.id, ctx);
    } catch (error) {
      this.unregisterPlugin(manifest.id);
      loaded.status = 'failed';
      loaded.error = error instanceof Error ? error.message : String(error);
      this.logger(manifest.id).error(`failed to register: ${loaded.error}`);
    }
    return loaded;
  }

  // Records a plugin that was found but not loaded (switched off, not approved, invalid),
  // so the Administrator can list it.
  record(loaded: LoadedPlugin): void {
    if (!this.plugins.has(loaded.manifest.id)) this.plugins.set(loaded.manifest.id, { loaded });
  }

  // Runs every loaded plugin's start hook, once all are registered.
  async start(): Promise<void> {
    for (const [id, entry] of this.plugins) {
      const ctx = this.contexts.get(id);
      if (!entry.plugin?.start || !ctx || entry.loaded.status !== 'loaded') continue;
      try {
        await entry.plugin.start(ctx);
      } catch (error) {
        entry.loaded.status = 'failed';
        entry.loaded.error = error instanceof Error ? error.message : String(error);
        this.unregisterPlugin(id);
        this.logger(id).error(`failed to start: ${entry.loaded.error}`);
      }
    }
  }

  async stop(): Promise<void> {
    for (const [id, entry] of [...this.plugins].reverse()) {
      if (!entry.plugin?.stop || entry.loaded.status !== 'loaded') continue;
      try {
        await entry.plugin.stop();
      } catch (error) {
        this.logger(id).warn(`failed to stop: ${String(error)}`);
      }
    }
  }

  // Stops a plugin and removes everything it registered, for a test or a switch that
  // takes effect without a restart.
  async unload(pluginId: string): Promise<void> {
    const entry = this.plugins.get(pluginId);
    if (!entry) return;
    if (entry.plugin?.stop && entry.loaded.status === 'loaded') {
      try {
        await entry.plugin.stop();
      } catch (error) {
        this.logger(pluginId).warn(`failed to stop: ${String(error)}`);
      }
    }
    this.unregisterPlugin(pluginId);
    this.plugins.delete(pluginId);
    this.contexts.delete(pluginId);
  }

  list(): LoadedPlugin[] {
    return [...this.plugins.values()].map((entry) => entry.loaded);
  }

  get(pluginId: string): LoadedPlugin | undefined {
    return this.plugins.get(pluginId)?.loaded;
  }

  // The policy decision for an action, from every registered evaluator.
  decide(request: PolicyRequest): Promise<PolicyDecision> {
    return decide(this.policies.list(), request);
  }

  private unregisterPlugin(pluginId: string): void {
    for (const registry of this.registries()) registry.removePlugin(pluginId);
    for (const sub of this.events.subscriptions()) {
      if (sub.pluginId === pluginId) this.unsubscribe.get(sub.id)?.();
    }
  }

  private registries(): Registry<never>[] {
    return [
      this.runtimes,
      this.connectors,
      this.tools,
      this.stepTypes,
      this.triggerTypes,
      this.policies,
      this.uiSlots,
      this.knowledgeSources,
      this.captureTargets,
      this.bundles,
      this.hostCapabilities,
      this.mcpServers,
      this.profileContributions,
      this.usageLimitSources,
      this.runtimeLoginSources,
      this.modelServers,
      this.localAiTaskClasses,
      this.updateSources,
      this.decisionBackends,
    ] as unknown as Registry<never>[];
  }

  private contextFor(manifest: PluginManifest): PluginContext {
    const pluginId = manifest.id;
    const provides = manifest.provides;
    const actions = new Set<ActionCategory>(manifest.permissions?.actions ?? []);
    const fail = (message: string): never => {
      throw new PluginRegistrationError(`${pluginId}: ${message}`);
    };
    const needAction = (category: ActionCategory, what: string) => {
      if (!isActionCategory(category)) fail(`${what} has no valid action category`);
      if (!actions.has(category)) {
        fail(
          `${what} is "${category}", which the manifest does not ask for in permissions.actions`,
        );
      }
    };
    const registrar = <T>(
      registry: Registry<T>,
      list: string[] | undefined,
      field: string,
      check?: (value: T) => void,
      idOf: (value: T) => string = (value) => (value as { id: string }).id,
    ): Registrar<T> => ({
      register(value) {
        const id = idOf(value);
        if (!declared(list, id)) fail(`${field} "${id}" is not declared in provides.${field}`);
        check?.(value);
        return registry.register(value, pluginId);
      },
    });
    const checkTool = (tool: AnyAgentTool, where = 'tool') => {
      needAction(declaredCategory(tool), `${where} ${tool.name}`);
      if (tool.connector && !manifest.permissions?.credentials) {
        fail(`tool ${tool.name} runs with a credential, which needs permissions.credentials`);
      }
    };
    const log = this.logger(pluginId);

    return {
      pluginId,
      manifest,
      process: this.process,
      z,
      log,
      settings: this.settingsOf(pluginId),
      runtimes: registrar(this.runtimes, provides.runtimes, 'runtimes'),
      // A connector's tools become agent tools too, bound to the connector.
      connectors: {
        register: (connector) => {
          if (!declared(provides.connectors, connector.id)) {
            fail(`connectors "${connector.id}" is not declared in provides.connectors`);
          }
          for (const service of connector.services ?? []) {
            for (const action of service.actions) needAction(action, `service ${service.id}`);
          }
          const tools = (connector.tools ?? []).map((tool) => ({
            ...tool,
            connector: tool.connector ?? connector.id,
          }));
          for (const tool of tools) {
            if (!declared(provides.tools, tool.name)) {
              fail(
                `tool "${tool.name}" of connector ${connector.id} is not declared in provides.tools`,
              );
            }
            checkTool(tool);
          }
          const offs = [this.connectors.register(connector, pluginId)];
          try {
            for (const tool of tools) offs.push(this.tools.register(tool, pluginId));
          } catch (error) {
            for (const off of offs) off();
            throw error;
          }
          return () => {
            for (const off of offs) off();
          };
        },
      },
      tools: registrar(
        this.tools,
        provides.tools,
        'tools',
        (tool) => checkTool(tool),
        (tool) => tool.name,
      ),
      stepTypes: registrar(this.stepTypes, provides.stepTypes, 'stepTypes', (step) =>
        needAction(step.category, `step type ${step.id}`),
      ),
      triggerTypes: registrar(
        this.triggerTypes,
        provides.triggerTypes,
        'triggerTypes',
        (trigger) => {
          for (const pattern of trigger.events ?? []) {
            if (!(manifest.permissions?.events ?? []).some((allowed) => covers(allowed, pattern))) {
              fail(`trigger ${trigger.id} listens to ${pattern}, not in permissions.events`);
            }
          }
        },
      ),
      policies: registrar(this.policies, provides.policies, 'policies'),
      uiSlots: registrar(this.uiSlots, provides.uiSlots, 'uiSlots', undefined, uiSlotKey),
      knowledgeSources: registrar(
        this.knowledgeSources,
        provides.knowledgeSources,
        'knowledgeSources',
      ),
      captureTargets: registrar(this.captureTargets, provides.captureTargets, 'captureTargets'),
      bundles: registrar(this.bundles, provides.bundles, 'bundles', (offer) => {
        const problems = validateBundle(offer.bundle);
        if (problems.length) fail(`bundle ${offer.id} is invalid: ${problems.join('; ')}`);
      }),
      hostCapabilities: registrar(
        this.hostCapabilities,
        provides.hostCapabilities,
        'hostCapabilities',
      ),
      mcpServers: registrar(
        this.mcpServers,
        (provides.mcpServers ?? []).map((server) => server.name),
        'mcpServers',
        (server) => {
          for (const category of Object.values(server.toolCategories ?? {})) {
            needAction(category, `a tool of MCP server ${server.name}`);
          }
        },
        (server) => server.name,
      ),
      profileContributions: registrar(
        this.profileContributions,
        provides.profileContributions,
        'profileContributions',
      ),
      usageLimitSources: registrar(
        this.usageLimitSources,
        provides.usageLimitSources,
        'usageLimitSources',
      ),
      runtimeLoginSources: registrar(
        this.runtimeLoginSources,
        provides.runtimeLoginSources,
        'runtimeLoginSources',
      ),
      modelServers: registrar(this.modelServers, provides.modelServers, 'modelServers'),
      localAiTaskClasses: registrar(
        this.localAiTaskClasses,
        provides.localAiTaskClasses,
        'localAiTaskClasses',
      ),
      updateSources: registrar(this.updateSources, provides.updateSources, 'updateSources'),
      decisionBackends: registrar(
        this.decisionBackends,
        provides.decisionBackends,
        'decisionBackends',
      ),
      events: {
        publish: async (init: EventInit) => {
          if (!init.type.startsWith(`${pluginId}.`)) {
            fail(`may only publish events under its own id (${pluginId}.*), not ${init.type}`);
          }
          if (!declared(provides.events, init.type)) {
            fail(`event ${init.type} is not declared in provides.events`);
          }
          const event = createEvent({ ...init, actor: init.actor ?? `plugin:${pluginId}` });
          await this.events.publish(event);
          return event;
        },
        subscribe: (patterns, handler, options = {}) => {
          const list = Array.isArray(patterns) ? patterns : [patterns];
          for (const pattern of list) {
            if (!(manifest.permissions?.events ?? []).some((allowed) => covers(allowed, pattern))) {
              fail(`subscribes to ${pattern}, which is not in permissions.events`);
            }
          }
          const id = `${pluginId}:${options.id ?? list.join(',')}`;
          const off = this.events.subscribe(list, handler, {
            id,
            durable: options.durable ?? true,
            pluginId,
          });
          this.unsubscribe.set(id, off);
          return off;
        },
      },
    };
  }
}

// Whether the permission pattern `allowed` covers everything `pattern` matches.
function covers(allowed: string, pattern: string): boolean {
  if (allowed === '*') return true;
  if (allowed === pattern) return true;
  if (allowed.endsWith('.*')) {
    const prefix = allowed.slice(0, -1);
    return pattern.startsWith(prefix);
  }
  return !pattern.includes('*') && matchesEventPattern(allowed, pattern);
}
