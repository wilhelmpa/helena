import assert from 'node:assert/strict';
import { afterEach, beforeEach, it } from 'node:test';
import { act } from 'react';
import type { Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { NextIntlClientProvider } from 'next-intl';
import { JSDOM } from 'jsdom';
import files from '../../../../messages/de/files.json';
import KnowledgeBaseView from './KnowledgeBaseView';
import { newBaseContent } from './FileNewBaseDialog';

const replaced = [
  'window',
  'document',
  'navigator',
  'HTMLElement',
  'IS_REACT_ACT_ENVIRONMENT',
] as const;
let saved: Map<string, PropertyDescriptor | undefined>;
let dom: JSDOM;
let root: Root;
let previousFetch: typeof fetch;
const requested: string[] = [];
let unsupported = false;

const row = (name: string, status: string) => ({
  path: `Projects/MKT/Docs/${name}.md`,
  file: {
    path: `Projects/MKT/Docs/${name}.md`,
    name: `${name}.md`,
    basename: name,
    folder: 'Projects/MKT/Docs',
    ext: 'md',
    ctime: null,
    mtime: null,
  },
  note: { status },
  formula: {},
  values: { 'file.name': `${name}.md`, 'note.status': status },
});

beforeEach(async () => {
  saved = new Map(replaced.map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  dom = new JSDOM('<div id="root"></div>', { url: 'https://helena.test/' });
  for (const key of replaced)
    Object.defineProperty(globalThis, key, {
      configurable: true,
      value: key === 'IS_REACT_ACT_ENVIRONMENT' ? true : dom.window[key as 'window'],
    });
  const { createRoot } = await import('react-dom/client');
  root = createRoot(document.querySelector('#root')!);
  requested.length = 0;
  unsupported = false;
  previousFetch = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
    requested.push(`${url.pathname}${url.search}`);
    if (url.pathname === '/knowledge/bases')
      return Response.json({
        path: 'Projects/MKT/Docs/Übersicht.base',
        content: '',
        sha256: 'a'.repeat(64),
        definition: {
          views: [
            { type: 'table', name: 'Tabelle', order: ['file.name', 'note.status'] },
            { type: 'cards', name: 'Karten', order: ['file.name', 'note.status'] },
          ],
          properties: { 'note.status': { displayName: 'Stand' } },
        },
      });
    if (url.pathname === '/knowledge/bases/rows') {
      if (unsupported) return Response.json({ error: 'formula.next: date(now)' }, { status: 422 });
      const view = url.searchParams.get('view') ?? 'Tabelle';
      return Response.json({
        path: 'Projects/MKT/Docs/Übersicht.base',
        view: {
          name: view,
          type: view === 'Karten' ? 'cards' : 'table',
          order: ['file.name', 'note.status'],
        },
        total: 2,
        page: 1,
        pageSize: 200,
        rows: [row('Regelwerk', 'aktiv'), row('Journal', 'entwurf')],
      });
    }
    return new Response('not found', { status: 404 });
  }) as typeof fetch;
});

afterEach(async () => {
  await act(async () => root.unmount());
  globalThis.fetch = previousFetch;
  for (const [key, descriptor] of saved) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else delete (globalThis as Record<string, unknown>)[key];
  }
  dom.window.close();
});

const flush = async (times = 6) => {
  for (let i = 0; i < times; i += 1)
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
};

async function render(onOpenNote?: (path: string) => void) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () =>
    root.render(
      <QueryClientProvider client={client}>
        <NextIntlClientProvider locale="de" messages={{ files }} timeZone="Europe/Berlin">
          <KnowledgeBaseView path="Projects/MKT/Docs/Übersicht.base" onOpenNote={onOpenNote} />
        </NextIntlClientProvider>
      </QueryClientProvider>,
    ),
  );
  await flush();
}

it('shows a view of notes as a table, switches to cards and filters the rows', async () => {
  const opened: string[] = [];
  await render((path) => opened.push(path));
  const rows = () => [...document.querySelectorAll('tbody tr')];
  assert.equal(rows().length, 2);
  assert.match(document.querySelector('thead')!.textContent!, /Stand/);
  assert.match(rows()[0]!.textContent!, /Regelwerk.*aktiv/);

  const filter = document.querySelector<HTMLInputElement>('input[type="search"]')!;
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(
      dom.window.HTMLInputElement.prototype,
      'value',
    )!.set!;
    setter.call(filter, 'journ');
    filter.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  });
  assert.equal(rows().length, 1);
  assert.match(rows()[0]!.textContent!, /Journal/);

  await act(async () => document.querySelector<HTMLButtonElement>('.ds-base-open')!.click());
  assert.deepEqual(opened, ['Projects/MKT/Docs/Journal.md']);

  const cards = [...document.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find(
    (tab) => tab.textContent === 'Karten',
  )!;
  await act(async () => cards.click());
  await flush();
  assert.ok(requested.some((path) => path.includes('view=Karten')));
  assert.equal(document.querySelectorAll('.ds-card').length, 1);
});

it('says plainly when a view uses an expression Helena does not evaluate', async () => {
  unsupported = true;
  await render();
  assert.match(document.body.textContent!, /noch nicht auswertet/);
  assert.match(document.body.textContent!, /formula\.next/);
});

it('a new view lists the notes of its folder as table, cards and list', () => {
  const yaml = newBaseContent('Projects/MKT/Docs/', ['Tabelle', 'Karten', 'Liste']);
  assert.match(yaml, /file\.inFolder\("Projects\/MKT\/Docs"\)/);
  assert.match(yaml, /type: table\n {4}name: "Tabelle"/);
  assert.match(yaml, /type: cards/);
  assert.match(yaml, /type: list/);
  assert.doesNotMatch(newBaseContent(null, ['a', 'b', 'c']), /inFolder/);
});
