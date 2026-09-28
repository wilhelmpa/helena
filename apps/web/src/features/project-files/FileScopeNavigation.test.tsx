import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { act } from 'react';
import { JSDOM } from 'jsdom';
import { NextIntlClientProvider } from 'next-intl';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import files from '../../../messages/en/files.json';
import nav from '../../../messages/en/nav.json';

const { mock } = createRequire(import.meta.url)('bun:test') as {
  mock: { module(specifier: string, factory: () => Record<string, unknown>): void };
};
const destinations: string[] = [];
mock.module('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams('root=private&path=Steuern'),
  useRouter: () => ({ push: (href: string) => destinations.push(href) }),
}));
mock.module('@/hooks/usePermissions', () => ({ usePermissions: () => ({ can: () => true }) }));
mock.module('@/lib/auth-client', () => ({
  useSession: () => ({ data: { user: { role: 'god' } } }),
}));
mock.module('@/services/projects.service', () => ({
  useProjectsQuery: () => ({ data: [] }),
  useProjectQuery: () => ({ data: null }),
}));
mock.module('@/components/layout/Shell', () => ({
  default: ({ children }: { children: React.ReactNode }) => children,
}));
mock.module('./components/FileBrowser', () => ({
  default: ({
    onSelect,
    onNavigate,
  }: {
    onSelect: (file: string) => void;
    onNavigate: (path: string) => void;
  }) => {
    return (
      <div>
        <button onClick={() => onSelect('Steuern/Bescheid.md')}>Öffnen</button>
        <button onClick={() => onNavigate('Steuern/2026')}>Ordner</button>
      </div>
    );
  },
}));
const { default: HomeFilesPage } = await import('./HomeFilesPage');

test('Home Wissen keeps the selected root while opening files and folders', async () => {
  const dom = new JSDOM('<!doctype html><div id="root"></div>');
  const saved = new Map(
    ['window', 'document', 'navigator', 'IS_REACT_ACT_ENVIRONMENT'].map((name) => [
      name,
      Object.getOwnPropertyDescriptor(globalThis, name),
    ]),
  );
  for (const name of saved.keys())
    Object.defineProperty(globalThis, name, {
      configurable: true,
      value:
        name === 'IS_REACT_ACT_ENVIRONMENT'
          ? true
          : (dom.window as unknown as Record<string, unknown>)[name],
    });
  const { createRoot } = await import('react-dom/client');
  const root = createRoot(document.querySelector('#root')!);
  try {
    await act(async () =>
      root.render(
        <QueryClientProvider client={new QueryClient()}>
          <NextIntlClientProvider locale="en" timeZone="UTC" messages={{ files, nav }}>
            <HomeFilesPage />
          </NextIntlClientProvider>
        </QueryClientProvider>,
      ),
    );
    const buttons = document.querySelectorAll<HTMLButtonElement>('button');
    await act(async () => buttons[0]!.click());
    assert.equal(
      destinations.at(-1),
      '/files?root=private&path=Steuern&file=Steuern%2FBescheid.md',
    );
    await act(async () => buttons[1]!.click());
    assert.equal(destinations.at(-1), '/files?root=private&path=Steuern%2F2026');
  } finally {
    await act(async () => root.unmount());
    dom.window.close();
    for (const [name, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else Reflect.deleteProperty(globalThis, name);
    }
  }
});
