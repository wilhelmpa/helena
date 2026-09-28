import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { act, type ReactNode } from 'react';
import { JSDOM } from 'jsdom';
import { NextIntlClientProvider } from 'next-intl';
import nav from '../../../messages/en/nav.json';

// A link into another project never embeds Helena's page: the pages refuse to be framed
// (X-Frame-Options DENY, frame-ancestors 'none'), so an iframe only ever showed the
// browser's "refused to connect" page (owner, 28.09., task activity on helena-home). A task
// opens in the task overlay; any other page offers "Open in project".

const { mock } = createRequire(import.meta.url)('bun:test') as {
  mock: { module(specifier: string, factory: () => Record<string, unknown>): void };
};

const pushed: string[] = [];
mock.module('next/navigation', () => ({
  useRouter: () => ({ push: (href: string) => pushed.push(href) }),
}));
mock.module('@/components/common/organization/OrganizationTaskSheet', () => ({
  default: ({ projectKey, sequenceNumber }: { projectKey: string; sequenceNumber: number }) => (
    <div data-task={`${projectKey}-${sequenceNumber}`} />
  ),
}));
mock.module('@/design-system', () => ({
  Overlay: ({ label, children }: { label: string; children: ReactNode }) => (
    <aside aria-label={label}>{children}</aside>
  ),
  Button: ({ children, onClick }: { children: ReactNode; onClick: () => void }) => (
    <button onClick={onClick}>{children}</button>
  ),
}));
const { default: ProjectLinkSheet } = await import('./ProjectLinkSheet');

test('opens a task in the overlay and never frames another project page', async () => {
  const dom = new JSDOM('<!doctype html><div id="root"></div>', {
    url: 'https://helena-home.example/tasks',
  });
  const names = [
    'window',
    'document',
    'navigator',
    'HTMLElement',
    'Element',
    'CustomEvent',
    'MouseEvent',
    'IS_REACT_ACT_ENVIRONMENT',
  ];
  const saved = new Map(
    names.map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]),
  );
  for (const name of names) {
    Object.defineProperty(globalThis, name, {
      configurable: true,
      value:
        name === 'IS_REACT_ACT_ENVIRONMENT'
          ? true
          : (dom.window as unknown as Record<string, unknown>)[name],
    });
  }
  const { createRoot } = await import('react-dom/client');
  const root = createRoot(document.querySelector('#root')!);
  try {
    await act(async () => {
      root.render(
        <NextIntlClientProvider locale="en" timeZone="UTC" messages={{ nav }}>
          <ProjectLinkSheet
            currentProjectKey={null}
            projects={[{ key: 'TRADE', name: 'Trading' } as never]}
          />
        </NextIntlClientProvider>,
      );
    });

    await act(async () => {
      window.dispatchEvent(
        new CustomEvent('helena:project-link', { detail: '/project/TRADE/activity' }),
      );
    });
    assert.equal(document.querySelector('iframe'), null);
    assert.equal(document.querySelector('aside')?.getAttribute('aria-label'), 'Trading');
    const open = [...document.querySelectorAll('button')].find(
      (button) => button.textContent === nav.openInProject,
    );
    assert.ok(open);
    await act(async () => open!.click());
    assert.deepEqual(pushed, ['/project/TRADE/activity']);

    await act(async () => {
      window.dispatchEvent(
        new CustomEvent('helena:project-link', { detail: '/project/TRADE/issue/7' }),
      );
    });
    assert.ok(document.querySelector('[data-task="TRADE-7"]'));
    assert.equal(document.querySelector('iframe'), null);
  } finally {
    await act(async () => root.unmount());
    dom.window.close();
    for (const [name, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else Reflect.deleteProperty(globalThis, name);
    }
  }
});
