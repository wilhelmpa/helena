import type { BudgetStatus } from '@/lib/api/endpoints/autopilot';
import { fullestBudget } from '@/components/helena/BudgetBar';
import type { Edge, Node } from '@xyflow/react';
import type {
  OrganizationAgent,
  OrganizationDepartment,
  OrganizationProject,
} from '@/lib/api/endpoints/organization';
import { projectColor } from '@/utils/projectColor';

// "Kreis": the same org data as the tree, as real rings around the middle (owner, O18/O56):
// every level of the reporting chain is one ring, and every branch keeps to its own slice
// of the circle (its share is the number of agents at its ends), so no two lines cross
// and none runs past the ring it ends on.
// - home:       Home in the middle, departments (or projects without one) on the first
//               ring, their coordinators on the second, their teams further out;
// - department: the department in the middle, its projects on the first ring;
// - project:    the project's coordinator in the middle, Home above it, its team around;
// - agent:      the agent in the middle, its manager above it, its reports around.
// Positions come from sorted data only, so a click, a filter or a refetch never moves
// a node. Optional tasks sit outside the last ring at their agent.

export type RingLevel = 'home' | 'department' | 'project' | 'agent';

export interface RingGroup {
  key: string;
  // What a click on the group drills into.
  target: { kind: 'department' | 'project'; id: number } | null;
  label: string;
  // The project keys of the group, as its small eyebrow.
  tag: string;
  accent: string;
  members: number[];
  // The department's fullest budget (hub/pc-costs), as a bar on its circle.
  budget?: BudgetStatus | null;
  // A budget of the department is used up, or one of its agents takes no new work.
  throttled?: boolean;
}

export interface RingTask {
  id: number;
  identifier: string;
  title: string;
  agentId: number;
  color: string;
}

export interface RingLayout {
  nodes: Node[];
  edges: Edge[];
  // Radii of the decorative orbits, around (0, 0).
  orbits: number[];
}

export interface RingLayoutInput {
  level: RingLevel;
  agents: OrganizationAgent[];
  departments: OrganizationDepartment[];
  projects: OrganizationProject[];
  // The department, project or agent in the middle, by level.
  focusId?: number;
  delegating: Set<number>;
  tasks?: RingTask[];
}

const GROUP_SIZE = 112;
export const HUB_SIZE = 136;
const PILL_HEIGHT = 34;
const TASK_HEIGHT = 26;
const MARGIN = 10;
// The first ring sits this far outside the hub's edge; each further ring at least this
// far outside the one before it. A ring grows only when its nodes would touch.
const FIRST_GAP = 70;
const RING_STEP = 96;
const GROW_STEP = 12;
const TASK_GAP = 110;
const TASKS_PER_AGENT = 4;

// A pill's width from its label, close enough to keep the collision check honest.
export function ringPillWidth(label: string): number {
  return Math.round(Math.min(220, Math.max(112, 44 + label.length * 6.6)));
}

export function ringTaskWidth(label: string): number {
  return Math.round(Math.min(190, Math.max(76, 30 + label.length * 6)));
}

type Box = { x: number; y: number; w: number; h: number };

function overlaps(a: Box, b: Box) {
  return (
    Math.abs(a.x - b.x) * 2 < a.w + b.w + MARGIN * 2 &&
    Math.abs(a.y - b.y) * 2 < a.h + b.h + MARGIN * 2
  );
}

const rad = (deg: number) => (deg * Math.PI) / 180;

function edge(
  source: string,
  target: string,
  accent: string,
  active: boolean,
  strong = false,
  task = false,
): Edge {
  return {
    id: `ring-${source}-${target}`,
    source,
    target,
    type: 'flow',
    animated: active,
    data: { active, accent, variant: 'straight', strong, task },
  };
}

// Places a box on the ray at `angle`, from `radius` outwards, where it overlaps nothing
// (the tasks: they fan out around their agent's ray, outside the rings).
function placeOnRay(placed: Box[], angle: number, radius: number, w: number, h: number) {
  let box: Box = { x: 0, y: 0, w, h };
  let at = radius;
  for (let step = 0; step < 60; step++) {
    at = radius + step * 42;
    box = { x: Math.cos(rad(angle)) * at, y: Math.sin(rad(angle)) * at, w, h };
    if (!placed.some((other) => overlaps(box, other))) break;
  }
  placed.push(box);
  return { box, radius: at };
}

// One node of the radial tree: an agent, or a department or project circle.
interface RingNode {
  id: string;
  kind: 'agent' | 'group';
  agent?: OrganizationAgent;
  group?: RingGroup;
  accent: string;
  // A head of its sector (or the manager above the middle): marked on its pill.
  head: boolean;
  // The line into it: from its parent (null for a loose agent, which gets none).
  lineFrom: 'parent' | 'none' | 'reverse';
  children: RingNode[];
  // Leaves below it (1 for a leaf): its share of the circle.
  weight: number;
  depth: number;
  angle: number;
  w: number;
  h: number;
}

