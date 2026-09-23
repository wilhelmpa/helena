import { z } from 'zod';
import { workEnvelopeSchema } from './contracts.ts';

const projectRef = z.string().regex(/^project:[A-Za-z0-9][A-Za-z0-9._-]*$/);
const agentRef = z.string().regex(/^agent:[A-Za-z0-9][A-Za-z0-9._-]*$/);
const taskRef = z.string().regex(/^task:[A-Za-z0-9][A-Za-z0-9._-]*-\d+$/);

// 'new' creates a task for every fire; 'reopen' reopens the task it names.
export const agentRoutinePayloadSchema = z
  .object({
    projectRef,
    agentRef,
    title: z.string().trim().min(1).max(300),
    instructions: z.string().trim().min(1).max(20_000),
    mode: z.enum(['new', 'reopen']),
    taskRef: taskRef.optional(),
  })
  .refine((value) => (value.mode === 'reopen') === (value.taskRef !== undefined), {
    message: 'A routine names a task exactly when it reopens one',
  });

export const agentRoutineStateSchema = z.object({
  envelope: workEnvelopeSchema,
  input: agentRoutinePayloadSchema,
  missed: z.boolean(),
});

// Plan's answer to a routine request. `taskRef` is the task the routine works on: the
// one Plan created or reopened, or the open one it left alone.
export const routineAnswerSchema = z.object({
  idempotencyKey: z.string().length(64),
  outcome: z.enum(['created', 'reopened', 'skipped']),
  taskRef,
});

export const agentRoutineOutputSchema = z.object({
  workflowId: z.literal('agent-routine'),
  correlationId: z.string().min(1).max(200),
  projectRef,
  status: z.enum(['created', 'reopened', 'skipped', 'dry-run-complete']),
  taskRef: taskRef.nullable(),
  // Why a skipped fire changed nothing: its task is still open, or it started too late.
  skipReason: z.enum(['task-open', 'missed']).nullable(),
});

export type AgentRoutinePayload = z.infer<typeof agentRoutinePayloadSchema>;
export type RoutineAnswer = z.infer<typeof routineAnswerSchema>;
export type AgentRoutineOutput = z.infer<typeof agentRoutineOutputSchema>;
