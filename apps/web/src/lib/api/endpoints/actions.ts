import type { FilterSet } from '@/utils/filters';
import { request } from '@/lib/api/core/client';
import type { IssuePatch } from '@/lib/api/endpoints/issues';

// A manual action: a saved macro on a project. `condition` is a FilterSet (empty
// = always available) that decides which issues the action shows on; `effect`
// is a partial issue patch over built-in fields applied in one update when the
// action runs. A present effect key sets that field (value may be null); an
// absent key leaves it unchanged.
export type ActionEffect = Pick<
  IssuePatch,
  'columnId' | 'assigneeUserId' | 'priority' | 'typeId' | 'startDate' | 'dueDate' | 'labelIds'
>;

export type WorkflowTrigger = 'manual' | 'issue_state_changed' | 'issue_comment_added';
export type WorkflowBranch = 'always' | 'true' | 'false';
export type WorkflowNode =
  | {
      id: string;
      type: 'trigger';
      config: { trigger: WorkflowTrigger };
      position: { x: number; y: number };
    }
  | {
      id: string;
      type: 'condition';
      config: FilterSet;
      position: { x: number; y: number };
    }
  | {
      id: string;
      type: 'action';
      config: ActionEffect;
      position: { x: number; y: number };
    };

export interface WorkflowDefinition {
  version: 1;
  nodes: WorkflowNode[];
  edges: { id: string; source: string; target: string; branch: WorkflowBranch }[];
}

export interface ActionDef {
  id: number;
  projectId: number;
  name: string;
  icon: string;
  enabled: boolean;
  trigger: WorkflowTrigger;
  condition: FilterSet;
  effect: ActionEffect;
  workflow: WorkflowDefinition;
  position: number;
  createdAt: string;
}

export interface NewActionInput {
  name: string;
  icon?: string;
  enabled?: boolean;
  trigger?: ActionDef['trigger'];
  condition?: FilterSet;
  effect?: ActionEffect;
  workflow?: WorkflowDefinition;
}

export interface ActionPatch {
  name?: string;
  icon?: string;
  enabled?: boolean;
  trigger?: ActionDef['trigger'];
  condition?: FilterSet;
  effect?: ActionEffect;
  workflow?: WorkflowDefinition;
}

// The action list any project member may read; the permissioned list route is
// for API/MCP callers.
export const listQuickActions = (projectKey: string) =>
  request<ActionDef[]>(`/projects/${projectKey}/actions/quick`);

export const createAction = (projectKey: string, input: NewActionInput) =>
  request<ActionDef>(`/projects/${projectKey}/actions`, {
    method: 'POST',
    body: JSON.stringify(input),
  });

export const updateAction = (actionId: number, patch: ActionPatch) =>
  request<ActionDef>(`/actions/${actionId}`, { method: 'PATCH', body: JSON.stringify(patch) });

export const deleteAction = (actionId: number) =>
  request<void>(`/actions/${actionId}`, { method: 'DELETE' });

export const reorderActions = (projectKey: string, orderedIds: number[]) =>
  request<ActionDef[]>(`/projects/${projectKey}/actions/reorder`, {
    method: 'PUT',
    body: JSON.stringify({ orderedIds }),
  });

export interface ActionRun {
  id: string;
  actionId: number | null;
  projectId: number;
  issueId: number | null;
  issueIdentifier: string | null;
  actorUserId: string | null;
  actorName: string | null;
  actionName: string;
  trigger: ActionDef['trigger'];
  fromColumnId: number;
  fromColumnName: string | null;
  toColumnId: number;
  toColumnName: string | null;
  depth: number;
  status: 'pending' | 'running' | 'succeeded' | 'skipped' | 'failed';
  attempts: number;
  lastError: string | null;
  result: { changedFields: string[] } | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
  steps?: ActionRunStep[];
}

export interface ActionRunStep {
  nodeId: string;
  nodeType: WorkflowNode['type'];
  status: ActionRun['status'];
  result: unknown;
  lastError: string | null;
  startedAt: string | null;
  finishedAt: string | null;
}

export interface ActionPreview {
  matched: boolean;
  path: { nodeId: string; type: WorkflowNode['type']; outcome: string }[];
  effects: ActionEffect[];
}

export const listActionRuns = (projectKey: string) =>
  request<ActionRun[]>(`/projects/${projectKey}/action-runs`);

export const runAction = (actionId: number, issueId: number) =>
  request<ActionRun>(`/actions/${actionId}/run`, {
    method: 'POST',
    body: JSON.stringify({ issueId }),
  });

export const getActionRun = (runId: string) => request<ActionRun>(`/action-runs/${runId}`);

export const previewAction = (actionId: number, issueId: number, workflow: WorkflowDefinition) =>
  request<ActionPreview>(`/actions/${actionId}/preview`, {
    method: 'POST',
    body: JSON.stringify({ issueId, workflow }),
  });
