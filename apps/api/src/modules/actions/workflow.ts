export type WorkflowTrigger = 'manual' | 'issue_state_changed' | 'issue_comment_added';
export type WorkflowBranch = 'always' | 'true' | 'false';
export type WorkflowFilterValue = string | number | boolean | null;
export type WorkflowFilterOperator =
  'is' | 'is_not' | 'before' | 'after' | 'is_set' | 'is_not_set' | 'contains' | 'not_contains';

export interface WorkflowCondition {
  id: string;
  field: string;
  op: WorkflowFilterOperator;
  values: WorkflowFilterValue[];
}

export interface TriggerNode {
  id: string;
  type: 'trigger';
  config: { trigger: WorkflowTrigger };
  position: { x: number; y: number };
}

export interface ConditionNode {
  id: string;
  type: 'condition';
  config: { conditions: WorkflowCondition[] };
  position: { x: number; y: number };
}

export interface ActionNode {
  id: string;
  type: 'action';
  config: {
    columnId?: number;
    assigneeUserId?: string | null;
    priority?: 'low' | 'medium' | 'high' | 'urgent' | null;
    typeId?: number | null;
    startDate?: string | null;
    dueDate?: string | null;
    labelIds?: number[];
  };
  position: { x: number; y: number };
}

export type WorkflowNode = TriggerNode | ConditionNode | ActionNode;

export interface WorkflowEdge {
  id: string;
  source: string;
  target: string;
  branch: WorkflowBranch;
}

export interface WorkflowDefinition {
  version: 1;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
}

export class WorkflowValidationError extends Error {}

const ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const CONDITION_FIELDS =
  /^(status|statusType|assignee|delegate|priority|type|initiative|cycle|labels|dueDate|startDate|created|updated|cf:[0-9]+)$/;
const CONDITION_OPS = new Set([
  'is',
  'is_not',
  'before',
  'after',
  'is_set',
  'is_not_set',
  'contains',
  'not_contains',
]);
const EFFECT_KEYS = new Set([
  'columnId',
  'assigneeUserId',
  'priority',
  'typeId',
  'startDate',
  'dueDate',
  'labelIds',
]);

export function validateWorkflowDefinition(raw: unknown): WorkflowDefinition {
  if (!isRecord(raw) || raw.version !== 1 || !Array.isArray(raw.nodes) || !Array.isArray(raw.edges))
    throw new WorkflowValidationError('Workflow must be a version 1 graph');
  if (JSON.stringify(raw).length > 64_000)
    throw new WorkflowValidationError('Workflow is too large');
  if (raw.nodes.length < 2 || raw.nodes.length > 24)
    throw new WorkflowValidationError('Workflow must contain between 2 and 24 nodes');
  if (raw.edges.length < 1 || raw.edges.length > 48)
    throw new WorkflowValidationError('Workflow must contain between 1 and 48 edges');

  const nodes = raw.nodes.map(validateNode);
  const nodeIds = new Set(nodes.map((node) => node.id));
  if (nodeIds.size !== nodes.length)
    throw new WorkflowValidationError('Workflow node ids must be unique');
  const triggers = nodes.filter((node): node is TriggerNode => node.type === 'trigger');
  if (triggers.length !== 1) throw new WorkflowValidationError('Workflow must contain one trigger');
  if (!nodes.some((node) => node.type === 'action'))
    throw new WorkflowValidationError('Workflow must contain at least one action');

  const edges = raw.edges.map((edge) => validateEdge(edge, nodeIds));
  if (new Set(edges.map((edge) => edge.id)).size !== edges.length)
    throw new WorkflowValidationError('Workflow edge ids must be unique');
  const incoming = new Map<string, number>();
  const outgoing = new Map<string, WorkflowEdge[]>();
  for (const edge of edges) {
    incoming.set(edge.target, (incoming.get(edge.target) ?? 0) + 1);
    outgoing.set(edge.source, [...(outgoing.get(edge.source) ?? []), edge]);
  }
  if (incoming.has(triggers[0].id))
    throw new WorkflowValidationError('Trigger cannot have an incoming edge');
  for (const node of nodes) {
    const count = incoming.get(node.id) ?? 0;
    if (node.type !== 'trigger' && count !== 1)
      throw new WorkflowValidationError('Every non-trigger node must have one incoming edge');
    const branches = outgoing.get(node.id) ?? [];
    if (node.type === 'condition') {
      if (branches.some((edge) => edge.branch === 'always'))
        throw new WorkflowValidationError('Condition edges must use true or false branches');
      if (new Set(branches.map((edge) => edge.branch)).size !== branches.length)
        throw new WorkflowValidationError('Condition branches must be unique');
    } else if (branches.length > 1 || branches.some((edge) => edge.branch !== 'always')) {
      throw new WorkflowValidationError('Trigger and action nodes may have one always edge');
    }
  }
  assertAcyclicAndReachable(triggers[0].id, nodes, outgoing);
  return { version: 1, nodes, edges };
}

