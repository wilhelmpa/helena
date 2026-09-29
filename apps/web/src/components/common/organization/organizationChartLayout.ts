import type { Edge, Node } from '@xyflow/react';
import type { OrganizationAgent } from '@/lib/api/endpoints/organization';
import type { RingTask } from './organizationRingLayout';

// "Baum": the classic org chart, Home on top, then coordinators, then specialists.
// Positions are deterministic (sorted by name), so selecting, filtering or a refetch
// never moves a card; only collapsing a branch changes the layout.
export const LEADER_WIDTH = 280;
export const LEADER_HEIGHT = 92;
export const LEAF_WIDTH = 242;
export const LEAF_HEIGHT = 112;
const X_GAP = 16;
const LEVEL_GAP = 30;
// Stacked specialists hang off a rail on the left of their coordinator.
const RAIL_INDENT = 40;
const STACK_GAP = 14;
// An agent's current tasks hang under its card, as in the ring (owner 29.09.: the same
// "Aufgaben" in both views): at most four, the fourth names how many more.
const TASK_HEIGHT = 26;
const TASK_GAP = 6;
const TASK_INDENT = 12;
const TASKS_PER_AGENT = 4;

export interface ChartLayoutOptions {
  // Stack a coordinator's specialists in a column under it instead of a row. Used on
  // Home, where 40+ agents in one row would shrink every card to a dot.
  stackLeaves?: boolean;
  // The current tasks of the agents, shown under their cards while "Aufgaben" is on.
  tasks?: RingTask[];
}

function isLeader(agent: OrganizationAgent) {
  return agent.isHome || agent.role === 'coordinator';
}

export function organizationChartLayout(
  agents: OrganizationAgent[],
  collapsed: Set<number>,
  delegating: Set<number>,
  options: ChartLayoutOptions = {},
): { nodes: Node[]; edges: Edge[] } {
  const byId = new Map(agents.map((agent) => [agent.id, agent]));
  const children = new Map<number, OrganizationAgent[]>();
  const roots: OrganizationAgent[] = [];
  for (const agent of agents) {
    const parent = agent.reportsToAgentId;
    if (parent != null && parent !== agent.id && byId.has(parent)) {
      children.set(parent, [...(children.get(parent) ?? []), agent]);
    } else {
      roots.push(agent);
    }
  }
  for (const entries of children.values()) entries.sort((a, b) => a.name.localeCompare(b.name));
  roots.sort((a, b) => Number(b.isHome) - Number(a.isHome) || a.name.localeCompare(b.name));

  const tasksOf = new Map<number, RingTask[]>();
  for (const task of options.tasks ?? [])
    tasksOf.set(task.agentId, [...(tasksOf.get(task.agentId) ?? []), task]);
  const shownTasks = (agent: OrganizationAgent) =>
    (tasksOf.get(agent.id) ?? []).slice(0, TASKS_PER_AGENT);
  // The room an agent's tasks take under its card.
  const taskRoom = (agent: OrganizationAgent) => {
    const count = shownTasks(agent).length;
    return count ? TASK_GAP + count * (TASK_HEIGHT + TASK_GAP) : 0;
  };
  const width = (agent: OrganizationAgent) => (isLeader(agent) ? LEADER_WIDTH : LEAF_WIDTH);
  const cardHeight = (agent: OrganizationAgent) => (isLeader(agent) ? LEADER_HEIGHT : LEAF_HEIGHT);
  // The card and its tasks under it.
  const height = (agent: OrganizationAgent) => cardHeight(agent) + taskRoom(agent);
  const visible = (agent: OrganizationAgent) =>
    collapsed.has(agent.id) ? [] : (children.get(agent.id) ?? []);
  const stacked = (agent: OrganizationAgent, reports: OrganizationAgent[]) =>
    Boolean(options.stackLeaves) &&
    !agent.isHome &&
    reports.length > 1 &&
    reports.every((report) => (children.get(report.id) ?? []).length === 0);

  // A cycle in reportsTo must not recurse forever: every agent is placed once.
  const measured = new Map<number, number>();
  const measuring = new Set<number>();
  function measure(agent: OrganizationAgent): number {
    const known = measured.get(agent.id);
    if (known != null) return known;
    if (measuring.has(agent.id)) return width(agent);
    measuring.add(agent.id);
    const reports = visible(agent);
    let result = width(agent);
    if (reports.length && stacked(agent, reports)) {
      result = Math.max(result, RAIL_INDENT + LEAF_WIDTH);
    } else if (reports.length) {
      const sum =
        reports.reduce((total, report) => total + measure(report), 0) +
        X_GAP * (reports.length - 1);
      result = Math.max(result, sum);
    }
    measuring.delete(agent.id);
    measured.set(agent.id, result);
    return result;
  }

  const nodes: Node[] = [];
  const edges: Edge[] = [];
  const placed = new Set<number>();
  const edge = (source: OrganizationAgent, target: OrganizationAgent, rail: boolean): Edge => {
    const active = delegating.has(target.id);
    return {
      id: `${source.id}-${target.id}`,
      source: String(source.id),
      target: String(target.id),
      type: 'flow',
      animated: active,
      ...(rail ? { sourceHandle: 'rail', targetHandle: 'side' } : {}),
      data: { active, rail },
    };
  };
  function node(agent: OrganizationAgent, x: number, y: number) {
    nodes.push({
      id: String(agent.id),
      type: 'agent',
      position: { x, y },
      width: width(agent),
      height: cardHeight(agent),
      data: { agent, reportCount: (children.get(agent.id) ?? []).length },
      draggable: false,
    });
    const list = tasksOf.get(agent.id) ?? [];
    const shown = shownTasks(agent);
    shown.forEach((task, index) => {
      const id = `task:${task.id}`;
      nodes.push({
        id,
        type: 'task',
        position: {
          x: x + TASK_INDENT,
          y: y + cardHeight(agent) + TASK_GAP + index * (TASK_HEIGHT + TASK_GAP),
        },
        draggable: false,
        data: { task, more: index === shown.length - 1 ? list.length - shown.length : 0 },
      });
      edges.push({
        id: `${agent.id}-${id}`,
        source: String(agent.id),
        target: id,
        type: 'flow',
        data: { active: false, accent: task.color, task: true },
      });
    });
  }
  function place(agent: OrganizationAgent, left: number, y: number) {
    if (placed.has(agent.id)) return;
    placed.add(agent.id);
    const total = measure(agent);
    const reports = visible(agent).filter((report) => !placed.has(report.id));
    if (reports.length && stacked(agent, reports)) {
      const x = left + (total - Math.max(width(agent), RAIL_INDENT + LEAF_WIDTH)) / 2;
      node(agent, x, y);
      let top = y + height(agent) + LEVEL_GAP;
      for (const report of reports) {
        placed.add(report.id);
        node(report, x + RAIL_INDENT, top);
        edges.push(edge(agent, report, true));
        top += height(report) + STACK_GAP;
      }
      return;
    }
    node(agent, left + (total - width(agent)) / 2, y);
    const childrenWidth =
      reports.reduce((sum, report) => sum + measure(report), 0) +
      X_GAP * Math.max(0, reports.length - 1);
    let cursor = left + (total - childrenWidth) / 2;
    for (const report of reports) {
      edges.push(edge(agent, report, false));
      place(report, cursor, y + height(agent) + LEVEL_GAP);
      cursor += measure(report) + X_GAP;
    }
  }
  let cursor = 0;
  for (const root of roots) {
    if (placed.has(root.id)) continue;
    place(root, cursor, 0);
    cursor += measure(root) + X_GAP * 2;
  }
  return { nodes, edges };
}
