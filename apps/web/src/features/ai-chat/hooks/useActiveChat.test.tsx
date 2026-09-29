import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { act, createElement } from 'react';
import type { Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { JSDOM } from 'jsdom';
import type { ChatLocation } from '../utils/chatLocation';

const { mock } = createRequire(import.meta.url)('bun:test') as {
  mock: { module(specifier: string, factory: () => Record<string, unknown>): void };
};
const empty: ChatLocation = { agentId: null, threadId: null };
const server = new Map<string, ChatLocation>();
const calls: string[] = [];
mock.module('@/lib/auth-client', () => ({
  useSession: () => ({ data: { user: { id: 'owner-109' } } }),
}));
mock.module('@/lib/api/core/client', () => ({
  request: async (url: string, init?: { method?: string; body?: string }) => {
    const scope = new URL(url, 'http://api.test').searchParams.get('scope')!;
    calls.push(`${init?.method ?? 'GET'}:${scope}`);
    if (init?.method === 'PUT') {
      const next = JSON.parse(init.body!) as ChatLocation;
      server.set(scope, next);
      return next;
    }
    return server.get(scope) ?? empty;
  },
}));

const globals = [
  'window',
  'document',
  'navigator',
  'HTMLElement',
  'localStorage',
  'IS_REACT_ACT_ENVIRONMENT',
] as const;
let dom: JSDOM;
let root: Root;
let client: QueryClient;
let originals: Map<string, PropertyDescriptor | undefined>;
let useActiveChat: typeof import('./useActiveChat').useActiveChat;
const seen = new Map<string, ReturnType<typeof import('./useActiveChat').useActiveChat>>();

function Probe({ scope }: { scope: string }) {
  seen.set(scope, useActiveChat(scope));
  return null;
}

beforeEach(async () => {
  server.clear();
  calls.length = 0;
  seen.clear();
  originals = new Map(
    globals.map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]),
  );
  dom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'http://localhost/' });
  Object.defineProperties(globalThis, {
    window: { configurable: true, value: dom.window },
    document: { configurable: true, value: dom.window.document },
    navigator: { configurable: true, value: dom.window.navigator },
    HTMLElement: { configurable: true, value: dom.window.HTMLElement },
    localStorage: { configurable: true, value: dom.window.localStorage },
    IS_REACT_ACT_ENVIRONMENT: { configurable: true, value: true },
  });
  const { createRoot } = await import('react-dom/client');
  useActiveChat = (await import('./useActiveChat')).useActiveChat;
  root = createRoot(document.querySelector('#root')!);
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});

afterEach(() => {
  act(() => root.unmount());
  client.clear();
  dom.window.close();
  for (const [name, descriptor] of originals) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else Reflect.deleteProperty(globalThis, name);
  }
});

async function render(scopes: string[]) {
  act(() => {
    root.render(
      createElement(
        QueryClientProvider,
        { client },
        ...scopes.map((scope) => createElement(Probe, { key: scope, scope })),
      ),
    );
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 10));
  });
}

describe('useActiveChat', () => {
  it('validates a cached thread against the server before opening it', async () => {
    localStorage.setItem(
      'volition:active-chat:owner-109:home',
      JSON.stringify({
        agentId: 7,
        threadId: 'deleted',
      }),
    );
    await render(['home']);
    assert.equal(seen.get('home')?.ready, true);
    assert.deepEqual(seen.get('home')?.location, empty);
    assert.equal(calls[0], 'GET:home');
    assert.deepEqual(
      JSON.parse(localStorage.getItem('volition:active-chat:owner-109:home')!),
      empty,
    );
  });

  it('shares updates inside one scope and keeps another project independent', async () => {
    await render(['project:MKT', 'project:OPS']);
    act(() => seen.get('project:MKT')!.set({ agentId: 7, threadId: 'mkt' }));
    await render(['project:MKT', 'project:OPS']);
    assert.equal(seen.get('project:MKT')?.location.threadId, 'mkt');
    assert.equal(seen.get('project:OPS')?.location.threadId, null);
    assert.deepEqual(await seen.get('project:MKT')!.validate(), { agentId: 7, threadId: 'mkt' });
    assert.equal(server.get('project:MKT')?.threadId, 'mkt');
  });
});
