import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { Node } from '@xyflow/react';
import type {
  Organization,
  OrganizationAgent,
  OrganizationDepartment,
  OrganizationProject,
} from '@/lib/api/endpoints/organization';
import { organizationChartLayout } from './organizationChartLayout';
import { focusFromParam, focusParam, focusScope } from './organizationFocus';
import { organizationRingLayout, ringPillWidth, ringTaskWidth } from './organizationRingLayout';

function agent(
  id: number,
  parent: number | null,
  project: number | null,
  role: OrganizationAgent['role'] = 'specialist',
  isHome = false,
): OrganizationAgent {
  return {
    id,
    userId: `u${id}`,
    name: isHome ? 'Home' : `Agent ${id} mit langem Namen`,
    roleTitle: '',
    isHome,
    template: false,
    role,
    departmentId: null,
    reportsToAgentId: parent,
    runtimeState: { status: 'online' },
    projects:
      project == null
        ? []
        : [{ id: project, key: `P${project}`, name: `Projekt ${project}`, instructions: '' }],
  } as unknown as OrganizationAgent;
}

const departments = [
  { id: 1, name: 'Volition', parentId: null, position: 0 },
  { id: 2, name: 'Familie & Privat', parentId: null, position: 1 },
] as OrganizationDepartment[];
const projects = [
  { id: 10, key: 'P10', name: 'Projekt 10', departmentId: 1 },
  { id: 11, key: 'P11', name: 'Projekt 11', departmentId: 1 },
  { id: 12, key: 'P12', name: 'Projekt 12', departmentId: 2 },
  { id: 13, key: 'P13', name: 'Projekt 13', departmentId: null },
] as OrganizationProject[];
const agents = [
  agent(1, null, null, null, true),
  agent(2, 1, 10, 'coordinator'),
  agent(3, 1, 11, 'coordinator'),
  agent(4, 1, 12, 'coordinator'),
  agent(5, 1, 13, 'coordinator'),
  ...Array.from({ length: 10 }, (_, index) => agent(20 + index, 2, 10)),
  ...Array.from({ length: 8 }, (_, index) => agent(40 + index, 3, 11)),
  ...Array.from({ length: 5 }, (_, index) => agent(60 + index, 4, 12)),
  agent(99, null, 13),
];
const organization = {
  teamId: 1,
  departments,
  projects,
  goals: [],
  agents,
} as unknown as Organization;

type Box = { x: number; y: number; w: number; h: number };
function boxes(nodes: Node[]): Box[] {
  return nodes
    .filter((node) => node.type === 'pill' || node.type === 'task')
    .map((node) => {
      const label =
        node.type === 'pill'
          ? (node.data.agent as OrganizationAgent).name
          : `${(node.data.task as { identifier: string; title: string }).identifier} ${(node.data.task as { title: string }).title}`;
      return {
        x: node.position.x,
        y: node.position.y,
        w: node.type === 'pill' ? ringPillWidth(label) : ringTaskWidth(label),
        h: node.type === 'pill' ? 34 : 26,
      };
    });
}
function assertNoOverlap(list: Box[]) {
  for (let i = 0; i < list.length; i++)
    for (let j = i + 1; j < list.length; j++) {
      const a = list[i]!;
      const b = list[j]!;
      const apart = Math.abs(a.x - b.x) * 2 >= a.w + b.w || Math.abs(a.y - b.y) * 2 >= a.h + b.h;
      assert.ok(apart, `nodes ${i} and ${j} overlap`);
    }
}

