import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { AiAgent } from '@/lib/api/endpoints/agents';
import type { CredentialEntry } from '@/lib/api/endpoints/credentials';
import {
  agentRole,
  credentialValue,
  domainsOf,
  emptyCredentialValue,
  envNameOf,
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
  provider: null,
  baseUrl: null,
  model: null,
  allowPrivateAddress: false,
  keySource: null,
  envName: null,
  value: null,
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
      envName: null,
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

  it('sends a decision model with its service, and a key only when it is stored here', () => {
    const jev = { ...emptyCredentialValue('decision_model'), label: 'Jev' };
    // TypeSafe needs a key.
    assert.equal(isCredentialFormValid(jev, null), false);
    assert.deepEqual(toNewCredential({ ...jev, value: ' ts-key ' }), {
      kind: 'decision_model',
      label: 'Jev',
      projectId: null,
      provider: 'typesafe',
      allowPrivateAddress: false,
      keySource: 'stored',
      notes: '',
      value: 'ts-key',
    });
    // The local Laya preset reads its key on the server: nothing to enter, no value sent.
    const laya = {
      ...jev,
      label: 'Laya',
      provider: 'compatible',
      baseUrl: 'http://127.0.0.1:8791',
      model: 'laya-browser',
      keySource: 'local-laya' as const,
      value: 'ignored',
    };
    assert.equal(isCredentialFormValid(laya, null), true);
    const sent = toNewCredential(laya);
    assert.equal(sent.keySource, 'local-laya');
    assert.equal('value' in sent, false);
    // A compatible server needs its address; the local address allowance is its alone.
    assert.equal(
      isCredentialFormValid({ ...laya, keySource: 'stored', baseUrl: ' ' }, null),
      false,
    );
    assert.equal(
      toNewCredential({ ...laya, provider: 'vercel', allowPrivateAddress: true })
        .allowPrivateAddress,
      false,
    );
    // The local AI preset of the logit backend brings its own address and key.
    const logit = {
      ...jev,
      label: 'Lokale KI',
      provider: 'local-logit',
      baseUrl: '',
      model: 'Qwen3.5-4B-GGUF',
      keySource: 'local-ai' as const,
    };
    assert.equal(isCredentialFormValid(logit, null), true);
    assert.equal(toNewCredential(logit).keySource, 'local-ai');
    // A logit backend on an own server needs its address but no key, and may be local.
    const own = { ...logit, keySource: 'stored' as const, baseUrl: 'http://192.168.2.20:8080' };
    assert.equal(isCredentialFormValid(own, null), true);
    assert.equal(toNewCredential({ ...own, allowPrivateAddress: true }).allowPrivateAddress, true);
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

  it('gives an API key to the agents as an environment variable only when asked to', () => {
    const key = {
      ...emptyCredentialValue('api_key'),
      label: 'Cloudflare VERVE',
      value: 'token',
      envEnabled: true,
      envName: envNameOf('cloudflare-api token'),
    };
    assert.equal(key.envName, 'CLOUDFLARE_API_TOKEN');
    assert.equal(isCredentialFormValid(key, null), true);
    assert.deepEqual(toNewCredential(key), {
      kind: 'api_key',
      label: 'Cloudflare VERVE',
      projectId: null,
      notes: '',
      value: 'token',
      envName: 'CLOUDFLARE_API_TOKEN',
    });
    // Turned off, the name is taken away; a name that is not one is refused.
    assert.equal(toCredentialPatch({ ...key, envEnabled: false }).envName, null);
    assert.equal(isCredentialFormValid({ ...key, envName: '1TOKEN' }, null), false);
    assert.equal(isCredentialFormValid({ ...key, envName: '' }, null), false);
  });

  it('sends a plain variable with its name and value, and reads one back', () => {
    const variable = {
      ...emptyCredentialValue('variable'),
      label: 'Cloudflare account',
      envName: 'CLOUDFLARE_ACCOUNT_ID',
      value: '42a48d019d819276f79d3cf42750689b',
    };
    assert.equal(emptyCredentialValue('variable').envEnabled, true);
    assert.equal(isCredentialFormValid(variable, null), true);
    assert.deepEqual(toNewCredential(variable), {
      kind: 'variable',
      label: 'Cloudflare account',
      projectId: null,
      notes: '',
      value: '42a48d019d819276f79d3cf42750689b',
      envName: 'CLOUDFLARE_ACCOUNT_ID',
    });
    assert.equal(isCredentialFormValid({ ...variable, envName: '' }, null), false);
    const entry: CredentialEntry = {
      ...login,
      kind: 'variable',
      secrets: [],
      envName: 'CLOUDFLARE_ACCOUNT_ID',
      value: '42a48d019d819276f79d3cf42750689b',
    };
    assert.deepEqual(
      { envName: credentialValue(entry).envName, value: credentialValue(entry).value },
      { envName: 'CLOUDFLARE_ACCOUNT_ID', value: '42a48d019d819276f79d3cf42750689b' },
    );
    assert.equal(credentialValue({ ...login, kind: 'api_key', envName: 'X_KEY' }).envEnabled, true);
    assert.equal(credentialValue({ ...login, kind: 'api_key' }).envEnabled, false);
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
