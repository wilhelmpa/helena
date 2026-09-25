import { db, pipelineRunStep } from '@repo/db';
import { and, eq } from 'drizzle-orm';
import { parseMentionHandles } from '#shared/mentions';
import { mentionedAgents, type MentionedAgent } from '#modules/agents/core/service';
import { enqueueAgentRun } from '#modules/agents/core/run-queue';
import { writeStep } from '#modules/engine/run-context';
import type { StepExecution } from '#modules/engine/sdk';
import { MENTION_STARTED, mentionPartId } from './agent-runs';

// A routine's instructions may @mention agents of the project: every fire starts each of
// them on the routine's task, the way a member's mention in a comment does, next to the
// agent the task is delegated to (docs/helena-decisions/routine-mentions.md). The mentions
// are the routine's author's — the member its fires act for — so every guard of a
// comment's mentions applies: the agent works in the project, takes work from that member,
// reacts to mentions and is not paused, and a routine an agent saved starts nobody by a
// mention (only a delegation hands one agent's work to another).

// The agents the instructions name besides the routine's own agent, each with whether a
// fire acting for `actorUserId` starts it.
export async function routineMentions(
  project: { id: number; teamId: number },
  instructions: string,
  actorUserId: string | null,
  delegateAgentId: number | null,
): Promise<MentionedAgent[]> {
  const agents = await mentionedAgents(
    project.id,
    project.teamId,
    parseMentionHandles(instructions),
    actorUserId,
  );
  return agents.filter((agent) => agent.id !== delegateAgentId);
}

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

// Starts the mentioned agents on the task of a fire: each gets a part of the fire's
// dispatch step, and one a mention starts also a mention run on the task whose prompt is
// the instructions. Run and part are written in the caller's transaction — the one that
// creates or reopens the task — so no runner claims a run before it is known as the
// routine's, and a replayed fire, which finds its parts, starts nobody twice.
export async function startRoutineMentions(
  tx: Transaction,
  input: {
    runId: string;
    parent: StepExecution;
    projectId: number;
    issueId: number;
    instructions: string;
    targets: MentionedAgent[];
  },
): Promise<void> {
  for (const target of input.targets) {
    const part = {
      stepId: mentionPartId(input.parent.stepId, target.id),
      iteration: input.parent.iteration,
      seq: input.parent.seq,
    };
    const [existing] = await tx
      .select({ stepId: pipelineRunStep.stepId })
      .from(pipelineRunStep)
      .where(
        and(
          eq(pipelineRunStep.runId, input.runId),
          eq(pipelineRunStep.stepId, part.stepId),
          eq(pipelineRunStep.iteration, part.iteration),
        ),
      );
    if (existing) continue;
    const step = { type: 'delegate', name: target.name };
    if (target.refused) {
      await writeStep(
        input.runId,
        step,
        part,
        {
          status: 'skipped',
          outcome: `mention-${target.refused}`,
          agentId: target.id,
          finishedAt: new Date(),
        },
        tx,
      );
      continue;
    }
    const agentRunId = await enqueueAgentRun(
      {
        agentId: target.id,
        projectId: input.projectId,
        issueId: input.issueId,
        sourceActivityId: null,
        prompt: input.instructions,
        trigger: 'mention',
      },
      tx,
    );
    await writeStep(
      input.runId,
      step,
      part,
      {
        status: 'succeeded',
        outcome: MENTION_STARTED,
        agentId: target.id,
        agentRunId,
        finishedAt: new Date(),
      },
      tx,
    );
  }
}
