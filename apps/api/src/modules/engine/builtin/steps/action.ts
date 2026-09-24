import { db, issueActivity, pipelineRunStep } from '@repo/db';
import { sql } from 'drizzle-orm';
import { HttpError } from '#shared/lib';
import { createIssue, setIssueLabels, updateIssue, type IssueRow } from '#modules/issues/service';
import { bumpControlPlaneRevision } from '#modules/sync/service';
import { LIMITS, type ActionStep, type TaskAction } from '#modules/pipelines/definition';
import { resolveRoles } from '#modules/pipelines/project-context';
import { renderTemplate } from '#modules/pipelines/render';
import {
  clip,
  loadRun,
  projectContext,
  renderContext,
  same,
  setRunStatus,
  stepRow,
  writeStep,
  WORKFLOW_ACTOR,
  type RunContext,
} from '../../run-context';
import {
  StepFailure,
  type FieldReader,
  type StepContext,
  type StepExecution,
  type WorkflowStepType,
} from '../../sdk';

// A task action: sets the status, labels or assignee of the run's task, adds a comment
// or creates a subtask, as the system actor `Workflow`. A change a workflow makes starts
// no workflow.

type Step = ActionStep & { [field: string]: unknown };

function readAction(raw: unknown, reader: FieldReader): TaskAction {
  const value = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : null;
  const kind = reader.choice(value?.kind, 'action.kind', [
    'set_status',
    'add_labels',
    'remove_labels',
    'set_assignee',
    'comment',
    'create_subtask',
  ] as const);
  switch (kind) {
    case 'set_status':
      return { kind, status: reader.text(value?.status, 'action.status', LIMITS.name) };
    case 'add_labels':
    case 'remove_labels':
      return { kind, labels: reader.names(value?.labels, 'action.labels') };
    case 'set_assignee': {
      const assignee =
        value?.assignee && typeof value.assignee === 'object'
          ? (value.assignee as Record<string, unknown>)
          : null;
      if (value?.assignee === null) return { kind, assignee: null };
      if (typeof assignee?.role === 'string') return { kind, assignee: { role: assignee.role } };
      if (typeof assignee?.userId === 'string' && assignee.userId.length <= 100)
        return { kind, assignee: { userId: assignee.userId } };
      reader.issue('required', 'action.assignee');
      return { kind, assignee: null };
    }
    case 'comment':
      return { kind, body: reader.text(value?.body, 'action.body', LIMITS.text) };
    case 'create_subtask':
      return {
        kind,
        title: reader.text(value?.title, 'action.title', 300),
        description: reader.text(
          value?.description ?? '',
          'action.description',
          LIMITS.text,
          false,
        ),
      };
  }
}

function describeAction(step: ActionStep): string {
  const { action } = step;
  switch (action.kind) {
    case 'set_status':
      return `Set the status to ${action.status}`;
    case 'add_labels':
      return `Add the labels ${action.labels.join(', ')}`;
    case 'remove_labels':
      return `Remove the labels ${action.labels.join(', ')}`;
    case 'set_assignee':
      return action.assignee ? 'Set the assignee' : 'Remove the assignee';
    case 'comment':
      return 'Add a comment';
    case 'create_subtask':
      return `Create the subtask "${action.title}"`;
  }
}

class StepExists extends Error {}

// Inserts the finished row of the execution together with what it writes, so the write
// happens exactly when its row is new.
async function onceWithRow(
  runId: string,
  step: ActionStep,
  at: StepExecution,
  summary: string,
  write: (tx: Parameters<Parameters<typeof db.transaction>[0]>[0]) => Promise<void>,
): Promise<void> {
  try {
    await db.transaction(async (tx) => {
      const [existing] = await tx
        .select({ status: pipelineRunStep.status })
        .from(pipelineRunStep)
        .where(
          sql`${pipelineRunStep.runId} = ${runId} AND ${pipelineRunStep.stepId} = ${at.stepId} AND ${pipelineRunStep.iteration} = ${at.iteration}`,
        )
        .for('update');
      if (existing?.status === 'succeeded') throw new StepExists();
      await write(tx);
      await writeStep(
        runId,
        step,
        at,
        { status: 'succeeded', outcome: 'success', summary: clip(summary), finishedAt: new Date() },
        tx,
      );
    });
  } catch (error) {
    if (!(error instanceof StepExists)) throw error;
  }
}

