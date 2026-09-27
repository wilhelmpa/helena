import type { Edge, Node } from '@xyflow/react';
import type { OrganizationAgent } from '@/lib/api/endpoints/organization';

const LEAF_WIDTH = 242;
const X_GAP = 16;
const Y_GAP = 122;

export function organizationChartLayout(
  agents: OrganizationAgent[],
  collapsed: Set<number>,
  delegating: Set<number>,
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

  const nodes: Node[] = [];
  const edges: Edge[] = [];
  const seen = new Set<number>();
  let column = 0;
  function visit(agent: OrganizationAgent, depth: number): number {
    if (seen.has(agent.id)) return column++;
    seen.add(agent.id);
    const start = column;
    const reports = collapsed.has(agent.id) ? [] : (children.get(agent.id) ?? []);
    const positions = reports.map((report) => {
      const x = visit(report, depth + 1);
      edges.push({
        id: `${agent.id}-${report.id}`,
        source: String(agent.id),
        target: String(report.id),
        type: 'smoothstep',
        animated: delegating.has(report.id),
        className: delegating.has(report.id) ? 'helena-delegation-edge' : undefined,
        style: { stroke: delegating.has(report.id) ? '#7ee0b8' : '#ffffff24', strokeWidth: 2 },
      });
      return x;
    });
    const center = positions.length ? (positions[0]! + positions.at(-1)!) / 2 : column++;
    const width = agent.isHome || agent.role === 'coordinator' ? 280 : LEAF_WIDTH;
    nodes.push({
      id: String(agent.id),
      type: 'agent',
      position: {
        x: center * (LEAF_WIDTH + X_GAP) + (LEAF_WIDTH - width) / 2,
        y: depth * Y_GAP,
      },
      data: { agent, reportCount: (children.get(agent.id) ?? []).length },
      draggable: false,
    });
    return positions.length ? center : start;
  }
  for (const root of roots) visit(root, 0);
  return { nodes, edges };
}
