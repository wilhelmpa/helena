import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { afterEach, beforeEach, it } from 'node:test';
import { act } from 'react';
import type { Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { NextIntlClientProvider } from 'next-intl';
import { JSDOM } from 'jsdom';
import receipts from '../../../../messages/de/receipts.json';

const { mock } = createRequire(import.meta.url)('bun:test') as {
  mock: { module(specifier: string, factory: () => Record<string, unknown>): void };
};
const saves: string[] = [];
mock.module('sonner', () => ({ toast: { success: () => {}, error: () => {} } }));
const format = await import('../utils/format');
mock.module('../utils/format', () => ({
  ...format,
  saveBlob: (_blob: Blob, name: string) => saves.push(name),
}));
const { default: ExportView } = await import('./ExportView');

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
  saves.length = 0;
  previousFetch = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
    requested.push(`${url.pathname}${url.search}`);
    if (url.pathname.endsWith('/receipts/summary'))
      return Response.json({
        month: url.searchParams.get('month'),
        transactions: { open: 2, matched: 3, ignored: 0 },
        receipts: { open: 1, matched: 3, ignored: 0 },
        proposals: 0,
        months: [],
      });
    if (url.pathname.endsWith('/receipts/export'))
      return new Response(new Blob(['PK']), { headers: { 'Content-Type': 'application/zip' } });
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

const flush = async () => {
  for (let i = 0; i < 6; i += 1)
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
};

async function render(months: string[], onUpload = () => {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () =>
    root.render(
      <QueryClientProvider client={client}>
        <NextIntlClientProvider locale="de" messages={{ receipts }} timeZone="Europe/Berlin">
          <ExportView projectKey="FIN" months={months} loading={false} onUpload={onUpload} />
        </NextIntlClientProvider>
      </QueryClientProvider>,
    ),
  );
  await flush();
}

it('lists every month with what it holds and downloads its ZIP', async () => {
  await render(['2026-09', '2026-08']);
  const rows = [...document.querySelectorAll('[data-knowledge-row]')];
  assert.equal(rows.length, 2);
  assert.match(rows[0]!.textContent!, /September 2026/);
  assert.match(rows[0]!.textContent!, /4 Belege · 1 offen · 2 Buchungen ohne Beleg/);
  const zip = rows[0]!.querySelector<HTMLButtonElement>('button')!;
  await act(async () => zip.click());
  await flush();
  assert.ok(requested.includes('/projects/FIN/receipts/export?month=2026-09'));
  assert.deepEqual(saves, ['Helena-Belege_FIN_2026-09.zip']);
});

it('offers the upload when there is nothing to export yet', async () => {
  let uploads = 0;
  await render([], () => (uploads += 1));
  assert.match(document.body.textContent!, /Noch nichts zu exportieren/);
  const button = [...document.querySelectorAll('button')].find((item) =>
    /Beleg hochladen/.test(item.textContent ?? ''),
  )!;
  await act(async () => button.click());
  assert.equal(uploads, 1);
});
