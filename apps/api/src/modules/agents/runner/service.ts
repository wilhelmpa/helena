import {
  db,
  aiAgent,
  agentRun,
  organizationProjectAssignment,
  project,
  projectMember,
} from '@repo/db';
import { and, asc, eq, inArray, lt, lte, notInArray, sql } from 'drizzle-orm';
import { HttpError } from '#shared/lib';
import { type ContextUsage } from '../chat-usage';
import { enforceAgentLimits } from '../governance';
import { heldProjects, useGrace } from '#modules/autopilot/budgets';
import { noteRunLevel } from '#modules/autopilot/engine';
import { resolveLevel } from '#modules/autopilot/levels';
import { autopilotRunSection } from '#modules/autopilot/prompt';
import { postAutopilotReport } from '#modules/autopilot/report';
import type { AutopilotLevel } from '@helena/policy';
import { agentRunConfig, loadThreadContext } from '../core/run-queue';
import { recordAgentRunFinished, recordAgentRunStarted } from '../core/run-activity';
import { isHomeAgent } from '../core/home-agent';
import { normalizeRuntimePolicy } from '../core/service';
import { parseLocalModelId, type RuntimeFailure } from '@helena/sdk';
import { learnFromOutcome, routeOf, runtimeOfPolicy } from '#modules/model-availability/service';
import { getRunResumeSettings } from '#modules/settings/service';
import type { AgentRunTrigger } from '../model';
import {
  claimedModelCheck,
  modelCheckOf,
  withStoredFallback,
  type RunModelReport,
} from '../runtime-sync/model-check';
import { routeRequest } from '#modules/model-router/service';
import { DIGEST_SYSTEM_PROMPT } from '#modules/updates/digest-prompt';
import { MAX_RUN_OUTPUT_BYTES, type reflectionBody } from './model';
import { recordUsage, type Spend } from '../usage/service';
import { emergencyStopActive } from '#modules/emergency-stop/service';
import {
  LOCAL_REFLECTION_LIMITS,
  LOCAL_REFLECTION_MAX_READ,
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
import { chooseModelNow, classModelNow, type LocalFallback } from '#modules/local-ai/service';
import { WORK_CLASS } from '#modules/local-ai/work-classes';
import { routinePromptContext } from '#modules/routines/agent-runs';

// The queue an agent's runner drains. The runner is a process the operator starts on
// their own machine; it authenticates with the agent's API key, claims one run at a
// time, executes whatever command it is configured with, and reports the result back.
// The task is framed here, so every runner gets a task that says what started the run
// and what to do about it without having to build that itself. Claiming works exactly like the worker's: the
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
  // The runtime it runs on ('hermes', 'claude', 'codex'), which a finding about its model
  // is recorded under.
  runtime: string;
}

