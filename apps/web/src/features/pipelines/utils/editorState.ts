import type {
  ConditionStep,
  PipelineDefinition,
  PipelineRole,
  PipelineStep,
  PipelineTrigger,
  StepKind,
  TriggerType,
} from '@/lib/api/endpoints/pipelines';

// The editor changes a draft definition through these functions. A lane is the root
// list or one branch of a condition, named by the condition's id.

export type Branch = 'then' | 'else';
export type LaneRef = { parentId: null } | { parentId: string; branch: Branch };

export const ROOT_LANE: LaneRef = { parentId: null };

// The deepest lane a condition may sit in (definition.ts LIMITS.depth).
export const MAX_CONDITION_DEPTH = 3;
export const MAX_STEPS = 50;

export function laneKey(lane: LaneRef): string {
  return lane.parentId === null ? 'root' : `${lane.parentId}:${lane.branch}`;
}

function mapLane(
  steps: PipelineStep[],
  lane: LaneRef,
  change: (lane: PipelineStep[]) => PipelineStep[],
): PipelineStep[] {
  if (lane.parentId === null) return change(steps);
  return steps.map((step) => {
    if (step.type !== 'condition') return step;
    if (step.id === lane.parentId) return { ...step, [lane.branch]: change(step[lane.branch]) };
    return {
      ...step,
      then: mapLane(step.then, lane, change),
      else: mapLane(step.else, lane, change),
    };
  });
}

export function insertStep(
  steps: PipelineStep[],
  lane: LaneRef,
  index: number,
  step: PipelineStep,
): PipelineStep[] {
  return mapLane(steps, lane, (list) => [...list.slice(0, index), step, ...list.slice(index)]);
}

// Moves a step of the lane to where `overId` is, as a drag within the lane does.
export function moveStep(
  steps: PipelineStep[],
  lane: LaneRef,
  activeId: string,
  overId: string,
): PipelineStep[] {
  return mapLane(steps, lane, (list) => {
    const from = list.findIndex((step) => step.id === activeId);
    const to = list.findIndex((step) => step.id === overId);
    if (from < 0 || to < 0 || from === to) return list;
    const next = [...list];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved!);
    return next;
  });
}

export function removeStep(steps: PipelineStep[], id: string): PipelineStep[] {
  return steps
    .filter((step) => step.id !== id)
    .map((step) =>
      step.type === 'condition'
        ? { ...step, then: removeStep(step.then, id), else: removeStep(step.else, id) }
        : step,
    );
}

export function replaceStep(steps: PipelineStep[], id: string, next: PipelineStep): PipelineStep[] {
  return steps.map((step) => {
    if (step.id === id) return next;
    if (step.type !== 'condition') return step;
    return {
      ...step,
      then: replaceStep(step.then, id, next),
      else: replaceStep(step.else, id, next),
    };
  });
}

// Every step in document order: the order a reader sees them, a condition before the
// steps of its lanes. `path` are the steps a run passed through to reach the step;
// `ancestors` the conditions around it.
export interface FlatStep {
  step: PipelineStep;
  path: PipelineStep[];
  ancestors: ConditionStep[];
}

export function flattenSteps(steps: PipelineStep[]): FlatStep[] {
  const flat: FlatStep[] = [];
  const walk = (lane: PipelineStep[], before: PipelineStep[], ancestors: ConditionStep[]) => {
    lane.forEach((step, position) => {
      const path = [...before, ...lane.slice(0, position)];
      flat.push({ step, path, ancestors });
      if (step.type === 'condition') {
        walk(step.then, [...path, step], [...ancestors, step]);
        walk(step.else, [...path, step], [...ancestors, step]);
      }
    });
  };
  walk(steps, [], []);
  return flat;
}

export function findStep(steps: PipelineStep[], id: string): PipelineStep | undefined {
  return flattenSteps(steps).find((entry) => entry.step.id === id)?.step;
}

// 1 for the root list, one more for each condition around the lane.
export function laneDepth(steps: PipelineStep[], lane: LaneRef): number {
  if (lane.parentId === null) return 1;
  const parent = flattenSteps(steps).find((entry) => entry.step.id === lane.parentId);
  return parent ? parent.ancestors.length + 2 : 1;
}

export function stepCount(steps: PipelineStep[]): number {
  return flattenSteps(steps).length;
}

