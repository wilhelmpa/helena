import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { AiAgent } from '@/lib/api/endpoints/agents';
import type { Organization, OrganizationAgent } from '@/lib/api/endpoints/organization';
import { teamMemberCandidates } from './teamMembers';

const project = (id: number) => ({ id, key: `P${id}`, name: `Projekt ${id}` });
const organization = {
  teamId: 1,
  departments: [],
  goals: [],
  projects: [project(10), project(11)],
  agents: [
    { id: 1, name: 'Helena', isHome: true, template: false, role: null, projects: [] },
    {
      id: 2,
      name: 'Koordinator P10',
      isHome: false,
      template: false,
      role: 'coordinator',
      projects: [project(10)],
    },
    {
      id: 3,
      name: 'Coder P10',
      isHome: false,
      template: false,
      role: 'specialist',
      projects: [project(10)],
    },
    {
      id: 4,
      name: 'Recherche P11',
      isHome: false,
      template: false,
      role: 'specialist',
      projects: [project(11)],
    },
  ] as unknown as OrganizationAgent[],
} as unknown as Organization;
const agents = [
  { id: 1, name: 'Helena', template: false, projects: [] },
  { id: 2, name: 'Koordinator P10', template: false, projects: [project(10)] },
  { id: 3, name: 'Coder P10', template: false, projects: [project(10)] },
  { id: 4, name: 'Recherche P11', template: false, projects: [project(11)] },
  { id: 5, name: 'Lose', template: false, projects: [] },
  { id: 9, name: 'Vorlage Coder', template: true, projects: [] },
] as unknown as AiAgent[];

describe('Mitglied hinzufügen', () => {
  test('Pool: nur Agenten, die noch nicht im Projekt arbeiten, ohne Helena und Vorlagen', () => {
    const result = teamMemberCandidates(organization, agents, 10, 'pool');
    assert.deepEqual(
      result.options.map((option) => option.id),
      [5, 4],
    );
    assert.equal(result.options.find((option) => option.id === 4)!.detail, 'P11');
  });

  test('Vorlage: alle Vorlagen des Teams', () => {
    const result = teamMemberCandidates(organization, agents, 10, 'template');
    assert.deepEqual(
      result.options.map((option) => option.id),
      [9],
    );
  });

  test('berichtet standardmäßig an den Koordinator, sonst an Helena', () => {
    const p10 = teamMemberCandidates(organization, agents, 10, 'pool');
    assert.equal(p10.defaultManagerId, 2);
    assert.deepEqual(
      p10.managers.map((manager) => manager.id),
      [2, 1, 3],
    );
    const p11 = teamMemberCandidates(organization, agents, 11, 'pool');
    assert.equal(p11.defaultManagerId, 1);
  });

  test('ohne Projekt nichts zur Auswahl', () => {
    const result = teamMemberCandidates(organization, agents, null, 'pool');
    assert.equal(result.options.length, 0);
    assert.equal(result.defaultManagerId, null);
  });
});
