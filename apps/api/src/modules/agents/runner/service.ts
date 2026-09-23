import {
  db,
  aiAgent,
  agentRun,
  organizationProjectAssignment,
  project,
  projectMember,
} from '@repo/db';
import { and, asc, eq, inArray, lt, lte, sql } from 'drizzle-orm';
import { HttpError } from '#shared/lib';
import { type ContextUsage } from '../chat-usage';
import { enforceAgentLimits } from '../governance';
import { agentRunConfig, loadThreadContext } from '../core/run-queue';
import { recordAgentRunFinished, recordAgentRunStarted } from '../core/run-activity';
import { isHomeAgent } from '../core/home-agent';
import { normalizeRuntimePolicy, type AgentKind } from '../core/service';
import { getRunResumeSettings } from '#modules/settings/service';
import type { AgentRunTrigger } from '../model';
import { MAX_RUN_OUTPUT_BYTES, type reflectionBody } from './model';
import {
  REFLECTION_LIMITS,
  reflectionPrompt,
  reflectionReason,
  type ReflectionReason,
} from './reflection';
import {
  framePrompt,
  peopleContext,
  projectInstructionsPreamble,
  projectPreamble,
  runModePreamble,
  type RunForPrompt,
} from '../core/prompt/framing';

// The queue an external agent's runner drains. The runner is a process the operator
// starts on their own machine; it authenticates with the agent's API key, claims one
// run at a time, executes whatever command it is configured with, and reports the
// result back. The task is framed here, the same way it is for an internal agent, so
// every runner gets a task that says what started the run and what to do about it
// without having to build that itself. Claiming works exactly like the worker's: the
// row stays 'pending' and its next_attempt_at is pushed forward by a lease, so a run
// whose runner dies mid-flight becomes claimable again once the lease expires.

// The project facts a system prompt names.
export interface RunnerProject {
  key: string;
  name: string;
  description: string;
  projectInstructions: string;
  agentProjectInstructions: string;
}

export interface RunnerAgent {
  id: number;
  teamId: number;
  kind: AgentKind;
  // The agent's bot user, so a run's prompts do not name the agent to itself, and
  // the handle it is addressed by.
  userId: string;
  username: string;
  // The projects of the team the agent works in, and the operator's own instructions.
  // A chat names all of them in the system prompt; a run names the one it works in.
  projects: RunnerProject[];
  instructions: string | null;
  model: string | null;
  thinkingLevel: string | null;
  // The run limits of the agent's runtime policy, for a run that sets none itself.
  maxTurns: number | null;
  runBudgetSeconds: number | null;
}

// The agent whose bot user is the caller, or null when the caller is not an agent.
// The API key identifies the agent, so holding it is the authorization to drain its
// queue — no permission check applies.
export async function getRunnerAgent(userId: string): Promise<RunnerAgent | null> {
  const rows = await db
    .select({
      id: aiAgent.id,
      teamId: aiAgent.teamId,
      kind: aiAgent.kind,
      userId: aiAgent.userId,
      username: aiAgent.username,
      instructions: aiAgent.instructions,
      model: aiAgent.model,
      runtimePolicy: aiAgent.runtimePolicy,
    })
    .from(aiAgent)
    .where(eq(aiAgent.userId, userId))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  const projects = await db
    .select({
      key: project.key,
      name: project.name,
      description: project.description,
      projectInstructions: sql<string>`coalesce(${organizationProjectAssignment.instructions}, '')`,
      agentProjectInstructions: projectMember.description,
    })
    .from(projectMember)
    .innerJoin(project, eq(project.id, projectMember.projectId))
    .leftJoin(
      organizationProjectAssignment,
      and(
        eq(organizationProjectAssignment.projectId, project.id),
        eq(organizationProjectAssignment.teamId, row.teamId),
      ),
    )
    .where(and(eq(projectMember.userId, userId), eq(project.teamId, row.teamId)))
    .orderBy(project.key);
  const policy = normalizeRuntimePolicy(row.runtimePolicy);
  return {
    ...row,
    kind: row.kind as AgentKind,
    projects,
    thinkingLevel: policy.reasoningEffort,
    maxTurns: policy.maxTurns ?? null,
    runBudgetSeconds: policy.runBudgetSeconds ?? null,
  };
}