// The agent whose bot user is the caller, or null when the caller is not an agent.
// The API key identifies the agent, so holding it is the authorization to drain its
// queue — no permission check applies.
export async function getRunnerAgent(userId: string): Promise<RunnerAgent | null> {
  const rows = await db
    .select({
      id: aiAgent.id,
      teamId: aiAgent.teamId,
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
    projects,
    thinkingLevel: policy.reasoningEffort,
    maxTurns: policy.maxTurns ?? null,
    runBudgetSeconds: policy.runBudgetSeconds ?? null,
    runtime: runtimeOfPolicy(policy),
  };
}

export interface RunnerRun {
  id: number;
  trigger: AgentRunTrigger;
  // The task as the agent should read it: the trigger text framed with what started
  // the run and what to do about it.
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
  // The Autopilot level the run works at (Helena's policy engine decides every tool call by
  // it); a runner maps it onto its runtime's own permission mode.
  autopilotLevel: AutopilotLevel;
}

// The claim's raw row, before framing. The extra people columns exist only to build
// the prompts and are not handed to the runner.
type ClaimedRow = Omit<RunnerRun, 'systemPrompt' | 'autopilotLevel'> & {
  projectId: number;
  // The run's own reasoning effort, where it overrides the agent's (a digest run).
  reasoning: string | null;
  // The kind of work the run is for Lokale KI (agent_run.work_class), or null.
  workClass: string | null;
  // What the last claim recorded about its model (agent_run.model_check), or null.
  modelCheck: unknown;
  // Claimed before, by a claim that ended without a result: the runner stopped, handed
  // the run back, or lost its lease.
  interrupted: boolean;
  // The first claim of a run that continues another run's session with a new instruction.
  continuation: boolean;
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
      id: agentRun.id,
      agentId: agentRun.agentId,
      projectId: agentRun.projectId,
      trigger: agentRun.trigger,
      lastError: agentRun.lastError,
      issueId: agentRun.issueId,
      agentUserId: sql<string>`(SELECT user_id FROM ai_agent a WHERE a.id = ${agentRun.agentId})`,
    });
  for (const row of rows) await recordAgentRunFinished(row, 'failed', row.lastError);
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
      id: agentRun.id,
      agentId: agentRun.agentId,
      projectId: agentRun.projectId,
      trigger: agentRun.trigger,
      lastError: agentRun.lastError,
      issueId: agentRun.issueId,
      agentUserId: sql<string>`(SELECT user_id FROM ai_agent a WHERE a.id = ${agentRun.agentId})`,
    });
  for (const row of rows) await recordAgentRunFinished(row, 'failed', row.lastError);
  return rows.length;
}

// The model a run starts on. A local model only while local AI runs it and its server
// answers; otherwise the model the agent runs on without local AI (its own, or the runtime's
// default when that is local too), with its own reasoning, and the fallback noted.
async function runSettingsOf(
  model: string | null,
  thinkingLevel: string | null,
  agent: { model: string | null; thinkingLevel: string | null },
): Promise<{ model: string | null; thinkingLevel: string | null; fallback: LocalFallback | null }> {
  const choice = await chooseModelNow(model, agent.model);
  if (!choice.fallback) return { model, thinkingLevel, fallback: null };
  return {
    model: choice.model,
    thinkingLevel:
      choice.model !== null && choice.model === agent.model ? agent.thinkingLevel : null,
    fallback: choice.fallback,
  };
}

