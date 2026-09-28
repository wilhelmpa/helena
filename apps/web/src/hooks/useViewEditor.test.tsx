import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { act, useEffect, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { JSDOM } from 'jsdom';
import { NextIntlClientProvider } from 'next-intl';
import type { View } from '@/lib/api/endpoints/views';
import { defaultViewSettings } from '@/utils/viewSettings';
import { viewDraftChanged } from '@/utils/viewDraft';
import messages from '../../messages/en/views.json';

const { mock } = createRequire(import.meta.url)('bun:test') as {
  mock: { module(specifier: string, factory: () => Record<string, unknown>): void };
};

let changeRows: ((update: (rows: View[]) => View[]) => void) | null = null;
let lastSaved: View | null = null;
let lastCreated: View | null = null;

mock.module('@/services/views.service', () => ({
  normalizeView: (view: View) => view,
  useCreateView: () => ({
    mutateAsync: async ({ input }: { input: Partial<View> }) => {
      const created = { ...sampleView(2), ...input } as View;
      lastCreated = created;
      changeRows?.((rows) => [...rows, created]);
      return created;
    },
  }),
  useUpdateView: () => ({
    mutateAsync: async ({ id, input }: { id: number; input: Partial<View> }) => {
      changeRows?.((rows) => rows.map((row) => (row.id === id ? { ...row, ...input } : row)));
      lastSaved = { ...sampleView(id), ...input };
      return lastSaved;
    },
  }),
  useDeleteView: () => ({ mutateAsync: async () => undefined }),
  useReorderViews: () => ({ mutate: () => undefined }),
}));

const { useViewEditor } = await import('./useViewEditor');
let editor: ReturnType<typeof useViewEditor>;

function sampleView(id = 1): View {
  return {
    id,
    projectId: 1,
    folderId: null,
    name: 'News',
    icon: null,
    filters: { conditions: [] },
    display: { layout: 'table', ...defaultViewSettings('table') },
    position: 0,
    shareToken: null,
    shareExtended: false,
    favorite: false,
    createdAt: '2026-09-28T00:00:00Z',
  };
}

function Probe({ selectedId, userId = 'alice' }: { selectedId: number | null; userId?: string }) {
  const [rows, setRows] = useState([sampleView()]);
  const [selected, setSelected] = useState(selectedId);
  const current = useViewEditor('TEST', rows, selected, setSelected, userId);
  useEffect(() => {
    changeRows = setRows;
    editor = current;
  }, [current]);
  return null;
}

function setup() {
  const dom = new JSDOM('<div id="root"></div>', { url: 'https://plan.test' });
  const globals = ['window', 'document', 'localStorage', 'IS_REACT_ACT_ENVIRONMENT'];
  const previous = new Map(
    globals.map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]),
  );
  for (const key of globals) {
    Object.defineProperty(globalThis, key, {
      configurable: true,
      value:
        key === 'IS_REACT_ACT_ENVIRONMENT'
          ? true
          : (dom.window as unknown as Record<string, unknown>)[key],
    });
  }
  let root: Root = createRoot(dom.window.document.getElementById('root')!);
  const render = (selectedId: number | null, userId?: string) =>
    act(() =>
      root.render(
        <NextIntlClientProvider locale="en" timeZone="UTC" messages={{ views: messages }}>
          <Probe selectedId={selectedId} userId={userId} />
        </NextIntlClientProvider>,
      ),
    );
  return {
    render,
    remount(selectedId: number | null, userId?: string) {
      act(() => root.unmount());
      root = createRoot(dom.window.document.getElementById('root')!);
      render(selectedId, userId);
    },
    cleanup() {
      act(() => root.unmount());
      dom.window.close();
      changeRows = null;
      lastSaved = null;
      lastCreated = null;
      for (const [key, descriptor] of previous) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else Reflect.deleteProperty(globalThis, key);
      }
    },
  };
}

test('saved view draft survives navigation and reload, then reset removes it for this user', () => {
  const app = setup();
  try {
    app.render(1);
    act(() =>
      editor.changeFilters({
        conditions: [{ id: 'c0', field: 'statusType', op: 'is', values: ['started'] }],
      }),
    );
    act(() =>
      editor.changeSettings({
        ...editor.settings,
        group: 'priority',
        hiddenGroups: ['p-none'],
        sort: { field: 'created', dir: 'desc' },
      }),
    );
    assert.equal(editor.changed, true);
    act(() => editor.selectView(null));
    act(() => editor.selectView(1));
    assert.deepEqual(editor.settings.hiddenGroups, ['p-none']);
    app.remount(1);
    assert.equal(editor.filters.conditions[0]?.field, 'statusType');
    assert.equal(editor.settings.group, 'priority');
    assert.equal(editor.settings.sort.field, 'created');
    app.remount(1, 'bob');
    assert.equal(editor.changed, false);
    app.remount(1);
    act(() => editor.resetChanges());
    assert.equal(editor.changed, false);
    app.remount(1);
    assert.equal(editor.settings.group, 'status');
  } finally {
    app.cleanup();
  }
});

test('saving a draft updates the view and clears the local draft', async () => {
  const app = setup();
  try {
    app.render(1);
    act(() => editor.changeSettings({ ...editor.settings, group: 'assignee' }));
    await act(async () => {
      await editor.saveEdits();
    });
    assert.equal(lastSaved?.display.group, 'assignee');
    assert.equal(lastSaved?.name, 'News');
    assert.equal(editor.changed, false);
    app.remount(1);
    assert.equal(editor.settings.group, 'status');
  } finally {
    app.cleanup();
  }
});

test('new view starts from the current filters and layout with a prefilled name', async () => {
  const app = setup();
  try {
    app.render(1);
    act(() =>
      editor.changeFilters({
        conditions: [{ id: 'c0', field: 'priority', op: 'is', values: ['high'] }],
      }),
    );
    act(() => editor.changeSettings({ ...editor.settings, hiddenGroups: ['c2'] }));
    act(() => editor.beginNewView('current'));
    assert.equal(editor.draftName, 'News');
    assert.equal(editor.view, 'table');
    await act(async () => {
      await editor.saveEdits();
    });
    assert.equal(lastCreated?.filters.conditions[0]?.field, 'priority');
    assert.deepEqual(lastCreated?.display.hiddenGroups, ['c2']);
    assert.equal(lastCreated?.display.layout, 'table');
  } finally {
    app.cleanup();
  }
});

test('filters on All survive reload for the same user', () => {
  const app = setup();
  try {
    app.render(null);
    act(() =>
      editor.changeFilters({
        conditions: [{ id: 'c0', field: 'priority', op: 'is', values: ['high'] }],
      }),
    );
    app.remount(null);
    assert.equal(editor.filters.conditions[0]?.field, 'priority');
    app.remount(null, 'bob');
    assert.equal(editor.filters.conditions.length, 0);
  } finally {
    app.cleanup();
  }
});

test('saved JSON key order does not leave a view marked as changed', () => {
  const filters = {
    conditions: [{ id: 'c0', field: 'priority', op: 'is' as const, values: ['high'] }],
  };
  const display = { layout: 'kanban' as const, ...defaultViewSettings('kanban') };
  const reordered = Object.fromEntries(Object.entries(display).reverse()) as typeof display;
  const dbFilters = {
    conditions: [{ values: ['high'], op: 'is' as const, field: 'priority', id: 'c0' }],
  };
  assert.equal(
    viewDraftChanged({ filters: dbFilters, display: reordered }, { filters, display }),
    false,
  );
});
