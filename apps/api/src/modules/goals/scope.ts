// Which goals an agent sees and how they read in its context (docs/helena-decisions/
// agent-context.md §7). Pure, so the rules are tested without a database.

export type GoalStatus = 'planned' | 'active' | 'achieved' | 'paused';
export const GOAL_STATUSES: GoalStatus[] = ['planned', 'active', 'achieved', 'paused'];

export interface ScopedGoal {
  id: number;
  title: string;
  description: string;
  status: GoalStatus;
  departmentId: number | null;
  projectId: number | null;
  parentGoalId: number | null;
  targetDate: string | null;
}

export interface DepartmentRef {
  id: number;
  parentId: number | null;
}

// The departments of the agent's projects with every department above them: a goal of
// "Volition" is also a goal of its sub-departments' projects.
export function departmentsWithAncestors(
  departmentIds: Iterable<number>,
  departments: DepartmentRef[],
): Set<number> {
  const parents = new Map(departments.map((department) => [department.id, department.parentId]));
  const found = new Set<number>();
  for (const start of departmentIds) {
    let current: number | null | undefined = start;
    while (current != null && !found.has(current)) {
      found.add(current);
      current = parents.get(current);
    }
  }
  return found;
}

// A goal concerns the agent when it names one of the agent's projects, or, without a
// project, one of their departments, or neither (a goal of the whole team).
export function concernsAgent(
  goal: Pick<ScopedGoal, 'projectId' | 'departmentId'>,
  scope: { projectIds: Set<number>; departmentIds: Set<number> },
): boolean {
  if (goal.projectId != null) return scope.projectIds.has(goal.projectId);
  if (goal.departmentId != null) return scope.departmentIds.has(goal.departmentId);
  return true;
}

// The goals the agent may read: those that concern it and the goals above them, so a
// goal's chain can be told. `all` is the Home agent, which sees every goal of the team.
export function visibleGoalIds(
  goals: ScopedGoal[],
  scope: { all: boolean; projectIds: Set<number>; departmentIds: Set<number> },
): Set<number> {
  if (scope.all) return new Set(goals.map((goal) => goal.id));
  const byId = new Map(goals.map((goal) => [goal.id, goal]));
  const visible = new Set<number>();
  for (const goal of goals) {
    if (!concernsAgent(goal, scope)) continue;
    let current: ScopedGoal | undefined = goal;
    while (current && !visible.has(current.id)) {
      visible.add(current.id);
      current = current.parentGoalId == null ? undefined : byId.get(current.parentGoalId);
    }
  }
  return visible;
}

// The titles above a goal, outermost first.
export function goalPath(goal: ScopedGoal, byId: Map<number, ScopedGoal>): string[] {
  const path: string[] = [];
  const seen = new Set<number>([goal.id]);
  let parent = goal.parentGoalId == null ? undefined : byId.get(goal.parentGoalId);
  while (parent && !seen.has(parent.id)) {
    seen.add(parent.id);
    path.unshift(parent.title);
    parent = parent.parentGoalId == null ? undefined : byId.get(parent.parentGoalId);
  }
  return path;
}

// What the SOUL.md says about goals: the active ones that concern the agent, each with its
// place in the tree, its project and target, in at most MAX_SOUL_GOALS entries and
// MAX_SOUL_GOAL_CHARS. Empty when there is none, so an agent without goals reads nothing
// about them. Progress is left out on purpose: it changes with every finished task, and
// each change of the SOUL.md is a new revision every runner writes (get_goal has it).
export const MAX_SOUL_GOALS = 12;
export const MAX_SOUL_GOAL_CHARS = 3000;
const DESCRIPTION_CHARS = 200;

export interface SoulGoal {
  id: number;
  title: string;
  description: string;
  path: string[];
  project: string | null;
  department: string | null;
  targetDate: string | null;
}

function oneLine(text: string, max: number): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

export function goalsSection(goals: SoulGoal[]): string {
  if (goals.length === 0) return '';
  const lines: string[] = [];
  let size = 0;
  let shown = 0;
  for (const goal of goals.slice(0, MAX_SOUL_GOALS)) {
    const where = [goal.project, goal.department].filter(Boolean).join(', ');
    const facts = [
      where,
      goal.targetDate ? `target ${goal.targetDate}` : '',
      goal.path.length > 0 ? `part of: ${goal.path.join(' › ')}` : '',
    ].filter(Boolean);
    const entry = [
      `- #${goal.id} "${oneLine(goal.title, 160)}"${facts.length ? ` — ${facts.join('; ')}` : ''}`,
      ...(goal.description.trim() ? [`  ${oneLine(goal.description, DESCRIPTION_CHARS)}`] : []),
    ].join('\n');
    if (size + entry.length > MAX_SOUL_GOAL_CHARS) break;
    lines.push(entry);
    size += entry.length;
    shown++;
  }
  const more = goals.length - shown;
  return [
    '## Goals',
    'What your work serves: the active goals of your projects and their departments (get_goal',
    'has the details, the linked tasks and the notes).',
    ...lines,
    ...(more > 0 ? [`- … and ${more} more (list_goals).`] : []),
    '',
    'A task that serves one of these goals is linked to it: pass goalId to create_issue, or',
    "call link_issue_to_goal. Report progress with add_goal_note; to change a goal's status",
    '(achieved, paused), propose it there — the owner confirms it. Do not invent goals.',
  ].join('\n');
}
