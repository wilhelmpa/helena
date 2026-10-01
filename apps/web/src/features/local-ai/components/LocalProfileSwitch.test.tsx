import assert from 'node:assert/strict';
import { afterEach, beforeEach, it } from 'node:test';
import { act } from 'react';
import type { Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { JSDOM } from 'jsdom';
import localAi from '../../../../messages/de/localAi.json';
import common from '../../../../messages/de/common.json';

const replaced = [
  'window',
  'document',
  'navigator',
  'HTMLElement',
  'HTMLFormElement',
  'DocumentFragment',
  'Event',
  'CustomEvent',
  'KeyboardEvent',
  'FocusEvent',
  'MouseEvent',
  'Node',
  'HTMLInputElement',
  'HTMLTextAreaElement',
  'HTMLSelectElement',
  'HTMLButtonElement',
  'HTMLAnchorElement',
  'SVGElement',
  'ShadowRoot',
  'Text',
  'InputEvent',
  'UIEvent',
  'NodeFilter',
  'Element',
  'MutationObserver',
  'getComputedStyle',
  'requestAnimationFrame',
  'cancelAnimationFrame',
  'IS_REACT_ACT_ENVIRONMENT',
] as const;
let saved: Map<string, PropertyDescriptor | undefined>;
let dom: JSDOM;
let root: Root;
let client: QueryClient;
let originalFetch: typeof fetch;
const requests: { path: string; method: string; body?: Record<string, unknown> }[] = [];

beforeEach(async () => {
  saved = new Map(
    replaced.map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]),
  );
  dom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'https://helena.test/' });
  dom.window.__ITSAPLAN_ENV__ = {
    apiUrl: 'http://localhost:3000',
    privacyUrl: '',
    termsUrl: '',
    workspace: {
      homeChatProjectKey: '',
      terminalUrl: '',
      codeUrl: '',
      projectWorkspacePaths: {},
      homeWorkspacePath: '',
      browserUrl: '',
    },
  };
  Object.defineProperties(globalThis, {
    window: { configurable: true, value: dom.window },
    document: { configurable: true, value: dom.window.document },
    navigator: { configurable: true, value: dom.window.navigator },
    HTMLElement: { configurable: true, value: dom.window.HTMLElement },
    HTMLFormElement: { configurable: true, value: dom.window.HTMLFormElement },
    DocumentFragment: { configurable: true, value: dom.window.DocumentFragment },
    Event: { configurable: true, value: dom.window.Event },
    CustomEvent: { configurable: true, value: dom.window.CustomEvent },
    KeyboardEvent: { configurable: true, value: dom.window.KeyboardEvent },
    FocusEvent: { configurable: true, value: dom.window.FocusEvent },
    MouseEvent: { configurable: true, value: dom.window.MouseEvent },
    NodeFilter: { configurable: true, value: dom.window.NodeFilter },
    Node: { configurable: true, value: dom.window.Node },
    Element: { configurable: true, value: dom.window.Element },
    MutationObserver: { configurable: true, value: dom.window.MutationObserver },
    getComputedStyle: { configurable: true, value: dom.window.getComputedStyle.bind(dom.window) },
    requestAnimationFrame: {
      configurable: true,
      // A frame that comes after the test's page is gone does nothing.
      value: (callback: FrameRequestCallback) =>
        setTimeout(() => {
          if (typeof window !== 'undefined') callback(0);
        }, 0),
    },
    cancelAnimationFrame: { configurable: true, value: (id: number) => clearTimeout(id) },
    IS_REACT_ACT_ENVIRONMENT: { configurable: true, value: true },
  });
  for (const name of [
    'HTMLInputElement',
    'HTMLTextAreaElement',
    'HTMLSelectElement',
    'HTMLButtonElement',
    'HTMLAnchorElement',
    'SVGElement',
    'ShadowRoot',
    'Text',
    'InputEvent',
    'UIEvent',
  ])
    Object.defineProperty(globalThis, name, {
      configurable: true,
      value: (dom.window as unknown as Record<string, unknown>)[name],
    });
  // What Radix's select needs of the browser and jsdom lacks.
  const proto = dom.window.HTMLElement.prototype as unknown as Record<string, unknown>;
  proto.hasPointerCapture = () => false;
  proto.releasePointerCapture = () => undefined;
  proto.scrollIntoView = () => undefined;
  Object.defineProperty(globalThis, 'ResizeObserver', {
    configurable: true,
    value: class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  });
  const { createRoot } = await import('react-dom/client');
  root = createRoot(document.querySelector('#root')!);
  client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  });
  requests.length = 0;
  originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const path = new URL(typeof input === 'string' || input instanceof URL ? input : input.url)
      .pathname;
    const method = init?.method ?? 'GET';
    const body = init?.body
      ? (JSON.parse(String(init.body)) as Record<string, unknown>)
      : undefined;
    requests.push({ path, method, ...(body ? { body } : {}) });
    if (path === '/god/local-ai')
      return Response.json({
        runningEvals: [],
        servers: [
          { id: 1, slug: 'halogen', kind: 'halogen', models: [] },
          { id: 2, slug: 'local', kind: 'lemonade', models: [] },
        ],
      });
    if (path === '/god/local-ai/status')
      return Response.json({
        globalModel: {
          model: 'helena-halogen/halogen-qwen3.8-flash-next',
          maintenance: null,
          job: null,
        },
      });
    if (path === '/god/local-ai/default/preview') {
      const paired = body?.profile === 'local-27b-npu';
      return Response.json({
        target: { server: 'lemonade', slug: 'local', model: 'Qwen3.8-27B-GGUF' },
        previous: null,
        weightLockGb: 72,
        simultaneousLargeModels: false,
        requiresGroupStop: true,
        agents: [{ id: 7, name: 'Koordinator RES' }],
        classes: ['summaries', 'triage'],
        npuClasses: paired ? ['triage'] : [],
        npuSelection: paired ? ['qwen3.5:2b', 'qwen3.5:4b', 'gemma4-it:e2b', 'gemma4-it:e4b'] : [],
      });
    }
    if (path === '/god/local-ai/default/apply')
      return Response.json({
        admissionPaused: true,
        proxyPaused: true,
        active: null,
        operation: null,
      });
    throw new Error(`Unexpected synthetic request: ${method} ${path}`);
  }) as typeof fetch;
});