// Claims the agent's next due run, or null when it has none or may not start it: a
// paused agent's runs wait in the queue. FOR UPDATE SKIP LOCKED keeps two runners on
// the same key from taking the same run.
export async function claimRunnerRun(agent: RunnerAgent): Promise<RunnerRun | null> {
  const agentId = agent.id;
  await expireExhaustedRuns(agentId);
  await touchRunner(agentId);
  if (await emergencyStopActive()) return null;
  const { maxResumes } = await getRunResumeSettings();
  // A run whose session has already resumed as often as the instance allows is left
  // pending rather than claimed again: the resume-limit janitor fails it and tells the
  // owner instead of it being retried silently forever.
  // The runs of a project whose budget is used up wait; the agent's other projects go on.
  const held = await heldProjects(
    (
      await db
        .selectDistinct({ projectId: agentRun.projectId })
        .from(agentRun)
        .where(and(eq(agentRun.agentId, agentId), eq(agentRun.status, 'pending')))
    ).map((row) => row.projectId),
  );
  const notHeld =
    held.length > 0
      ? sql` AND q.project_id NOT IN (${sql.join(
          held.map((id) => sql`${id}`),
          sql`, `,
        )})`
      : sql``;
  const claimable = sql`q.status = 'pending' AND q.next_attempt_at <= now()
    AND (q.session_id IS NULL OR q.resumes < ${maxResumes})${notHeld}`;
  const [next] = await db
    .select({ projectId: agentRun.projectId, issueId: agentRun.issueId })
    .from(agentRun)
    .where(
      and(
        eq(agentRun.agentId, agentId),
        eq(agentRun.status, 'pending'),
        lte(agentRun.nextAttemptAt, sql`now()`),
        sql`(${agentRun.sessionId} IS NULL OR ${agentRun.resumes} < ${maxResumes})`,
        held.length > 0 ? notInArray(agentRun.projectId, held) : undefined,
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
      r.project_id AS "projectId",
      r.claims AS "claim",
      r.issue_id AS "issueId",
      r.started_at < now() AS "interrupted",
      r.max_turns AS "maxTurns",
      r.run_budget_seconds AS "runBudgetSeconds",
      r.model,
      r.reasoning,
      r.work_class AS "workClass",
      r.model_check AS "modelCheck",
      r.session_id AS "sessionId",
      r.resumes,
      (r.continued_from_run_id IS NOT NULL AND r.resumes = 1) AS "continuation",
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
  await useGrace(agent.id, next.projectId, row.id);
  const autopilot = await resolveLevel(agent.id, next.projectId);
  await noteRunLevel(row.id, autopilot.level);
  const threadContext = await loadThreadContext(row.sourceActivityId);
  // The routine whose work the run is, when it is one: its framing keeps the run quiet and
  // names the agents the fire started beside it (docs/helena-decisions/routine-mentions.md).
  const routine = await routinePromptContext(row);
  const forPrompt = {
    ...row,
    agentUserId: agent.userId,
    agentUsername: agent.username,
    threadContext,
    routine,
  };
  await recordAgentRunStarted({ ...forPrompt, agentId: agent.id, autopilotLevel: autopilot.level });
  // A digest run is text only: its prompt is the whole task and its system prompt says the
  // input is data (updates/digest.ts); nothing about projects, people or the Autopilot.
  const digest = row.trigger === 'digest';
  // The model router (docs/helena-decisions/decisions.md §4): a fresh run without a model of
  // its own may go to a cheaper model of the agent's runtime. The routed model is stored on
  // the run, so a resumed session keeps it and the model check compares against it.
  // A local model only while local AI is on; otherwise the agent's default runs, as without
  // local AI (docs/helena-decisions/local-ai-platform.md §6).
  const configured = await runSettingsOf(
    row.model ?? agent.model,
    row.reasoning ?? agent.thinkingLevel,
    agent,
  );
  let { model, thinkingLevel } = configured;
  let fallback = configured.fallback;
  // The kind of work the run is (a digest, a routine's task, a coordinator's first plan) may
  // run on its local model while Lokale KI takes it (docs/helena-decisions/local-ai-platform.md
  // §7.1); otherwise, and whenever the server does not answer, on the model above, exactly as
  // without local AI. A run that names a local model of its own keeps it. A resumed run whose
  // session began on the configured model stays there: it is not moved to a local model with
  // the whole session to read again; one that began locally is asked again (its server may be
  // gone since).
  const resumedElsewhere =
    row.sessionId !== null &&
    (row.modelCheck as { configured?: { source?: string } } | null)?.configured?.source !== 'local';
  const local =
    row.workClass && !fallback && !parseLocalModelId(model) && !resumedElsewhere
      ? await classModelNow(row.workClass)
      : null;
  if (local?.model) {
    model = local.model;
    // The local provider says how its turns think (runner local-ai.ts extra_body).
    thinkingLevel = null;
  } else if (local?.fallback) {
    fallback = local.fallback;
  }
  const source = local?.model ? 'local' : row.model ? 'run' : model ? 'agent' : 'default';
  if (fallback || local?.model) {
    // Shown with the run until its runner reports what really ran (which keeps it).
    await db
      .update(agentRun)
      .set({
        modelCheck: claimedModelCheck(model, thinkingLevel, source, fallback, row.workClass),
      })
      .where(eq(agentRun.id, row.id));
  }
  if (!local?.model && !row.model && !row.sessionId && !digest && row.trigger !== 'workspace') {
    const routed = await routeRequest({
      teamId: agent.teamId,
      agentId: agent.id,
      projectId: next.projectId,
      configuredModel: model,
      thinkingLevel,
      text: [row.issueTitle, row.prompt].filter(Boolean).join('\n\n'),
      runId: row.id,
    });
    // A routed model that local AI would not run right now (it is off) is not taken.
    const settled =
      routed.route?.routed && routed.model
        ? await runSettingsOf(routed.model, routed.thinkingLevel, agent)
        : null;
    if (settled && !settled.fallback) {
      model = settled.model;
      thinkingLevel = settled.thinkingLevel;
      await db
        .update(agentRun)
        .set({ model, reasoning: thinkingLevel })
        .where(eq(agentRun.id, row.id));
    }
  }
  return {
    id: row.id,
    trigger: row.trigger,
    // A workspace job (a clone) is for the runner itself: its prompt is the job as it was
    // queued, never framed for a model.
    prompt:
      row.trigger === 'workspace' || digest
        ? row.prompt
        : row.sessionId && !row.continuation
          ? RESUME_PROMPT
          : framePrompt(forPrompt),
    systemPrompt: digest
      ? DIGEST_SYSTEM_PROMPT
      : buildSystemPrompt(
          agent,
          { key: row.projectKey, name: row.projectName, description: row.projectDescription },
          forPrompt,
        ) +
        autopilotRunSection(row.projectKey, autopilot.level) +
        (row.interrupted && !row.sessionId ? INTERRUPTED_RUN : ''),
    attempts: row.attempts,
    claim: row.claim,
    issueId: row.issueId,
    issueIdentifier: row.issueIdentifier,
    sourceActivityId: row.sourceActivityId,
    model,
    thinkingLevel,
    maxTurns: row.maxTurns ?? agent.maxTurns,
    runBudgetSeconds: row.runBudgetSeconds ?? agent.runBudgetSeconds,
    workdir: worksInProjectWorkspace(agent) ? row.issueAreaFolder : null,
    sessionId: row.sessionId,
    autopilotLevel: autopilot.level,
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
  hold?: boolean;
}

// The claim a runner holds: the run, still pending, not claimed since. A runner that
// names no claim is not checked.
export function heldBy(agentId: number, runId: number, claim: number | undefined) {
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
  if (rows.length > 0)
    return (await emergencyStopActive()) ? { canceled: false, hold: true } : { canceled: false };
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
  // A local model Lokale KI hands the reflection; absent: the run's model.
  model?: string | null;
}

export interface RunReflection {
  status: 'pending' | 'success' | 'failed';
  reason: ReflectionReason;
  // The local model it runs on, when Lokale KI takes it.
  model?: string | null;
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
  run: { status: 'success' | 'failed'; issueId: number | null; paused: boolean; digest?: boolean },
  report: { sessionId?: string; toolCalls?: number; usage?: ContextUsage | null },
): Promise<ReflectionRequest | null> {
  // A digest run is a summary, with nothing to learn from (and no memory tools).
  if (run.paused || run.digest || !report.sessionId) return null;
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
  // Lokale KI's class `reflection`, for a session small enough (reflection.ts). Hermes reports
  // what the whole run read, every call summed, which bounds the session from above; a run
  // of unknown size stays on its own model.
  const read = report.usage?.inputTokens ?? null;
  const local =
    read !== null && read <= LOCAL_REFLECTION_MAX_READ
      ? (await classModelNow(WORK_CLASS.reflection)).model
      : null;
  const reflection: RunReflection = {
    status: 'pending',
    reason,
    ...(local && { model: local }),
    saved: [],
    summary: null,
    error: null,
    inputTokens: null,
    outputTokens: null,
  };
  await db.update(agentRun).set({ reflection }).where(eq(agentRun.id, runId));
  return local
    ? { prompt: reflectionPrompt(reason), ...LOCAL_REFLECTION_LIMITS, model: local }
    : { prompt: reflectionPrompt(reason), ...REFLECTION_LIMITS };
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
    spend?: Spend | null;
    runtime?: RunModelReport;
    failure?: RuntimeFailure;
  },
  claim?: number,
): Promise<{ reflection: ReflectionRequest | null } | null> {
  if (result.output != null && Buffer.byteLength(result.output, 'utf8') > MAX_RUN_OUTPUT_BYTES) {
    throw new HttpError(413, 'Run output exceeds 128 KiB');
  }
  await touchRunner(agent.id);
  const error = result.status === 'failed' ? (result.error?.slice(0, 500) ?? 'Run failed') : null;
  // A run that names a model of its own (a workflow step's) was configured with that one.
  const [own] = result.runtime
    ? await db
        .select({ model: agentRun.model, modelCheck: agentRun.modelCheck })
        .from(agentRun)
        .where(eq(agentRun.id, runId))
    : [];
  const check = withStoredFallback(
    modelCheckOf(result.runtime, own?.model ?? null),
    own?.modelCheck ?? null,
  );
  const blocked = sql`${agentRun.blockedQuestion} IS NOT NULL`;
  const rows = await db
    .update(agentRun)
    .set({
      status: sql`CASE WHEN ${blocked} THEN 'success' ELSE ${result.status} END`,
      output: result.output ?? null,
      lastError: sql`CASE WHEN ${blocked} THEN NULL ELSE ${error}::text END`,
      inputTokens: result.usage?.inputTokens ?? null,
      outputTokens: result.usage?.outputTokens ?? null,
      // The session the run ended in (a compression moves it to a new id), which "continue
      // from here" resumes.
      ...(result.sessionId && { sessionId: result.sessionId }),
      ...(check && { modelCheck: check }),
      failure: result.status === 'failed' ? (result.failure ?? null) : null,
      finishedAt: new Date(),
    })
    .where(heldBy(agent.id, runId, claim))
    .returning({
      issueId: agentRun.issueId,
      projectId: agentRun.projectId,
      status: agentRun.status,
      trigger: agentRun.trigger,
      lastError: agentRun.lastError,
    });
  const row = rows[0];
  if (!row) return null;
  const status = row.status as 'success' | 'failed';
  // What the run taught about its model: a refusal takes it out of the pickers, a success
  // confirms it.
  await learnFromOutcome({
    runtime: agent.runtime,
    report: result.runtime,
    status: result.status,
    failure: result.failure,
    source: { agentId: agent.id, runId },
  });
  await recordUsage({
    agentId: agent.id,
    projectId: row.projectId,
    runId,
    kind: 'run',
    sessionId: result.sessionId,
    spend: result.spend,
  });
  await recordAgentRunFinished(
    {
      id: runId,
      agentId: agent.id,
      projectId: row.projectId,
      trigger: row.trigger,
      issueId: row.issueId,
      agentUserId: agent.userId,
    },
    status,
    row.lastError,
    status === 'failed' && result.failure
      ? {
          code: result.failure.code,
          model:
            routeOf(agent.runtime, result.runtime, result.failure)?.model ??
            result.failure.model ??
            null,
        }
      : null,
  );
  // "Handeln & berichten": what the run did without approval, on its task.
  await postAutopilotReport(runId);
  const paused = await enforceAgentLimits(agent.id, row.projectId, row.issueId);
  return {
    reflection: await requestReflection(
      agent.id,
      runId,
      { status, issueId: row.issueId, paused: paused !== null, digest: row.trigger === 'digest' },
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
  await recordUsage({
    agentId: agent.id,
    projectId: row.projectId,
    runId,
    kind: 'reflection',
    spend: report.spend,
  });
  await enforceAgentLimits(agent.id, row.projectId, row.issueId);
  return true;
}
