import assert from 'node:assert/strict';
import { afterEach, beforeEach, it } from 'node:test';
import { act } from 'react';
import type { Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { JSDOM } from 'jsdom';
import localAi from '../../../../messages/de/localAi.json';
import decisions from '../../../../messages/de/decisions.json';
import type { FirstStagePolicy, listDecisionClasses } from '@/lib/api/endpoints/decisions';
import JevToggle from './JevToggle';

const replaced = [
  'window',
  'document',
  'navigator',
  'HTMLElement',
  'HTMLFormElement',
  'IS_REACT_ACT_ENVIRONMENT',
] as const;
let saved: Map<string, PropertyDescriptor | undefined>;
let dom: JSDOM;
let root: Root;
let client: QueryClient;
let originalFetch: typeof fetch;
let data: Awaited<ReturnType<typeof listDecisionClasses>>;
let role: 'owner' | 'member';
let failRead: boolean;
const requests: { path: string; method: string; body?: Partial<FirstStagePolicy> }[] = [];

beforeEach(async () => {
  saved = new Map(
    replaced.map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]),
  );
  dom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'https://helena.test/' });
  Object.defineProperties(globalThis, {
    window: { configurable: true, value: dom.window },
    document: { configurable: true, value: dom.window.document },
    navigator: { configurable: true, value: dom.window.navigator },
    HTMLElement: { configurable: true, value: dom.window.HTMLElement },
    HTMLFormElement: { configurable: true, value: dom.window.HTMLFormElement },
    IS_REACT_ACT_ENVIRONMENT: { configurable: true, value: true },
  });
  const { createRoot } = await import('react-dom/client');
  root = createRoot(document.querySelector('#root')!);
  client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  });
  role = 'owner';
  failRead = false;
  requests.length = 0;
  data = {
    classes: [],
    connections: [
      {
        id: 91,
        label: 'Synthetic Jev',
        provider: 'typesafe',
        model: 'jev-test',
        local: false,
        projectKey: null,
        status: 'error',
      },
    ],
    firstStage: {
      enabled: true,
      credentialId: 91,
      timeoutMs: 1000,
      revision: 'synthetic-v1',
      circuitOpen: false,
      useCases: {
        'helena.mail': { enabled: true, cloudAllowed: true },
        'helena.browser': { enabled: false, cloudAllowed: false },
      },
      checks: {
        'helena.mail': { ok: true, reason: null, running: false },
        'helena.browser': { ok: true, reason: null, running: false },
        'helena.trading.news': { ok: true, reason: null, running: false },
      },
      effective: {
        'helena.mail': { enabled: true, reason: null },
        'helena.browser': { enabled: false, reason: 'use_case_off' },
      },
    },
  };
  originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const path = new URL(typeof input === 'string' || input instanceof URL ? input : input.url)
      .pathname;
    const method = init?.method ?? 'GET';
    const body = init?.body
      ? (JSON.parse(String(init.body)) as Partial<FirstStagePolicy>)
      : undefined;
    requests.push({ path, method, ...(body ? { body } : {}) });
    if (path === '/teams') return Response.json([{ id: 42, name: 'Synthetic team', role }]);
    if (path === '/teams/42/decisions/classes')
      return failRead
        ? Response.json({ error: 'Synthetic unavailable' }, { status: 503 })
        : Response.json(data);
    if (path === '/teams/42/decisions/first-stage' && body) {
      data.firstStage = {
        ...data.firstStage,
        ...body,
        useCases: { ...data.firstStage.useCases, ...body.useCases },
      };
      return Response.json(data.firstStage);
    }
    throw new Error(`Unexpected synthetic request: ${method} ${path}`);
  }) as typeof fetch;
});

afterEach(() => {
  act(() => root.unmount());
  client.clear();
  globalThis.fetch = originalFetch;
  dom.window.close();
  for (const [name, descriptor] of saved) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else Reflect.deleteProperty(globalThis, name);
  }
});

async function render(visible = true) {
  await act(async () =>
    root.render(
      <QueryClientProvider client={client}>
        <NextIntlClientProvider locale="de" messages={{ localAi, decisions }} timeZone="UTC">
          {visible ? <JevToggle /> : null}
        </NextIntlClientProvider>
      </QueryClientProvider>,
    ),
  );
}

async function until(check: () => boolean) {
  if (check()) return;
  await act(
    async () =>
      new Promise<void>((resolve, reject) => {
        const observer = new dom.window.MutationObserver(() => {
          if (!check()) return;
          clearTimeout(timeout);
          observer.disconnect();
          resolve();
        });
        const timeout = setTimeout(() => {
          observer.disconnect();
          reject(new Error('Expected dashboard state did not arrive'));
        }, 4000);
        observer.observe(document.body, {
          attributes: true,
          childList: true,
          characterData: true,
          subtree: true,
        });
      }),
  );
}

function control(label: string) {
  const element = [...document.querySelectorAll<HTMLButtonElement>('[role="switch"]')].find(
    (entry) => entry.getAttribute('aria-label') === label,
  );
  assert.ok(element, `Missing switch: ${label}`);
  return element;
}