export function legacyWorkflow(
  trigger: WorkflowTrigger,
  condition: unknown,
  effect: unknown,
): WorkflowDefinition {
  return validateWorkflowDefinition({
    version: 1,
    nodes: [
      { id: 'trigger', type: 'trigger', config: { trigger }, position: { x: 0, y: 0 } },
      {
        id: 'condition',
        type: 'condition',
        config: normalizeCondition(condition),
        position: { x: 0, y: 160 },
      },
      {
        id: 'action',
        type: 'action',
        config: normalizeEffect(effect),
        position: { x: 0, y: 320 },
      },
    ],
    edges: [
      { id: 'trigger-condition', source: 'trigger', target: 'condition', branch: 'always' },
      { id: 'condition-action', source: 'condition', target: 'action', branch: 'true' },
    ],
  });
}

export function workflowTrigger(workflow: WorkflowDefinition): WorkflowTrigger {
  return (
    workflow.nodes.find((node): node is TriggerNode => node.type === 'trigger') as TriggerNode
  ).config.trigger;
}

export function workflowLegacyFields(workflow: WorkflowDefinition): {
  condition: ConditionNode['config'];
  effect: ActionNode['config'];
} {
  return {
    condition: workflow.nodes.find((node): node is ConditionNode => node.type === 'condition')
      ?.config ?? { conditions: [] },
    effect: workflow.nodes.find((node): node is ActionNode => node.type === 'action')?.config ?? {},
  };
}

export function outgoingEdge(
  workflow: WorkflowDefinition,
  nodeId: string,
  branch: WorkflowBranch,
): WorkflowEdge | undefined {
  return workflow.edges.find((edge) => edge.source === nodeId && edge.branch === branch);
}

function validateNode(raw: unknown): WorkflowNode {
  if (!isRecord(raw) || typeof raw.id !== 'string' || !ID.test(raw.id))
    throw new WorkflowValidationError('Workflow node id is invalid');
  if (!isPosition(raw.position))
    throw new WorkflowValidationError('Workflow node position is invalid');
  if (raw.type === 'trigger') {
    if (
      !isRecord(raw.config) ||
      !['manual', 'issue_state_changed', 'issue_comment_added'].includes(String(raw.config.trigger))
    )
      throw new WorkflowValidationError('Workflow trigger is invalid');
    return {
      id: raw.id,
      type: 'trigger',
      config: { trigger: raw.config.trigger as WorkflowTrigger },
      position: raw.position,
    };
  }
  if (raw.type === 'condition') {
    return {
      id: raw.id,
      type: 'condition',
      config: validateCondition(raw.config),
      position: raw.position,
    };
  }
  if (raw.type === 'action') {
    return {
      id: raw.id,
      type: 'action',
      config: validateEffect(raw.config),
      position: raw.position,
    };
  }
  throw new WorkflowValidationError('Workflow node type is invalid');
}

function validateCondition(raw: unknown): ConditionNode['config'] {
  if (!isRecord(raw) || !Array.isArray(raw.conditions) || raw.conditions.length > 25)
    throw new WorkflowValidationError('Condition node is invalid');
  return {
    conditions: raw.conditions.map((entry) => {
      if (!isRecord(entry)) throw new WorkflowValidationError('Condition is invalid');
      if (typeof entry.id !== 'string' || !ID.test(entry.id))
        throw new WorkflowValidationError('Condition id is invalid');
      if (typeof entry.field !== 'string' || !CONDITION_FIELDS.test(entry.field))
        throw new WorkflowValidationError('Condition field is invalid');
      if (typeof entry.op !== 'string' || !CONDITION_OPS.has(entry.op))
        throw new WorkflowValidationError('Condition operator is invalid');
      if (!Array.isArray(entry.values) || entry.values.length > 50)
        throw new WorkflowValidationError('Condition values are invalid');
      for (const value of entry.values) {
        if (
          value !== null &&
          typeof value !== 'boolean' &&
          typeof value !== 'number' &&
          (typeof value !== 'string' || value.length > 500)
        )
          throw new WorkflowValidationError('Condition value is invalid');
      }
      return {
        id: entry.id,
        field: entry.field,
        op: entry.op as WorkflowFilterOperator,
        values: entry.values as WorkflowFilterValue[],
      };
    }),
  };
}