export interface RunnerRun {
  id: number;
  trigger: AgentRunTrigger;
  // The task as the agent should read it: the trigger text framed with what started
  // the run and what to do about it, the same framing an internal agent gets.
  prompt: string;
  // Instructions about the run itself — that it is autonomous, and who the people
  // behind it are — for the agent's system prompt rather than its task.
  systemPrompt: string;
  attempts: number;
  // Names this claim on the run's heartbeats, result and release.
  claim: number;
  issueId: number | null;
  // The issue's human-readable key ("MKT-42"), so the runner can name the work in its
  // log. Null for a run with no issue, or a deleted one.
  issueIdentifier: string | null;
  // The human comment that started the run. The external runner attaches its final
  // answer to it so the issue feed keeps the exchange threaded.
  sourceActivityId: number | null;
  model: string | null;
  thinkingLevel: string | null;
  // Handed to Hermes as --max-turns and --run-budget; null leaves Hermes' own default.
  maxTurns: number | null;
  runBudgetSeconds: number | null;
  // The folder of the issue's area, relative to the working directory of the agent's
  // runtime, which is the project workspace. The runner starts the run there.
  workdir: string | null;
  // The coding agent session to resume, when the runner that held this run before died
  // mid run and reported one: the runner passes this to the command instead of starting
  // a fresh session. Null for a run claimed for the first time, or resumed past its limit.
  sessionId: string | null;
}

// The claim's raw row, before framing. The extra people columns exist only to build
// the prompts and are not handed to the runner.
type ClaimedRow = Omit<RunnerRun, 'systemPrompt'> & {
  // Claimed before, by a claim that ended without a result: the runner stopped, handed
  // the run back, or lost its lease.
  interrupted: boolean;
  // The project the run works in, which is what its system prompt names.
  projectKey: string;
  projectName: string;
  projectDescription: string;
  projectInstructions: string;
  agentProjectInstructions: string;
  issueTitle: string | null;
  issueArea: string | null;
  issueAreaFolder: string | null;
  assigneeName: string | null;
  assigneeUsername: string | null;
  requesterName: string | null;
  requesterUsername: string | null;
  sourceActivityId: number | null;
};

// Records that a runner polled, which is what the UI shows as the agent's presence.
// The chat feed calls it too: both queues are drained by the same runner.
export async function touchRunner(agentId: number): Promise<void> {
  await db.update(aiAgent).set({ lastSeenAt: new Date() }).where(eq(aiAgent.id, agentId));
}

// Fails runs of external agents that were handed out too many times without a result,
// so a run whose runner keeps dying ends in a visible state instead of being served
// forever. That is the end of the run, so the issue's timeline gets the same entry a
// reported failure writes. The claim runs it for its agent; the api's janitor runs it
// for every agent, so a run whose runner never comes back ends as well.
export async function expireExhaustedRuns(agentId?: number): Promise<number> {
  const rows = await db
    .update(agentRun)
    .set({ status: 'failed', lastError: 'Runner did not report a result', finishedAt: new Date() })
    .where(
      and(
        agentId === undefined ? undefined : eq(agentRun.agentId, agentId),
        eq(agentRun.status, 'pending'),
        sql`${agentRun.attempts} >= ${agentRunConfig.maxAttempts()}`,
        sql`${agentRun.nextAttemptAt} <= now()`,
        sql`(SELECT kind FROM ai_agent a WHERE a.id = ${agentRun.agentId}) = 'external'`,
      ),
    )
    .returning({
      issueId: agentRun.issueId,
      agentUserId: sql<string>`(SELECT user_id FROM ai_agent a WHERE a.id = ${agentRun.agentId})`,
    });
  for (const row of rows) await recordAgentRunFinished(row, 'failed');
  return rows.length;
}

// What a run's lastError says once it has reached the resume limit, so the health
// overview can count these separately from an ordinary failure.
export const RESUME_LIMIT_ERROR = 'Reached the resume limit; the owner needs to look at this run';

