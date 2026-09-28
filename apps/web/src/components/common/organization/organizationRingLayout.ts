import type { BudgetStatus } from '@/lib/api/endpoints/autopilot';
import { fullestBudget } from '@/components/helena/BudgetBar';
import type { Edge, Node } from '@xyflow/react';
import type {
  OrganizationAgent,
  OrganizationDepartment,
  OrganizationProject,
} from '@/lib/api/endpoints/organization';
import { projectColor } from '@/utils/projectColor';

// "Kreis": the same org data as the tree, radial, on every level:
// - home:       Home in the middle, departments (or projects without one) on the inner
//               ring, their agents on the outer ring as branches;
// - department: the department in the middle, its projects on the inner ring;
// - project:    the project's coordinator in the middle, Home above it, its team around;
// - agent:      the agent in the middle, its manager above it, its reports around.
// Positions come from sorted data only, so a click, a filter or a refetch never moves
// a node. Optional tasks sit on the outermost ring at their agent.

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

const GROUP_RADIUS = 190;
const GROUP_SIZE = 112;
export const HUB_SIZE = 136;
const PILL_HEIGHT = 34;
const TASK_HEIGHT = 26;
const MARGIN = 10;
const RADIUS_STEP = 42;
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

// Places a box on the ray at `angle`, from `radius` outwards, where it overlaps nothing.
function placeOnRay(placed: Box[], angle: number, radius: number, w: number, h: number) {
  let box: Box = { x: 0, y: 0, w, h };
  let at = radius;
  for (let step = 0; step < 60; step++) {
    at = radius + step * RADIUS_STEP;
    box = { x: Math.cos(rad(angle)) * at, y: Math.sin(rad(angle)) * at, w, h };
    if (!placed.some((other) => overlaps(box, other))) break;
  }
  placed.push(box);
  return { box, radius: at };
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

  // Everyone below an agent, depth first and by name, each once.
  const seen = new Set<number>(hubAgent ? [hubAgent.id] : []);
  function subtree(agent: OrganizationAgent): OrganizationAgent[] {
    const result: OrganizationAgent[] = [];
    for (const report of children.get(agent.id) ?? []) {
      if (seen.has(report.id)) continue;
      seen.add(report.id);
      result.push(report, ...subtree(report));
    }
    return result;
  }

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

  interface Sector {
    group: RingGroup;
    circle: boolean;
    members: OrganizationAgent[];
    heads: Set<number>;
  }
  const sectors: Sector[] = [];
  const palette = [
    'var(--project-vol)',
    'var(--project-trade)',
    'var(--project-verve)',
    'var(--project-color-4)',
    'var(--project-color-5)',
  ];

  if (level === 'home' || level === 'department') {
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
    [...bucket.entries()]
      .sort((a, b) => a[1].order.localeCompare(b[1].order))
      .forEach(([key, entry], index) => {
        const members: OrganizationAgent[] = [];
        for (const head of entry.heads.sort(byName)) members.push(head, ...subtree(head));
        sectors.push({
          circle: !key.startsWith('a:'),
          members,
          heads: new Set(entry.heads.map((head) => head.id)),
          group: {
            key,
            target: entry.target,
            label: entry.label,
            tag: [...entry.keys].sort().join(' · '),
            accent: entry.accent ?? palette[index % palette.length]!,
            members: members.map((member) => member.id),
            budget: entry.budget,
            throttled:
              (entry.budget?.ratio ?? 0) >= 1 || members.some((member) => member.throttled),
          },
        });
      });
  } else {
    const members: OrganizationAgent[] = [];
    if (manager) members.push(manager);
    for (const head of heads) members.push(head, ...subtree(head));
    const project =
      level === 'project'
        ? projectById.get(focusId ?? -1)
        : hubAgent?.projects.map((item) => projectById.get(item.id)).find(Boolean);
    sectors.push({
      circle: false,
      members,
      heads: new Set(heads.map((head) => head.id)),
      group: {
        key: 'single',
        target: null,
        label: '',
        tag: '',
        accent: projectColor(project?.key ?? null),
        members: members.map((member) => member.id),
      },
    });
  }
  // Agents in scope outside every chain: shown, never connected by an invented line.
  const loose = agents
    .filter((agent) => !seen.has(agent.id) && !agent.isHome)
    .filter((agent) => agent.reportsToAgentId == null || !byId.has(agent.reportsToAgentId))
    .sort(byName);
  for (const agent of loose) seen.add(agent.id);
  const looseMembers = loose.flatMap((agent) => [agent, ...subtree(agent)]);
  if (looseMembers.length)
    sectors.push({
      circle: false,
      members: looseMembers,
      heads: new Set(),
      group: {
        key: 'loose',
        target: null,
        label: '',
        tag: '',
        accent: 'var(--muted-foreground)',
        members: looseMembers.map((agent) => agent.id),
      },
    });

  const nodes: Node[] = [];
  const edges: Edge[] = [];
  const total = sectors.reduce((sum, sector) => sum + sector.members.length, 0);
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
      count: total,
      accent: sectors[0]?.group.accent,
    },
  });

  const grouped = level === 'home' || level === 'department';
  const agentRadius = Math.max(grouped ? 360 : 250, total * 9);
  const placed: Box[] = [{ x: 0, y: 0, w: HUB_SIZE, h: HUB_SIZE }];
  const weight = (sector: Sector) => Math.max(1, sector.members.length) + 0.8;
  const weights = sectors.reduce((sum, sector) => sum + weight(sector), 0);
  // The first sector is centered at the top; without groups the manager is at the top.
  let start = grouped
    ? -90 - (sectors[0] ? (180 * weight(sectors[0])) / weights : 0)
    : -90 - 180 / Math.max(1, total);
  const circles = sectors.filter((sector) => sector.circle).length;
  const groupRadius = circles > 0 ? Math.max(GROUP_RADIUS, circles * 30) : 0;
  let outermost = agentRadius;
  const agentAngles = new Map<number, number>();

  for (const sector of sectors) {
    const span = grouped
      ? (360 * weight(sector)) / weights
      : (360 * sector.members.length) / Math.max(1, total);
    const middle = start + span / 2;
    const groupId = `group:${sector.group.key}`;
    const anchor = sector.circle ? groupId : hubId;
    if (sector.circle) {
      const x = Math.cos(rad(middle)) * groupRadius;
      const y = Math.sin(rad(middle)) * groupRadius;
      placed.push({ x, y, w: GROUP_SIZE, h: GROUP_SIZE });
      nodes.push({
        id: groupId,
        type: 'group',
        position: { x, y },
        origin: [0.5, 0.5],
        width: GROUP_SIZE,
        height: GROUP_SIZE,
        draggable: false,
        data: { group: sector.group },
      });
      edges.push(
        edge(
          hubId,
          groupId,
          sector.group.accent,
          sector.members.some((member) => delegating.has(member.id)),
          true,
        ),
      );
    }
    const count = sector.members.length;
    const accent = sector.group.accent;
    sector.members.forEach((agent, index) => {
      const angle = start + (span * (index + 0.5)) / Math.max(1, count);
      const { box, radius } = placeOnRay(
        placed,
        angle,
        agentRadius,
        ringPillWidth(agent.name),
        PILL_HEIGHT,
      );
      outermost = Math.max(outermost, radius);
      agentAngles.set(agent.id, angle);
      nodes.push({
        id: String(agent.id),
        type: 'pill',
        position: { x: box.x, y: box.y },
        origin: [0.5, 0.5],
        draggable: false,
        data: {
          agent,
          accent,
          head: sector.heads.has(agent.id) || agent.id === manager?.id,
          reportCount: (children.get(agent.id) ?? []).length,
        },
      });
      if (agent.id === manager?.id) {
        const active = hubAgent ? delegating.has(hubAgent.id) : false;
        edges.push(edge(String(agent.id), hubId, accent, active));
        return;
      }
      const managerId = agent.reportsToAgentId;
      const managerShown =
        managerId != null &&
        managerId !== hubAgent?.id &&
        sector.members.some((member) => member.id === managerId);
      const source = managerShown ? String(managerId) : sector.heads.has(agent.id) ? anchor : null;
      if (source) edges.push(edge(source, String(agent.id), accent, delegating.has(agent.id)));
    });
    start += span;
  }

  // Tasks: the outermost ring, fanned out around the ray of their agent.
  const byAgent = new Map<number, RingTask[]>();
  for (const task of tasks) {
    if (!agentAngles.has(task.agentId) && task.agentId !== hubAgent?.id) continue;
    byAgent.set(task.agentId, [...(byAgent.get(task.agentId) ?? []), task]);
  }
  const taskRadius = outermost + 110;
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

  const orbits = [
    ...(groupRadius ? [groupRadius] : []),
    agentRadius,
    ...(outermost > agentRadius + 20 ? [outermost] : []),
    ...(taskOutermost ? [taskRadius] : []),
  ];
  return { nodes, edges, orbits };
}