describe('Organigramm „Kreis“', () => {
  test('Home: Home in der Mitte, Abteilungen und lose Projekte innen, keine Überlappung', () => {
    const ring = organizationRingLayout({
      level: 'home',
      agents,
      departments,
      projects,
      delegating: new Set([21]),
    });
    const hub = ring.nodes.find((node) => node.type === 'hub')!;
    assert.equal(hub.id, '1');
    assert.deepEqual(hub.position, { x: 0, y: 0 });
    assert.deepEqual(
      ring.nodes.filter((node) => node.type === 'group').map((node) => node.id),
      ['group:d:1', 'group:d:2', 'group:p:13'],
    );
    assert.equal(ring.nodes.filter((node) => node.type === 'pill').length, agents.length - 1);
    assertNoOverlap(boxes(ring.nodes));
    // A running delegation lights up exactly the line into the delegated agent.
    assert.deepEqual(
      ring.edges.filter((edge) => edge.data?.active && edge.target === '21').length,
      1,
    );
    // The orphan is shown but never connected by an invented line.
    assert.ok(!ring.edges.some((edge) => edge.target === '99'));
  });

  test('Home: echte Ringe – jede Ebene auf einem Kreis, keine Linie kreuzt eine andere', () => {
    const ring = organizationRingLayout({
      level: 'home',
      agents,
      departments,
      projects,
      delegating: new Set(),
    });
    const at = new Map(ring.nodes.map((node) => [node.id, node.position]));
    const distance = (id: string) => Math.round(Math.hypot(at.get(id)!.x, at.get(id)!.y));
    const same = (ids: string[]) => new Set(ids.map(distance)).size === 1;
    const first = ['group:d:1', 'group:d:2', 'group:p:13', '99'];
    const second = ['2', '3', '4', '5'];
    const third = [20, 29, 40, 47, 60, 64].map(String);
    assert.ok(same(first), 'erster Ring');
    assert.ok(same(second), 'zweiter Ring');
    assert.ok(same(third), 'dritter Ring');
    assert.ok(distance('99') < distance('2') && distance('2') < distance('20'));
    assert.deepEqual(ring.orbits.slice(0, 3), [distance('99'), distance('2'), distance('20')]);
    // Every line of the middle ends on the first ring.
    assert.ok(
      ring.edges.filter((edge) => edge.source === '1').every((edge) => first.includes(edge.target)),
    );
    // No two lines cross (lines that share a node may touch there).
    const cross = (a: [number, number][], b: [number, number][]) => {
      const turn = (p: [number, number], q: [number, number], r: [number, number]) =>
        Math.sign((q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]));
      return (
        turn(a[0], a[1], b[0]) * turn(a[0], a[1], b[1]) < 0 &&
        turn(b[0], b[1], a[0]) * turn(b[0], b[1], a[1]) < 0
      );
    };
    const lines = ring.edges.map((edge) => ({
      edge,
      points: [edge.source, edge.target].map((id) => [at.get(id)!.x, at.get(id)!.y]) as [
        number,
        number,
      ][],
    }));
    for (const a of lines)
      for (const b of lines) {
        if (a === b) continue;
        const shared = [a.edge.source, a.edge.target].some((id) =>
          [b.edge.source, b.edge.target].includes(id),
        );
        if (!shared) assert.ok(!cross(a.points, b.points), `${a.edge.id} kreuzt ${b.edge.id}`);
      }
  });

  test('gleiche Daten ergeben dieselben Positionen (kein Springen)', () => {
    const input = {
      level: 'home' as const,
      agents,
      departments,
      projects,
      delegating: new Set<number>(),
    };
    const first = organizationRingLayout(input);
    const second = organizationRingLayout({ ...input, delegating: new Set([20]) });
    assert.deepEqual(
      first.nodes.map((node) => [node.id, node.position]),
      second.nodes.map((node) => [node.id, node.position]),
    );
  });

  test('Abteilung: Abteilung in der Mitte, ihre Projekte innen, ohne Home', () => {
    const scoped = focusScope(organization, { kind: 'department', id: 1 }).agents;
    const ring = organizationRingLayout({
      level: 'department',
      agents: scoped,
      departments,
      projects,
      focusId: 1,
      delegating: new Set(),
    });
    assert.equal(ring.nodes[0]!.id, 'department:1');
    assert.deepEqual(
      ring.nodes.filter((node) => node.type === 'group').map((node) => node.id),
      ['group:p:10', 'group:p:11'],
    );
    assert.ok(!ring.nodes.some((node) => node.id === '1'));
    assertNoOverlap(boxes(ring.nodes));
  });

  test('Projekt: Koordinator in der Mitte, Home oben, Team rundherum', () => {
    const scoped = focusScope(organization, { kind: 'project', id: 12 }).agents;
    const ring = organizationRingLayout({
      level: 'project',
      agents: scoped,
      departments,
      projects,
      focusId: 12,
      delegating: new Set(),
    });
    assert.equal(ring.nodes[0]!.id, '4');
    const home = ring.nodes.find((node) => node.id === '1')!;
    assert.ok(home.position.y < 0 && Math.abs(home.position.x) < 1);
    assert.ok(ring.edges.some((edge) => edge.source === '1' && edge.target === '4'));
    assert.equal(ring.edges.filter((edge) => edge.source === '4').length, 5);
  });

  test('Agent: Agent in der Mitte, Vorgesetzter oben, Aufgaben außen', () => {
    const scoped = focusScope(organization, { kind: 'agent', id: 3 }).agents;
    const ring = organizationRingLayout({
      level: 'agent',
      agents: scoped,
      departments,
      projects,
      focusId: 3,
      delegating: new Set(),
      tasks: [1, 2, 3, 4, 5, 6].map((id) => ({
        id,
        identifier: `P11-${id}`,
        title: 'Recherche',
        agentId: 40,
        color: 'var(--status-idle)',
      })),
    });
    assert.equal(ring.nodes[0]!.id, '3');
    const tasks = ring.nodes.filter((node) => node.type === 'task');
    assert.equal(tasks.length, 4);
    assert.equal(tasks.at(-1)!.data.more, 2);
    const agentNode = ring.nodes.find((node) => node.id === '40')!;
    const distance = (node: Node) => Math.hypot(node.position.x, node.position.y);
    assert.ok(tasks.every((task) => distance(task) > distance(agentNode)));
    assertNoOverlap(boxes(ring.nodes));
  });
});

