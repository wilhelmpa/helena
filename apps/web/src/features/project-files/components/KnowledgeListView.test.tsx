import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { afterEach, beforeEach, it } from 'node:test';
import { act } from 'react';
import type { Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { NextIntlClientProvider } from 'next-intl';
import { JSDOM } from 'jsdom';
import files from '../../../../messages/de/files.json';
import common from '../../../../messages/de/common.json';
import type { FileItem, FileOrigin } from '@/lib/api/endpoints/projectFiles';

const { mock } = createRequire(import.meta.url)('bun:test') as {
  mock: { module(specifier: string, factory: () => Record<string, unknown>): void };
};
let params = new URLSearchParams();
mock.module('next/navigation', () => ({
  useSearchParams: () => params,
  useRouter: () => ({ push: () => {}, replace: () => {} }),
  usePathname: () => '/project/MKT/files',
}));
mock.module('@/context/relativeTimeContext', () => ({ useRelativeTime: () => () => 'gerade' }));
mock.module('@/components/helena/ProjectTag', () => ({
  ProjectTag: ({ projectKey }: { projectKey: string }) => <span>{projectKey}</span>,
}));
// The preview itself (editor, viewers) has its own tests; here only what opens it.
mock.module('./KnowledgePreview', () => ({
  default: ({
    entry,
    onOpenLarge,
    onClose,
  }: {
    entry: { item: FileItem };
    onOpenLarge: () => void;
    onClose: () => void;
  }) => (
    <aside data-preview={entry.item.path}>
      <button onClick={onOpenLarge}>groß</button>
      <button onClick={onClose}>zu</button>
    </aside>
  ),
}));
const { default: KnowledgeListView } = await import('./KnowledgeListView');

const replaced = [
  'window',
  'document',
  'navigator',
  'HTMLElement',
  'IS_REACT_ACT_ENVIRONMENT',
  'ResizeObserver',
] as const;
let saved: Map<string, PropertyDescriptor | undefined>;
let dom: JSDOM;
let root: Root;

beforeEach(async () => {
  saved = new Map(replaced.map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  dom = new JSDOM('<div id="root"></div>', { url: 'https://helena.test/' });
  for (const key of replaced)
    Object.defineProperty(globalThis, key, {
      configurable: true,
      value:
        key === 'IS_REACT_ACT_ENVIRONMENT'
          ? true
          : key === 'ResizeObserver'
            ? class {
                observe() {}
                unobserve() {}
                disconnect() {}
              }
            : dom.window[key as 'window'],
    });
  const { createRoot } = await import('react-dom/client');
  root = createRoot(document.querySelector('#root')!);
  params = new URLSearchParams();
});

afterEach(async () => {
  await act(async () => root.unmount());
  for (const [key, descriptor] of saved) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else delete (globalThis as Record<string, unknown>)[key];
  }
  dom.window.close();
});

const file = (path: string, origin: FileOrigin): FileItem => ({
  name: path.split('/').at(-1)!,
  path,
  kind: 'file',
  sizeBytes: 10,
  contentType: null,
  updatedAt: '2026-09-29T08:00:00Z',
  origin,
});
const scope = { kind: 'project' as const, projectKey: 'MKT', root: 'vault' as const };
const entry = (path: string, origin: FileOrigin) => ({
  key: path,
  item: file(path, origin),
  scope,
  vaultPath: `Projects/MKT/${path}`,
});

async function render(props: Partial<Parameters<typeof KnowledgeListView>[0]> = {}) {
  const opened: string[] = [];
  const folders: string[] = [];
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () =>
    root.render(
      <QueryClientProvider client={client}>
        <NextIntlClientProvider
          locale="de"
          messages={{ files, common }}
          timeZone="Europe/Berlin"
        >
          <KnowledgeListView
            title="Wissen"
            entries={[
              entry('Docs/Plan.md', 'manual'),
              entry('Docs/Bericht.md', 'agent'),
              entry('Boards/Karte.canvas', 'manual'),
              entry('Files/Belege/2026-09/r.pdf', 'system'),
            ]}
            searchRoots={[]}
            can={{ create: true, edit: true, delete: true }}
            onOpen={(item) => opened.push(item.item.path)}
            onCreate={() => {}}
            emptyText="leer"
            onOpenFolder={(path) => folders.push(path)}
            {...props}
          />
        </NextIntlClientProvider>
      </QueryClientProvider>,
    ),
  );
  return { opened, folders };
}

const names = () =>
  [...document.querySelectorAll('[data-knowledge-row] [data-row-button]')].map(
    (button) => button.textContent,
  );
const button = (label: string) =>
  [...document.querySelectorAll('button')].find((item) => item.textContent === label)!;

it('Wissen lists docs and canvases, Dateien the other files', async () => {
  await render();
  assert.deepEqual(names(), ['Plan', 'BerichtAgent', 'Karte']);
  params = new URLSearchParams('kind=files');
  await render();
  assert.deepEqual(names(), ['r.pdfSystem']);
});

it('the origin pills filter the list; the badge marks agent and system files', async () => {
  await render({ kind: 'all' });
  assert.equal(document.querySelectorAll('[data-origin="agent"]').length, 1);
  assert.equal(document.querySelectorAll('[data-origin="system"]').length, 1);
  await act(async () => button('Agent').click());
  assert.deepEqual(names(), ['BerichtAgent']);
  await act(async () => button('Manuell').click());
  assert.deepEqual(names(), ['Plan', 'Karte']);
  await act(async () => button('Alle').click());
  assert.equal(names().length, 4);
});

it('a click opens the file on the right; full screen or a double click opens it large', async () => {
  const { opened } = await render();
  const plan = document.querySelector<HTMLButtonElement>('[data-row-button]')!;
  await act(async () => plan.click());
  assert.equal(document.querySelector('[data-preview]')?.getAttribute('data-preview'), 'Docs/Plan.md');
  await act(async () => button('groß').click());
  assert.deepEqual(opened, ['Docs/Plan.md']);
  assert.equal(document.querySelector('[data-preview]'), null);
  await act(async () =>
    plan.dispatchEvent(new dom.window.MouseEvent('dblclick', { bubbles: true })),
  );
  assert.deepEqual(opened, ['Docs/Plan.md', 'Docs/Plan.md']);
});

it('a folder without files offers its subfolders instead of empty column heads', async () => {
  const { folders } = await render({
    kind: 'all',
    entries: [],
    subfolders: [{ name: '2025', path: 'Archiv/2025' }],
  });
  assert.equal(document.querySelectorAll('.ds-column-heads').length, 0);
  assert.match(document.body.textContent!, /Nur Unterordner/);
  await act(async () => button('2025').click());
  assert.deepEqual(folders, ['Archiv/2025']);
});

it('an empty Wissen offers to create the first doc', async () => {
  let created = '';
  await render({ entries: [], onCreate: (kind) => (created = kind) });
  assert.match(document.body.textContent!, /Noch nichts in Wissen/);
  await act(async () => button('Doc anlegen').click());
  assert.equal(created, 'doc');
});
