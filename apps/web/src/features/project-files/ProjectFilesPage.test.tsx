import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { act, type ReactNode } from 'react';
import { JSDOM } from 'jsdom';
import { NextIntlClientProvider } from 'next-intl';
import { ShellHeaderSlotCtx } from '@/context/shellHeaderSlot';
import { PageToolbar } from '@/components/layout/PageToolbar';
import files from '../../../messages/en/files.json';
import notes from '../../../messages/en/notes.json';
import common from '../../../messages/en/common.json';

// Bun executes the web tests; ambient browser-project types remain Node/DOM.
const { mock } = createRequire(import.meta.url)('bun:test') as {
  mock: { module(specifier: string, factory: () => Record<string, unknown>): void };
};

let params = new URLSearchParams();
let boardsAllowed = true;
const destinations: string[] = [];
mock.module('next/navigation', () => ({
  useParams: () => ({ projectKey: 'TEST' }),
  useSearchParams: () => params,
  useRouter: () => ({ push: (href: string) => destinations.push(href) }),
}));
mock.module('@/hooks/useProjectFeatures', () => ({ useProjectFeatures: () => ({ notes: true }) }));
mock.module('@/hooks/usePermissions', () => ({
  usePermissions: () => ({
    can: (resource: string) => resource !== 'note_boards' || boardsAllowed,
  }),
}));
// Replace data-bound children only; exercise the real page, board toolbar,
// responsive PageTabs and ShellHeaderRow portal.
mock.module('./components/FileBrowser', () => ({
  default: ({ leading }: { leading: ReactNode }) => <PageToolbar>{leading}</PageToolbar>,
}));
mock.module('@/features/notes/components/BoardSwitcher', () => ({ default: () => null }));
mock.module('@/features/notes/components/NoteBoardNameDialog', () => ({ default: () => null }));
const { default: ProjectFilesPage } = await import('./ProjectFilesPage');
const { default: NoteBoardBar } = await import('@/features/notes/components/NoteBoardBar');

test('keeps file navigation in the same desktop/mobile header when changing views', async () => {
  const dom = new JSDOM('<!doctype html><div id="header"></div><div id="root"></div>');
  const names = [
    'window',
    'document',
    'navigator',
    'HTMLElement',
    'Element',
    'Node',
    'ResizeObserver',
    'IS_REACT_ACT_ENVIRONMENT',
  ];
  const saved = new Map(
    names.map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]),
  );
  for (const name of names) {
    const value =
      name === 'IS_REACT_ACT_ENVIRONMENT'
        ? true
        : name === 'ResizeObserver'
          ? class {
              observe() {}
              disconnect() {}
            }
          : (dom.window as unknown as Record<string, unknown>)[name];
    Object.defineProperty(globalThis, name, { configurable: true, value });
  }
  const { createRoot } = await import('react-dom/client');
  const container = document.querySelector('#root')!;
  const header = document.querySelector<HTMLElement>('#header')!;
  const root = createRoot(container);
  const board = (
    <NoteBoardBar
      projectKey="TEST"
      tabs={[]}
      activeBoardId={null}
      onSelect={() => {}}
      onCreate={() => {}}
      onRename={() => {}}
      onDelete={() => {}}
    />
  );
  const render = async () =>
    act(async () =>
      root.render(
        <NextIntlClientProvider locale="en" timeZone="UTC" messages={{ files, notes, common }}>
          <ShellHeaderSlotCtx.Provider value={header}>
            <ProjectFilesPage boards={board} />
          </ShellHeaderSlotCtx.Provider>
        </NextIntlClientProvider>,
      ),
    );
  try {
    for (const mobile of [false, true]) {
      header.dataset.slot = mobile ? 'app-page-bar' : 'app-header';
      Object.defineProperty(dom.window.HTMLElement.prototype, 'clientWidth', {
        configurable: true,
        get: () => (mobile ? 160 : 900),
      });
      Object.defineProperty(dom.window.HTMLElement.prototype, 'scrollWidth', {
        configurable: true,
        get: () => (mobile ? 500 : 900),
      });
      for (const view of ['', 'view=boards', 'root=code']) {
        params = new URLSearchParams(view);
        await render();
        assert.equal(container.querySelector('nav[aria-label="Files"]'), null);
        if (mobile) {
          assert.ok(header.querySelector('button[aria-label="Files"]'));
        } else {
          const navigation = header.querySelector('nav[aria-label="Files"]');
          assert.ok(navigation);
          assert.ok(navigation.textContent?.includes('Knowledge'));
          assert.ok(navigation.textContent?.includes('Boards'));
          assert.ok(navigation.textContent?.includes('Code'));
          await act(async () => navigation!.querySelectorAll('button')[1]!.click());
          assert.equal(destinations.at(-1), '/project/TEST/files?view=boards');
        }
      }
    }
    boardsAllowed = false;
    params = new URLSearchParams('view=boards');
    await act(async () => root.render(null));
    Object.defineProperty(dom.window.HTMLElement.prototype, 'scrollWidth', {
      configurable: true,
      get: () => 160,
    });
    await render();
    assert.ok(!header.textContent?.includes('Boards'));
    assert.ok(header.textContent?.includes('Knowledge'));
  } finally {
    await act(async () => root.unmount());
    dom.window.close();
    for (const [name, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else Reflect.deleteProperty(globalThis, name);
    }
    boardsAllowed = true;
  }
});
