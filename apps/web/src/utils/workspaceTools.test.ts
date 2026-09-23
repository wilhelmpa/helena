import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { WorkspaceRuntimeEnv } from './runtimeEnv';
import {
  nativeChatProjectKey,
  preferredAgentUsername,
  workspaceFrameOrigins,
  workspaceTools,
} from './workspaceTools';

const config: WorkspaceRuntimeEnv = {
  homeChatProjectKey: 'PRIV',
  terminalUrl: 'https://plan.example.com/focus/terminal-project/',
  codeUrl: 'https://plan.example.com/workspace/code/',
  projectWorkspacePaths: { VERV: '/workspace/verve' },
  browserUrl: 'https://browser.example.com/',
  filesUrl: 'https://files.example.com/',
  inboxUrl: 'https://inbox.example.com/',
  connectionsUrl: '',
  vaultEnabled: true,
};

describe('workspaceTools', () => {
  it('uses the global master agent outside a project', () => {
    assert.equal(preferredAgentUsername(null), 'master');
    assert.equal(workspaceTools(config, null).chat.url, '');
  });

  it('anchors the native Home chat while preserving its master agent', () => {
    assert.equal(nativeChatProjectKey(config, null), 'PRIV');
    assert.equal(preferredAgentUsername(null), 'master');
    assert.equal(nativeChatProjectKey(config, 'verv'), 'VERV');
    assert.equal(preferredAgentUsername('VERV'), 'hermes-verve-coordinator');
  });

  it('uses configured project agents and workspace paths', () => {
    const tools = workspaceTools(config, 'verv');
    assert.equal(tools.chat.url, '');
    assert.equal(tools.terminal.url, 'https://plan.example.com/focus/terminal-project/verve');
    assert.equal(
      tools.code.url,
      'https://plan.example.com/workspace/code/?folder=%2Fworkspace%2Fverve',
    );
  });

  it('uses the deterministic project agent while provisioning is pending', () => {
    assert.equal(preferredAgentUsername('OPS'), 'hermes-ops-coordinator');
    assert.equal(preferredAgentUsername('VERV'), 'hermes-verve-coordinator');
  });

  it('prefers successfully provisioned project resources over static mappings', () => {
    const resources = [
      {
        kind: 'workspace',
        id: '/projects/demo',
        url: 'https://plan.example.com/workspace/code/?folder=%2Fprojects%2Fdemo',
      },
      {
        kind: 'terminal',
        id: 'terminal-project:demo',
        url: 'https://plan.example.com/focus/terminal-project/?arg=demo',
      },
      {
        kind: 'files',
        id: '/Projects/demo',
        url: 'https://files.example.com/apps/files/files?dir=%2FProjects%2Fdemo',
      },
      {
        kind: 'browser',
        id: 'demo-coordinator:volition-browser',
        url: 'https://browser.example.com/focus/dashboard/demo-coordinator',
      },
    ];
    const tools = workspaceTools(config, 'DEMO', resources);
    assert.equal(preferredAgentUsername('DEMO'), 'hermes-demo-coordinator');
    assert.equal(tools.chat.url, '');
    assert.equal(
      tools.code.url,
      'https://plan.example.com/workspace/code/?folder=%2Fprojects%2Fdemo',
    );
    assert.equal(tools.terminal.url, 'https://plan.example.com/focus/terminal-project/demo');
    assert.equal(
      tools.files.url,
      'https://files.example.com/apps/files/files?dir=%2FProjects%2Fdemo',
    );
    assert.equal(tools.browser.url, 'https://browser.example.com/focus/dashboard/demo-coordinator');
  });

  it('uses the current code route when a stored workspace URL is stale', () => {
    const tools = workspaceTools({ ...config, codeUrl: 'https://plan.example.com/code/' }, 'DEMO', [
      {
        kind: 'workspace',
        id: '/srv/volition/workspaces/projects/demo',
        url: 'https://plan.example.com/workspace/code/?folder=%2Fsrv%2Fvolition%2Fworkspaces%2Fprojects%2Fdemo',
      },
    ]);
    assert.equal(
      tools.code.url,
      'https://plan.example.com/code/?folder=%2Fsrv%2Fvolition%2Fworkspaces%2Fprojects%2Fdemo',
    );
  });

  it('uses the scoped terminal when the global terminal URL is configured', () => {
    const tools = workspaceTools(
      { ...config, terminalUrl: 'https://plan.example.com/terminal' },
      'VOL',
      [
        {
          kind: 'terminal',
          id: 'terminal-project:vol',
          url: 'https://plan.example.com/focus/terminal-project/?arg=vol',
        },
      ],
    );
    assert.equal(tools.terminal.url, 'https://plan.example.com/focus/terminal-project/vol');
  });

  it('rejects a provisioned resource outside its configured service origin', () => {
    const tools = workspaceTools(config, 'DEMO', [
      { kind: 'files', id: '/Projects/demo', url: 'https://attacker.example/demo' },
      {
        kind: 'browser',
        id: 'demo-coordinator:volition-browser',
        url: 'https://attacker.example/focus/dashboard/demo-coordinator',
      },
    ]);
    assert.equal(tools.files.url, 'https://files.example.com/');
    assert.equal(tools.browser.url, 'https://browser.example.com/');
  });

  it('returns unique valid frame origins only', () => {
    assert.deepEqual(workspaceFrameOrigins(config), [
      'https://plan.example.com',
      'https://browser.example.com',
      'https://files.example.com',
      'https://inbox.example.com',
    ]);
  });

  it('does not expose non-http workspace URLs to an iframe', () => {
    const unsafe = { ...config, browserUrl: 'javascript:alert(1)' };
    assert.equal(workspaceTools(unsafe, null).browser.url, '');
    assert.ok(!workspaceFrameOrigins(unsafe).includes('null'));
  });
});
