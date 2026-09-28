import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { workspaceLayout, type WorkspaceLayout } from '@/extensions/workspaceLayouts';
import {
  layoutGeometry,
  nextLayoutId,
  pickAreaTool,
  resolveWorkspaceLayout,
  type ResolveInput,
} from './workspaceLayout';

const TOOLS = ['chat', 'terminal', 'code', 'browser', 'mail', 'inbox', 'connections'];

function layout(id: string): WorkspaceLayout {
  const found = workspaceLayout(id);
  assert.ok(found, id);
  return found;
}

function resolve(id: string, input: Partial<ResolveInput> = {}) {
  return resolveWorkspaceLayout({
    layout: layout(id),
    activeTool: 'browser',
    areaTools: {},
    open: true,
    pinned: false,
    room: 1920,
    routedTool: null,
    tools: TOOLS,
    ...input,
  });
}

const shape = (resolved: ReturnType<typeof resolve>) =>
  resolved.areas.map((area) => `${area.id}:${area.tool ?? 'page'}${area.fill ? '*' : ''}`);

describe('resolveWorkspaceLayout', () => {
  it('offers a 50/50 page and tool layout without losing the existing layouts', () => {
    assert.deepEqual(shape(resolve('page-tool-half')), ['page:page*', 'main:browser']);
    assert.deepEqual(shape(resolve('two-tools')), [
      'page:page*',
      'main:browser',
      'second:terminal',
    ]);
    assert.equal(resolve('tool-full').full, true);
  });
  it('shows the standard layout as page | tool, and the page alone while the panel is closed', () => {
    assert.deepEqual(shape(resolve('standard')), ['page:page*', 'main:browser']);
    const closed = resolve('standard', { open: false });
    assert.deepEqual(shape(closed), ['page:page*']);
    assert.equal(closed.closable, true);
    assert.equal(closed.mainTool, null);
  });

  it('keeps the panel on the dual kiosk, where it cannot close', () => {
    const dual = resolve('standard', { open: false, pinned: true });
    assert.deepEqual(shape(dual), ['page:page*', 'main:browser']);
    assert.equal(dual.closable, false);
  });

  it('docks the chat beside the page and moves the active chat out of the panel', () => {
    const resolved = resolve('chat-left', { activeTool: 'chat', room: 1600 });
    assert.deepEqual(shape(resolved), ['page:page*', 'dock:chat', 'main:browser']);
    assert.deepEqual(resolved.shownTools, ['chat', 'browser']);
    assert.equal(resolved.closable, false);
  });

  it('lets the chat take the page’s place on a screen narrower than 1600px', () => {
    assert.deepEqual(shape(resolve('chat-left', { room: 0 })), ['dock:chat*', 'main:browser']);
  });

  it('never shows the chat twice beside a chat page', () => {
    // The docked chat steps aside for the chat page …
    assert.deepEqual(shape(resolve('chat-left', { routedTool: 'chat', room: 1600 })), [
      'page:page*',
      'main:browser',
    ]);
    // … the pinned panel of the dual kiosk shows another tool …
    assert.deepEqual(
      shape(resolve('standard', { activeTool: 'chat', routedTool: 'chat', pinned: true })),
      ['page:page*', 'main:terminal'],
    );
    // … and the standard panel closes (Shell).
    assert.deepEqual(shape(resolve('standard', { activeTool: 'chat', routedTool: 'chat' })), [
      'page:page*',
    ]);
    // Without the page on screen, the chat area stays.
    assert.deepEqual(shape(resolve('chat-tool', { routedTool: 'chat' })), [
      'chat:chat*',
      'main:browser',
    ]);
  });

  it('puts two tools side by side and keeps each tool in one area', () => {
    assert.deepEqual(shape(resolve('two-tools')), [
      'page:page*',
      'main:browser',
      'second:terminal',
    ]);
    assert.deepEqual(shape(resolve('two-tools', { activeTool: 'terminal' })), [
      'page:page*',
      'main:chat',
      'second:terminal',
    ]);
    assert.deepEqual(shape(resolve('two-tools', { areaTools: { second: 'mail' } })), [
      'page:page*',
      'main:browser',
      'second:mail',
    ]);
  });

  it('ignores a stored tool that no longer exists, but keeps a plugin’s that loads later', () => {
    assert.deepEqual(shape(resolve('two-tools', { areaTools: { second: 'gone' } })), [
      'page:page*',
      'main:browser',
      'second:terminal',
    ]);
    assert.deepEqual(shape(resolve('two-tools', { areaTools: { second: 'plugin:x:y' } })), [
      'page:page*',
      'main:browser',
      'second:plugin:x:y',
    ]);
  });

  it('gives one tool the whole room', () => {
    const full = resolve('tool-full', { activeTool: 'terminal' });
    assert.deepEqual(shape(full), ['main:terminal']);
    assert.equal(full.full, true);
    assert.equal(full.pageVisible, false);
  });
});

