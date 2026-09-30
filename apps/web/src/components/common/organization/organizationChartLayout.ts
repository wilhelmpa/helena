import type { Edge, Node } from '@xyflow/react';
import type { OrganizationAgent } from '@/lib/api/endpoints/organization';
import type { RingTask } from './organizationRingLayout';

// "Baum": the classic org chart, Home on top, then coordinators, then specialists — the
// real hierarchy (owner 30.09., O93): one level is one row, everyone who reports to the same
// manager stands beside the others in that row, and a line runs only from a manager to its
// direct reports (one shared line above the row, then down to each). A row that gets wide is
// not wrapped into a second one — its cards turn compact and the chart fits by zoom and can
// be panned sideways.
// Positions are deterministic (sorted by name), so selecting, filtering or a refetch
// never moves a card; only collapsing a branch changes the layout.
export const LEADER_WIDTH = 280;
export const LEADER_HEIGHT = 92;
export const LEAF_WIDTH = 242;
export const LEAF_HEIGHT = 112;
// The compact card of a row with many reports (see COMPACT_FROM): narrower, without the
// decider line, so ten specialists fit a screen at a readable zoom.
export const COMPACT_LEADER_WIDTH = 224;
export const COMPACT_LEAF_WIDTH = 176;
export const COMPACT_LEAF_HEIGHT = 92;
// A manager with more reports than this shows them compact.
export const COMPACT_FROM = 4;
// The short card of a row that would still be too wide at a readable zoom with compact cards
// (owner 30.09., O96): two lines, name and status, instead of a smaller zoom.
export const SHORT_LEADER_WIDTH = 152;
export const SHORT_LEAF_WIDTH = 120;
export const SHORT_HEIGHT = 64;
// Room around the chart when it is fitted, and the smallest zoom it is fitted to: compact
// cards down to 0.7, short cards down to 0.5 (their text is larger); beyond that the chart
// starts at its left edge and is panned.
export const TREE_PADDING = 32;
export const TREE_MIN_ZOOM = 0.7;
export const TREE_SHORT_MIN_ZOOM = 0.45;
const X_GAP = 16;
const SHORT_X_GAP = 10;
// Room between a leader and its reports for a clear trunk and the shared line (owner
// 29.09.: the lines from the coordinator to its specialists were not to be seen).
const LEVEL_GAP = 56;
// Every report of a leader hangs from one horizontal line this far above its row.
export const BUS_OFFSET = 24;
// An agent's current tasks hang under its card, as in the ring (owner 29.09.: the same
// "Aufgaben" in both views): at most four, the fourth names how many more.
// The task pill's height as the ring draws it (.ds-ring-task).
const TASK_HEIGHT = 32;
const TASK_GAP = 6;
const TASK_INDENT = 12;
const TASKS_PER_AGENT = 4;

export type ChartDensity = 'compact' | 'short';

