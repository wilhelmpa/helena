import type { IssueFieldValueRow, IssuePatch, IssueRow } from '#modules/issues/service';

type FilterValue = string | number | boolean | null;
type Operator =
  'is' | 'is_not' | 'before' | 'after' | 'is_set' | 'is_not_set' | 'contains' | 'not_contains';

interface Condition {
  field: string;
  op: Operator;
  values: FilterValue[];
}

export interface ParsedActionEffect {
  patch: IssuePatch;
  labelIds?: number[];
}

export function actionMatches(
  raw: unknown,
  issue: IssueRow,
  stateType: string | null,
  fields: IssueFieldValueRow[],
): boolean {
  const conditions = conditionsOf(raw).filter(effective);
  return conditions.every((condition) => matches(condition, issue, stateType, fields));
}

export function parseActionEffect(raw: unknown): ParsedActionEffect {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { patch: {} };
  const value = raw as Record<string, unknown>;
  const patch: IssuePatch = {};
  if (Number.isInteger(value.columnId)) patch.columnId = value.columnId as number;
  if (typeof value.assigneeUserId === 'string' || value.assigneeUserId === null)
    patch.assigneeUserId = value.assigneeUserId;
  if (typeof value.priority === 'string' || value.priority === null)
    patch.priority = value.priority;
  if (Number.isInteger(value.typeId) || value.typeId === null)
    patch.typeId = value.typeId as number | null;
  if (typeof value.startDate === 'string' || value.startDate === null)
    patch.startDate = value.startDate;
  if (typeof value.dueDate === 'string' || value.dueDate === null) patch.dueDate = value.dueDate;
  const labelIds = Array.isArray(value.labelIds)
    ? value.labelIds.filter((id): id is number => Number.isInteger(id))
    : undefined;
  return { patch, labelIds };
}

function conditionsOf(raw: unknown): Condition[] {
  if (!raw || typeof raw !== 'object') return [];
  const rows = (raw as { conditions?: unknown }).conditions;
  if (!Array.isArray(rows)) return [];
  return rows.flatMap((row): Condition[] => {
    if (!row || typeof row !== 'object') return [];
    const value = row as { field?: unknown; op?: unknown; values?: unknown };
    if (typeof value.field !== 'string' || !isOperator(value.op) || !Array.isArray(value.values))
      return [];
    return [{ field: value.field, op: value.op, values: value.values as FilterValue[] }];
  });
}

function isOperator(value: unknown): value is Operator {
  return [
    'is',
    'is_not',
    'before',
    'after',
    'is_set',
    'is_not_set',
    'contains',
    'not_contains',
  ].includes(String(value));
}

function effective(condition: Condition): boolean {
  return ['is_set', 'is_not_set'].includes(condition.op) || condition.values.length > 0;
}

function matches(
  condition: Condition,
  issue: IssueRow,
  stateType: string | null,
  fields: IssueFieldValueRow[],
): boolean {
  const values = valuesFor(condition.field, issue, stateType, fields);
  if (condition.op === 'is_set' || condition.op === 'is_not_set') {
    const present = values.some((value) => value !== null && value !== '');
    return condition.op === 'is_set' ? present : !present;
  }
  if (condition.op === 'before' || condition.op === 'after') {
    const current = typeof values[0] === 'string' ? day(values[0]) : null;
    const target = typeof condition.values[0] === 'string' ? day(condition.values[0]) : null;
    if (!current || !target) return false;
    return condition.op === 'before' ? current < target : current > target;
  }
  if (condition.op === 'contains' || condition.op === 'not_contains') {
    const current = typeof values[0] === 'string' ? values[0].toLowerCase() : '';
    const needle = typeof condition.values[0] === 'string' ? condition.values[0].toLowerCase() : '';
    const found = needle.length > 0 && current.includes(needle);
    return condition.op === 'contains' ? found : !found;
  }
  const overlaps = condition.values.some((value) => values.includes(value));
  return condition.op === 'is' ? overlaps : !overlaps;
}

function valuesFor(
  field: string,
  issue: IssueRow,
  stateType: string | null,
  fields: IssueFieldValueRow[],
): FilterValue[] {
  if (field.startsWith('cf:')) {
    const id = Number(field.slice(3));
    const entry = fields.find((candidate) => candidate.fieldId === id);
    if (!entry) return [null];
    return entry.optionIds.length > 0 ? entry.optionIds : [entry.value];
  }
  switch (field) {
    case 'status':
      return [issue.columnId];
    case 'statusType':
      return [stateType];
    case 'assignee':
      return [issue.assigneeUserId];
    case 'delegate':
      return [issue.delegateUserId];
    case 'priority':
      return [issue.priority];
    case 'type':
      return [issue.typeId];
    case 'initiative':
      return issue.initiative ? [issue.initiative.id, `status:${issue.initiative.status}`] : [null];
    case 'cycle':
      return issue.cycle ? [issue.cycle.id, `status:${issue.cycle.status}`] : [null];
    case 'labels':
      return issue.labelIds.length > 0 ? issue.labelIds : [null];
    case 'dueDate':
      return [issue.dueDate];
    case 'startDate':
      return [issue.startDate];
    case 'created':
      return [issue.createdAt];
    case 'updated':
      return [issue.updatedAt];
    default:
      return [null];
  }
}

function day(value: string): string | null {
  const matched = /^\d{4}-\d{2}-\d{2}/.exec(value);
  return matched?.[0] ?? null;
}