async function applyAction(
  context: RunContext,
  step: ActionStep,
  at: StepExecution,
  task: IssueRow,
): Promise<string> {
  const runId = context.run.id;
  const { action } = step;
  const variables = await renderContext(context, at.seq);
  const projectData = await projectContext(context);
  const done = (summary: string) =>
    writeStep(runId, step, at, {
      status: 'succeeded',
      outcome: 'success',
      summary,
      finishedAt: new Date(),
    }).then(() => summary);
  switch (action.kind) {
    case 'set_status': {
      const column = projectData.statuses.find((status) => same(status.name, action.status));
      if (!column) throw new StepFailure(`The project has no status ${action.status}`);
      if (task.columnId !== column.id)
        await updateIssue(task.id, { columnId: column.id }, WORKFLOW_ACTOR);
      return done(`Status set to ${column.name}`);
    }
    case 'add_labels':
    case 'remove_labels': {
      const named = projectData.labels.filter((item) =>
        action.labels.some((name) => same(name, item.name)),
      );
      const ids = new Set(task.labelIds);
      for (const item of named)
        if (action.kind === 'add_labels') ids.add(item.id);
        else ids.delete(item.id);
      await setIssueLabels(context.project.id, task.id, [...ids], null);
      const names = named.map((item) => item.name).join(', ') || '-';
      return done(
        action.kind === 'add_labels' ? `Labels added: ${names}` : `Labels removed: ${names}`,
      );
    }
    case 'set_assignee': {
      const { assignee } = action;
      let userId: string | null = null;
      if (assignee && 'role' in assignee) {
        const role = resolveRoles(context.definition.roles, context.roles, projectData).find(
          (item) => item.key === assignee.role,
        );
        if (!role?.agent)
          throw new StepFailure(`No agent of the project fills the role ${assignee.role}`);
        userId = role.agent.userId;
      } else if (assignee) {
        if (!projectData.members.some((member) => member.id === assignee.userId))
          throw new StepFailure('The assignee is not a member of this project');
        userId = assignee.userId;
      }
      await updateIssue(task.id, { assigneeUserId: userId }, WORKFLOW_ACTOR);
      return done(userId ? 'Assignee set' : 'Assignee removed');
    }
    case 'comment': {
      const body = renderTemplate(action.body, variables);
      await onceWithRow(runId, step, at, body, async (tx) => {
        await tx.insert(issueActivity).values({
          issueId: task.id,
          kind: 'comment',
          actorName: `Workflow: ${context.name}`,
          body,
        });
      });
      return clip(body);
    }
    case 'create_subtask': {
      const unstarted = projectData.statuses.find((status) => status.stateType === 'unstarted');
      if (!unstarted) throw new StepFailure('Project has no unstarted state');
      const title = renderTemplate(action.title, variables).slice(0, 300) || step.name;
      const summary = `Subtask created: ${title}`;
      try {
        await createIssue(
          context.project,
          {
            columnId: unstarted.id,
            title,
            description: renderTemplate(action.description, variables),
            parentId: task.parentId ?? task.id,
          },
          null,
          {
            fromWorkflow: true,
            afterInsert: async (tx) => {
              const [existing] = await tx
                .select({ status: pipelineRunStep.status })
                .from(pipelineRunStep)
                .where(
                  sql`${pipelineRunStep.runId} = ${runId} AND ${pipelineRunStep.stepId} = ${at.stepId} AND ${pipelineRunStep.iteration} = ${at.iteration}`,
                )
                .for('update');
              if (existing?.status === 'succeeded') throw new StepExists();
              await writeStep(
                runId,
                step,
                at,
                { status: 'succeeded', outcome: 'success', summary, finishedAt: new Date() },
                tx,
              );
            },
          },
        );
      } catch (error) {
        if (!(error instanceof StepExists)) throw error;
      }
      return summary;
    }
  }
}

async function apply(runId: string, step: ActionStep, at: StepExecution): Promise<string> {
  const existing = await stepRow(runId, at);
  if (existing && ['succeeded', 'simulated'].includes(existing.status))
    return existing.summary ?? '';
  const context = await loadRun(runId);
  if (!context.task) throw new StepFailure('The workflow run has no task');
  let summary: string;
  if (context.run.dryRun) {
    summary = describeAction(step);
    await writeStep(runId, step, at, {
      status: 'simulated',
      outcome: 'success',
      summary,
      finishedAt: new Date(),
    });
  } else {
    await setRunStatus(runId, 'running');
    try {
      summary = await applyAction(context, step, at, context.task);
    } catch (error) {
      if (error instanceof HttpError && error.status < 500) throw new StepFailure(error.message);
      throw error;
    }
  }
  await bumpControlPlaneRevision(context.project.id);
  return summary;
}

export const actionStep: WorkflowStepType<Step> = {
  type: 'action',
  ui: { builder: true, icon: 'zap' },
  category: 'write',
  producesResult: true,
  read(value, reader, scope) {
    const action = readAction(value.action, reader);
    if (
      action.kind === 'set_assignee' &&
      action.assignee &&
      'userId' in action.assignee &&
      scope.template
    )
      reader.issue('member_in_template', 'action.assignee');
    return { action };
  },
  templateFields(step) {
    if (step.action.kind === 'comment') return [{ field: 'action.body', text: step.action.body }];
    if (step.action.kind === 'create_subtask')
      return [
        { field: 'action.title', text: step.action.title },
        { field: 'action.description', text: step.action.description },
      ];
    return [];
  },
  roleReferences: (step) =>
    step.action.kind === 'set_assignee' && step.action.assignee && 'role' in step.action.assignee
      ? [{ field: 'action.assignee', role: step.action.assignee.role }]
      : [],
  async execute(context: StepContext<Step>) {
    const summary = await context.op('apply', () =>
      apply(context.run.id, context.step, context.execution),
    );
    return { kind: 'continue', outcome: 'success', summary };
  },
};