// Fails a run that kept dying and being resumed until it reached the instance's resume
// limit, so it ends in a visible state the owner can look at instead of sitting pending
// forever, uncounted by expireExhaustedRuns because its lease keeps making it claimable
// again. claimRunnerRun already refuses to claim it past the limit; this is what ends
// it. The run-janitor loop runs it for every agent.
export async function expireResumeLimitedRuns(): Promise<number> {
  const { maxResumes } = await getRunResumeSettings();
  if (maxResumes <= 0) return 0;
  const rows = await db
    .update(agentRun)
    .set({
      status: 'failed',
      lastError: RESUME_LIMIT_ERROR,
      finishedAt: new Date(),
    })
    .where(
      and(
        eq(agentRun.status, 'pending'),
        sql`${agentRun.sessionId} IS NOT NULL`,
        sql`${agentRun.resumes} >= ${maxResumes}`,
        sql`${agentRun.nextAttemptAt} <= now()`,
      ),
    )
    .returning({
      issueId: agentRun.issueId,
      agentUserId: sql<string>`(SELECT user_id FROM ai_agent a WHERE a.id = ${agentRun.agentId})`,
    });
  for (const row of rows) await recordAgentRunFinished(row, 'failed');
  return rows.length;
}

// Claims the agent's next due run, or null when it has none or may not start it: a
// paused agent's runs wait in the queue. FOR UPDATE SKIP LOCKED keeps two runners on
// the same key from taking the same run.
export async function claimRunnerRun(agent: RunnerAgent): Promise<RunnerRun | null> {
  const agentId = agent.id;
  await expireExhaustedRuns(agentId);
  await touchRunner(agentId);
  const { maxResumes } = await getRunResumeSettings();
  // A run whose session has already resumed as often as the instance allows is left
  // pending rather than claimed again: the resume-limit janitor fails it and tells the
  // owner instead of it being retried silently forever.
  const claimable = sql`q.status = 'pending' AND q.next_attempt_at <= now()
    AND (q.session_id IS NULL OR q.resumes < ${maxResumes})`;
  const [next] = await db
    .select({ projectId: agentRun.projectId, issueId: agentRun.issueId })
    .from(agentRun)
    .where(
      and(
        eq(agentRun.agentId, agentId),
        eq(agentRun.status, 'pending'),
        lte(agentRun.nextAttemptAt, sql`now()`),
        sql`(${agentRun.sessionId} IS NULL OR ${agentRun.resumes} < ${maxResumes})`,
      ),
    )
    .orderBy(asc(agentRun.nextAttemptAt), asc(agentRun.id))
    .limit(1);
  if (!next || (await enforceAgentLimits(agentId, next.projectId, next.issueId))) return null;
  const rows = await db.execute(sql`
    UPDATE agent_run r
    SET attempts = r.attempts + 1,
        claims = r.claims + 1,
        claimed_at = now(),
        started_at = coalesce(r.started_at, now()),
        resumes = CASE WHEN r.session_id IS NOT NULL THEN r.resumes + 1 ELSE r.resumes END,
        next_attempt_at = now() + make_interval(secs => ${agentRunConfig.leaseSeconds()})
    WHERE r.id = (
      SELECT id FROM agent_run q
      WHERE q.agent_id = ${agentId} AND ${claimable}
      ORDER BY q.next_attempt_at, q.id
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    )
    RETURNING
      r.id,
      r.trigger,
      r.prompt,
      r.attempts,
      r.claims AS "claim",
      r.issue_id AS "issueId",
      r.started_at < now() AS "interrupted",
      r.max_turns AS "maxTurns",
      r.run_budget_seconds AS "runBudgetSeconds",
      r.model,
      r.session_id AS "sessionId",
      r.resumes,
      (SELECT p.key FROM project p WHERE p.id = r.project_id) AS "projectKey",
      (SELECT p.name FROM project p WHERE p.id = r.project_id) AS "projectName",
      (SELECT p.description FROM project p WHERE p.id = r.project_id) AS "projectDescription",
      (SELECT opa.instructions FROM organization_project_assignment opa
         WHERE opa.project_id = r.project_id AND opa.team_id = ${agent.teamId}) AS "projectInstructions",
      (SELECT pm.description FROM project_member pm
         WHERE pm.project_id = r.project_id AND pm.user_id = ${agent.userId}) AS "agentProjectInstructions",
      (SELECT p.key || '-' || i.sequence_number
         FROM issue i JOIN project p ON p.id = i.project_id
         WHERE i.id = r.issue_id) AS "issueIdentifier",
      (SELECT title FROM issue i WHERE i.id = r.issue_id) AS "issueTitle",
      (SELECT f.name FROM issue i JOIN project_view_folder f ON f.id = i.folder_id
         WHERE i.id = r.issue_id) AS "issueArea",
      (SELECT f.folder FROM issue i JOIN project_view_folder f ON f.id = i.folder_id
         WHERE i.id = r.issue_id) AS "issueAreaFolder",
      (SELECT u.name FROM issue i JOIN "user" u ON u.id = i.assignee_user_id
         WHERE i.id = r.issue_id) AS "assigneeName",
      (SELECT COALESCE(u.username, ag.username)
         FROM issue i JOIN "user" u ON u.id = i.assignee_user_id
         LEFT JOIN ai_agent ag ON ag.user_id = u.id
         WHERE i.id = r.issue_id) AS "assigneeUsername",
      r.source_activity_id AS "sourceActivityId",
      (SELECT actor_name FROM issue_activity a WHERE a.id = r.source_activity_id) AS "requesterName",
      (SELECT COALESCE(u.username, ag.username)
         FROM issue_activity a JOIN "user" u ON u.id = a.actor_user_id
         LEFT JOIN ai_agent ag ON ag.user_id = u.id
         WHERE a.id = r.source_activity_id) AS "requesterUsername"
  `);
  const row = (rows as unknown as ClaimedRow[])[0];
  if (!row) return null;
  const threadContext = await loadThreadContext(row.sourceActivityId);
  const forPrompt = {
    ...row,
    agentUserId: agent.userId,
    agentUsername: agent.username,
    threadContext,
  };
  await recordAgentRunStarted(forPrompt);
  return {
    id: row.id,
    trigger: row.trigger,
    prompt: row.sessionId ? RESUME_PROMPT : framePrompt(forPrompt),
    systemPrompt:
      buildSystemPrompt(
        agent,
        { key: row.projectKey, name: row.projectName, description: row.projectDescription },
        forPrompt,
      ) + (row.interrupted && !row.sessionId ? INTERRUPTED_RUN : ''),
    attempts: row.attempts,
    claim: row.claim,
    issueId: row.issueId,
    issueIdentifier: row.issueIdentifier,
    sourceActivityId: row.sourceActivityId,
    model: row.model ?? agent.model,
    thinkingLevel: agent.thinkingLevel,
    maxTurns: row.maxTurns ?? agent.maxTurns,
    runBudgetSeconds: row.runBudgetSeconds ?? agent.runBudgetSeconds,
    workdir: worksInProjectWorkspace(agent) ? row.issueAreaFolder : null,
    sessionId: row.sessionId,
  };
}

