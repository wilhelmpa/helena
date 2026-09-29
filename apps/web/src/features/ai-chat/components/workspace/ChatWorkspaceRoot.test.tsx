import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { act, createElement } from 'react';
import type { Root } from 'react-dom/client';
import { JSDOM } from 'jsdom';
import type { ChatLocation } from '../../utils/chatLocation';

const { mock } = createRequire(import.meta.url)('bun:test') as {
  mock: { module(specifier: string, factory: () => Record<string, unknown>): void };
};

const empty: ChatLocation = { agentId: null, threadId: null };
const saved = new Map<string, ChatLocation>();
const setters = new Map<string, (next: ChatLocation) => void>();
const validators = new Map<string, () => Promise<ChatLocation>>();
const routes: { kind: 'push' | 'replace'; href: string }[] = [];
let search = new URLSearchParams();

mock.module('next/navigation', () => ({
  useRouter: () => ({
    push: (href: string) => routes.push({ kind: 'push', href }),
    replace: (href: string) => routes.push({ kind: 'replace', href }),
  }),
  useSearchParams: () => search,
  usePathname: () => '/',
}));
mock.module('next-intl', () => ({ useTranslations: () => (key: string) => key }));
mock.module('../../hooks/useChatWorkspaceScope', () => ({
  useChatWorkspaceScope: (projectKey: string | null) => ({
    loading: false,
    scopeKey: projectKey ?? 'team:1',
    teamId: 1,
    agents: [],
  }),
}));
mock.module('../../hooks/useActiveChat', () => ({
  useActiveChat: (scope: string) => {
    if (!setters.has(scope)) setters.set(scope, (next) => saved.set(scope, next));
    if (!validators.has(scope)) validators.set(scope, async () => saved.get(scope) ?? empty);
    return {
      ready: true,
      location: saved.get(scope) ?? empty,
      set: setters.get(scope)!,
      validate: validators.get(scope)!,
    };
  },
}));
// The chat records the page looks up for a thread from the address (a project page checks
// which scope the chat belongs to).
const summaries = new Map<
  string,
  { id: string; agent: { id: number }; project: { key: string } | null }
>();
let summaryLoading = false;
mock.module('../../hooks/useChatSummary', () => ({
  useChatSummary: (threadId: string | null) => ({
    data: threadId ? summaries.get(threadId) : undefined,
    isLoading: threadId != null && summaryLoading,
  }),
}));
mock.module('./ChatWorkspace', () => ({
  default: ({
    scopeKey,
    location,
    onNavigate,
    inPage,
  }: {
    scopeKey: string;
    location: ChatLocation;
    onNavigate: (next: ChatLocation) => void;
    inPage?: boolean;
  }) =>
    createElement(
      'div',
      {
        'data-page': String(Boolean(inPage)),
        'data-scope': scopeKey,
        'data-thread': location.threadId ?? '',
      },
      createElement(
        'button',
        { onClick: () => onNavigate({ agentId: 7, threadId: 'chosen' }) },
        'open',
      ),
      createElement('button', { onClick: () => onNavigate({ agentId: 7, threadId: null }) }, 'new'),
    ),
}));

const replacedGlobals = [
  'window',
  'document',
  'navigator',
  'HTMLElement',
  'IS_REACT_ACT_ENVIRONMENT',
] as const;
let dom: JSDOM;
let root: Root;
let originals: Map<string, PropertyDescriptor | undefined>;

beforeEach(async () => {
  saved.clear();
  setters.clear();
  validators.clear();
  routes.length = 0;
  summaries.clear();
  summaryLoading = false;
  search = new URLSearchParams();
  originals = new Map(
    replacedGlobals.map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]),
  );
  dom = new JSDOM('<!doctype html><div id="root"></div>');
  Object.defineProperties(globalThis, {
    window: { configurable: true, value: dom.window },
    document: { configurable: true, value: dom.window.document },
    navigator: { configurable: true, value: dom.window.navigator },
    HTMLElement: { configurable: true, value: dom.window.HTMLElement },
    IS_REACT_ACT_ENVIRONMENT: { configurable: true, value: true },
  });
  const { createRoot } = await import('react-dom/client');
  root = createRoot(document.querySelector('#root')!);
});

afterEach(() => {
  act(() => root.unmount());
  dom.window.close();
  for (const [name, descriptor] of originals) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else Reflect.deleteProperty(globalThis, name);
  }
});

async function render(projectKey: string | null = null, panel = false) {
  const Component = panel
    ? (await import('../panel/NativeChatWorkspace')).default
    : (await import('./ChatWorkspaceRoot')).default;
  await act(async () => {
    root.render(createElement(Component, { projectKey }));
    await Promise.resolve();
  });
}