// An id for a new step from its kind: 'agent', then 'agent-2', 'agent-3', …
export function uniqueStepId(kind: StepKind, steps: PipelineStep[]): string {
  const taken = new Set(flattenSteps(steps).map((entry) => entry.step.id));
  if (!taken.has(kind)) return kind;
  let n = 2;
  while (taken.has(`${kind}-${n}`)) n += 1;
  return `${kind}-${n}`;
}

// A new step with the defaults the editor offers. An agent step is given to the first
// role, the one a new workflow starts with.
export function newStep(
  kind: StepKind,
  id: string,
  name: string,
  roles: PipelineRole[],
): PipelineStep {
  switch (kind) {
    case 'agent':
      return {
        id,
        name,
        type: 'agent',
        assignee: { role: roles[0]?.key ?? '' },
        instruction: '',
        maxTurns: null,
        runBudgetSeconds: null,
        model: null,
        timeoutMinutes: 60,
      };
    case 'approval':
      return { id, name, type: 'approval', message: '', onReject: { action: 'end' } };
    case 'condition':
      return {
        id,
        name,
        type: 'condition',
        condition: { kind: 'outcome', outcomes: ['success'] },
        then: [],
        else: [],
        thenEnd: false,
        elseEnd: false,
      };
    case 'action':
      return { id, name, type: 'action', action: { kind: 'comment', body: '' } };
    case 'wait':
      return { id, name, type: 'wait', wait: { kind: 'delay', minutes: 60 } };
  }
}

// The trigger of the type with the fields it needs, empty or at a common default.
export function triggerOf(type: TriggerType): PipelineTrigger {
  switch (type) {
    case 'status_changed':
      return { type, to: null };
    case 'label_added':
      return { type, label: '' };
    case 'schedule':
      return { type, cron: '0 9 * * 1-5', timezone: 'Europe/Berlin', title: '' };
    default:
      return { type };
  }
}

const ROLE_KEY = /^[a-z][a-z0-9-]{0,31}$/;

// A role key from the role's name, unique among the roles: 'Content agent' → 'content-agent'.
export function roleKeyFor(name: string, roles: PipelineRole[]): string {
  const slug = name
    .normalize('NFKD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^[^a-z]+/, '')
    .replace(/-+$/, '')
    .slice(0, 28);
  const base = ROLE_KEY.test(slug) ? slug : 'role';
  const taken = new Set(roles.map((role) => role.key));
  if (!taken.has(base)) return base;
  let n = 2;
  while (taken.has(`${base}-${n}`)) n += 1;
  return `${base}-${n}`;
}

export function addRole(definition: PipelineDefinition, name: string): PipelineDefinition {
  const role: PipelineRole = {
    key: roleKeyFor(name, definition.roles),
    name,
    match: { type: 'none' },
  };
  return { ...definition, roles: [...definition.roles, role] };
}

export function updateRole(
  definition: PipelineDefinition,
  key: string,
  role: PipelineRole,
): PipelineDefinition {
  return {
    ...definition,
    roles: definition.roles.map((item) => (item.key === key ? role : item)),
  };
}

export function removeRole(definition: PipelineDefinition, key: string): PipelineDefinition {
  return { ...definition, roles: definition.roles.filter((role) => role.key !== key) };
}

// What a new workflow starts with: the coordinator as its one role and one agent step.
export function starterDefinition(names: {
  role: string;
  step: string;
  instruction: string;
}): PipelineDefinition {
  return {
    schemaVersion: 1,
    trigger: { type: 'manual' },
    roles: [{ key: 'coordinator', name: names.role, match: { type: 'coordinator' } }],
    steps: [
      {
        id: 'agent',
        name: names.step,
        type: 'agent',
        assignee: { role: 'coordinator' },
        instruction: names.instruction,
        maxTurns: null,
        runBudgetSeconds: null,
        model: null,
        timeoutMinutes: 60,
      },
    ],
  };
}

// A built-in template in the reader's language: its step and role names looked up by
// id and key; one without a translation keeps its own.
export function localizeDefinition(
  definition: PipelineDefinition,
  names: { step: (id: string) => string | null; role: (key: string) => string | null },
): PipelineDefinition {
  const localize = (steps: PipelineStep[]): PipelineStep[] =>
    steps.map((step) => {
      const name = names.step(step.id) ?? step.name;
      return step.type === 'condition'
        ? { ...step, name, then: localize(step.then), else: localize(step.else) }
        : { ...step, name };
    });
  return {
    ...definition,
    roles: definition.roles.map((role) => ({ ...role, name: names.role(role.key) ?? role.name })),
    steps: localize(definition.steps),
  };
}
