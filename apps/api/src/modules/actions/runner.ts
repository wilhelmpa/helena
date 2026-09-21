import { db, projectColumn } from '@repo/db';
import { eq } from 'drizzle-orm';
import { checkPermission } from '#shared/access';
import { HttpError } from '#shared/lib';
import {
  getIssue,
  getIssueFieldValues,
  setIssueLabels,
  updateIssue,
  type IssueRow,
} from '#modules/issues/service';
import { getAction, getActionRun } from './service';
import { actionMatches, parseActionEffect } from './matcher';
import {
  legacyWorkflow,
  outgoingEdge,
  validateWorkflowDefinition,
  type ActionNode,
  type WorkflowDefinition,
  type WorkflowNode,
} from './workflow';
import {
  claimActionRuns,
  createManualActionRun,
  failActionRun,
  finishActionRun,
  getCurrentActionState,
  startActionRunStep,
  finishActionRunStep,
  failActionRunStep,
  type ClaimedActionRun,
} from './queue';

interface RunOutcome {
  status: 'succeeded' | 'skipped';
  changedFields: string[];
  message?: string;
}

export async function processActionRuns(): Promise<void> {
  const runs = await claimActionRuns();
  const states = await getCurrentActionState(
    runs.flatMap((run) => (run.actionId == null ? [] : [run.actionId])),
  );
  for (const run of runs) {
    try {
      const state = run.actionId == null ? null : states.get(run.actionId);
      if (!state || !state.enabled || state.trigger !== run.trigger || state.trigger === 'manual') {
        await finishActionRun(run.id, 'skipped', [], 'Action is disabled or no longer automatic');
        continue;
      }
      const outcome = await execute(run, true);
      await finishActionRun(run.id, outcome.status, outcome.changedFields, outcome.message);
    } catch (error) {
      await failActionRun(run, error instanceof Error ? error.message : String(error));
    }
  }
}

export async function runManualAction(actionId: number, issueId: number, actorUserId: string) {
  const [action, issue] = await Promise.all([getAction(actionId), getIssue(issueId)]);
  if (!action || !issue || action.projectId !== issue.projectId)
    throw new HttpError(404, 'Action or issue not found');
  if (!action.enabled) throw new HttpError(409, 'Action is disabled');
  if (action.trigger !== 'manual')
    throw new HttpError(409, 'Automatic actions cannot be run manually');
  if (!(await checkPermission(issue.projectId, { id: actorUserId }, 'work_items', 'edit')))
    throw new HttpError(403, 'You do not have permission to edit work items');
  const run = await createManualActionRun({
    actionId,
    projectId: issue.projectId,
    issueId,
    actorUserId,
    actionName: action.name,
    columnId: issue.columnId,
    condition: action.condition,
    effect: action.effect,
    workflow: action.workflow,
  });
  try {
    const outcome = await execute(run, false);
    await finishActionRun(run.id, outcome.status, outcome.changedFields, outcome.message);
    if (outcome.status === 'skipped') throw new HttpError(409, outcome.message ?? 'Action skipped');
  } catch (error) {
    if (!(error instanceof HttpError && error.status === 409))
      await failActionRun(run, error instanceof Error ? error.message : String(error));
    throw error;
  }
  return getActionRun(run.id);
}

async function execute(run: ClaimedActionRun, automatic: boolean): Promise<RunOutcome> {
  if (!run.actorUserId)
    return {
      status: 'skipped',
      changedFields: [],
      message: 'The initiating member no longer exists',
    };
  if (!(await checkPermission(run.projectId, { id: run.actorUserId }, 'work_items', 'edit'))) {
    return {
      status: 'skipped',
      changedFields: [],
      message: 'The initiating member no longer has permission to edit work items',
    };
  }
  const issue = run.issueId == null ? null : await getIssue(run.issueId);
  if (!issue || issue.projectId !== run.projectId)
    return { status: 'skipped', changedFields: [], message: 'Work item no longer exists' };
  if (automatic && issue.columnId !== run.toColumnId) {
    return {
      status: 'skipped',
      changedFields: [],
      message: 'Work item moved again before this action ran',
    };
  }
  const workflow = workflowOf(run);
  let current: IssueRow = issue;
  let node: WorkflowNode | undefined = workflow.nodes.find(
    (candidate) => candidate.type === 'trigger',
  );
  const changedFields = new Set<string>();
  while (node) {
    const activeNode = node;
    const step = await startActionRunStep(run.id, activeNode.id, activeNode.type);
    try {
      if (activeNode.type === 'trigger') {
        if (step.execute)
          await finishActionRunStep(run.id, activeNode.id, 'succeeded', { trigger: run.trigger });
        node = targetNode(workflow, activeNode.id, 'always');
        continue;
      }
      if (activeNode.type === 'condition') {
        const recorded = step.result as { matched?: unknown } | null;
        const matched = step.execute
          ? actionMatches(
              activeNode.config,
              current,
              await columnStateType(current.columnId),
              await getIssueFieldValues(current.id),
            )
          : recorded?.matched;
        if (typeof matched !== 'boolean') throw new Error('Workflow condition result is missing');
        if (step.execute)
          await finishActionRunStep(run.id, activeNode.id, 'succeeded', { matched });
        node = targetNode(workflow, activeNode.id, matched ? 'true' : 'false');
        continue;
      }
      if (step.execute) {
        const outcome = await applyEffectNode(run, current, activeNode, automatic);
        current = outcome.issue;
        for (const field of outcome.changedFields) changedFields.add(field);
        await finishActionRunStep(
          run.id,
          activeNode.id,
          outcome.changedFields.length > 0 ? 'succeeded' : 'skipped',
          { changedFields: outcome.changedFields },
        );
      } else {
        const recorded = step.result as { changedFields?: unknown } | null;
        if (Array.isArray(recorded?.changedFields)) {
          for (const field of recorded.changedFields) {
            if (typeof field === 'string') changedFields.add(field);
          }
        }
        const refreshed = await getIssue(current.id);
        if (!refreshed)
          return { status: 'skipped', changedFields: [], message: 'Work item no longer exists' };
        current = refreshed;
      }
      node = targetNode(workflow, activeNode.id, 'always');
    } catch (error) {
      await failActionRunStep(
        run.id,
        activeNode.id,
        error instanceof Error ? error.message : String(error),
      );
      throw error;
    }
  }
  const changed = [...changedFields];
  return changed.length > 0
    ? { status: 'succeeded', changedFields: changed }
    : { status: 'skipped', changedFields: changed, message: 'Workflow made no changes' };
}

