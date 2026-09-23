import { z } from 'zod';
import { workEnvelopeSchema } from './contracts.ts';

// plan-pipeline runs a workflow a member put together in Plan. Plan validates and stores
// the definition (apps/api/src/modules/pipelines/definition.ts); Mastra reads only what
// decides where a run goes next and leaves every other field of a step to Plan.

const projectRef = z.string().regex(/^project:[A-Za-z0-9][A-Za-z0-9._-]*$/);
const taskRef = z.string().regex(/^task:[A-Za-z0-9][A-Za-z0-9._-]*-\d+$/);
export const stepIdSchema = z.string().regex(/^[a-z0-9][a-z0-9-]{0,39}$/);

export type StepKind = 'agent' | 'approval' | 'condition' | 'action' | 'wait';

export interface PipelineStep {
  id: string;
  name: string;
  type: StepKind;
  condition?: { kind: string };
  then?: PipelineStep[];
  else?: PipelineStep[];
  thenEnd?: boolean;
  elseEnd?: boolean;
  onReject?: { action: 'end' } | { action: 'goto'; stepId: string; maxLoops: number };
}

export const pipelineStepSchema: z.ZodType<PipelineStep> = z.lazy(() =>
  z.looseObject({
    id: stepIdSchema,
    name: z.string().min(1).max(120),
    type: z.enum(['agent', 'approval', 'condition', 'action', 'wait']),
    condition: z.looseObject({ kind: z.string() }).optional(),
    then: z.array(pipelineStepSchema).max(50).optional(),
    else: z.array(pipelineStepSchema).max(50).optional(),
    thenEnd: z.boolean().optional(),
    elseEnd: z.boolean().optional(),
    onReject: z
      .discriminatedUnion('action', [
        z.object({ action: z.literal('end') }),
        z.object({
          action: z.literal('goto'),
          stepId: stepIdSchema,
          maxLoops: z.number().int().min(1).max(10),
        }),
      ])
      .optional(),
  }),
);

export const pipelineDefinitionSchema = z.looseObject({
  schemaVersion: z.literal(1),
  steps: z.array(pipelineStepSchema).max(50),
});

// A run Plan planned carries its workflow; its event id is the id of Plan's run. A
// schedule fire carries the same payload and Plan plans the run when it begins.
export const pipelinePayloadSchema = z.object({
  schemaVersion: z.literal(1),
  pipelineId: z.number().int().positive(),
});

export const beginAnswerSchema = z.object({
  run: z.object({
    id: z.string().min(1).max(200),
    pipelineId: z.number().int().positive(),
    pipelineName: z.string(),
    version: z.number().int().positive(),
    taskRef: taskRef.nullable(),
    dryRun: z.boolean(),
  }),
  definition: pipelineDefinitionSchema,
});

export const agentPreparationSchema = z.object({
  dryRun: z.boolean(),
  attempt: z.number().int().positive(),
  idempotencyKey: z.string().regex(/^[a-f0-9]{64}$/),
  agentRef: z.string().regex(/^agent:[A-Za-z0-9][A-Za-z0-9._-]*$/),
  taskRef,
  prompt: z.string().min(1).max(48_000),
  timeoutSeconds: z.number().int().min(60).max(86_400),
  policy: z.object({
    maxTurns: z.number().int().min(1).max(200).optional(),
    runBudgetSeconds: z.number().int().min(60).max(7_200).optional(),
    model: z.string().min(1).max(200).optional(),
  }),
});

export const agentOutcomeSchema = z.enum(['success', 'failed', 'blocked']);

// What the bridge reports for the Plan agent run of an agent step.
export const agentResultSchema = z.object({
  agentRunId: z.number().int().positive(),
  outcome: agentOutcomeSchema,
  summary: z.string().max(4_000),
});

export const approvalDecisionSchema = z.object({
  approved: z.boolean(),
  decidedBy: z.string().min(1).max(200),
  note: z.string().max(2_000).optional(),
});

export const pipelineStateSchema = z.object({
  envelope: workEnvelopeSchema,
  run: z.object({
    id: z.string().min(1).max(200),
    projectRef,
    taskRef: taskRef.nullable(),
    dryRun: z.boolean(),
  }),
  definition: pipelineDefinitionSchema,
  // The step the next iteration executes; null once the run is over.
  cursor: stepIdSchema.nullable(),
  // Step executions so far. The next one is `seq + 1`.
  seq: z.number().int().min(0),
  // How often each step executed, and how often each approval sent the run back.
  visits: z.record(z.string(), z.number().int().min(0)),
  reworks: z.record(z.string(), z.number().int().min(0)),
  status: z.enum(['running', 'succeeded', 'rejected', 'skipped']),
});

export const pipelineOutputSchema = z.object({
  workflowId: z.literal('plan-pipeline'),
  runId: z.string(),
  projectRef,
  taskRef: taskRef.nullable(),
  status: z.enum(['succeeded', 'rejected', 'skipped', 'dry-run-complete']),
  executedSteps: z.number().int().min(0),
});

export type PipelineDefinition = z.infer<typeof pipelineDefinitionSchema>;
export type PipelineState = z.infer<typeof pipelineStateSchema>;
export type AgentPreparation = z.infer<typeof agentPreparationSchema>;
export type AgentResult = z.infer<typeof agentResultSchema>;
