import { aiAgent, db, issue, user } from '@repo/db';
import { and, eq, inArray, or, sql } from 'drizzle-orm';
import { agentTeamStages, record, text } from '#modules/control-plane-workflows/agent-team';
import { listWorkflowRuns } from '#modules/control-plane-workflows/service';
import { emptyEntry, isBefore, type ActivityEntry, type ActivityFilters } from './entry';

// The Mastra runs of a timeline. Mastra stores them, not Plan, and filters them by
// project only, so the runs before a cursor are found by paging from the newest, a
// bounded number of pages per workflow. A workflow Mastra does not answer for leaves its
// runs out of the page, and so do runs older than the pages read; both are reported.

export interface WorkflowSource {
  workflowId: string;
  project: { id: number; key: string; name: string; teamId: number };
}

const SCAN_PAGES = 3;
// The size mastra-control reads a task's runs in, below its response size limit.
const SCAN_PAGE_SIZE = 20;
const TIMEOUT_MS = 5_000;
const TERMINAL = new Set(['success', 'failed', 'canceled', 'bailed', 'skipped']);
const TASK_REF = /^task:(.+)-(\d+)$/;

type Run = Record<string, unknown>;

function isoOf(value: unknown): string | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function payloadOf(run: Run) {
  return record(record(record(record(run.snapshot).context).input).payload);
}

function entryId(source: WorkflowSource, run: Run) {
  return `workflow:${source.project.id}:${source.workflowId}:${String(run.runId)}`;
}

function agentRefs(run: Run): string[] {
  const payload = payloadOf(run);
  const specialists = Array.isArray(payload.specialists) ? payload.specialists : [];
  return [payload.coordinator, ...specialists]
    .map((member) => text(record(member).agentRef)?.toLowerCase())
    .filter((ref): ref is string => Boolean(ref));
}

async function scan(
  source: WorkflowSource,
  filters: ActivityFilters,
  agent: { username: string; teamId: number } | null,
  want: number,
): Promise<{ runs: Run[]; complete: boolean }> {
  if (agent && agent.teamId !== source.project.teamId) return { runs: [], complete: true };
  const found: Run[] = [];
  for (let page = 0; page < SCAN_PAGES && found.length < want; page += 1) {
    const result = await listWorkflowRuns(
      source.project,
      source.workflowId,
      page,
      SCAN_PAGE_SIZE,
      TIMEOUT_MS,
    );
    const runs = (Array.isArray(result?.runs) ? result.runs : []).map(record);
    for (const run of runs) {
      const at = isoOf(run.createdAt);
      if (!at || !isBefore({ at, id: entryId(source, run) }, filters.cursor)) continue;
      if (agent && !agentRefs(run).includes(`agent:${agent.username.toLowerCase()}`)) continue;
      found.push(run);
    }
    if (runs.length < SCAN_PAGE_SIZE) return { runs: found, complete: true };
  }
  return { runs: found, complete: found.length >= want };
}

function total(values: (number | null)[]): number | null {
  const known = values.filter((value): value is number => value != null);
  return known.length > 0 ? known.reduce((sum, value) => sum + value, 0) : null;
}

// The task named by each run's payload, when it is an issue of the run's project.
async function resolveIssues(found: { source: WorkflowSource; run: Run }[]) {
  const wanted = found.flatMap(({ source, run }) => {
    const match = TASK_REF.exec(text(record(payloadOf(run).task).taskRef) ?? '');
    return match && match[1] === source.project.key
      ? [{ projectId: source.project.id, sequenceNumber: Number(match[2]) }]
      : [];
  });
  if (wanted.length === 0) return new Map<string, { id: number; title: string }>();
  const rows = await db
    .select({
      id: issue.id,
      projectId: issue.projectId,
      sequenceNumber: issue.sequenceNumber,
      title: issue.title,
    })
    .from(issue)
    .where(
      or(
        ...wanted.map((item) =>
          and(eq(issue.projectId, item.projectId), eq(issue.sequenceNumber, item.sequenceNumber)),
        ),
      ),
    );
  return new Map(rows.map((row) => [`${row.projectId}:${row.sequenceNumber}`, row]));
}

