import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { AgentInventorySkill } from '@/lib/api/endpoints/agents';
import { isHermesToolset, skillGroups, toggleToolset } from './agentAbilities';

describe('agent toolsets', () => {
  it('denies a toolset switched off and allows it again when switched on', () => {
    const denied = toggleToolset([], 'terminal', false);
    assert.deepEqual(denied, ['terminal']);
    assert.deepEqual(toggleToolset(denied, 'terminal', false), ['terminal']);
    assert.deepEqual(toggleToolset(denied, 'terminal', true), []);
  });

  it('keeps entries that name no reported toolset', () => {
    assert.deepEqual(toggleToolset(['message.send'], 'web', false), ['message.send', 'web']);
    assert.deepEqual(toggleToolset(['message.send', 'web'], 'web', true), ['message.send']);
  });

  it('describes only the toolsets it knows', () => {
    assert.equal(isHermesToolset('terminal'), true);
    assert.equal(isHermesToolset('itsaplan'), false);
  });
});

describe('agent skill inventory', () => {
  const skill = (
    name: string,
    category: string | null,
    description = '',
    origin: AgentInventorySkill['origin'] = 'bundled',
  ): AgentInventorySkill => ({ name, category, description, origin });
  const skills = [
    skill('release-notes', null, 'Writes release notes', 'agent'),
    skill('airtable', 'productivity', 'Airtable REST API'),
    skill('notion', 'productivity', 'Notion pages'),
    skill('arxiv', 'research', 'Search papers'),
  ];

  it('groups the skills by category in the order they were reported', () => {
    assert.deepEqual(
      skillGroups(skills, '').map(([category, items]) => [category, items.map((s) => s.name)]),
      [
        ['', ['release-notes']],
        ['productivity', ['airtable', 'notion']],
        ['research', ['arxiv']],
      ],
    );
  });

  it('filters by name, description and category, ignoring case', () => {
    const names = (query: string) =>
      skillGroups(skills, query).flatMap(([, items]) => items.map((s) => s.name));
    assert.deepEqual(names('  NOTION '), ['notion']);
    assert.deepEqual(names('papers'), ['arxiv']);
    assert.deepEqual(names('productivity'), ['airtable', 'notion']);
    assert.deepEqual(names('nothing like this'), []);
  });
});
