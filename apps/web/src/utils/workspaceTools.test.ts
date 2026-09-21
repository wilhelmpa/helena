import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { WorkspaceRuntimeEnv } from './runtimeEnv';
import { coordinatorId, workspaceFrameOrigins, workspaceTools } from './workspaceTools';

const config: WorkspaceRuntimeEnv = {
  openClawUrl: 'https://openclaw.example.com/root/',
  coordinatorId: 'coordinator',
  projectCoordinators: { VERV: 'verve-agent' },
  terminalUrl: '',
  codeUrl: 'https://code.example.com/',
  projectWorkspacePaths: { VERV: '/workspace/verve' },
  browserUrl: 'https://browser.example.com/',
  filesUrl: 'https://files.example.com/',
  paperlessUrl: 'https://paperless.example.com/',
  inboxUrl: 'https://inbox.example.com/',
  connectionsUrl: '',
};

describe('workspaceTools', () => {
  it('uses the global coordinator outside a project', () => {
    assert.equal(coordinatorId(config, null), 'coordinator');
    assert.equal(
      workspaceTools(config, null).chat.url,
      'https://openclaw.example.com/root/chat/coordinator',
    );
  });

  it('uses configured project coordinators and workspace paths', () => {
    const tools = workspaceTools(config, 'verv');
    assert.equal(tools.chat.url, 'https://openclaw.example.com/root/chat/verve-agent');
    assert.equal(tools.terminal.url, 'https://openclaw.example.com/root/focus/terminal');
    assert.equal(tools.code.url, 'https://code.example.com/?folder=%2Fworkspace%2Fverve');
  });

  it('uses the deterministic project coordinator while provisioning is pending', () => {
    assert.equal(coordinatorId(config, 'OPS'), 'ops-coordinator');
    assert.equal(
      coordinatorId({ ...config, projectCoordinators: {} }, 'VERV'),
      'verve-coordinator',
    );
  });

  it('prefers successfully provisioned project resources over static mappings', () => {
    const resources = [
      {
        kind: 'coordinator',
        id: 'demo-coordinator',
        url: 'https://openclaw.example.com/chat/demo-coordinator',
      },
      {
        kind: 'workspace',
        id: '/projects/demo',
        url: 'https://code.example.com/?folder=%2Fprojects%2Fdemo',
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
    assert.equal(coordinatorId(config, 'DEMO', resources), 'demo-coordinator');
    assert.equal(tools.chat.url, 'https://openclaw.example.com/chat/demo-coordinator');
    assert.equal(tools.code.url, 'https://code.example.com/?folder=%2Fprojects%2Fdemo');
    assert.equal(
      tools.files.url,
      'https://files.example.com/apps/files/files?dir=%2FProjects%2Fdemo',
    );
    assert.equal(tools.browser.url, 'https://browser.example.com/focus/dashboard/demo-coordinator');
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
      'https://openclaw.example.com',
      'https://code.example.com',
      'https://browser.example.com',
      'https://files.example.com',
      'https://paperless.example.com',
      'https://inbox.example.com',
    ]);
  });

  it('does not expose non-http workspace URLs to an iframe', () => {
    const unsafe = { ...config, browserUrl: 'javascript:alert(1)' };
    assert.equal(workspaceTools(unsafe, null).browser.url, '');
    assert.ok(!workspaceFrameOrigins(unsafe).includes('null'));
  });
});