// The coordinator of each agent-team run, looked up in the team of its project.
async function resolveCoordinators(found: { source: WorkflowSource; run: Run }[]) {
  const wanted = found.flatMap(({ source, run }) => {
    const ref = text(record(payloadOf(run).coordinator).agentRef);
    return ref?.startsWith('agent:')
      ? [{ teamId: source.project.teamId, username: ref.slice('agent:'.length).toLowerCase() }]
      : [];
  });
  if (wanted.length === 0) return new Map<string, { id: number; username: string; name: string }>();
  const rows = await db
    .select({ id: aiAgent.id, teamId: aiAgent.teamId, username: aiAgent.username, name: user.name })
    .from(aiAgent)
    .innerJoin(user, eq(user.id, aiAgent.userId))
    .where(
      and(
        inArray(aiAgent.teamId, [...new Set(wanted.map((item) => item.teamId))]),
        inArray(sql`lower(${aiAgent.username})`, [...new Set(wanted.map((item) => item.username))]),
      ),
    );
  return new Map(
    rows.map(({ teamId, ...row }) => [`${teamId}:${row.username.toLowerCase()}`, row]),
  );
}

export async function workflowRunEntries(
  sources: WorkflowSource[],
  filters: ActivityFilters,
  limit: number,
): Promise<{ entries: ActivityEntry[]; failed: boolean; limited: boolean }> {
  if (sources.length === 0) return { entries: [], failed: false, limited: false };
  const [agent] = filters.agentId
    ? await db
        .select({ username: aiAgent.username, teamId: aiAgent.teamId })
        .from(aiAgent)
        .where(eq(aiAgent.id, filters.agentId))
    : [null];
  if (filters.agentId && !agent) return { entries: [], failed: false, limited: false };
  const settled = await Promise.allSettled(
    sources.map((source) => scan(source, filters, agent ?? null, limit + 1)),
  );
  const found = sources.flatMap((source, index) => {
    const outcome = settled[index]!;
    return outcome.status === 'fulfilled' ? outcome.value.runs.map((run) => ({ source, run })) : [];
  });
  const teamRuns = found.filter(({ source }) => source.workflowId === 'agent-team');
  const [issues, coordinators, stages] = await Promise.all([
    resolveIssues(found),
    resolveCoordinators(teamRuns),
    Promise.all(
      [...new Set(teamRuns.map(({ source }) => source.project.id))].map((projectId) =>
        agentTeamStages(
          projectId,
          teamRuns.filter(({ source }) => source.project.id === projectId).map(({ run }) => run),
        ),
      ),
    ).then((maps) => new Map(maps.flatMap((map) => [...map]))),
  ]);
  const entries = found.map(({ source, run }): ActivityEntry => {
    const payload = payloadOf(run);
    const status = text(run.status) ?? 'unknown';
    const createdAt = isoOf(run.createdAt)!;
    const updatedAt = isoOf(run.updatedAt);
    const match = TASK_REF.exec(text(record(payload.task).taskRef) ?? '');
    const task = match ? issues.get(`${source.project.id}:${match[2]}`) : undefined;
    const coordinator = text(record(payload.coordinator).agentRef)?.slice('agent:'.length);
    const runStages = stages.get(String(run.runId)) ?? [];
    const policy = record(payload.policy);
    const isTeam = source.workflowId === 'agent-team';
    return {
      ...emptyEntry,
      id: entryId(source, run),
      kind: isTeam ? 'agent-team-run' : 'workflow-run',
      at: createdAt,
      status,
      project: { id: source.project.id, key: source.project.key, name: source.project.name },
      agent:
        (isTeam && coordinator
          ? coordinators.get(`${source.project.teamId}:${coordinator.toLowerCase()}`)
          : undefined) ?? null,
      issue: task
        ? {
            id: task.id,
            identifier: `${source.project.key}-${match![2]}`,
            sequenceNumber: Number(match![2]),
            title: task.title,
          }
        : null,
      maxTurns: typeof policy.maxTurns === 'number' ? policy.maxTurns : null,
      runBudgetSeconds:
        typeof policy.runBudgetSeconds === 'number' ? policy.runBudgetSeconds : null,
      workflowId: source.workflowId,
      workflowRunId: String(run.runId),
      durationMs:
        TERMINAL.has(status) && updatedAt ? Date.parse(updatedAt) - Date.parse(createdAt) : null,
      inputTokens: total(runStages.map((stage) => stage.inputTokens)),
      outputTokens: total(runStages.map((stage) => stage.outputTokens)),
    };
  });
  return {
    entries,
    failed: settled.some((outcome) => outcome.status === 'rejected'),
    limited: settled.some((outcome) => outcome.status === 'fulfilled' && !outcome.value.complete),
  };
}