// Whatever an interrupted attempt did outside the run has happened.
const INTERRUPTED_RUN =
  '## Interrupted run\nAn earlier attempt at this run was interrupted before it reported a ' +
  'result. Check the work item, its comments and your workspace for what that attempt ' +
  'already did, and do not repeat an action that already took effect.\n';

// The prompt a resumed run gets instead of the original task: the runner passes the
// same coding agent session along with it, so the agent already has that context and
// only needs telling that it was cut off and should pick the work back up.
const RESUME_PROMPT =
  'The runner working on this task stopped before it finished, a crash, a restart, or a ' +
  'deploy. You are continuing the same session. Check the work item, your workspace and ' +
  'what you already did before you decide what is next; do not repeat an action that ' +
  'already took effect.';

// The runtime of an agent that works in one project runs in that project's workspace.
// The Home agent and an agent of several projects share one working directory outside
// any project, where an area folder does not exist.
function worksInProjectWorkspace(agent: RunnerAgent): boolean {
  return agent.projects.length === 1 && !isHomeAgent(agent.username);
}

// What the agent is told about the run before the task itself: the project the run
// works in, that the run is autonomous, who the people behind it are, and last the
// operator's own instructions from the agent's settings, which therefore win over the
// generic parts.
function buildSystemPrompt(
  agent: RunnerAgent,
  project: Pick<RunnerProject, 'key' | 'name' | 'description'>,
  run: RunForPrompt & Pick<ClaimedRow, 'projectInstructions' | 'agentProjectInstructions'>,
): string {
  const instructions = agent.instructions?.trim();
  return (
    projectPreamble(project) +
    runModePreamble(run.trigger) +
    peopleContext(run) +
    projectInstructionsPreamble({
      key: project.key,
      projectInstructions: run.projectInstructions,
      agentProjectInstructions: run.agentProjectInstructions,
    }) +
    (instructions ? `## Instructions\n${instructions}\n` : '')
  );
}

export interface RunAck {
  canceled: boolean;
}

