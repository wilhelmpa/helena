import type { Connector } from './connectors';
import type { CaptureTarget, KnowledgeSource } from './knowledge';
import type { McpServerContribution } from './manifest-types';
import type { PolicyEvaluator } from './policy';
import { Registry, createRegistry } from './registry';
import type { RuntimeAdapter } from './runtime';
import type { BundleOffer } from './templates';
import type { AnyAgentTool } from './tools';
import { uiSlotKey, type UiSlot } from './ui';
import type { TriggerType, WorkflowStepType } from './workflows';

// One registry per extension point. A process creates the set once (or only the ones it
// uses) and hands it to its plugin host, so built-ins registered at import time and
// plugins loaded at start end up in the same place.
export interface HelenaRegistries {
  runtimes: Registry<RuntimeAdapter>;
  connectors: Registry<Connector>;
  tools: Registry<AnyAgentTool>;
  stepTypes: Registry<WorkflowStepType<unknown>>;
  triggerTypes: Registry<TriggerType<unknown>>;
  policies: Registry<PolicyEvaluator>;
  uiSlots: Registry<UiSlot>;
  knowledgeSources: Registry<KnowledgeSource>;
  captureTargets: Registry<CaptureTarget>;
  bundles: Registry<BundleOffer>;
  mcpServers: Registry<McpServerContribution>;
}

export function createRegistries(given: Partial<HelenaRegistries> = {}): HelenaRegistries {
  return {
    runtimes: given.runtimes ?? createRegistry<RuntimeAdapter>('runtime'),
    connectors: given.connectors ?? createRegistry<Connector>('connector'),
    tools: given.tools ?? new Registry<AnyAgentTool>('tool', (tool) => tool.name),
    stepTypes: given.stepTypes ?? createRegistry<WorkflowStepType<unknown>>('workflow step type'),
    triggerTypes: given.triggerTypes ?? createRegistry<TriggerType<unknown>>('trigger type'),
    policies: given.policies ?? createRegistry<PolicyEvaluator>('policy'),
    uiSlots: given.uiSlots ?? new Registry<UiSlot>('UI slot', uiSlotKey),
    knowledgeSources: given.knowledgeSources ?? createRegistry<KnowledgeSource>('knowledge source'),
    captureTargets: given.captureTargets ?? createRegistry<CaptureTarget>('capture target'),
    bundles: given.bundles ?? createRegistry<BundleOffer>('template bundle'),
    mcpServers:
      given.mcpServers ??
      new Registry<McpServerContribution>('MCP server', (server) => server.name),
  };
}