describe('Organigramm-Ebenen', () => {
  test('Adresse hin und zurück, ungültige Ebenen fallen auf die Wurzel', () => {
    assert.equal(focusParam({ kind: 'department', id: 2 }), 'd2');
    assert.deepEqual(focusFromParam('d2', organization), { kind: 'department', id: 2 });
    assert.deepEqual(focusFromParam('p13', organization), { kind: 'project', id: 13 });
    assert.deepEqual(focusFromParam('a40', organization), { kind: 'agent', id: 40 });
    assert.deepEqual(focusFromParam('d77', organization), { kind: 'root' });
    // A project page only opens its own agents, and no departments.
    assert.deepEqual(focusFromParam('a40', organization, 12), { kind: 'root' });
    assert.deepEqual(focusFromParam('d1', organization, 12), { kind: 'root' });
    assert.deepEqual(focusFromParam('a60', organization, 12), { kind: 'agent', id: 60 });
  });

  test('Breadcrumb führt über Abteilung und Projekt zurück', () => {
    const scope = focusScope(organization, { kind: 'agent', id: 41 });
    assert.deepEqual(
      scope.crumbs.map((crumb) => focusParam(crumb.focus)),
      [null, 'd1', 'p11', 'a41'],
    );
    assert.deepEqual(
      scope.agents.map((item) => item.id).sort((a, b) => a - b),
      [3, 41],
    );
  });
});

describe('Organigramm „Baum“ auf Home', () => {
  test('Spezialisten hängen gestapelt an ihrem Koordinator', () => {
    const tree = organizationChartLayout(agents, new Set(), new Set(), { stackLeaves: true });
    const coordinator = tree.nodes.find((node) => node.id === '2')!;
    const leaves = tree.nodes.filter((node) => [20, 21, 22].includes(Number(node.id)));
    assert.ok(leaves.every((leaf) => leaf.position.x === coordinator.position.x + 40));
    assert.ok(leaves[0]!.position.y < leaves[1]!.position.y);
    assert.ok(
      tree.edges
        .filter((edge) => edge.source === '2')
        .every((edge) => edge.sourceHandle === 'rail'),
    );
  });

  test('Aufgaben hängen wie im Kreis an ihrem Agenten, das Team rückt darunter', () => {
    const tasks = [1, 2, 3, 4, 5].map((id) => ({
      id,
      identifier: `P10-${id}`,
      title: 'Aufgabe',
      agentId: 2,
      color: 'var(--status-idle)',
    }));
    const without = organizationChartLayout(agents, new Set(), new Set(), { stackLeaves: true });
    const tree = organizationChartLayout(agents, new Set(), new Set(), {
      stackLeaves: true,
      tasks,
    });
    const shown = tree.nodes.filter((node) => node.type === 'task');
    assert.equal(shown.length, 4);
    assert.equal(shown.at(-1)!.data.more, 1);
    const coordinator = tree.nodes.find((node) => node.id === '2')!;
    assert.ok(shown.every((node) => node.position.y > coordinator.position.y));
    assert.equal(tree.edges.filter((edge) => edge.target.startsWith('task:')).length, 4);
    // The coordinator's team starts below its tasks.
    const firstLeaf = (layout: typeof tree) => layout.nodes.find((node) => node.id === '20')!;
    assert.ok(firstLeaf(tree).position.y > firstLeaf(without).position.y);
    const lastTask = shown.at(-1)!;
    assert.ok(firstLeaf(tree).position.y > lastTask.position.y);
  });
});