// The claim a runner holds: the run, still pending, not claimed since. A runner that
// names no claim is not checked.
function heldBy(agentId: number, runId: number, claim: number | undefined) {
  return and(
    eq(agentRun.id, runId),
    eq(agentRun.agentId, agentId),
    eq(agentRun.status, 'pending'),
    claim === undefined ? undefined : eq(agentRun.claims, claim),
  );
}

// Extends a claimed run's lease while the runner is still working on it. A command
// can outlive the lease by far, so the runner sends this periodically; without it the
// run would be handed to another runner mid-flight. A lease that ran out is extended as
// long as nobody claimed the run since. `canceled` tells the runner to kill the command
// and report nothing: the run was canceled, or, for a runner that names its claim, it
// was claimed again or finished. Null when the run is not this agent's.
export async function heartbeatRun(
  agentId: number,
  runId: number,
  claim?: number,
): Promise<RunAck | null> {
  await touchRunner(agentId);
  const rows = await db
    .update(agentRun)
    .set({ nextAttemptAt: sql`now() + make_interval(secs => ${agentRunConfig.leaseSeconds()})` })
    .where(heldBy(agentId, runId, claim))
    .returning({ id: agentRun.id });
  if (rows.length > 0) return { canceled: false };
  const [row] = await db
    .select({ status: agentRun.status })
    .from(agentRun)
    .where(and(eq(agentRun.id, runId), eq(agentRun.agentId, agentId)))
    .limit(1);
  if (!row) return null;
  return row.status === 'canceled' || claim !== undefined ? { canceled: true } : null;
}

// Saves the coding agent session of a claimed run as soon as the runner reads it off
// the command's own output, not only once the run finishes: a crash before the result
// still leaves a session the next claim can resume. False when the runner no longer
// holds the run, which is not fatal to it -- the runner just starts fresh next time.
export async function reportRunSession(
  agentId: number,
  runId: number,
  claim: number | undefined,
  sessionId: string,
): Promise<boolean> {
  const rows = await db
    .update(agentRun)
    .set({ sessionId })
    .where(heldBy(agentId, runId, claim))
    .returning({ id: agentRun.id });
  return rows.length > 0;
}

// Hands a claimed run back to the queue without spending the attempt, for a runner that
// stops while the run executes: the run is claimable at once instead of after its lease,
// and the stop does not count towards the attempts that fail it. False when the runner
// no longer holds the run.
export async function releaseRun(agentId: number, runId: number, claim: number): Promise<boolean> {
  await touchRunner(agentId);
  const rows = await db
    .update(agentRun)
    .set({ attempts: sql`${agentRun.attempts} - 1`, nextAttemptAt: sql`now()` })
    .where(heldBy(agentId, runId, claim))
    .returning({ id: agentRun.id });
  return rows.length > 0;
}

export interface ReflectionRequest {
  prompt: string;
  maxTurns: number;
  runBudgetSeconds: number;
}

export interface RunReflection {
  status: 'pending' | 'success' | 'failed';
  reason: ReflectionReason;
  saved: (typeof reflectionBody.static)['saved'];
  summary: string | null;
  error: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
}

// Rework is the agent coming back to an issue it already finished a run on: a reply to
// its result, a review that sent the work back, a changed request.
async function isRework(agentId: number, runId: number, issueId: number | null) {
  if (issueId == null) return false;
  const [row] = await db
    .select({ id: agentRun.id })
    .from(agentRun)
    .where(
      and(
        eq(agentRun.agentId, agentId),
        eq(agentRun.issueId, issueId),
        lt(agentRun.id, runId),
        inArray(agentRun.status, ['success', 'failed']),
      ),
    )
    .limit(1);
  return row !== undefined;
}

// The reflection the finished run is worth, noted on the run as waiting, or null. None
// for an agent its tokens paused, or without the session to continue.
async function requestReflection(
  agentId: number,
  runId: number,
  run: { status: 'success' | 'failed'; issueId: number | null; paused: boolean },
  report: { sessionId?: string; toolCalls?: number },
): Promise<ReflectionRequest | null> {
  if (run.paused || !report.sessionId) return null;
  const [agent] = await db
    .select({ runtimePolicy: aiAgent.runtimePolicy })
    .from(aiAgent)
    .where(eq(aiAgent.id, agentId));
  if (!agent) return null;
  const reason = reflectionReason(normalizeRuntimePolicy(agent.runtimePolicy), {
    status: run.status,
    toolCalls: report.toolCalls ?? 0,
    rework: await isRework(agentId, runId, run.issueId),
  });
  if (!reason) return null;
  const reflection: RunReflection = {
    status: 'pending',
    reason,
    saved: [],
    summary: null,
    error: null,
    inputTokens: null,
    outputTokens: null,
  };
  await db.update(agentRun).set({ reflection }).where(eq(agentRun.id, runId));
  return { prompt: reflectionPrompt(reason), ...REFLECTION_LIMITS };
}