export function organizationRingLayout({
  level,
  agents,
  departments,
  projects,
  focusId,
  delegating,
  tasks = [],
}: RingLayoutInput): RingLayout {
  const byId = new Map(agents.map((agent) => [agent.id, agent]));
  const children = new Map<number, OrganizationAgent[]>();
  for (const agent of agents) {
    const parent = agent.reportsToAgentId;
    if (parent != null && parent !== agent.id && byId.has(parent))
      children.set(parent, [...(children.get(parent) ?? []), agent]);
  }
  const byName = (a: OrganizationAgent, b: OrganizationAgent) => a.name.localeCompare(b.name);
  for (const list of children.values()) list.sort(byName);

  const projectById = new Map(projects.map((project) => [project.id, project]));
  const departmentById = new Map(departments.map((department) => [department.id, department]));
  function rootDepartment(id: number | null | undefined) {
    let current = id == null ? undefined : departmentById.get(id);
    const visited = new Set<number>();
    while (current?.parentId != null && !visited.has(current.id)) {
      visited.add(current.id);
      const parent = departmentById.get(current.parentId);
      if (!parent) break;
      current = parent;
    }
    return current;
  }
  const home = agents.find((agent) => agent.isHome);

  // The middle: an agent, or (on the department level) the department itself.
  const hubAgent =
    level === 'home'
      ? (home ?? agents[0])
      : level === 'project'
        ? (agents.find(
            (agent) =>
              agent.role === 'coordinator' &&
              agent.projects.some((project) => project.id === focusId),
          ) ?? home)
        : level === 'agent'
          ? byId.get(focusId ?? -1)
          : undefined;
  const hubDepartment = level === 'department' ? departmentById.get(focusId ?? -1) : undefined;
  if (!hubAgent && !hubDepartment) return { nodes: [], edges: [], orbits: [] };
  const hubId = hubAgent ? String(hubAgent.id) : `department:${hubDepartment!.id}`;

  // Every agent is placed once.
  const seen = new Set<number>(hubAgent ? [hubAgent.id] : []);

  // The manager shown above the hub (project and agent level).
  const manager =
    hubAgent && (level === 'project' || level === 'agent') && hubAgent.reportsToAgentId != null
      ? byId.get(hubAgent.reportsToAgentId)
      : undefined;
  if (manager) seen.add(manager.id);

  // The heads: agents hanging straight off the middle. On the department level Home is
  // left out; its coordinators are the heads.
  const heads = hubAgent
    ? [...(children.get(hubAgent.id) ?? [])].filter((agent) => agent.id !== manager?.id)
    : agents
        .filter((agent) => !agent.isHome)
        .filter(
          (agent) =>
            agent.reportsToAgentId == null ||
            !byId.has(agent.reportsToAgentId) ||
            byId.get(agent.reportsToAgentId)!.isHome,
        )
        .sort(byName);
  for (const head of heads) seen.add(head.id);

  const palette = [
    'var(--project-vol)',
    'var(--project-trade)',
    'var(--project-verve)',
    'var(--project-color-4)',
    'var(--project-color-5)',
  ];

  // Everyone below an agent as a tree, each agent once, by name.
  function agentNode(
    agent: OrganizationAgent,
    accent: string,
    head: boolean,
    lineFrom: RingNode['lineFrom'],
  ): RingNode {
    const reports = (children.get(agent.id) ?? []).filter((report) => !seen.has(report.id));
    for (const report of reports) seen.add(report.id);
    return {
      id: String(agent.id),
      kind: 'agent',
      agent,
      accent,
      head,
      lineFrom,
      children: reports.map((report) => agentNode(report, accent, false, 'parent')),
      weight: 1,
      depth: 0,
      angle: 0,
      w: ringPillWidth(agent.name),
      h: PILL_HEIGHT,
    };
  }

  // The middle's children, ring by ring outwards: departments or projects as circles
  // (Home and department level), then their heads, then everyone below them.
  const top: RingNode[] = [];
  const grouped = level === 'home' || level === 'department';
  let sectorIndex = 0;
  if (manager) {
    top.push({
      ...agentNode(manager, projectColor(null), true, 'reverse'),
      // The manager keeps only the line down to the middle; its other reports belong to
      // another level.
      children: [],
    });
  }
  if (grouped) {
    const bucket = new Map<
      string,
      {
        target: RingGroup['target'];
        label: string;
        accent: string | null;
        order: string;
        keys: Set<string>;
        heads: OrganizationAgent[];
        budget: BudgetStatus | null;
      }
    >();
    for (const head of heads) {
      const project = head.projects
        .map((item) => projectById.get(item.id))
        .find((item) => item != null);
      const department =
        level === 'home' ? rootDepartment(project?.departmentId ?? head.departmentId) : undefined;
      const key = department ? `d:${department.id}` : project ? `p:${project.id}` : `a:${head.id}`;
      const entry = bucket.get(key) ?? {
        target: department
          ? { kind: 'department' as const, id: department.id }
          : project
            ? { kind: 'project' as const, id: project.id }
            : null,
        label: department?.name ?? project?.name ?? head.name,
        accent: department ? null : project ? projectColor(project.key) : null,
        order: department
          ? `0:${String(department.position).padStart(8, '0')}:${department.name}`
          : project
            ? `1:${project.name}`
            : `2:${head.name}`,
        keys: new Set<string>(),
        heads: [],
        budget: department ? fullestBudget(department.budgets) : null,
      };
      if (project) entry.keys.add(project.key);
      entry.heads.push(head);
      bucket.set(key, entry);
    }
    for (const [key, entry] of [...bucket.entries()].sort((a, b) =>
      a[1].order.localeCompare(b[1].order),
    )) {
      const accent = entry.accent ?? palette[sectorIndex++ % palette.length]!;
      if (key.startsWith('a:')) {
        // A head outside every project: straight on the first ring.
        for (const head of entry.heads.sort(byName))
          top.push(agentNode(head, accent, true, 'parent'));
        continue;
      }
      const headNodes = entry.heads.sort(byName).map((head) => agentNode(head, accent, true, 'parent'));
      const members: number[] = [];
      const collect = (node: RingNode) => {
        if (node.agent) members.push(node.agent.id);
        node.children.forEach(collect);
      };
      headNodes.forEach(collect);
      const group: RingGroup = {
        key,
        target: entry.target,
        label: entry.label,
        tag: [...entry.keys].sort().join(' · '),
        accent,
        members,
        budget: entry.budget,
        throttled:
          (entry.budget?.ratio ?? 0) >= 1 || members.some((id) => byId.get(id)?.throttled),
      };
      top.push({
        id: `group:${key}`,
        kind: 'group',
        group,
        accent,
        head: false,
        lineFrom: 'parent',
        children: headNodes,
        weight: 1,
        depth: 0,
        angle: 0,
        w: GROUP_SIZE,
        h: GROUP_SIZE,
      });
    }
  } else {
    const project =
      level === 'project'
        ? projectById.get(focusId ?? -1)
        : hubAgent?.projects.map((item) => projectById.get(item.id)).find(Boolean);
    const accent = projectColor(project?.key ?? null);
    for (const head of heads) top.push(agentNode(head, accent, true, 'parent'));
  }
  // Agents in scope outside every chain: shown on the first ring, never connected by an
  // invented line.
  const loose = agents
    .filter((agent) => !seen.has(agent.id) && !agent.isHome)
    .filter((agent) => agent.reportsToAgentId == null || !byId.has(agent.reportsToAgentId))
    .sort(byName);
  for (const agent of loose) seen.add(agent.id);
  for (const agent of loose) top.push(agentNode(agent, 'var(--muted-foreground)', false, 'none'));

  // Every node's share of the circle is the number of leaves below it, so a branch never
  // leaves its own slice and no two lines cross.
  function measure(node: RingNode, depth: number): number {
    node.depth = depth;
    node.weight = node.children.length
      ? node.children.reduce((sum, child) => sum + measure(child, depth + 1), 0)
      : 1;
    return node.weight;
  }
  const total = top.reduce((sum, node) => sum + measure(node, 1), 0);
  // The first slice is centred at the top: the manager (or the first group) sits above
  // the middle.
  let start = -90 - (top[0] ? (180 * top[0].weight) / Math.max(1, total) : 0);
  function assign(node: RingNode, from: number, span: number) {
    node.angle = from + span / 2;
    let at = from;
    for (const child of node.children) {
      const share = (span * child.weight) / Math.max(1, node.weight);
      assign(child, at, share);
      at += share;
    }
  }
  for (const node of top) {
    const span = (360 * node.weight) / Math.max(1, total);
    assign(node, start, span);
    start += span;
  }

  // Ring by ring: the smallest radius at which no node of the ring touches another one
  // (of its ring or of a ring inside it).
  const rings: RingNode[][] = [];
  const walk = (node: RingNode) => {
    (rings[node.depth - 1] ??= []).push(node);
    node.children.forEach(walk);
  };
  top.forEach(walk);
  const placed: Box[] = [{ x: 0, y: 0, w: HUB_SIZE, h: HUB_SIZE }];
  const radii: number[] = [];
  const at = new Map<string, Box>();
  rings.forEach((ring, index) => {
    const widest = Math.max(...ring.map((node) => Math.max(node.w, node.h)));
    let radius =
      index === 0
        ? HUB_SIZE / 2 + FIRST_GAP + widest / 2
        : radii[index - 1]! + Math.max(RING_STEP, widest / 2 + PILL_HEIGHT);
    const boxesAt = (r: number) =>
      ring.map((node) => ({
        x: Math.cos(rad(node.angle)) * r,
        y: Math.sin(rad(node.angle)) * r,
        w: node.w,
        h: node.h,
      }));
    for (let step = 0; step < 400; step++) {
      const boxes = boxesAt(radius);
      const clash =
        boxes.some((box) => placed.some((other) => overlaps(box, other))) ||
        boxes.some((box, i) => boxes.some((other, j) => j > i && overlaps(box, other)));
      if (!clash) break;
      radius += GROW_STEP;
    }
    radius = Math.round(radius);
    radii.push(radius);
    boxesAt(radius).forEach((box, i) => {
      placed.push(box);
      at.set(ring[i]!.id, box);
    });
  });

  const nodes: Node[] = [];
  const edges: Edge[] = [];
  const agentCount = rings.flat().filter((node) => node.kind === 'agent').length;
  nodes.push({
    id: hubId,
    type: 'hub',
    position: { x: 0, y: 0 },
    origin: [0.5, 0.5],
    width: HUB_SIZE,
    height: HUB_SIZE,
    draggable: false,
    data: {
      ...(hubAgent ? { agent: hubAgent } : {}),
      department: hubDepartment ?? null,
      count: agentCount,
      accent: top.find((node) => node.kind === 'group')?.accent ?? top[0]?.accent,
    },
  });
  const agentAngles = new Map<number, number>();
  const busy = (node: RingNode): boolean =>
    (node.agent != null && delegating.has(node.agent.id)) || node.children.some(busy);
  const emit = (node: RingNode, parentId: string) => {
    const box = at.get(node.id)!;
    if (node.kind === 'group') {
      nodes.push({
        id: node.id,
        type: 'group',
        position: { x: box.x, y: box.y },
        origin: [0.5, 0.5],
        width: GROUP_SIZE,
        height: GROUP_SIZE,
        draggable: false,
        data: { group: node.group },
      });
      edges.push(edge(parentId, node.id, node.accent, busy(node), true));
    } else {
      const agent = node.agent!;
      agentAngles.set(agent.id, node.angle);
      nodes.push({
        id: node.id,
        type: 'pill',
        position: { x: box.x, y: box.y },
        origin: [0.5, 0.5],
        draggable: false,
        data: {
          agent,
          accent: node.accent,
          head: node.head,
          reportCount: (children.get(agent.id) ?? []).length,
        },
      });
      if (node.lineFrom === 'reverse')
        edges.push(
          edge(node.id, parentId, node.accent, hubAgent ? delegating.has(hubAgent.id) : false),
        );
      else if (node.lineFrom === 'parent')
        edges.push(edge(parentId, node.id, node.accent, delegating.has(agent.id)));
    }
    node.children.forEach((child) => emit(child, node.id));
  };
  top.forEach((node) => emit(node, hubId));

  // Tasks: the outermost ring, fanned out around the ray of their agent.
  const byAgent = new Map<number, RingTask[]>();
  for (const task of tasks) {
    if (!agentAngles.has(task.agentId) && task.agentId !== hubAgent?.id) continue;
    byAgent.set(task.agentId, [...(byAgent.get(task.agentId) ?? []), task]);
  }
  const outermost = radii.at(-1) ?? HUB_SIZE;
  const taskRadius = outermost + TASK_GAP;
  let taskOutermost = 0;
  for (const [agentId, list] of [...byAgent].sort((a, b) => a[0] - b[0])) {
    const baseAngle = agentAngles.get(agentId) ?? -90;
    const shown = list.slice(0, TASKS_PER_AGENT);
    const extra = list.length - shown.length;
    shown.forEach((task, index) => {
      const angle = baseAngle + (index - (shown.length - 1) / 2) * 7;
      const width = ringTaskWidth(`${task.identifier} ${task.title}`);
      const { box, radius } = placeOnRay(placed, angle, taskRadius, width, TASK_HEIGHT);
      taskOutermost = Math.max(taskOutermost, radius);
      const id = `task:${task.id}`;
      nodes.push({
        id,
        type: 'task',
        position: { x: box.x, y: box.y },
        origin: [0.5, 0.5],
        draggable: false,
        data: { task, more: index === shown.length - 1 && extra > 0 ? extra : 0 },
      });
      edges.push(edge(String(agentId), id, task.color, false, false, true));
    });
  }

  const orbits = [...radii, ...(taskOutermost ? [taskRadius] : [])];
  return { nodes, edges, orbits };
}
