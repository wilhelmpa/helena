import assert from 'node:assert/strict';
import { afterEach, beforeEach, it } from 'node:test';
import { act } from 'react';
import type { Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { NextIntlClientProvider } from 'next-intl';
import { JSDOM } from 'jsdom';
import type { ReceiptDetail } from '@/lib/api/endpoints/receipts';
import receipts from '../../../../messages/de/receipts.json';
import { ReceiptOriginals } from './ReceiptOriginals';

const original: ReceiptDetail = {
  id: 91,
  source: 'mail',
  filename: 'payment.pdf',
  contentType: 'application/pdf',
  size: 123,
  vaultPath: 'Projects/FIN/Files/Mail/payment.pdf',
  issuer: 'Fictional Seller',
  invoiceNumber: 'FICTION-1',
  invoiceDate: '2026-09-01',
  dueDate: null,
  totalGrossCents: 11900,
  vatCents: 1900,
  currency: 'EUR',
  iban: null,
  direction: 'incoming',
  extraction: 'text',
  extractionError: null,
  status: 'open',
  creditNote: false,
  directDebit: false,
  einvoice: false,
  paymentReference: null,
  createdAt: '2026-09-01T00:00:00Z',
  match: null,
  proposals: 0,
  textExcerpt: null,
  details: {},
  mailAttachmentId: null,
  sourceLinks: null,
  primaryReceiptId: null,
  originalCount: 1,
};
const primary = { ...original, id: 92, filename: 'invoice.pdf' };
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
let client: QueryClient;
let previousFetch: typeof fetch;
const writes: { method: string; path: string; body: unknown }[] = [];
const opened: number[] = [];

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
  client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  writes.length = 0;
  opened.length = 0;
  previousFetch = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const path = new URL(typeof input === 'string' || input instanceof URL ? input : input.url)
      .pathname;
    const method = init?.method ?? 'GET';
    if (method === 'GET' && path === '/projects/FIN/receipts')
      return Response.json({ receipts: [original, primary] });
    assert.equal(path, '/projects/FIN/receipts/91/original-link');
    assert.ok(method === 'PUT' || method === 'DELETE');
    writes.push({ path, method, body: JSON.parse(String(init?.body)) });
    return Response.json({ ok: true });
  }) as typeof fetch;
});

afterEach(async () => {
  await act(async () => root.unmount());
  client.clear();
  globalThis.fetch = previousFetch;
  dom.window.close();
  for (const [key, descriptor] of saved) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else Reflect.deleteProperty(globalThis, key);
  }
});

async function render(value: ReceiptDetail) {
  await act(async () =>
    root.render(
      <QueryClientProvider client={client}>
        <NextIntlClientProvider locale="de" timeZone="UTC" messages={{ receipts }}>
          <ReceiptOriginals projectKey="FIN" receipt={value} onOpen={(id) => opened.push(id)} />
        </NextIntlClientProvider>
      </QueryClientProvider>,
    ),
  );
}
function button(label: string) {
  const result = [...document.querySelectorAll('button')].find(
    (node) => node.textContent === label,
  );
  assert.ok(result, label);
  return result;
}
async function click(label: string) {
  await act(async () => button(label).click());
}

it('requires an explicit primary choice and sends only the selected relation, never changed facts', async () => {
  await render(original);
  assert.equal(writes.length, 0);
  await click(receipts.originals.choose);
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
  assert.equal(button(receipts.originals.attach).disabled, true);
  const select = document.querySelector('select')!;
  assert.deepEqual(
    [...select.options].map((option) => option.value),
    ['', '92'],
  );
  await act(async () => {
    select.value = '92';
    select.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  });
  await click(receipts.originals.attach);
  assert.deepEqual(writes, [
    {
      method: 'PUT',
      path: '/projects/FIN/receipts/91/original-link',
      body: { primaryReceiptId: 92 },
    },
  ]);
});

it('opens the canonical original and detaches using the exact current primary binding', async () => {
  await render({
    ...original,
    primaryReceiptId: 92,
    originals: [
      { id: 91, filename: 'payment.pdf', size: 123, contentType: 'application/pdf' },
      { id: 92, filename: 'invoice.pdf', size: 124, contentType: 'application/pdf' },
    ],
  });
  await click(`invoice.pdf · ${receipts.originals.primary}`);
  assert.deepEqual(opened, [92]);
  await click(receipts.originals.detach);
  assert.deepEqual(writes, [
    {
      method: 'DELETE',
      path: '/projects/FIN/receipts/91/original-link',
      body: { primaryReceiptId: 92 },
    },
  ]);
});