async function click(label: string) {
  await act(async () =>
    control(label).dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })),
  );
}

it('shows cloud scope and last failed provider state while master off remains usable', async () => {
  await render();
  await until(() => document.body.textContent?.includes(localAi.jev.lastFailed) === true);
  assert.ok(document.body.textContent?.includes(localAi.jev.title));
  assert.ok(document.body.textContent?.includes(localAi.jev.cloud));
  assert.ok(document.body.textContent?.includes(localAi.jev.scopeHint));
  assert.equal(control(localAi.jev.master).disabled, false);
  await click(localAi.jev.master);
  await until(() => control(localAi.jev.master).getAttribute('aria-checked') === 'false');
  assert.deepEqual(
    requests.filter((request) => request.method === 'PATCH'),
    [{ path: '/teams/42/decisions/first-stage', method: 'PATCH', body: { enabled: false } }],
  );
  assert.equal(document.querySelectorAll('[role="switch"]').length, 1);
});

it('writes only the selected use case with its explicit cloud grant to the same team policy', async () => {
  await render();
  await until(() => document.querySelectorAll('[role="switch"]').length === 4);
  await click(localAi.jev.browser);
  await until(() => control(localAi.jev.browser).getAttribute('aria-checked') === 'true');
  assert.deepEqual(requests.filter((request) => request.method === 'PATCH')[0], {
    path: '/teams/42/decisions/first-stage',
    method: 'PATCH',
    body: { useCases: { 'helena.browser': { enabled: true, cloudAllowed: true } } },
  });
  assert.equal(control(localAi.jev.mail).getAttribute('aria-checked'), 'true');
  await click(localAi.jev.mail);
  await until(() => control(localAi.jev.mail).getAttribute('aria-checked') === 'false');
  assert.deepEqual(requests.filter((request) => request.method === 'PATCH')[1]?.body, {
    useCases: { 'helena.mail': { enabled: false, cloudAllowed: false } },
  });
  assert.equal(control(localAi.jev.browser).getAttribute('aria-checked'), 'true');
});

it('does not pick or grant the first connection merely by opening the dashboard', async () => {
  data.firstStage.enabled = false;
  data.firstStage.credentialId = null;
  await render();
  await until(() => document.querySelector('[role="switch"]') !== null);
  assert.equal(control(localAi.jev.master).disabled, true);
  assert.ok(document.body.textContent?.includes(localAi.jev.noConnection));
  assert.equal(
    requests.some((request) => request.method !== 'GET'),
    false,
  );
});

it('refetches persisted policy when reopened after another view changed the master', async () => {
  await render();
  await until(() => document.querySelector('[role="switch"]') !== null);
  assert.equal(control(localAi.jev.master).getAttribute('aria-checked'), 'true');
  await render(false);
  data.firstStage.enabled = false;
  await render();
  await until(
    () => document.querySelector('[role="switch"]')?.getAttribute('aria-checked') === 'false',
  );
  assert.ok(requests.filter((request) => request.path.endsWith('/classes')).length >= 2);
});

it('offers no mutation or policy fetch to a team reader', async () => {
  role = 'member';
  await render();
  await until(() => document.body.textContent?.includes(localAi.jev.managerOnly) === true);
  assert.equal(document.querySelector('[role="switch"]'), null);
  assert.equal(
    requests.some((request) => request.path.includes('/decisions/')),
    false,
  );
});

it('does not present unavailable policy data as a saved off state', async () => {
  failRead = true;
  await render();
  await until(() => document.querySelector('[role="alert"]') !== null);
  assert.equal(document.querySelector('[role="switch"]'), null);
  assert.ok(document.body.textContent?.includes(localAi.jev.loadFailed));
});

it('maps public trading news to its exact class and preserves mail, browser and connection settings', async () => {
  await render();
  await until(() => document.querySelectorAll('[role="switch"]').length === 4);
  assert.equal(control(localAi.jev.tradingNews).getAttribute('aria-checked'), 'false');
  await click(localAi.jev.tradingNews);
  await until(() => control(localAi.jev.tradingNews).getAttribute('aria-checked') === 'true');
  assert.deepEqual(requests.filter((request) => request.method === 'PATCH')[0]?.body, {
    useCases: { 'helena.trading.news': { enabled: true, cloudAllowed: true } },
  });
  assert.equal(data.firstStage.credentialId, 91);
  assert.deepEqual(data.firstStage.useCases['helena.mail'], { enabled: true, cloudAllowed: true });
  assert.deepEqual(data.firstStage.useCases['helena.browser'], {
    enabled: false,
    cloudAllowed: false,
  });
  assert.ok(document.body.textContent?.includes(localAi.jev.tradingNewsHint));
  await click(localAi.jev.tradingNews);
  await until(() => control(localAi.jev.tradingNews).getAttribute('aria-checked') === 'false');
  assert.deepEqual(requests.filter((request) => request.method === 'PATCH')[1]?.body, {
    useCases: { 'helena.trading.news': { enabled: false, cloudAllowed: false } },
  });
});
