import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { panelTools } from './panelTools';
import { pluginFrameUrl, pluginPanelToolId } from './pluginPanelTools';

// The panel's tools moved from hard-wired lists to the panel tool registry (@helena/sdk
// UI slot `panel-tool`). The built-ins keep what the lists said.

describe('panel tools', () => {
  it('registers the built-ins with the order, header and scope the lists had', () => {
    const tools = panelTools.list().sort((a, b) => a.order - b.order);
    assert.deepEqual(
      tools.map((tool) => tool.id),
      ['chat', 'terminal', 'code', 'notes', 'browser', 'mail', 'inbox', 'connections'],
    );
    assert.deepEqual(
      tools.filter((tool) => tool.inHeader).map((tool) => tool.id),
      ['chat', 'terminal', 'code', 'notes', 'browser', 'mail'],
    );
    assert.deepEqual(
      tools.filter((tool) => tool.phonePinned).map((tool) => tool.id),
      ['chat'],
    );
    assert.deepEqual(
      tools.filter((tool) => tool.projectScoped).map((tool) => tool.id),
      ['terminal', 'code', 'notes'],
    );
    // Only the notes ask whether this origin has them.
    assert.deepEqual(
      tools.filter((tool) => tool.available).map((tool) => tool.id),
      ['notes'],
    );
    assert.deepEqual(panelTools.get('code')?.view, { kind: 'workspace' });
    assert.equal(panelTools.get('chat')?.view.kind, 'component');
  });

  it('gives a plugin tool an id of its own and serves its page from the api', () => {
    assert.equal(pluginPanelToolId('hello-helena', 'chat'), 'plugin:hello-helena:chat');
    assert.match(
      pluginFrameUrl('hello-helena', 'panel.html'),
      /\/plugins\/hello-helena\/ui\/panel\.html$/,
    );
    assert.equal(pluginFrameUrl('x', 'https://example.com/app'), 'https://example.com/app');
  });
});
