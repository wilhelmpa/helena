import { describe, expect, it } from 'bun:test';
import type { VaultScope } from '#modules/knowledge/scope';
import { knowledgeSection, vaultAccessOf } from '../../knowledge';

const none = { read: false, write: false };
const author = { name: 'Agent', email: 'agent@agents.volition.local' };

function scope(overrides: Partial<VaultScope>): VaultScope {
  return {
    projects: new Map(),
    home: none,
    templates: none,
    private: false,
    agent: { username: 'writer' },
    author,
    actor: { ref: 'agent:1', agentId: 1, runId: null, timeZone: 'UTC', locale: 'en' },
    ...overrides,
  };
}

describe('vaultAccessOf', () => {
  it('gives a project agent its project and the templates, never Private', () => {
    const access = vaultAccessOf(
      scope({
        projects: new Map([['VOL', { read: true, write: true }]]),
        templates: { read: true, write: false },
      }),
      '/vault',
    );
    expect(access).toEqual({
      root: '/vault',
      read: ['/vault/Projects/VOL', '/vault/Templates'],
      write: ['/vault/Projects/VOL'],
      deny: ['/vault/.git', '/vault/.obsidian', '/vault/.trash', '/vault/Private'],
    });
  });

  it('lets the Home agent read the whole vault but Private and write Home', () => {
    const access = vaultAccessOf(
      scope({
        agent: { username: 'master' },
        projects: new Map([['VOL', { read: true, write: false }]]),
        home: { read: true, write: true },
        templates: { read: true, write: false },
      }),
      '/vault',
    );
    expect(access.read).toEqual(['/vault']);
    expect(access.write).toEqual(['/vault/Home']);
    expect(access.deny).toContain('/vault/Private');
  });
});

describe('knowledgeSection', () => {
  it('tells the agent where knowledge goes and what it reaches', () => {
    const text = knowledgeSection({
      root: '/vault',
      read: ['/vault/Projects/VOL', '/vault/Templates'],
      write: ['/vault/Projects/VOL'],
      deny: ['/vault/Private'],
    });
    expect(text).toStartWith('## Knowledge');
    expect(text).toContain('[[KEY-n]]');
    expect(text).toContain('You read: Projects/VOL, Templates. You write: Projects/VOL.');
    expect(text).toContain('Never: Private.');
  });

  it('is empty for an agent that reaches no part of the vault', () => {
    expect(knowledgeSection({ root: '/vault', read: [], write: [], deny: [] })).toBe('');
  });
});