describe('layoutGeometry', () => {
  const dock = () => 440;

  it('gives the page the rest and the panel its width', () => {
    const geometry = layoutGeometry({
      resolved: resolve('standard'),
      overlay: false,
      phone: false,
      dual: false,
      panelWidth: 620,
      dockWidth: dock,
      pageMin: 400,
    });
    assert.equal(geometry.columns, 'minmax(0,1fr) min(620px, calc((100% - 400px) / 1))');
    assert.deepEqual(geometry.column, { page: 1, main: 2 });
    assert.equal(geometry.pageColumn, '1');
  });

  it('lets the page run under a floating panel', () => {
    const geometry = layoutGeometry({
      resolved: resolve('standard'),
      overlay: true,
      phone: false,
      dual: false,
      panelWidth: 620,
      dockWidth: dock,
      pageMin: 400,
    });
    assert.equal(geometry.pageColumn, '1 / -1');
  });

  it('puts the panel on the dual kiosk’s second screen and the dock beside the page', () => {
    const geometry = layoutGeometry({
      resolved: resolve('chat-left', { room: 1600, pinned: true }),
      overlay: false,
      phone: false,
      dual: true,
      panelWidth: 620,
      dockWidth: dock,
      pageMin: 400,
    });
    assert.equal(geometry.columns, 'minmax(0,1fr) 440px 50vw');
    assert.deepEqual(geometry.column, { page: 1, dock: 2, main: 3 });
  });

  it('halves the panel for two tools and fills the window for a full one', () => {
    const two = layoutGeometry({
      resolved: resolve('two-tools', { pinned: true }),
      overlay: false,
      phone: false,
      dual: true,
      panelWidth: 1180,
      dockWidth: dock,
      pageMin: 400,
    });
    assert.equal(two.columns, 'minmax(0,1fr) calc(50vw / 2) calc(50vw / 2)');
    const single = layoutGeometry({
      resolved: resolve('two-tools'),
      overlay: false,
      phone: false,
      dual: false,
      panelWidth: 1180,
      dockWidth: dock,
      pageMin: 400,
    });
    assert.equal(
      single.columns,
      'minmax(0,1fr) min(590px, calc((100% - 400px) / 2)) min(590px, calc((100% - 400px) / 2))',
    );
    const chatTool = layoutGeometry({
      resolved: resolve('chat-tool'),
      overlay: false,
      phone: false,
      dual: false,
      panelWidth: 620,
      dockWidth: dock,
      pageMin: 400,
    });
    assert.equal(chatTool.columns, 'minmax(0,1fr) 620px');
    const full = layoutGeometry({
      resolved: resolve('tool-full'),
      overlay: false,
      phone: false,
      dual: true,
      panelWidth: 620,
      dockWidth: dock,
      pageMin: 400,
    });
    assert.equal(full.columns, 'minmax(0,1fr)');
    assert.equal(full.panelFills, true);
  });
});

describe('pickAreaTool', () => {
  it('sets the main area’s tool as the active one, and an own area’s per layout', () => {
    const resolved = resolve('two-tools');
    assert.deepEqual(pickAreaTool(resolved, 'main', 'mail'), {
      activeTool: 'mail',
      areaTools: {},
    });
    assert.deepEqual(pickAreaTool(resolved, 'second', 'code'), { areaTools: { second: 'code' } });
  });

  it('swaps a tool another area shows instead of showing it twice', () => {
    const resolved = resolve('two-tools');
    assert.deepEqual(pickAreaTool(resolved, 'second', 'browser'), {
      activeTool: 'terminal',
      areaTools: { second: 'browser' },
    });
    const docked = resolve('chat-left', { room: 1600 });
    assert.deepEqual(pickAreaTool(docked, 'main', 'chat'), {
      activeTool: 'chat',
      areaTools: { dock: 'browser' },
    });
  });

  it('changes nothing for the page or the tool already shown', () => {
    const resolved = resolve('standard');
    assert.deepEqual(pickAreaTool(resolved, 'page', 'chat'), { areaTools: {} });
    assert.deepEqual(pickAreaTool(resolved, 'main', 'browser'), { areaTools: {} });
  });
});

describe('nextLayoutId', () => {
  it('cycles through the layouts and wraps around', () => {
    const order = ['standard', 'chat-left', 'tool-full'];
    assert.equal(nextLayoutId(order, 'standard'), 'chat-left');
    assert.equal(nextLayoutId(order, 'tool-full'), 'standard');
    assert.equal(nextLayoutId(order, 'unknown'), 'standard');
  });
});