afterEach(async () => {
  await act(async () => root.unmount());
  client.clear();
  // Let the queries' own timers finish while the page globals are still there.
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 50));
  });
  globalThis.fetch = originalFetch;
  dom.window.close();
  for (const [name, descriptor] of saved) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else delete (globalThis as Record<string, unknown>)[name];
  }
});

async function render() {
  const { default: LocalProfileSwitch } = await import('./LocalProfileSwitch');
  await act(async () => {
    root.render(
      <QueryClientProvider client={client}>
        <NextIntlClientProvider
          locale="de"
          messages={{ localAi, common }}
          timeZone="Europe/Berlin"
          onError={() => undefined}
        >
          <LocalProfileSwitch />
        </NextIntlClientProvider>
      </QueryClientProvider>,
    );
  });
}

async function until(check: () => boolean) {
  for (let step = 0; step < 100 && !check(); step += 1)
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
  assert.ok(check(), 'The expected state did not arrive');
}

const text = () => document.body.textContent ?? '';
const button = (label: RegExp) =>
  [...document.querySelectorAll<HTMLElement>('button')].find((entry) =>
    label.test(entry.textContent ?? ''),
  );
async function click(label: RegExp) {
  const target = button(label);
  assert.ok(target, `Missing button: ${label}`);
  await act(async () =>
    target.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })),
  );
}

it('shows Halogen without an NPU, then offers the NPU models of the paired profile', async () => {
  await render();
  await until(() => text().includes(localAi.profileSwitch.switch.unchanged));
  // Halogen is on: the NPU is off, and nothing to switch yet.
  assert.ok(text().includes(localAi.profileSwitch.npu.off));
  assert.equal((button(/Umstellen …/) as HTMLButtonElement).disabled, true);
  await click(/Lokal 27B \+ NPU/);
  await until(() => /Betrifft 1 Agent /.test(text()));
  assert.ok(text().includes(localAi.profileSwitch.npu.hint));
  assert.equal((button(/Umstellen …/) as HTMLButtonElement).disabled, false);
  // The NPU select lists exactly what the server offered for the paired profile.
  const trigger = document.querySelector<HTMLElement>(`[aria-label="NPU-Modell"]`)!;
  assert.equal(trigger.hasAttribute('disabled'), false);
  await act(async () =>
    trigger.dispatchEvent(new dom.window.KeyboardEvent('keydown', { bubbles: true, key: 'Enter' })),
  );
  const options = [...document.querySelectorAll('[role="option"]')].map((node) => node.textContent);
  assert.deepEqual(options, [
    'Qwen 3.5 2B · sehr klein',
    'Qwen 3.5 4B · etwas größer, langsamer',
    'Gemma 4 E2B · schnell, für Helfer empfohlen',
    'Gemma 4 E4B · genauer, aber langsamer',
  ]);
});

it('switches only after the owner confirms, with the profile and the NPU model', async () => {
  await render();
  await until(() => text().includes(localAi.profileSwitch.switch.unchanged));
  await click(/Lokal 27B \+ NPU/);
  await until(() => /Betrifft 1 Agent /.test(text()));
  await click(/Umstellen …/);
  await until(() => text().includes(localAi.profileSwitch.confirm.text));
  assert.equal(requests.filter((entry) => entry.path.endsWith('/apply')).length, 0);
  await click(/Jetzt umstellen/);
  await until(() => requests.some((entry) => entry.path.endsWith('/apply')));
  assert.deepEqual(requests.find((entry) => entry.path.endsWith('/apply'))?.body, {
    model: 'helena-local/Qwen3.8-27B-GGUF',
    profile: 'local-27b-npu',
    npuModel: 'gemma4-it:e2b',
  });
});
