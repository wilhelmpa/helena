import assert from 'node:assert/strict';
import { describe, it, test } from 'node:test';
import { filterPool, poolGroups, poolRowText } from './agentPool';

describe('Agentenpool', () => {
  test('Zeile: Projekte nach Schlüssel, Modell kurz, Standard ohne Modell', () => {
    assert.deepEqual(
      poolRowText({
        projects: [{ key: 'VOL' }, { key: 'FAM' }] as never,
        model: 'helena-local/Qwen3.8-27B',
      }),
      { projects: ['FAM', 'VOL'], model: 'Qwen3.8-27B' },
    );
    assert.deepEqual(poolRowText({ projects: [], model: null }), { projects: [], model: null });
  });

  test('Gruppen: Agenten und Vorlagen getrennt, nach Namen', () => {
    const groups = poolGroups([
      { name: 'Zeta', template: false },
      { name: 'Vorlage', template: true },
      { name: 'Alpha', template: false },
    ]);
    assert.deepEqual(
      groups.agents.map((agent) => agent.name),
      ['Alpha', 'Zeta'],
    );
    assert.deepEqual(
      groups.templates.map((agent) => agent.name),
      ['Vorlage'],
    );
  });
});

describe('filterPool', () => {
  const agent = (
    name: string,
    template: boolean,
    projects: { key: string; name: string }[],
    model: string | null = null,
  ) => ({ name, username: name.toLowerCase(), template, projects, model });
  const pool = [
    agent('Coder VOL', false, [{ key: 'VOL', name: 'Volition' }], 'gpt-6-sol'),
    agent('Researcher', false, [{ key: 'TRADE', name: 'Trading' }]),
    agent('Planner', true, []),
  ];

  it('searches name, handle, projects and model', () => {
    assert.deepEqual(
      filterPool(pool, { search: 'trading' }).agents.map((a) => a.name),
      ['Researcher'],
    );
    assert.deepEqual(
      filterPool(pool, { search: 'SOL' }).agents.map((a) => a.name),
      ['Coder VOL'],
    );
    assert.deepEqual(
      filterPool(pool, { search: 'plan' }).templates.map((a) => a.name),
      ['Planner'],
    );
  });

  it('shows agents or templates, and a project’s agents with every template', () => {
    assert.equal(filterPool(pool, { show: 'agents' }).templates.length, 0);
    assert.equal(filterPool(pool, { show: 'templates' }).agents.length, 0);
    const vol = filterPool(pool, { projectKey: 'VOL' });
    assert.deepEqual(
      vol.agents.map((a) => a.name),
      ['Coder VOL'],
    );
    assert.deepEqual(
      vol.templates.map((a) => a.name),
      ['Planner'],
    );
  });
});
