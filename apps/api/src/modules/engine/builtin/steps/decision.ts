import { db, pipelineRunStep } from '@repo/db';
import { and, desc, eq, lt } from 'drizzle-orm';
import { LIMITS, type DecisionStep } from '#modules/pipelines/definition';
import { renderTemplate } from '#modules/pipelines/render';
import { bumpControlPlaneRevision } from '#modules/sync/service';
import { GENERAL_CLASS } from '#modules/decisions/classes';
import { decide } from '#modules/decisions/service';
import { clip, loadRun, renderContext, stepRow, writeStep } from '../../run-context';
import {
  StepFailure,
  type StepContext,
  type StepExecution,
  type WorkflowStepType,
} from '../../sdk';

// "Entscheidung" (docs/helena-decisions/decisions.md §6): a typed decision in a workflow. The
// step asks a decision model which of its options fits the context (the task, an earlier
// step's result), and the run takes the `then` lane when the answer is one of the options the
// step names for it, the `else` lane otherwise. Below the class's threshold, or without an
// answer, the run takes the lane the step names for "unsure" (else by default), or fails.
// A step may reuse an earlier decision step's answer instead of asking again, so several
// lanes can follow one question. The chosen option is the step's `outcome` and its summary
// says it with the confidence ({{step.<id>.outcome}}, {{step.<id>.summary}}).

type Step = DecisionStep & { [field: string]: unknown };

const MAX_OPTIONS = 12;
const DEFAULT_CONTEXT = '{{task.title}}\n\n{{task.description}}';

interface DecisionState {
  choice?: string | null;
  confidence?: number | null;
  decided?: boolean;
  decisionId?: number | null;
}

function percent(value: number | null | undefined): string {
  return value === null || value === undefined ? '' : ` (${Math.round(value * 100)} %)`;
}

// The answer of an earlier decision step of this run: its latest execution before this one.
async function earlier(runId: string, stepId: string, seq: number): Promise<DecisionState | null> {
  const [row] = await db
    .select({ state: pipelineRunStep.state, status: pipelineRunStep.status })
    .from(pipelineRunStep)
    .where(
      and(
        eq(pipelineRunStep.runId, runId),
        eq(pipelineRunStep.stepId, stepId),
        lt(pipelineRunStep.seq, seq),
      ),
    )
    .orderBy(desc(pipelineRunStep.seq))
    .limit(1);
  return row?.status === 'succeeded' ? ((row.state ?? {}) as DecisionState) : null;
}

async function evaluate(runId: string, step: Step, at: StepExecution): Promise<DecisionState> {
  const existing = await stepRow(runId, at);
  if (existing?.status === 'succeeded') return (existing.state ?? {}) as DecisionState;
  const context = await loadRun(runId);
  let state: DecisionState;
  if (step.from) {
    const found = await earlier(runId, step.from, at.seq);
    if (!found) throw new StepFailure(`The decision step ${step.from} has not been answered yet`);
    state = { ...found, decisionId: found.decisionId ?? null };
  } else {
    const render = await renderContext(context, at.seq);
    const question = clip(renderTemplate(step.question, render).trim(), 2000);
    const text = clip(renderTemplate(step.context || DEFAULT_CONTEXT, render).trim(), 12_000);
    const outcome = await decide({
      teamId: context.project.teamId,
      classId: GENERAL_CLASS,
      context: text,
      questions: {
        choice: {
          kind: 'choice',
          question,
          options: step.options.map((label, index) => ({ id: `o${index + 1}`, label })),
        },
      },
      subject: `workflow:${runId}:${at.stepId}`,
      projectId: context.project.id,
    });
    const answer = outcome.answers.choice!;
    const index = answer.choice ? Number(answer.choice.slice(1)) - 1 : -1;
    state = {
      choice: index >= 0 ? (step.options[index] ?? null) : null,
      confidence: answer.confidence,
      decided: answer.decided,
      decisionId: answer.decisionId,
    };
  }
  const summary = state.choice
    ? `${state.choice}${percent(state.confidence)}${state.decided ? '' : ' — unsicher'}`
    : 'keine Entscheidung';
  await writeStep(runId, step, at, {
    status: 'succeeded',
    outcome: state.decided && state.choice ? state.choice : 'unsure',
    summary: clip(summary, 500),
    state: state as Record<string, unknown>,
    finishedAt: new Date(),
  });
  await bumpControlPlaneRevision(context.project.id);
  return state;
}

export const decisionStep: WorkflowStepType<Step> = {
  type: 'decision',
  ui: { builder: true, icon: 'split' },
  category: 'read',
  branching: true,
  producesResult: true,
  read(value, reader) {
    const from =
      typeof value.from === 'string' && value.from.trim() ? value.from.trim().slice(0, 40) : null;
    const rawOptions = Array.isArray(value.options) ? value.options : [];
    const options = [
      ...new Set(
        rawOptions
          .filter((option): option is string => typeof option === 'string')
          .map((option) => option.trim())
          .filter(Boolean),
      ),
    ];
    if (options.length < 2) reader.issue('too_few', 'options', { min: 2 });
    if (options.length > MAX_OPTIONS) reader.issue('too_many', 'options', { max: MAX_OPTIONS });
    for (const option of options)
      if (option.length > 200) reader.issue('too_long', 'options', { max: 200 });
    const thenOptions = (Array.isArray(value.thenOptions) ? value.thenOptions : [])
      .filter((option): option is string => typeof option === 'string')
      .map((option) => option.trim())
      .filter((option) => options.includes(option));
    if (thenOptions.length === 0) reader.issue('required', 'thenOptions');
    const unsure = reader.choice(value.unsure ?? 'else', 'unsure', [
      'else',
      'then',
      'fail',
    ] as const);
    return {
      question: from ? '' : reader.text(value.question, 'question', LIMITS.message),
      context: from ? '' : reader.text(value.context ?? '', 'context', LIMITS.text, false),
      options: options.slice(0, MAX_OPTIONS),
      thenOptions,
      unsure,
      from,
      then: [],
      else: [],
      thenEnd: false,
      elseEnd: false,
    };
  },
  templateFields: (step) => [
    { field: 'question', text: step.question },
    { field: 'context', text: step.context },
  ],
  checkDefinition(step, path) {
    if (!step.from) return [];
    const source = path.find((candidate) => candidate.id === step.from);
    if (!source || source.type !== 'decision')
      return [{ code: 'decision_source', stepId: step.id, field: 'from' }];
    const sourceOptions = (source.options as string[] | undefined) ?? [];
    if (step.options.some((option) => !sourceOptions.includes(option)))
      return [{ code: 'decision_options', stepId: step.id, field: 'options' }];
    return [];
  },
  async execute(context: StepContext<Step>) {
    const state = await context.op('decide', () =>
      evaluate(context.run.id, context.step, context.execution),
    );
    if (!state.decided || !state.choice) {
      if (context.step.unsure === 'fail')
        throw new StepFailure('The decision model was not sure enough', 'blocked');
      return { kind: 'branch', matched: context.step.unsure === 'then' };
    }
    return { kind: 'branch', matched: context.step.thenOptions.includes(state.choice) };
  },
};
