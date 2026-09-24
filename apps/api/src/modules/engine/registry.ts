import {
  eventMatches,
  listPluginStepTypes,
  listPluginTriggerTypes,
  pluginStepType,
  pluginTriggerType,
} from './plugins';
import type {
  DomainEventHandler,
  PolicyDecider,
  StepDefinition,
  TriggerDefinition,
  WorkflowStepType,
  WorkflowTriggerType,
} from './sdk';

// The registries of the engine. Helena's built-in types register here at startup
// (builtin/index.ts). A plugin registers its types with the framework's plugin host
// (@helena/sdk registries.stepTypes / triggerTypes); the lookups below find those too,
// adapted to the engine's interface (plugins.ts). A built-in name has no dot and a
// plugin's does, so neither hides the other.

const stepTypes = new Map<string, WorkflowStepType>();
const triggerTypes = new Map<string, WorkflowTriggerType>();

const TYPE_NAME = /^[a-z][a-z0-9_]{0,39}$/;

export function registerStepType<S extends StepDefinition>(type: WorkflowStepType<S>): void {
  if (!TYPE_NAME.test(type.type)) throw new Error(`Invalid step type name ${type.type}`);
  stepTypes.set(type.type, type as unknown as WorkflowStepType);
}

export function registerTriggerType<T extends TriggerDefinition>(
  type: WorkflowTriggerType<T>,
): void {
  if (!TYPE_NAME.test(type.type)) throw new Error(`Invalid trigger type name ${type.type}`);
  triggerTypes.set(type.type, type as unknown as WorkflowTriggerType);
}

export function stepType(type: string): WorkflowStepType | undefined {
  return stepTypes.get(type) ?? pluginStepType(type);
}

export function triggerType(type: string): WorkflowTriggerType | undefined {
  return triggerTypes.get(type) ?? pluginTriggerType(type);
}

export function listStepTypes(): WorkflowStepType[] {
  return [...stepTypes.values(), ...listPluginStepTypes()];
}

export function listTriggerTypes(): WorkflowTriggerType[] {
  return [...triggerTypes.values(), ...listPluginTriggerTypes()];
}

// The trigger types that listen to an event type (a pattern like `helena.issue.*` covers
// every issue event).
export function triggersFor(eventType: string): WorkflowTriggerType[] {
  return listTriggerTypes().filter((type) => eventMatches(type.events, eventType));
}

// The policy engine. The default asks a person for every approval gate and refuses what
// the agent's own limits refuse (policy.ts); the autopilot replaces it.
let policy: PolicyDecider | null = null;
let fallback: PolicyDecider | null = null;

export function setPolicyDecider(decider: PolicyDecider): void {
  policy = decider;
}

// The built-in policy, used while no policy engine is registered.
export function setDefaultPolicyDecider(decider: PolicyDecider): void {
  fallback = decider;
}

export function policyDecider(): PolicyDecider {
  const decider = policy ?? fallback;
  if (!decider) throw new Error('No policy decider is registered');
  return decider;
}

// The subscribers of domain events, by name. The engine hands every published event to
// each of them once (engine/events.ts); the triggers are the first subscriber.
const subscribers = new Map<string, DomainEventHandler>();

export function subscribeDomainEvents(name: string, handler: DomainEventHandler): void {
  if (!TYPE_NAME.test(name)) throw new Error(`Invalid subscriber name ${name}`);
  subscribers.set(name, handler);
}

export function domainEventSubscribers(): [string, DomainEventHandler][] {
  return [...subscribers.entries()];
}