function validateEffect(raw: unknown): ActionNode['config'] {
  if (!isRecord(raw)) throw new WorkflowValidationError('Action node is invalid');
  for (const key of Object.keys(raw)) {
    if (!EFFECT_KEYS.has(key))
      throw new WorkflowValidationError(`Action field ${key} is not allowed`);
  }
  if (raw.columnId !== undefined && (!Number.isInteger(raw.columnId) || Number(raw.columnId) < 1))
    throw new WorkflowValidationError('Action status is invalid');
  if (
    raw.assigneeUserId !== undefined &&
    raw.assigneeUserId !== null &&
    (typeof raw.assigneeUserId !== 'string' || raw.assigneeUserId.length > 100)
  )
    throw new WorkflowValidationError('Action assignee is invalid');
  if (
    raw.priority !== undefined &&
    raw.priority !== null &&
    !['low', 'medium', 'high', 'urgent'].includes(String(raw.priority))
  )
    throw new WorkflowValidationError('Action priority is invalid');
  if (raw.typeId !== undefined && raw.typeId !== null && !Number.isInteger(raw.typeId))
    throw new WorkflowValidationError('Action type is invalid');
  for (const key of ['startDate', 'dueDate']) {
    const value = raw[key];
    if (value !== undefined && value !== null && (typeof value !== 'string' || value.length > 32))
      throw new WorkflowValidationError(`Action ${key} is invalid`);
  }
  if (
    raw.labelIds !== undefined &&
    (!Array.isArray(raw.labelIds) ||
      raw.labelIds.length > 50 ||
      raw.labelIds.some((value) => !Number.isInteger(value) || Number(value) < 1))
  )
    throw new WorkflowValidationError('Action labels are invalid');
  return raw as ActionNode['config'];
}

function validateEdge(raw: unknown, nodeIds: Set<string>): WorkflowEdge {
  if (!isRecord(raw) || typeof raw.id !== 'string' || !ID.test(raw.id))
    throw new WorkflowValidationError('Workflow edge id is invalid');
  if (typeof raw.source !== 'string' || typeof raw.target !== 'string')
    throw new WorkflowValidationError('Workflow edge endpoint is invalid');
  if (!nodeIds.has(raw.source) || !nodeIds.has(raw.target) || raw.source === raw.target)
    throw new WorkflowValidationError('Workflow edge endpoint does not exist');
  if (!['always', 'true', 'false'].includes(String(raw.branch)))
    throw new WorkflowValidationError('Workflow edge branch is invalid');
  return {
    id: raw.id,
    source: raw.source,
    target: raw.target,
    branch: raw.branch as WorkflowBranch,
  };
}

function assertAcyclicAndReachable(
  root: string,
  nodes: WorkflowNode[],
  outgoing: Map<string, WorkflowEdge[]>,
): void {
  const visited = new Set<string>();
  const active = new Set<string>();
  const visit = (id: string) => {
    if (active.has(id)) throw new WorkflowValidationError('Workflow must be acyclic');
    if (visited.has(id)) return;
    active.add(id);
    for (const edge of outgoing.get(id) ?? []) visit(edge.target);
    active.delete(id);
    visited.add(id);
  };
  visit(root);
  if (visited.size !== nodes.length)
    throw new WorkflowValidationError('Every workflow node must be reachable from the trigger');
}

function normalizeCondition(raw: unknown): ConditionNode['config'] {
  return isRecord(raw) && Array.isArray(raw.conditions)
    ? { conditions: raw.conditions as WorkflowCondition[] }
    : { conditions: [] };
}

function normalizeEffect(raw: unknown): ActionNode['config'] {
  return isRecord(raw) ? (raw as ActionNode['config']) : {};
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isPosition(value: unknown): value is { x: number; y: number } {
  return (
    isRecord(value) &&
    typeof value.x === 'number' &&
    Number.isFinite(value.x) &&
    Math.abs(value.x) <= 10_000 &&
    typeof value.y === 'number' &&
    Number.isFinite(value.y) &&
    Math.abs(value.y) <= 10_000
  );
}
