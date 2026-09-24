import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { AiAgent } from '@/lib/api/endpoints/agents';
import type { CredentialEntry } from '@/lib/api/endpoints/credentials';
import {
  agentRole,
  credentialValue,
  domainsOf,
  emptyCredentialValue,
  grantableAgentGroups,
  isCredentialFormValid,
  toCredentialPatch,
  toNewCredential,
} from './credentialForm';

const login: CredentialEntry = {
  id: 4,
  teamId: 1,
  kind: 'web_login',
  label: 'GitHub',
  projectId: null,
  projectKey: null,
  loginUrl: 'https://github.com/login',
  allowedDomains: ['https://gist.github.com', 'http://localhost:8080'],
  username: 'bot@example.com',
  notes: '',
  publicKey: null,
  runtime: null,
  method: null,
  secrets: ['password', 'totpSecret'],
  agentIds: [],
  grants: [],
  serverUrl: null,
  status: null,
  statusDetail: null,
  createdAt: '2026-09-23T10:00:00.000Z',
  updatedAt: '2026-09-23T10:00:00.000Z',
};

describe('credential form', () => {
  it('sends a new web login with its secrets and domains', () => {
    const value = {
      ...emptyCredentialValue('web_login'),
      label: ' GitHub ',
      loginUrl: 'https://github.com/login',
      allowedDomains: 'gist.github.com\n  api.github.com, ',
      username: 'bot@example.com',
      password: ' fake pass ',
      totpSecret: ' JBSWY3DPEHPK3PXP ',
    };
    assert.equal(isCredentialFormValid(value, null), true);
    assert.deepEqual(toNewCredential(value), {
      kind: 'web_login',
      label: 'GitHub',
      projectId: null,
      loginUrl: 'https://github.com/login',
      allowedDomains: ['gist.github.com', 'api.github.com'],
      username: 'bot@example.com',
      notes: '',
      password: ' fake pass ',
      totpSecret: 'JBSWY3DPEHPK3PXP',
    });
    assert.equal(isCredentialFormValid({ ...value, password: '' }, null), false);
    assert.equal(isCredentialFormValid({ ...value, label: ' ' }, null), false);
  });

  it('keeps the stored secrets of an edit unless one is typed or removed', () => {
    const value = credentialValue(login);
    assert.equal(value.allowedDomains, 'gist.github.com\nhttp://localhost:8080');
    assert.equal(isCredentialFormValid(value, login), true);
    const patch = toCredentialPatch(value);
    assert.equal('password' in patch, false);
    assert.equal('totpSecret' in patch, false);
    assert.deepEqual(patch.allowedDomains, ['gist.github.com', 'http://localhost:8080']);

    assert.equal(toCredentialPatch({ ...value, password: 'new' }).password, 'new');
    assert.equal(toCredentialPatch({ ...value, removeTotp: true }).totpSecret, null);
  });

  it('sends only the fields of the kind', () => {
    const secret = { ...emptyCredentialValue('secret'), label: 'TOKEN', value: 'x', username: 'u' };
    assert.deepEqual(toNewCredential(secret), {
      kind: 'secret',
      label: 'TOKEN',
      projectId: null,
      notes: '',
      value: 'x',
    });
    const key = { ...emptyCredentialValue('ssh_key'), label: 'Deploy', projectId: 3 };
    assert.equal(isCredentialFormValid(key, null), true);
    assert.deepEqual(toNewCredential(key), {
      kind: 'ssh_key',
      label: 'Deploy',
      projectId: 3,
      notes: '',
    });
    assert.equal(isCredentialFormValid(emptyCredentialValue('api_key'), null), false);
  });

  it('sends a runtime login with its runtime and how it signs in', () => {
    const login = {
      ...emptyCredentialValue('runtime_login'),
      label: 'Claude Code',
      value: ' sk-ant-oat01-x ',
    };
    assert.equal(isCredentialFormValid(login, null), true);
    assert.deepEqual(toNewCredential(login), {
      kind: 'runtime_login',
      label: 'Claude Code',
      projectId: null,
      runtime: 'claude',
      method: 'oauth_token',
      notes: '',
      value: 'sk-ant-oat01-x',
    });
    // Codex takes an API key here, never a token.
    assert.equal(isCredentialFormValid({ ...login, runtime: 'codex' }, null), false);
    assert.equal(
      isCredentialFormValid({ ...login, runtime: 'codex', method: 'api_key' }, null),
      true,
    );
    assert.equal(isCredentialFormValid({ ...login, value: '' }, null), false);
  });

  it('splits domains on lines, commas and spaces', () => {
    assert.deepEqual(domainsOf(' a.com,b.com\n\nc.com d.com '), [
      'a.com',
      'b.com',
      'c.com',
      'd.com',
    ]);
    assert.deepEqual(domainsOf(''), []);
  });
});

function agent(id: number, username: string, projects: { id: number; name: string }[] = []) {
  return {
    id,
    name: username,
    username,
    kind: 'external',
    template: false,
    projects: projects.map((p) => ({
      ...p,
      key: p.name,
      roleId: null,
      roleName: null,
      instructions: '',
    })),
  } as unknown as AiAgent;
}

describe('grantable agents', () => {
  const mkt = { id: 1, name: 'Marketing' };
  const ops = { id: 2, name: 'Ops' };
  const agents = [
    agent(5, 'writer', [mkt]),
    agent(1, 'master', [mkt, ops]),
    agent(3, 'hermes-mkt-coordinator', [mkt]),
    agent(4, 'hermes-ops-coordinator', [ops]),
    { ...agent(6, 'designer'), template: true } as AiAgent,
  ];

  it('names the Home agent, the coordinators and the project agents', () => {
    assert.equal(agentRole({ username: 'master' }), 'home');
    assert.equal(agentRole({ username: 'hermes-mkt-coordinator' }), 'coordinator');
    assert.equal(agentRole({ username: 'writer' }), 'specialist');
  });

  it('groups the Home agent first, then each project with its coordinator ahead', () => {
    const groups = grantableAgentGroups(agents, null);
    assert.deepEqual(
      groups.map((group) => [group.project?.name ?? null, group.agents.map((a) => a.id)]),
      [
        [null, [1]],
        ['Marketing', [3, 5]],
        ['Ops', [4]],
      ],
    );
  });

  it('offers a runtime login only to the agents running on its runtime', () => {
    const onClaude = {
      ...agent(8, 'coder', [mkt]),
      runtimePolicy: { runtime: 'claude' },
    } as AiAgent;
    const groups = grantableAgentGroups([...agents, onClaude], null, 'claude');
    assert.deepEqual(
      groups.map((group) => group.agents.map((a) => a.id)),
      [[8]],
    );
  });

  it('offers only the agents of the project a credential is limited to', () => {
    const groups = grantableAgentGroups(agents, ops.id);
    assert.deepEqual(
      groups.map((group) => group.agents.map((a) => a.id)),
      [[1], [4]],
    );
  });
});
