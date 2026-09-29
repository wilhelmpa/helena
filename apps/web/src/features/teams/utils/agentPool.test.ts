import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { poolGroups, poolRowText } from './agentPool';

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
