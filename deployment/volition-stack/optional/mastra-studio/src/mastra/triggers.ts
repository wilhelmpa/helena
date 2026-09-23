import type { WorkflowId } from './contracts.ts';

export const eventTriggerRegistry = {
  'gmail.message.received': 'inbox-triage',
  'agent.team.requested': 'agent-team',
} as const satisfies Record<string, WorkflowId>;

export type TriggerEvent = keyof typeof eventTriggerRegistry;

export function workflowForEvent(event: string): WorkflowId | null {
  return Object.prototype.hasOwnProperty.call(eventTriggerRegistry, event)
    ? eventTriggerRegistry[event as TriggerEvent]
    : null;
}
