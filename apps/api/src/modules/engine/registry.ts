import type {
  DomainEventHandler,
  PolicyDecider,
  StepDefinition,
  TriggerDefinition,
  WorkflowStepType,
  WorkflowTriggerType,
} from './sdk';

// The registries of the engine. Built-in types register at startup (builtin/index.ts);
// a plugin registers the same way. A type registered twice replaces the first, so a
// plugin can override a built-in one on purpose.

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
  return stepTypes.get(type);
}

export function triggerType(type: string): WorkflowTriggerType | undefined {
  return triggerTypes.get(type);
}

export function listStepTypes(): WorkflowStepType[] {
  return [...stepTypes.values()];
}

export function listTriggerTypes(): WorkflowTriggerType[] {
  return [...triggerTypes.values()];
}

// The trigger types that listen to an event type.
export function triggersFor(eventType: string): WorkflowTriggerType[] {
  return [...triggerTypes.values()].filter((type) => type.events?.includes(eventType));
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
