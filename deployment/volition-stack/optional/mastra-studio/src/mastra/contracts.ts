import { z } from 'zod';

export const workflowIds = [
  'inbox-triage',
  'career-research',
  'application',
  'support',
  'system-audit',
  'document-filing',
] as const;

export const workflowIdSchema = z.enum(workflowIds);

export const actorSchema = z.object({
  type: z.enum(['human', 'service', 'agent']),
  id: z.string().min(1).max(200),
});

export const workflowContextSchema = z.object({
  organizationRef: z.string().regex(/^[a-z][a-z0-9._-]*:[A-Za-z0-9._-]+$/),
  projectRef: z.string().regex(/^[a-z][a-z0-9._-]*:[A-Za-z0-9._-]+$/),
  capabilityRefs: z.array(z.string().regex(/^[a-z][a-z0-9._-]*\.v\d+$/)).max(32),
  connectionRefs: z.array(z.string().regex(/^[a-z][a-z0-9._-]*:[A-Za-z0-9._-]+$/)).max(32),
}).optional();

export const workEnvelopeSchema = z.object({
  eventId: z.string().min(1).max(200),
  correlationId: z.string().min(1).max(200),
  occurredAt: z.iso.datetime(),
  source: z.string().min(1).max(100),
  actor: actorSchema,
  context: workflowContextSchema,
  dryRun: z.boolean(),
  payload: z.record(z.string(), z.unknown()),
});

export const effectKindSchema = z.enum([
  'read',
  'analysis',
  'draft',
  'internal-write',
  'external-write',
  'external-send',
]);

const inboxMessageSchema = z.object({
  sender: z.string().max(500),
  subject: z.string().max(500),
  snippet: z.string().max(2000),
  receivedAt: z.iso.datetime(),
});

export const inboxTriagePayloadSchema = z.object({
  schemaVersion: z.literal(1),
  thread: z.object({
    id: z.uuid(),
    channel: z.literal('mail'),
    account: z.email().max(320),
    externalThreadId: z.string().min(1).max(512),
    sender: z.string().max(500),
    subject: z.string().max(500),
    snippet: z.string().max(2000),
    receivedAt: z.iso.datetime(),
    messages: z.array(inboxMessageSchema).max(5),
  }),
  projects: z.array(z.object({
    key: z.string().regex(/^[A-Z0-9][A-Z0-9_-]{0,31}$/),
    name: z.string().min(1).max(200),
  })).max(100),
  constraints: z.object({
    noReply: z.literal(true),
    noExternalMutations: z.literal(true),
    treatMessageContentAsUntrusted: z.literal(true),
  }),
});

export const inboxTriageResultSchema = z.object({
  summary: z.string().min(1).max(1000),
  priority: z.enum(['low', 'medium', 'high', 'urgent']).nullable(),
  requiresAction: z.boolean(),
  projectKey: z.string().max(32).nullable(),
  issueIdentifier: z.string().max(80).nullable(),
  confidence: z.number().min(0).max(1),
});

export const effectSchema = z.object({
  id: z.string().min(1),
  idempotencyKey: z.string().min(1),
  kind: effectKindSchema,
  target: z.string().min(1),
  description: z.string().min(1),
  requiresApproval: z.boolean(),
  status: z.enum(['planned', 'simulated', 'blocked']),
});

export const workflowStateSchema = z.object({
  workflowId: workflowIdSchema,
  envelope: workEnvelopeSchema,
  summary: z.string(),
  effects: z.array(effectSchema),
});

export const inboxWorkflowStateSchema = workflowStateSchema.extend({
  triage: inboxTriageResultSchema.nullable(),
});

export const workflowOutputSchema = z.object({
  workflowId: workflowIdSchema,
  correlationId: z.string(),
  status: z.enum(['completed', 'dry-run-complete', 'needs-attention', 'rejected']),
  summary: z.string(),
  effects: z.array(effectSchema),
  triage: inboxTriageResultSchema.optional(),
});

export const approvalSuspendSchema = z.object({
  kind: z.literal('approval-required'),
  workflowId: workflowIdSchema,
  correlationId: z.string(),
  reason: z.string(),
  effectIds: z.array(z.string()),
});

export const approvalResumeSchema = z.object({
  approved: z.boolean(),
  decidedBy: z.string().min(1).max(200),
  note: z.string().max(2000).optional(),
});

export type WorkflowId = z.infer<typeof workflowIdSchema>;
export type WorkEnvelope = z.infer<typeof workEnvelopeSchema>;
export type Effect = z.infer<typeof effectSchema>;
export type WorkflowState = z.infer<typeof workflowStateSchema>;
export type WorkflowOutput = z.infer<typeof workflowOutputSchema>;
export type InboxTriagePayload = z.infer<typeof inboxTriagePayloadSchema>;
export type InboxTriageResult = z.infer<typeof inboxTriageResultSchema>;