async function applyEffectNode(
  run: ClaimedActionRun,
  issue: IssueRow,
  node: ActionNode,
  automatic: boolean,
): Promise<{ issue: IssueRow; changedFields: string[] }> {
  const effect = parseActionEffect(node.config);
  if (Object.keys(effect.patch).length === 0 && effect.labelIds === undefined)
    return { issue, changedFields: [] };
  const after = await updateIssue(issue.id, effect.patch, run.actorUserId!, {
    onlyIfColumnId: issue.columnId,
    skipIfColumnFull: automatic,
    actionChain: automatic ? { rootEventId: run.rootEventId, depth: run.depth + 1 } : undefined,
  });
  if (!after) throw new Error('Work item no longer exists');
  const expectedColumnId = effect.patch.columnId ?? issue.columnId;
  if (after.columnId !== expectedColumnId) throw new Error('Work item moved concurrently');
  if (effect.labelIds !== undefined) {
    await setIssueLabels(run.projectId, issue.id, effect.labelIds, run.actorUserId!);
    after.labelIds = effect.labelIds;
  }
  return {
    issue: after,
    changedFields: changedEffectFields(issue, after, effect.labelIds !== undefined),
  };
}

function workflowOf(run: ClaimedActionRun): WorkflowDefinition {
  return run.workflow == null
    ? legacyWorkflow(run.trigger, run.condition, run.effect)
    : validateWorkflowDefinition(run.workflow);
}

function targetNode(
  workflow: WorkflowDefinition,
  nodeId: string,
  branch: 'always' | 'true' | 'false',
): WorkflowNode | undefined {
  const edge = outgoingEdge(workflow, nodeId, branch);
  return edge ? workflow.nodes.find((node) => node.id === edge.target) : undefined;
}

export async function previewAction(
  actionId: number,
  issueId: number,
  actorUserId: string,
  proposed?: unknown,
) {
  const [action, issue] = await Promise.all([getAction(actionId), getIssue(issueId)]);
  if (!action || !issue || action.projectId !== issue.projectId)
    throw new HttpError(404, 'Action or issue not found');
  if (!(await checkPermission(issue.projectId, { id: actorUserId }, 'work_items', 'read')))
    throw new HttpError(403, 'You do not have permission to read work items');
  const workflow = proposed == null ? action.workflow : validateWorkflowDefinition(proposed);
  let current = { ...issue, labelIds: [...issue.labelIds] };
  let node: WorkflowNode | undefined = workflow.nodes.find(
    (candidate) => candidate.type === 'trigger',
  );
  const path: { nodeId: string; type: WorkflowNode['type']; outcome: string }[] = [];
  const effects: Record<string, unknown>[] = [];
  let matched = true;
  while (node) {
    if (node.type === 'trigger') {
      path.push({ nodeId: node.id, type: node.type, outcome: node.config.trigger });
      node = targetNode(workflow, node.id, 'always');
      continue;
    }
    if (node.type === 'condition') {
      const [stateType, fields] = await Promise.all([
        columnStateType(current.columnId),
        getIssueFieldValues(current.id),
      ]);
      matched = actionMatches(node.config, current, stateType, fields);
      path.push({ nodeId: node.id, type: node.type, outcome: matched ? 'true' : 'false' });
      node = targetNode(workflow, node.id, matched ? 'true' : 'false');
      continue;
    }
    const effect = parseActionEffect(node.config);
    effects.push(node.config);
    current = { ...current, ...effect.patch, labelIds: effect.labelIds ?? current.labelIds };
    path.push({ nodeId: node.id, type: node.type, outcome: 'would_apply' });
    node = targetNode(workflow, node.id, 'always');
  }
  return { matched, path, effects };
}

async function columnStateType(columnId: number): Promise<string | null> {
  const [row] = await db
    .select({ stateType: projectColumn.stateType })
    .from(projectColumn)
    .where(eq(projectColumn.id, columnId));
  return row?.stateType ?? null;
}

function changedEffectFields(before: IssueRow, after: IssueRow, labelsSet: boolean): string[] {
  const fields: (keyof IssueRow)[] = [
    'columnId',
    'assigneeUserId',
    'priority',
    'typeId',
    'startDate',
    'dueDate',
  ];
  const changed = fields.filter((field) => before[field] !== after[field]).map(String);
  if (labelsSet && !sameNumbers(before.labelIds, after.labelIds)) changed.push('labelIds');
  return changed;
}

function sameNumbers(left: number[], right: number[]): boolean {
  return [...left].sort((a, b) => a - b).join(',') === [...right].sort((a, b) => a - b).join(',');
}
