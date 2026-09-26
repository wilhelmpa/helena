import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mock } from 'bun:test';
import { act, useCallback, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import Link from 'next/link';
import { AppRouterContext } from 'next/dist/shared/lib/app-router-context.shared-runtime';
import { JSDOM } from 'jsdom';
import { installWebLinkNavigation } from '@/utils/webLinkNavigation';
import type { WebLinkScope as Scope } from '@/utils/webLinkScope';
import WebLinkScope from '../WebLinkScope';
import Markdown from '../Markdown';
import common from '../../../../messages/en/common.json';

const opened: [string, Scope][] = [];
const mountedScopes: (string | null)[] = [];
mock.module('@/hooks/useWebLinkNavigation', () => ({
  // The existing hook's HTTP/error behavior has separate tests. Here the real
  // authenticated wrapper must mount capture, provide Home context and hand back
  // through its actual router callback; no API or authentication is contacted.
  useWebLinkNavigation(scope: string | null, showTool: (tool: string) => void) {
    mountedScopes.push(scope);
    const open = useCallback(
      (url: string, source: Scope) => {
        opened.push([url, source]);
        if (source === scope) showTool('browser');
      },
      [scope, showTool],
    );
    useEffect(
      () => installWebLinkNavigation(document, open, () => scope, window.location.href),
      [scope, open],
    );
    return { open, scope };
  },
}));
mock.module('@/services/preferences.service', () => ({
  useAccountPreferences: () => ({ headerLayout: 'single' }),
}));
mock.module('@/components/layout/UserMenu', () => ({ default: () => null }));
mock.module('@/components/locale-toggle', () => ({ LocaleToggle: () => null }));
mock.module('@/components/theme-toggle', () => ({ ThemeToggle: () => null }));
mock.module('@/features/agent-runtime/components/EmergencyStop', () => ({
  EmergencyStopBanner: () => null,
}));

// StandaloneShell has exactly two production callers: GodShell and AccountShell.
for (const route of ['/god/about', '/account/profile']) {
  test(`${route} shared shell routes a web link to Home and retains explicit source context`, async () => {
    opened.length = 0;
    mountedScopes.length = 0;
    const dom = new JSDOM('<div id="root"></div>', { url: `https://helena.test${route}` });
    const globals = [
      'window',
      'document',
      'navigator',
      'HTMLElement',
      'Element',
      'Node',
      'MutationObserver',
      'IS_REACT_ACT_ENVIRONMENT',
    ];
    const descriptors = new Map(
      globals.map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]),
    );
    for (const key of globals)
      Object.defineProperty(globalThis, key, {
        configurable: true,
        value:
          key === 'IS_REACT_ACT_ENVIRONMENT'
            ? true
            : (dom.window as unknown as Record<string, unknown>)[key],
      });
    dom.window.matchMedia = ((media: string) => ({
      media,
      matches: false,
      addEventListener() {},
      removeEventListener() {},
    })) as typeof window.matchMedia;
    const { default: StandaloneShell } = await import('./StandaloneShell');
    const pushed: string[] = [];
    const root = createRoot(document.getElementById('root')!);
    try {
      await act(async () =>
        root.render(
          <NextIntlClientProvider locale="en" timeZone="UTC" messages={{ common }}>
            <AppRouterContext.Provider
              value={{ push: (href: string) => pushed.push(href) } as never}
            >
              <StandaloneShell defaultSidebarOpen title="Fixture" sidebar={<aside>Fixture</aside>}>
                <Markdown>{'[Update or provider docs](https://synthetic.example/docs)'}</Markdown>
                <WebLinkScope projectKey="PRIV">
                  <Markdown>{'[Project](https://synthetic.example/project)'}</Markdown>
                </WebLinkScope>
                <Link href="/account/security" prefetch={false}>
                  Security
                </Link>
              </StandaloneShell>
            </AppRouterContext.Provider>
          </NextIntlClientProvider>,
        ),
      );
      assert.ok(mountedScopes.length > 0 && mountedScopes.every((scope) => scope === null));
      for (const link of document.querySelectorAll('a[href^="https://synthetic.example"]')) {
        link.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }));
      }
      assert.deepEqual(opened, [
        ['https://synthetic.example/docs', null],
        ['https://synthetic.example/project', 'PRIV'],
      ]);
      assert.deepEqual(pushed, ['/?tool=browser']);
      const internal = document.querySelector('a[href="/account/security"]')!;
      const event = new dom.window.Event('helena:open-web-link', {
        bubbles: true,
        cancelable: true,
      });
      internal.dispatchEvent(event);
      assert.equal(event.defaultPrevented, false);
      assert.equal(opened.length, 2);
    } finally {
      await act(async () => root.unmount());
      dom.window.close();
      for (const [key, descriptor] of descriptors) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else Reflect.deleteProperty(globalThis, key);
      }
    }
  });
}
