import { describe, expect, it } from 'bun:test';
import { panelTools } from './panelTools';
import { pluginFrameUrl, pluginPanelToolId } from './pluginPanelTools';

// The panel's tools moved from hard-wired lists to the panel tool registry (@helena/sdk
// UI slot `panel-tool`). The built-ins keep what the lists said.

describe('panel tools', () => {
  it('registers the built-ins with the order, header and scope the lists had', () => {
    const tools = panelTools.list().sort((a, b) => a.order - b.order);
    expect(tools.map((tool) => tool.id)).toEqual([
      'chat',
      'terminal',
      'code',
      'browser',
      'mail',
      'inbox',
      'connections',
    ]);
    expect(tools.filter((tool) => tool.inHeader).map((tool) => tool.id)).toEqual([
      'chat',
      'terminal',
      'code',
      'browser',
      'mail',
    ]);
    expect(tools.filter((tool) => tool.phonePinned).map((tool) => tool.id)).toEqual(['chat']);
    expect(tools.filter((tool) => tool.projectScoped).map((tool) => tool.id)).toEqual([
      'terminal',
      'code',
    ]);
    expect(panelTools.get('code')?.view).toEqual({ kind: 'workspace' });
    expect(panelTools.get('chat')?.view.kind).toBe('component');
  });

  it('gives a plugin tool an id of its own and serves its page from the api', () => {
    expect(pluginPanelToolId('hello-helena', 'chat')).toBe('plugin:hello-helena:chat');
    expect(pluginFrameUrl('hello-helena', 'panel.html')).toMatch(
      /\/plugins\/hello-helena\/ui\/panel\.html$/,
    );
    expect(pluginFrameUrl('x', 'https://example.com/app')).toBe('https://example.com/app');
  });
});
