import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { act } from 'react';
import type { Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { JSDOM } from 'jsdom';
import chatWorkspace from '../../../../../messages/en/chatWorkspace.json';
import type { ChatSummary } from '@/lib/api/endpoints/agentChat';
import ChatListItem from './ChatListItem';

const replacedGlobals = [
  'window',
  'document',
  'navigator',
  'HTMLElement',
  'IS_REACT_ACT_ENVIRONMENT',
] as const;
let dom: JSDOM;
let root: Root;
let queryClient: QueryClient;
let originalGlobalDescriptors: Map<string, PropertyDescriptor | undefined>;

function render(node: React.ReactNode) {
  act(() =>
    root.render(
      <NextIntlClientProvider locale="en" messages={{ chatWorkspace }} timeZone="UTC">
        <QueryClientProvider client={queryClient}>{node}</QueryClientProvider>
      </NextIntlClientProvider>,
    ),
  );
}

beforeEach(async () => {
  originalGlobalDescriptors = new Map(
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
  const element = document.querySelector('#root');
  assert.ok(element);
  root = createRoot(element);
  queryClient = new QueryClient();
});

afterEach(() => {
  act(() => root.unmount());
  dom.window.close();
  for (const [name, descriptor] of originalGlobalDescriptors) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else Reflect.deleteProperty(globalThis, name);
  }
});

function chat(overrides: Partial<ChatSummary> = {}): ChatSummary {
  return {
    id: 'thread-1',
    title: 'Deploy the release',
    agent: { id: 1, name: 'Verve', username: 'verve' },
    teamId: 1,
    project: null,
    issue: null,
    pinned: false,
    running: false,
    archivedAt: null,
    deletedAt: null,
    createdAt: '2026-09-23T10:00:00Z',
    updatedAt: '2026-09-23T10:00:00Z',
    ...overrides,
  };
}

describe('ChatListItem', () => {
  it('marks the matching part of the title, case-insensitively', () => {
    render(
      <ChatListItem
        chat={chat({ title: 'Deploy the Release' })}
        view="active"
        selected={false}
        onSelect={() => {}}
        onRemoved={() => {}}
        highlightQuery="release"
      />,
    );
    const mark = document.querySelector('mark');
    assert.ok(mark);
    assert.equal(mark!.textContent, 'Release');
  });

  it('never turns an untrusted title or snippet into markup — react escapes it as text', () => {
    render(
      <ChatListItem
        chat={chat({
          title: '<img src=x onerror=alert(1)>',
          snippet: '<script>alert(2)</script> was mentioned',
        })}
        view="active"
        selected={false}
        onSelect={() => {}}
        onRemoved={() => {}}
      />,
    );
    assert.equal(document.querySelectorAll('img').length, 0);
    assert.equal(document.querySelectorAll('script').length, 0);
    assert.match(document.body.textContent ?? '', /<img src=x onerror=alert\(1\)>/);
    assert.match(document.body.textContent ?? '', /<script>alert\(2\)<\/script>/);
  });

  it('shows a running dot only while an answer is in flight', () => {
    render(
      <ChatListItem
        chat={chat({ running: true })}
        view="active"
        selected={false}
        onSelect={() => {}}
        onRemoved={() => {}}
      />,
    );
    assert.ok(document.querySelector('[role="status"]'));
  });

  it('calls onSelect when the row itself is clicked', () => {
    let selected = false;
    render(
      <ChatListItem
        chat={chat()}
        view="active"
        selected={false}
        onSelect={() => (selected = true)}
        onRemoved={() => {}}
      />,
    );
    const button = document.querySelector('button');
    act(() => button!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })));
    assert.equal(selected, true);
  });
});