describe('active chat location', () => {
  it('resumes on a bare Start link and reload without adding history', async () => {
    saved.set('home', { agentId: 7, threadId: 'last' });
    await render();
    assert.deepEqual(routes.at(-1), { kind: 'replace', href: '/?agent=7&thread=last' });
    act(() => root.unmount());
    const { createRoot } = await import('react-dom/client');
    root = createRoot(document.querySelector('#root')!);
    await render();
    assert.equal(routes.at(-1)?.kind, 'replace');
  });

  it('lets an explicit thread link replace the remembered thread', async () => {
    saved.set('home', { agentId: 7, threadId: 'last' });
    search = new URLSearchParams('agent=8&thread=linked');
    await render();
    assert.deepEqual(saved.get('home'), { agentId: 8, threadId: 'linked' });
    assert.equal(routes.length, 0);
  });

  it('keeps a deliberate new chat empty when Start is reopened', async () => {
    search = new URLSearchParams('agent=7&thread=old');
    await render();
    const button = document.querySelector('[data-page="true"] button:last-child')!;
    act(() => button.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })));
    assert.equal(saved.get('home')?.threadId, null);
    assert.match(routes.at(-1)?.href ?? '', /new=1/);
    search = new URLSearchParams();
    await render();
    assert.equal(saved.get('home')?.threadId, null);
    assert.match(routes.at(-1)?.href ?? '', /agent=7&new=1/);
  });

  it('shares a scope between page and panel while isolating projects', async () => {
    saved.set('project:MKT', { agentId: 7, threadId: 'mkt' });
    saved.set('project:OPS', { agentId: 8, threadId: 'ops' });
    await render('MKT', true);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
    });
    assert.equal(document.querySelector('[data-page="false"]')?.getAttribute('data-thread'), 'mkt');
    act(() => root.unmount());
    const { createRoot } = await import('react-dom/client');
    root = createRoot(document.querySelector('#root')!);
    await render('MKT', true);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
    });
    assert.equal(document.querySelector('[data-page="false"]')?.getAttribute('data-thread'), 'mkt');
    await render('MKT');
    assert.match(routes.at(-1)?.href ?? '', /thread=mkt/);
    search = new URLSearchParams();
    await render('OPS');
    assert.match(routes.at(-1)?.href ?? '', /thread=ops/);
  });

  it('carries a panel selection to the page and a page link back to the panel', async () => {
    await render(null, true);
    const button = document.querySelector('[data-page="false"] button:first-child')!;
    act(() => button.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })));
    assert.equal(saved.get('home')?.threadId, 'chosen');
    await render();
    assert.match(routes.at(-1)?.href ?? '', /thread=chosen/);
    search = new URLSearchParams('agent=9&thread=linked');
    await render();
    assert.equal(saved.get('home')?.threadId, 'linked');
    await render(null, true);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
    });
    assert.equal(
      document.querySelector('[data-page="false"]')?.getAttribute('data-thread'),
      'linked',
    );
  });

  it('opens an empty new chat when the saved thread is gone', async () => {
    saved.set('home', { agentId: 7, threadId: 'deleted' });
    validators.set('home', async () => {
      saved.set('home', empty);
      return empty;
    });
    await render();
    assert.equal(routes.length, 0);
    assert.equal(document.querySelector('[data-page="true"]')?.getAttribute('data-thread'), '');
  });

  it('does not let an older validation undo a new chat', async () => {
    let finish!: (location: ChatLocation) => void;
    validators.set(
      'home',
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    saved.set('home', { agentId: 7, threadId: 'old' });
    await render();
    assert.equal(routes.length, 0);
    const button = document.querySelector('[data-page="true"] button:last-child')!;
    act(() => button.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })));
    await act(async () => finish({ agentId: 7, threadId: 'old' }));
    assert.equal(saved.get('home')?.threadId, null);
    assert.match(routes.at(-1)?.href ?? '', /new=1/);
  });

  describe('the scope of a chat opened in a project', () => {
    it('keeps a chat of this project and remembers it', async () => {
      summaries.set('m1', { id: 'm1', agent: { id: 7 }, project: { key: 'MKT' } });
      search = new URLSearchParams('agent=7&thread=m1');
      await render('MKT');
      assert.deepEqual(saved.get('project:MKT'), { agentId: 7, threadId: 'm1' });
      assert.equal(routes.length, 0);
      assert.equal(document.querySelector('[data-page="true"]')?.getAttribute('data-thread'), 'm1');
    });

    it("moves a Helena chat to Helena's chat page instead of a list that does not hold it", async () => {
      summaries.set('h1', { id: 'h1', agent: { id: 7 }, project: null });
      search = new URLSearchParams('agent=7&thread=h1');
      await render('MKT');
      assert.deepEqual(routes.at(-1), { kind: 'replace', href: '/?agent=7&thread=h1' });
      assert.equal(saved.has('project:MKT'), false);
      assert.equal(document.querySelector('[data-page="true"]'), null);
    });

    it("moves another project's chat to that project's page", async () => {
      summaries.set('o1', { id: 'o1', agent: { id: 9 }, project: { key: 'OPS' } });
      search = new URLSearchParams('agent=9&thread=o1');
      await render('MKT');
      assert.match(routes.at(-1)?.href ?? '', /^\/project\/OPS\/chat\?agent=9&thread=o1$/);
      assert.equal(saved.has('project:MKT'), false);
    });

    it('waits for the chat record before remembering the chat', async () => {
      summaryLoading = true;
      search = new URLSearchParams('agent=7&thread=m1');
      await render('MKT');
      assert.equal(saved.has('project:MKT'), false);
      assert.equal(routes.length, 0);
      assert.equal(document.querySelector('[data-page="true"]'), null);
    });

    it("lets Helena's page open a chat of any project", async () => {
      summaries.set('o1', { id: 'o1', agent: { id: 9 }, project: { key: 'OPS' } });
      search = new URLSearchParams('agent=9&thread=o1');
      await render();
      assert.deepEqual(saved.get('home'), { agentId: 9, threadId: 'o1' });
      assert.equal(routes.length, 0);
    });
  });
});
