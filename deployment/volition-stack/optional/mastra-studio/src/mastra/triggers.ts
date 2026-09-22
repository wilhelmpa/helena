import type { WorkflowId } from './contracts.ts';

export const eventTriggerRegistry = {
  'gmail.message.received': 'inbox-triage',
  'career.job.discovered': 'career-research',
  'career.application.requested': 'application',
  'support.request.received': 'support',
  'system.audit.requested': 'system-audit',
  'document.received': 'document-filing',
} as const satisfies Record<string, WorkflowId>;

export type TriggerEvent = keyof typeof eventTriggerRegistry;

export function workflowForEvent(event: string): WorkflowId | null {
  return event in eventTriggerRegistry
    ? eventTriggerRegistry[event as TriggerEvent]
    : null;
}
