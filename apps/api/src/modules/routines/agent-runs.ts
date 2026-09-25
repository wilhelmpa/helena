import { agentRun, aiAgent, db, helenaSchedule, issue, pipelineRun, pipelineRunStep } from '@repo/db';
import { and, asc, desc, eq, isNotNull } from 'drizzle-orm';

// The agent runs a routine's fire started, read back: the delegation run of the agent the
// routine hands its task to, and the mention runs of the agents its instructions name
// (docs/helena-decisions/routine-mentions.md). The runner frames such a run as a routine's
// work, and what an agent writes during one reaches people only where it asks them for
// something (notifications/service.ts). Reads only; the step starts them (mentions.ts).

// The part of a routine fire's dispatch step that records one mentioned agent: its row
// names the agent and, when a run was started, the run.
export const MENTION_PART = /^m\d+$/;

export function mentionPartId(parentStepId: string, agentId: number): string {
  return `${parentStepId}.m${agentId}`;
}

// The outcome of a mention part: started, or the reason the agent was not (MentionRefusal).
export const MENTION_STARTED = 'mention-started';

export interface RoutineOfRun {
  // The fire (pipeline_run) and the routine behind it; the routine is null once deleted.
  fireId: string;
  title: string;
  scheduleId: string | null;
  // The routine's time zone, the day a collapsed mention counts in.
  timezone: string | null;
}

type RunRef = {
  id: number;
  trigger: string;
  issueId: number | null;
  sourceActivityId: number | null;
};

const routineColumns = {
  fireId: pipelineRun.id,
  title: pipelineRun.title,
  scheduleId: pipelineRun.scheduleId,
  timezone: helenaSchedule.timezone,
};

// The routine fire an agent run belongs to, or null. A mention run a fire started is
// linked by the fire's mention part; a delegation run on a task a routine created or
// reopens is that routine's work (the fire enqueues it through the task's delegation). A
// run a person started on such a task by mentioning the agent is not.
export async function routineOfAgentRun(run: RunRef): Promise<RoutineOfRun | null> {
  if (run.trigger === 'mention' && run.sourceActivityId == null) {
    const [row] = await db
      .select(routineColumns)
      .from(pipelineRunStep)
      .innerJoin(pipelineRun, eq(pipelineRun.id, pipelineRunStep.runId))
      .leftJoin(helenaSchedule, eq(helenaSchedule.id, pipelineRun.scheduleId))
      .where(and(eq(pipelineRunStep.agentRunId, run.id), eq(pipelineRun.kind, 'routine')))
      .orderBy(desc(pipelineRun.createdAt))
      .limit(1);
    return row ? { ...row, title: row.title ?? '' } : null;
  }
  if (run.trigger === 'delegation' && run.issueId != null) {
    const [row] = await db
      .select(routineColumns)
      .from(pipelineRun)
      .leftJoin(helenaSchedule, eq(helenaSchedule.id, pipelineRun.scheduleId))
      .where(and(eq(pipelineRun.issueId, run.issueId), eq(pipelineRun.kind, 'routine')))
      .orderBy(desc(pipelineRun.createdAt))
      .limit(1);
    return row ? { ...row, title: row.title ?? '' } : null;
  }
  return null;
}

// The routine whose run the agent (by its bot user) is working on the issue right now:
// its claimed, unfinished run there, when that run is a routine's work. Null otherwise —
// no run in flight, or one a person started.
export async function activeRoutineRun(
  issueId: number,
  agentUserId: string,
): Promise<RoutineOfRun | null> {
  const [run] = await db
    .select({
      id: agentRun.id,
      trigger: agentRun.trigger,
      issueId: agentRun.issueId,
      sourceActivityId: agentRun.sourceActivityId,
    })
    .from(agentRun)
    .innerJoin(aiAgent, eq(aiAgent.id, agentRun.agentId))
    .where(
      and(
        eq(aiAgent.userId, agentUserId),
        eq(agentRun.issueId, issueId),
        eq(agentRun.status, 'pending'),
        isNotNull(agentRun.startedAt),
      ),
    )
    .orderBy(desc(agentRun.id))
    .limit(1);
  return run ? routineOfAgentRun(run) : null;
}

// What an agent is told about the routine a run of it belongs to: the routine's name, the
// agent its task is delegated to, and the agents the fire started beside it for the parts
// the instructions name them for.
export interface RoutinePromptContext {
  title: string;
  delegateUsername: string | null;
  startedUsernames: string[];
}

export async function routinePromptContext(run: RunRef): Promise<RoutinePromptContext | null> {
  const routine = await routineOfAgentRun(run);
  if (!routine) return null;
  const [started, delegate] = await Promise.all([
    db
      .select({ username: aiAgent.username })
      .from(pipelineRunStep)
      .innerJoin(aiAgent, eq(aiAgent.id, pipelineRunStep.agentId))
      .where(
        and(
          eq(pipelineRunStep.runId, routine.fireId),
          eq(pipelineRunStep.outcome, MENTION_STARTED),
        ),
      )
      .orderBy(asc(pipelineRunStep.seq), asc(pipelineRunStep.startedAt)),
    run.issueId == null
      ? Promise.resolve([])
      : db
          .select({ username: aiAgent.username })
          .from(issue)
          .innerJoin(aiAgent, eq(aiAgent.userId, issue.delegateUserId))
          .where(eq(issue.id, run.issueId)),
  ]);
  return {
    title: routine.title,
    delegateUsername: delegate[0]?.username ?? null,
    startedUsernames: started.map((row) => row.username),
  };
}
