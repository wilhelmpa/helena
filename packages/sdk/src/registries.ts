import type { Connector } from './connectors';
import type { CaptureTarget, KnowledgeSource } from './knowledge';
import type { McpServerContribution } from './manifest-types';
import type { PolicyEvaluator } from './policy';
import { Registry, createRegistry } from './registry';
import type { RuntimeType } from './runtime';
import type { RuntimeLoginSource } from './runtime-logins';
import type { DecisionBackendType } from './decision-backends';
import type { DecisionClass } from './decisions';
import type { ProfileContribution } from './runtime-policy';
import type { BundleOffer } from './templates';
import type { AnyAgentTool } from './tools';
import { uiSlotKey, type UiSlot } from './ui';
import type { UpdateSource } from './updates';
import type { UsageLimitSource } from './usage-limits';
import type { TriggerType, WorkflowStepType } from './workflows';

// One registry per extension point. A process creates the set once (or only the ones it
// uses) and hands it to its plugin host, so built-ins registered at import time and
// plugins loaded at start end up in the same place.
export interface HelenaRegistries {
  runtimes: Registry<RuntimeType>;
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
  profileContributions: Registry<ProfileContribution>;
  usageLimitSources: Registry<UsageLimitSource>;
  runtimeLoginSources: Registry<RuntimeLoginSource>;
  updateSources: Registry<UpdateSource>;
  decisionBackends: Registry<DecisionBackendType>;
  decisionClasses: Registry<DecisionClass>;
}

export function createRegistries(given: Partial<HelenaRegistries> = {}): HelenaRegistries {
  return {
    runtimes: given.runtimes ?? createRegistry<RuntimeType>('runtime'),
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
    profileContributions:
      given.profileContributions ?? createRegistry<ProfileContribution>('profile contribution'),
    usageLimitSources:
      given.usageLimitSources ?? createRegistry<UsageLimitSource>('usage-limit source'),
    runtimeLoginSources:
      given.runtimeLoginSources ?? createRegistry<RuntimeLoginSource>('runtime login source'),
    updateSources: given.updateSources ?? createRegistry<UpdateSource>('update source'),
    decisionBackends:
      given.decisionBackends ?? createRegistry<DecisionBackendType>('decision backend'),
    decisionClasses: given.decisionClasses ?? createRegistry<DecisionClass>('decision class'),
  };
}
