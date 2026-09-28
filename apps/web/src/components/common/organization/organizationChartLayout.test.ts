import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { OrganizationAgent } from '@/lib/api/endpoints/organization';
import { organizationChartAgents } from './organizationChartAgents';
import { organizationChartLayout } from './organizationChartLayout';
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
    assert.deepEqual(
      chart.edges.map((edge) => [edge.source, edge.target, edge.animated]).sort(),
      [
        ['1', '2', false],
        ['2', '3', true],
      ],
    );
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
});
