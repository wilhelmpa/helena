import { z } from 'zod';
import { actorSchema, workflowContextSchema } from './contracts.ts';

const reference = /^[a-z][a-z0-9._-]*:[A-Za-z0-9][A-Za-z0-9._-]*$/;

export const agentMemberSchema = z.object({
  agentRef: z.string().regex(reference),
  role: z.string().min(1).max(100),
  capabilities: z.array(z.string().min(1).max(100)).max(32).default([]),
});

export const teamPolicySchema = z.object({
  maxAttempts: z.number().int().min(1).max(5).default(3),
  initialBackoffMs: z.number().int().min(50).max(60_000).default(1_000),
  maxBackoffMs: z.number().int().min(100).max(300_000).default(30_000),
  backoffMultiplier: z.number().min(1).max(5).default(2),
  leaseSeconds: z.number().int().min(30).max(900).default(300),
  heartbeatSeconds: z.number().int().min(5).max(120).default(60),
  timeoutSeconds: z.number().int().min(30).max(7_200).default(900),
  reviewRequired: z.boolean().default(true),
  // Handed to every Hermes stage as --max-turns and --run-budget.
  maxTurns: z.number().int().min(1).max(200).optional(),
  runBudgetSeconds: z.number().int().min(60).max(7_200).optional(),
  // 'done' moves the task to Done when the coordinator review accepted the work;
  // 'review' always leaves it in Review for a person.
  autonomy: z.enum(['review', 'done']).default('review'),
});

export const agentTeamPayloadSchema = z.object({
  schemaVersion: z.literal(1),
  task: z.object({
    taskRef: z.string().regex(reference),
    title: z.string().min(1).max(300),
    objective: z.string().min(1).max(12_000),
    acceptanceCriteria: z.array(z.string().min(1).max(1_000)).min(1).max(30),
    labels: z.array(z.string().min(1).max(100)).max(50).default([]),
  }),
  coordinator: agentMemberSchema,
  specialists: z.array(agentMemberSchema).min(1).max(12),
  policy: teamPolicySchema.prefault({}),
  execution: z
    .object({
      model: z.string().min(1).max(200).optional(),
      reasoning: z.string().min(1).max(50).optional(),
    })
    .default({}),
});

export const delegationSchema = z.object({
  assignmentId: z.string().min(1).max(120),
  agentRef: z.string().regex(reference),
  objective: z.string().min(1).max(4_000),
  acceptanceCriteria: z.array(z.string().min(1).max(1_000)).min(1).max(30),
  dependsOn: z.array(z.string().min(1).max(120)).max(20).default([]),
});

export const evidenceSchema = z.object({
  kind: z.enum(['comment', 'artifact', 'test', 'link']),
  ref: z.string().min(1).max(2_000),
  label: z.string().min(1).max(300),
});

export const stageResultSchema = z.object({
  executionId: z.string().min(1).max(200),
  idempotencyKey: z.string().length(64),
  phase: z.enum(['coordinate', 'specialize', 'review', 'synchronize']),
  status: z.enum(['completed', 'needs-review', 'failed']),
  attempt: z.number().int().min(1).max(20),
  startedAt: z.iso.datetime(),
  completedAt: z.iso.datetime(),
  summary: z.string().min(1).max(4_000),
  evidence: z.array(evidenceSchema).max(100).default([]),
  delegations: z.array(delegationSchema).max(12).default([]),
  review: z
    .object({
      accepted: z.boolean(),
      notes: z.string().max(4_000),
    })
    .optional(),
  lease: z.object({
    claimedAt: z.iso.datetime(),
    heartbeatAt: z.iso.datetime(),
    expiresAt: z.iso.datetime(),
  }),
});

export const specialistResultSchema = stageResultSchema.extend({
  assignmentId: z.string().min(1).max(120),
});

// 'route' records a delegation Mastra built without asking the coordinator.
export const teamHistoryEntrySchema = stageResultSchema
  .pick({
    executionId: true,
    status: true,
    attempt: true,
    startedAt: true,
    completedAt: true,
    summary: true,
  })
  .extend({ phase: z.enum(['route', 'coordinate', 'specialize', 'review', 'synchronize']) });

export const agentTeamStateSchema = z.object({
  workflowId: z.literal('agent-team'),
  envelope: z.object({
    eventId: z.string().min(1).max(200),
    correlationId: z.string().min(1).max(200),
    occurredAt: z.iso.datetime(),
    source: z.string().min(1).max(100),
    actor: actorSchema,
    context: workflowContextSchema,
    dryRun: z.boolean(),
    payload: z.record(z.string(), z.unknown()),
  }),
  input: agentTeamPayloadSchema,
  delegations: z.array(delegationSchema).max(12),
  specialistResults: z.array(specialistResultSchema).max(12),
  history: z.array(teamHistoryEntrySchema).max(100),
  review: stageResultSchema.nullable(),
});

export const agentTeamOutputSchema = z.object({
  workflowId: z.literal('agent-team'),
  correlationId: z.string().min(1).max(200),
  projectRef: z.string().regex(reference),
  taskRef: z.string().regex(reference),
  status: z.enum(['dry-run-complete', 'review', 'done']),
  summary: z.string().min(1).max(4_000),
  evidence: z.array(evidenceSchema).max(500),
  history: z.array(teamHistoryEntrySchema).max(100),
  planSync: z.object({
    state: z.enum(['review', 'done', 'simulated']),
    synchronizedAt: z.iso.datetime().nullable(),
  }),
});

export type AgentTeamPayload = z.infer<typeof agentTeamPayloadSchema>;
export type TeamPolicy = z.infer<typeof teamPolicySchema>;
export type Delegation = z.infer<typeof delegationSchema>;
export type StageResult = z.infer<typeof stageResultSchema>;
export type SpecialistResult = z.infer<typeof specialistResultSchema>;
export type AgentTeamState = z.infer<typeof agentTeamStateSchema>;
export type AgentTeamOutput = z.infer<typeof agentTeamOutputSchema>;