// Records the outcome the runner reports. A failure is terminal: the runner ran the
// command and it failed, so re-serving the same run would just repeat it. A run in
// which the agent reported itself blocked ends as a success whatever the command did
// afterwards. The tokens it used may reach a ceiling, which pauses the agent now rather
// than at its next run. Null when the run is not this agent's, was already finished, or
// was claimed again after the named claim; otherwise the reflection the runner is to
// start, if any.
export async function finishRun(
  agent: RunnerAgent,
  runId: number,
  result: {
    status: 'success' | 'failed';
    output?: string | null;
    error?: string | null;
    usage?: ContextUsage | null;
    sessionId?: string;
    toolCalls?: number;
  },
  claim?: number,
): Promise<{ reflection: ReflectionRequest | null } | null> {
  if (result.output != null && Buffer.byteLength(result.output, 'utf8') > MAX_RUN_OUTPUT_BYTES) {
    throw new HttpError(413, 'Run output exceeds 128 KiB');
  }
  await touchRunner(agent.id);
  const error = result.status === 'failed' ? (result.error?.slice(0, 500) ?? 'Run failed') : null;
  const blocked = sql`${agentRun.blockedQuestion} IS NOT NULL`;
  const rows = await db
    .update(agentRun)
    .set({
      status: sql`CASE WHEN ${blocked} THEN 'success' ELSE ${result.status} END`,
      output: result.output ?? null,
      lastError: sql`CASE WHEN ${blocked} THEN NULL ELSE ${error}::text END`,
      inputTokens: result.usage?.inputTokens ?? null,
      outputTokens: result.usage?.outputTokens ?? null,
      finishedAt: new Date(),
    })
    .where(heldBy(agent.id, runId, claim))
    .returning({
      issueId: agentRun.issueId,
      projectId: agentRun.projectId,
      status: agentRun.status,
    });
  const row = rows[0];
  if (!row) return null;
  const status = row.status as 'success' | 'failed';
  await recordAgentRunFinished({ issueId: row.issueId, agentUserId: agent.userId }, status);
  const paused = await enforceAgentLimits(agent.id, row.projectId, row.issueId);
  return {
    reflection: await requestReflection(
      agent.id,
      runId,
      { status, issueId: row.issueId, paused: paused !== null },
      result,
    ),
  };
}

// Records the reflection a run result asked for, once. Its tokens are added to the run's,
// so the agent's ceilings count them, and may pause the agent.
export async function recordReflection(
  agent: RunnerAgent,
  runId: number,
  report: typeof reflectionBody.static,
): Promise<boolean> {
  const input = report.usage?.inputTokens ?? null;
  const output = report.usage?.outputTokens ?? null;
  const rows = await db
    .update(agentRun)
    .set({
      reflection: sql`${agentRun.reflection} || ${JSON.stringify({
        status: report.status,
        saved: report.saved,
        summary: report.summary?.trim() || null,
        error: report.status === 'failed' ? (report.error ?? 'Reflection failed') : null,
        inputTokens: input,
        outputTokens: output,
      })}::jsonb`,
      inputTokens:
        input === null
          ? agentRun.inputTokens
          : sql`COALESCE(${agentRun.inputTokens}, 0) + ${input}`,
      outputTokens:
        output === null
          ? agentRun.outputTokens
          : sql`COALESCE(${agentRun.outputTokens}, 0) + ${output}`,
    })
    .where(
      and(
        eq(agentRun.id, runId),
        eq(agentRun.agentId, agent.id),
        sql`${agentRun.reflection}->>'status' = 'pending'`,
      ),
    )
    .returning({ projectId: agentRun.projectId, issueId: agentRun.issueId });
  const row = rows[0];
  if (!row) return false;
  await enforceAgentLimits(agent.id, row.projectId, row.issueId);
  return true;
}
