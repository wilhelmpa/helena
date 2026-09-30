import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { OrganizationAgent } from '@/lib/api/endpoints/organization';
import { organizationChartAgents } from './organizationChartAgents';
import {
  BUS_OFFSET,
  COMPACT_FROM,
  COMPACT_LEAF_WIDTH,
  LEADER_WIDTH,
  LEAF_WIDTH,
  SHORT_HEIGHT,
  SHORT_LEAF_WIDTH,
  chartWidth,
  organizationChartLayout,
} from './organizationChartLayout';
import { organizationChartState } from './organizationChartState';
import type { AgentActivityEntry } from '@/lib/api/endpoints/agentActivity';

function agent(
  id: number,
  parent: number | null,
  project: number | null,
  isHome = false,
): OrganizationAgent {
  return {
    id,
    name: `Agent ${id}`,
    isHome,
    template: false,
    reportsToAgentId: parent,
    runtimeState: { status: 'online' },
    projects:
      project == null
        ? []
        : [{ id: project, key: `P${project}`, name: `P${project}`, instructions: '' }],
  } as OrganizationAgent;
}

describe('Organigramm', () => {
  const agents = [agent(1, null, null, true), agent(2, 1, 7), agent(3, 2, 7), agent(4, 1, 8)];

  test('Projektansicht behält Home und die Berichtslinie, blendet fremde Projekte aus', () => {
    const scoped = organizationChartAgents(agents, 7);
    assert.deepEqual(
      scoped.map((item) => item.id),
      [1, 2, 3],
    );
    const chart = organizationChartLayout(scoped, new Set(), new Set([3]));
    assert.deepEqual(chart.edges.map((edge) => [edge.source, edge.target, edge.animated]).sort(), [
      ['1', '2', false],
      ['2', '3', true],
    ]);
    assert.equal(chart.nodes.find((node) => node.id === '1')?.position.y, 0);
    assert.ok(
      chart.nodes.find((node) => node.id === '3')!.position.y >
        chart.nodes.find((node) => node.id === '2')!.position.y,
    );
  });

  test('Zuklappen versteckt Nachkommen, erhält aber den Koordinator', () => {
    const chart = organizationChartLayout(agents, new Set([2]), new Set());
    assert.ok(chart.nodes.some((node) => node.id === '2'));
    assert.ok(!chart.nodes.some((node) => node.id === '3'));
    assert.ok(chart.nodes.some((node) => node.id === '4'));
  });

  test('fehlende Berichtslinie erzeugt keine erfundene Home-Verbindung', () => {
    const chart = organizationChartLayout([...agents, agent(5, null, 7)], new Set(), new Set());
    assert.ok(chart.nodes.some((node) => node.id === '5'));
    assert.ok(!chart.edges.some((edge) => edge.target === '5'));
  });

  test('Status folgt laufender Arbeit und echten Fehlern', () => {
    const entry = (status: string) => ({ agent: { id: 2 }, status }) as AgentActivityEntry;
    assert.equal(organizationChartState(agents[1]!, [entry('running')], false), 'thinking');
    assert.equal(organizationChartState(agents[1]!, [entry('running')], true), 'tool');
    assert.equal(organizationChartState(agents[1]!, [entry('pending')], false), 'waiting');
    assert.equal(organizationChartState(agents[1]!, [entry('failed')], false), 'error');
  });

  test('alle Spezialisten eines Koordinators stehen in einer Zeile an einer Linie (O93)', () => {
    const team = [agent(2, null, 7), ...Array.from({ length: 10 }, (_, i) => agent(10 + i, 2, 7))];
    const chart = organizationChartLayout(team, new Set(), new Set());
    const lead = chart.nodes.find((node) => node.id === '2')!;
    const leaves = chart.nodes.filter((node) => node.id !== '2');
    // One level is one row, however many reports there are.
    assert.deepEqual([...new Set(leaves.map((node) => node.position.y))].length, 1);
    assert.ok(leaves[0]!.position.y > lead.position.y);
    // The row is one row: no card overlaps its neighbour, and they do not wrap.
    const xs = leaves.map((node) => node.position.x).sort((a, b) => a - b);
    for (let i = 1; i < xs.length; i++)
      assert.ok(xs[i]! >= xs[i - 1]! + (leaves[0]!.width ?? 0), 'cards side by side');
    // Many reports are shown compact, so the row stays narrow enough to fit by zoom.
    assert.ok(leaves.every((node) => node.width === COMPACT_LEAF_WIDTH));
    assert.ok(leaves.every((node) => (node.data as { compact?: boolean }).compact));
    // A line runs only from the manager to a direct report, all along one shared height.
    assert.equal(chart.edges.length, 10);
    assert.ok(chart.edges.every((edge) => edge.source === '2'));
    for (const edge of chart.edges) {
      const target = chart.nodes.find((node) => node.id === edge.target)!;
      assert.equal((edge.data as { busY?: number }).busY, target.position.y - BUS_OFFSET);
    }
  });

  test('bis zu vier Berichte behalten die volle Karte', () => {
    const team = [
      agent(2, null, 7),
      ...Array.from({ length: COMPACT_FROM }, (_, i) => agent(10 + i, 2, 7)),
    ];
    const chart = organizationChartLayout(team, new Set(), new Set());
    assert.ok(
      chart.nodes.filter((node) => node.id !== '2').every((node) => node.width === LEAF_WIDTH),
    );
  });

  test('jede Ebene ist eine Zeile über alle Zweige, auch wenn ein Koordinator Aufgaben trägt', () => {
    const team = [
      agent(1, null, null, true),
      agent(2, 1, 7),
      agent(3, 1, 8),
      agent(20, 2, 7),
      agent(21, 2, 7),
      agent(30, 3, 8),
    ];
    const tasks = [1, 2].map((id) => ({
      id,
      identifier: `P7-${id}`,
      title: 'Aufgabe',
      agentId: 2,
      color: 'var(--status-idle)',
    }));
    const chart = organizationChartLayout(team, new Set(), new Set(), { tasks });
    const y = (id: string) => chart.nodes.find((node) => node.id === id)!.position.y;
    assert.equal(y('2'), y('3'));
    assert.equal(y('20'), y('30'));
    assert.equal(y('21'), y('30'));
    // The specialists stand below the coordinator's tasks.
    const lastTask = Math.max(
      ...chart.nodes.filter((node) => node.type === 'task').map((node) => node.position.y + 32),
    );
    assert.ok(y('20') > lastTask);
    // Only manager → direct report lines (plus the dotted task lines).
    const reporting = chart.edges.filter((edge) => !edge.target.startsWith('task:'));
    assert.deepEqual(reporting.map((edge) => `${edge.source}>${edge.target}`).sort(), [
      '1>2',
      '1>3',
      '2>20',
      '2>21',
      '3>30',
    ]);
  });

  test('kurze Karten: alle unter der Spitze zweizeilig und schmal, eine Ebene bleibt eine Zeile (O96)', () => {
    const team = [
      agent(1, null, null, true),
      agent(2, 1, 7),
      agent(3, 1, 8),
      ...Array.from({ length: 9 }, (_, i) => agent(10 + i, 2, 7)),
      agent(30, 3, 8),
    ];
    const compact = organizationChartLayout(team, new Set(), new Set());
    const short = organizationChartLayout(team, new Set(), new Set(), { density: 'short' });
    assert.ok(chartWidth(short.nodes) < chartWidth(compact.nodes));
    const below = short.nodes.filter((node) => node.id !== '1');
    assert.ok(below.every((node) => (node.data as { short?: boolean }).short));
    assert.ok(below.every((node) => node.height === SHORT_HEIGHT));
    assert.equal(short.nodes.find((node) => node.id === '1')!.width, LEADER_WIDTH);
    const leaves = short.nodes.filter((node) => Number(node.id) >= 10);
    assert.equal(new Set(leaves.map((node) => node.position.y)).size, 1);
    assert.ok(leaves.every((node) => node.width === SHORT_LEAF_WIDTH));
    // No card overlaps its neighbour.
    const xs = leaves.map((node) => node.position.x).sort((a, b) => a - b);
    for (let i = 1; i < xs.length; i++) assert.ok(xs[i]! >= xs[i - 1]! + SHORT_LEAF_WIDTH);
  });
});
