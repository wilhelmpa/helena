import { db, pipelineRunStep } from '@repo/db';
import { and, desc, eq, lt, sql } from 'drizzle-orm';
import { bumpControlPlaneRevision } from '#modules/sync/service';
import {
  OUTCOMES,
  TASK_FIELDS,
  type ConditionStep,
  type ConditionTest,
  type Outcome,
} from '#modules/pipelines/definition';
import { loadRun, projectContext, same, stepRow, writeStep, type StepRow } from '../../run-context';
import type { FieldReader, StepContext, StepExecution, WorkflowStepType } from '../../sdk';
import { findState } from '@helena/locales/defaults';

// A condition: the outcome of the previous agent, approval or action step, a keyword in
// its summary, or a field of the task decides which of the two lanes the run takes.

type Step = ConditionStep & { [field: string]: unknown };

function readCondition(raw: unknown, reader: FieldReader): ConditionTest {
  const value = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : null;
  const kind = reader.choice(value?.kind, 'condition.kind', [
    'outcome',
    'keyword',
    'task',
  ] as const);
  if (kind === 'outcome') {
    const outcomes = Array.isArray(value?.outcomes) ? value.outcomes : [];
    const valid = [...new Set(outcomes)].filter((item): item is Outcome =>
      (OUTCOMES as readonly unknown[]).includes(item),
    );
    if (valid.length === 0 || valid.length !== outcomes.length)
      reader.issue('required', 'condition.outcomes');
    return { kind, outcomes: valid };
  }
  if (kind === 'keyword')
    return { kind, keyword: reader.text(value?.keyword, 'condition.keyword', 200) };
  return {
    kind,
    field: reader.choice(value?.field, 'condition.field', TASK_FIELDS),
    op: reader.choice(value?.op, 'condition.op', ['is', 'is_not'] as const),
    values: reader.names(value?.values, 'condition.values'),
  };
}

// What an approval or action left as `previous` for an outcome condition.
function outcomeOf(row: StepRow): string {
  if (row.kind === 'approval') return row.outcome === 'approved' ? 'success' : 'failed';
  return row.outcome ?? (row.status === 'failed' ? 'failed' : 'success');
}

async function evaluate(runId: string, step: ConditionStep, at: StepExecution): Promise<boolean> {
  const existing = await stepRow(runId, at);
  if (existing?.status === 'succeeded') return existing.outcome === 'true';
  const context = await loadRun(runId);
  const test = step.condition;
  let matched = false;
  if (test.kind === 'task') {
    const task = context.task;
    const projectData = await projectContext(context);
    const current: string[] = !task
      ? []
      : test.field === 'status'
        ? projectData.statuses.filter((s) => s.id === task.columnId).map((s) => s.name)
        : test.field === 'statusType'
          ? projectData.statuses.filter((s) => s.id === task.columnId).map((s) => s.stateType)
          : test.field === 'labels'
            ? projectData.labels.filter((l) => task.labelIds.includes(l.id)).map((l) => l.name)
            : test.field === 'area'
              ? projectData.areas.filter((a) => a.id === task.folderId).map((a) => a.name)
              : task.priority
                ? [task.priority]
                : [];
    // A status is found as a workflow step finds it (findState), so "Review" also means
    // a project's "In Prüfung".
    const overlaps =
      test.field === 'status'
        ? !!task && test.values.some((value) => findState(projectData.statuses, value)?.id === task.columnId)
        : test.values.some((value) => current.some((item) => same(item, value)));
    matched = test.op === 'is' ? overlaps : !overlaps;
  } else {
    const [previous] = await db
      .select()
      .from(pipelineRunStep)
      .where(
        and(
          eq(pipelineRunStep.runId, runId),
          lt(pipelineRunStep.seq, at.seq),
          sql`${pipelineRunStep.kind} IN ('agent', 'approval', 'action', 'webhook', 'notify')`,
          sql`${pipelineRunStep.stepId} NOT LIKE '%.%'`,
        ),
      )
      .orderBy(desc(pipelineRunStep.seq))
      .limit(1);
    if (previous && test.kind === 'outcome')
      matched = (test.outcomes as string[]).includes(outcomeOf(previous));
    if (previous && test.kind === 'keyword')
      matched = (previous.summary ?? '').toLowerCase().includes(test.keyword.toLowerCase());
  }
  await writeStep(runId, step, at, {
    status: 'succeeded',
    outcome: matched ? 'true' : 'false',
    summary: null,
    finishedAt: new Date(),
  });
  await bumpControlPlaneRevision(context.project.id);
  return matched;
}

export const conditionStep: WorkflowStepType<Step> = {
  type: 'condition',
  ui: { builder: true, icon: 'git-branch' },
  branching: true,
  read(value, reader) {
    return {
      condition: readCondition(value.condition, reader),
      then: [],
      else: [],
      thenEnd: false,
      elseEnd: false,
    };
  },
  async execute(context: StepContext<Step>) {
    const matched = await context.op('evaluate', () =>
      evaluate(context.run.id, context.step, context.execution),
    );
    return { kind: 'branch', matched };
  },
};
