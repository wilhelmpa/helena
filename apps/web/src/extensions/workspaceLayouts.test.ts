import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  layoutProblem,
  registerWorkspaceLayout,
  workspaceLayouts,
  type WorkspaceLayout,
} from './workspaceLayouts';
import { pluginLayout, pluginToolRef } from './pluginWorkspaceLayouts';

describe('workspace layouts', () => {
  it('registers the built-ins in menu order', () => {
    const layouts = workspaceLayouts.list().sort((a, b) => a.order - b.order);
    assert.deepEqual(
      layouts.map((layout) => layout.id),
      ['standard', 'chat-left', 'chat-tool', 'two-tools', 'tool-full'],
    );
    assert.deepEqual(
      layouts.filter((layout) => layout.optionalPanel).map((layout) => layout.id),
      ['standard'],
    );
    for (const layout of layouts) assert.equal(layoutProblem(layout), null, layout.id);
  });

  it('refuses a layout that cannot be drawn', () => {
    const main = { id: 'main', shows: 'main', side: 'panel' } as const;
    assert.match(layoutProblem({ areas: [], full: false }) ?? '', /exactly one main/);
    assert.match(layoutProblem({ areas: [main, main], full: false }) ?? '', /used twice/);
    assert.match(
      layoutProblem({
        areas: [main, { id: 'x', shows: 'tool', side: 'page' }],
        full: false,
      }) ?? '',
      /names none/,
    );
    assert.match(
      layoutProblem({ areas: [main, { id: 'p', shows: 'page', side: 'panel' }], full: false }) ??
        '',
      /page side/,
    );
    assert.match(
      layoutProblem({
        areas: [main, { id: 'p', shows: 'page', side: 'page' }],
        full: true,
      }) ?? '',
      /full layout/,
    );
  });

  it('takes a plugin’s layout under its own id, with its own tools by their short id', () => {
    assert.equal(pluginToolRef('acme', 'chat'), 'chat');
    assert.equal(pluginToolRef('acme', 'board'), 'plugin:acme:board');
    assert.equal(pluginToolRef('acme', 'plugin:other:x'), 'plugin:other:x');
    const layout = pluginLayout(
      'acme',
      { id: 'review', label: { en: 'Review' } },
      {
        areas: [
          { id: 'page', shows: 'page', side: 'page' },
          { id: 'main', shows: 'main', side: 'panel' },
          { id: 'board', shows: 'tool', tool: 'board', side: 'panel' },
        ],
      },
    ) as WorkspaceLayout;
    assert.equal(layout.id, 'plugin:acme:review');
    assert.equal(layout.areas[2]?.tool, 'plugin:acme:board');
    assert.equal(layout.optionalPanel, false);
    const off = registerWorkspaceLayout(layout, 'acme');
    try {
      assert.equal(workspaceLayouts.pluginOf('plugin:acme:review'), 'acme');
    } finally {
      off();
    }
    assert.equal(pluginLayout('acme', { id: 'x', label: { en: 'X' } }, {}), null);
    assert.throws(() =>
      registerWorkspaceLayout({ ...layout, id: 'plugin:acme:broken', areas: [] }, 'acme'),
    );
  });
});