export interface ChartLayoutOptions {
  // How the reports of a wide row are drawn: compact (default) or short (two lines).
  density?: ChartDensity;
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
  // The reports of a manager with many of them are compact, so the row stays one row.
  const short = options.density === 'short';
  const compact = new Set<number>();
  // Short cards are drawn for every agent below the top, so the levels look alike.
  for (const reports of children.values())
    if (short || reports.length > COMPACT_FROM)
      for (const report of reports) compact.add(report.id);
  // Short cards also stand closer.
  const gap = short ? SHORT_X_GAP : X_GAP;
  const width = (agent: OrganizationAgent) =>
    isLeader(agent)
      ? compact.has(agent.id)
        ? short
          ? SHORT_LEADER_WIDTH
          : COMPACT_LEADER_WIDTH
        : LEADER_WIDTH
      : compact.has(agent.id)
        ? short
          ? SHORT_LEAF_WIDTH
          : COMPACT_LEAF_WIDTH
        : LEAF_WIDTH;
  const cardHeight = (agent: OrganizationAgent) =>
    compact.has(agent.id) && short
      ? SHORT_HEIGHT
      : isLeader(agent)
        ? LEADER_HEIGHT
        : compact.has(agent.id)
          ? COMPACT_LEAF_HEIGHT
          : LEAF_HEIGHT;
  // The card and its tasks under it.
  const height = (agent: OrganizationAgent) => cardHeight(agent) + taskRoom(agent);
  const visible = (agent: OrganizationAgent) =>
    collapsed.has(agent.id) ? [] : (children.get(agent.id) ?? []);

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
    if (reports.length) {
      const sum =
        reports.reduce((total, report) => total + measure(report), 0) + gap * (reports.length - 1);
      result = Math.max(result, sum);
    }
    measuring.delete(agent.id);
    measured.set(agent.id, result);
    return result;
  }

  // A level is one row: every agent of a depth stands at the same height, below the
  // tallest card (with its tasks) of the level above.
  const depthOf = new Map<number, number>();
  const rowHeight: number[] = [];
  function levelOf(agent: OrganizationAgent, depth: number) {
    if (depthOf.has(agent.id)) return;
    depthOf.set(agent.id, depth);
    rowHeight[depth] = Math.max(rowHeight[depth] ?? 0, height(agent));
    for (const report of visible(agent)) levelOf(report, depth + 1);
  }
  for (const root of roots) levelOf(root, 0);
  const rowTop: number[] = [0];
  for (let depth = 1; depth <= rowHeight.length; depth++)
    rowTop[depth] = rowTop[depth - 1]! + (rowHeight[depth - 1] ?? 0) + LEVEL_GAP;

  const nodes: Node[] = [];
  const edges: Edge[] = [];
  const placed = new Set<number>();
  const edge = (source: OrganizationAgent, target: OrganizationAgent, busY: number): Edge => {
    const active = delegating.has(target.id);
    return {
      id: `${source.id}-${target.id}`,
      source: String(source.id),
      target: String(target.id),
      type: 'flow',
      animated: active,
      data: { active, busY },
    };
  };
  function node(agent: OrganizationAgent, x: number, y: number) {
    nodes.push({
      id: String(agent.id),
      type: 'agent',
      position: { x, y },
      width: width(agent),
      height: cardHeight(agent),
      data: {
        agent,
        reportCount: (children.get(agent.id) ?? []).length,
        ...(compact.has(agent.id) && { compact: true, ...(short && { short: true }) }),
      },
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
  function place(agent: OrganizationAgent, left: number) {
    if (placed.has(agent.id)) return;
    placed.add(agent.id);
    const total = measure(agent);
    const reports = visible(agent).filter((report) => !placed.has(report.id));
    node(agent, left + (total - width(agent)) / 2, rowTop[depthOf.get(agent.id) ?? 0] ?? 0);
    const childTop = rowTop[(depthOf.get(agent.id) ?? 0) + 1] ?? 0;
    const childrenWidth =
      reports.reduce((sum, report) => sum + measure(report), 0) +
      gap * Math.max(0, reports.length - 1);
    let cursor = left + (total - childrenWidth) / 2;
    for (const report of reports) {
      edges.push(edge(agent, report, childTop - BUS_OFFSET));
      place(report, cursor);
      cursor += measure(report) + gap;
    }
  }
  let cursor = 0;
  for (const root of roots) {
    if (placed.has(root.id)) continue;
    place(root, cursor);
    cursor += measure(root) + X_GAP * 2;
  }
  return { nodes, edges };
}

// The width the laid-out agent cards take, for deciding how densely to draw them.
export function chartWidth(nodes: Node[]): number {
  let left = Infinity;
  let right = -Infinity;
  for (const node of nodes) {
    if (node.type !== 'agent') continue;
    left = Math.min(left, node.position.x);
    right = Math.max(right, node.position.x + (node.width ?? 0));
  }
  return right > left ? right - left : 0;
}
