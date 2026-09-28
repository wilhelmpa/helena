import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { act } from 'react';
import { JSDOM } from 'jsdom';
import { NextIntlClientProvider } from 'next-intl';
import files from '../../../messages/en/files.json';

const { mock } = createRequire(import.meta.url)('bun:test') as {
  mock: { module(specifier: string, factory: () => Record<string, unknown>): void };
};
let params = new URLSearchParams();
const destinations: string[] = [];
mock.module('next/navigation', () => ({
  useParams: () => ({ projectKey: 'TEST' }),
  useSearchParams: () => params,
  useRouter: () => ({
    push: (href: string) => destinations.push(href),
    replace: (href: string) => destinations.push(href),
  }),
}));
mock.module('@/hooks/usePermissions', () => ({ usePermissions: () => ({ can: () => true }) }));
mock.module('@/hooks/useProjectFeatures', () => ({
  useProjectFeatures: () => ({ documents: true, notes: true }),
}));
mock.module('@/features/notes/services/noteBoards.service', () => ({
  useNoteBoardQuery: () => ({ data: { vaultPath: 'Projects/TEST/Boards/Plan.canvas' } }),
}));
mock.module('@/features/notes/NotesPage', () => ({ default: () => null }));
mock.module('./components/FileBrowser', () => ({
  default: ({
    onSelect,
    onNavigate,
  }: {
    onSelect: (path: string) => void;
    onNavigate: (path: string) => void;
  }) => (
    <div data-browser>
      <button onClick={() => onSelect('Berichte/Plan.md')}>Doc</button>
      <button onClick={() => onNavigate('Berichte')}>Ordner</button>
    </div>
  ),
}));
const { default: ProjectFilesPage } = await import('./ProjectFilesPage');

test('Wissen opens files in the same page and redirects old board routes to canvas files', async () => {
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
  const render = async () =>
    act(async () =>
      root.render(
        <NextIntlClientProvider locale="de" messages={{ files }}>
          <ProjectFilesPage />
        </NextIntlClientProvider>,
      ),
    );
  try {
    await render();
    assert.ok(document.querySelector('[data-browser]'));
    await act(async () => document.querySelector<HTMLButtonElement>('button')!.click());
    assert.equal(destinations.at(-1), '/project/TEST/files?path=Berichte&file=Berichte%2FPlan.md');
    params = new URLSearchParams('view=boards&board=3');
    await render();
    assert.equal(destinations.at(-1), '/project/TEST/files?path=Boards&file=Boards%2FPlan.canvas');
  } finally {
    await act(async () => root.unmount());
    dom.window.close();
    for (const [name, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else Reflect.deleteProperty(globalThis, name);
    }
  }
});
