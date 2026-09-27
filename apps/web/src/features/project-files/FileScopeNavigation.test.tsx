import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { act, type ReactNode } from 'react';
import { JSDOM } from 'jsdom';
import { NextIntlClientProvider } from 'next-intl';
import { PageToolbar } from '@/components/layout/PageToolbar';
import files from '../../../messages/en/files.json';
import common from '../../../messages/en/common.json';
import nav from '../../../messages/en/nav.json';

const { mock } = createRequire(import.meta.url)('bun:test') as {
  mock: { module(specifier: string, factory: () => Record<string, unknown>): void };
};
const destinations: string[] = [];
let reportDirty: (value: boolean) => void;
mock.module('next/navigation', () => ({
  useParams: () => ({ projectKey: 'TEST' }),
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: (href: string) => destinations.push(href) }),
}));
mock.module('@/hooks/useProjectFeatures', () => ({ useProjectFeatures: () => ({ notes: true }) }));
mock.module('@/hooks/usePermissions', () => ({ usePermissions: () => ({ can: () => true }) }));
mock.module('@/hooks/useMediaQuery', () => ({ useMediaQuery: () => false }));
mock.module('@/lib/auth-client', () => ({
  useSession: () => ({ data: { user: { role: 'god' } } }),
}));
mock.module('@/services/projects.service', () => ({
  useProjectsQuery: () => ({
    data: [{ key: 'TEST', name: 'Test project', documentsEnabled: true }],
  }),
  useProjectQuery: () => ({ data: null }),
}));
mock.module('@/components/layout/Shell', () => ({
  default: ({ children }: { children: ReactNode }) => children,
}));
// Only the data/editor child is replaced. Real page navigation, PageTabs, HomeRoots
// and their callbacks must respect the dirty report from the inline browser.
mock.module('./components/FileBrowser', () => ({
  default: ({
    leading,
    onDirtyChange,
  }: {
    leading: ReactNode;
    onDirtyChange: (value: boolean) => void;
  }) => {
    reportDirty = onDirtyChange;
    return <PageToolbar>{leading}</PageToolbar>;
  },
}));
const { default: ProjectFilesPage } = await import('./ProjectFilesPage');
const { default: HomeFilesPage } = await import('./HomeFilesPage');

test('guards actual project tabs and Home root buttons before their routing callbacks', async () => {
  const dom = new JSDOM('<!doctype html><div id="root"></div>');
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
  for (const name of names)
    Object.defineProperty(globalThis, name, {
      configurable: true,
      value:
        name === 'IS_REACT_ACT_ENVIRONMENT'
          ? true
          : name === 'ResizeObserver'
            ? class {
                observe() {}
                disconnect() {}
              }
            : (dom.window as unknown as Record<string, unknown>)[name],
    });
  const { createRoot } = await import('react-dom/client');
  const root = createRoot(document.querySelector('#root')!);
  const render = async (home: boolean) =>
    act(async () =>
      root.render(
        <NextIntlClientProvider locale="en" timeZone="UTC" messages={{ files, common, nav }}>
          {home ? <HomeFilesPage /> : <ProjectFilesPage />}
        </NextIntlClientProvider>,
      ),
    );
  try {
    for (const home of [false, true]) {
      await render(home);
      reportDirty(true);
      destinations.length = 0;
      let confirmations = 0;
      dom.window.confirm = () => {
        confirmations++;
        return false;
      };
      const navigation = document.querySelector(
        `nav[aria-label="${home ? files.roots.label : files.title}"]`,
      )!;
      assert.ok(navigation);
      const buttons = [...navigation.querySelectorAll<HTMLButtonElement>('button')];
      assert.equal(buttons.length, home ? 4 : 3);
      for (const button of buttons) await act(async () => button.click());
      assert.equal(confirmations, buttons.length);
      assert.deepEqual(destinations, []);
      dom.window.confirm = () => true;
      await act(async () => buttons[1]!.click());
      assert.equal(
        destinations.at(-1),
        home ? '/files?root=private' : '/project/TEST/files?view=boards',
      );
      reportDirty(false);
      dom.window.confirm = () => {
        throw new Error('Clean navigation must not confirm');
      };
      await act(async () => buttons.at(-1)!.click());
      assert.equal(destinations.length, 2);
    }
  } finally {
    await act(async () => root.unmount());
    dom.window.close();
    for (const [name, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else Reflect.deleteProperty(globalThis, name);
    }
  }
});
