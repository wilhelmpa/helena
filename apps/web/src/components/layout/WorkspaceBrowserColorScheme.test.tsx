import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { act } from 'react';
import { JSDOM } from 'jsdom';
import { NextIntlClientProvider } from 'next-intl';
import nav from '../../../messages/en/nav.json';

const { mock } = createRequire(import.meta.url)('bun:test') as {
  mock: { module(specifier: string, factory: () => Record<string, unknown>): void };
};

// Keep the menu visible in JSDOM; Radix's portal and pointer positioning are unrelated to
// this switch's state and its requests to the project router.
mock.module('@/components/ui/dropdown-menu', () => ({
  DropdownMenu: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuTrigger: ({ children }: { children: React.ReactNode }) => children,
  DropdownMenuContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuLabel: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
  DropdownMenuItem: ({
    children,
    onSelect,
    ...props
  }: React.ComponentProps<'button'> & { onSelect: () => void }) => (
    <button onClick={onSelect} {...props}>
      {children}
    </button>
  ),
}));
const { default: WorkspaceBrowserColorScheme, useBrowserColorScheme } =
  await import('./WorkspaceBrowserColorScheme');

function BrowserSwitch({ theme, resolvedTheme }: { theme: string; resolvedTheme: string }) {
  const scheme = useBrowserColorScheme('/browser/projects/demo/api', theme, resolvedTheme);
  return (
    <WorkspaceBrowserColorScheme
      mode={scheme.mode}
      loaded={scheme.loaded}
      onModeChange={scheme.setMode}
    />
  );
}

test('browser switch persists always light and sends Helena theme changes', async () => {
  const dom = new JSDOM('<!doctype html><div id="root"></div>');
  const names = ['window', 'document', 'navigator', 'HTMLElement', 'IS_REACT_ACT_ENVIRONMENT'];
  const saved = new Map(
    names.map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]),
  );
  const originalFetch = globalThis.fetch;
  for (const name of names)
    Object.defineProperty(globalThis, name, {
      configurable: true,
      value:
        name === 'IS_REACT_ACT_ENVIRONMENT'
          ? true
          : (dom.window as unknown as Record<string, unknown>)[name],
    });
  const posts: Array<Record<string, string>> = [];
  globalThis.fetch = async (_url, init) => {
    if (init?.method === 'POST')
      posts.push(JSON.parse(String(init.body)) as Record<string, string>);
    return Response.json(init?.method === 'POST' ? {} : { mode: 'helena' });
  };
  const { createRoot } = await import('react-dom/client');
  const root = createRoot(document.querySelector('#root')!);
  const render = (theme: string, resolvedTheme: string) => (
    <NextIntlClientProvider locale="en" timeZone="UTC" messages={{ nav }}>
      <BrowserSwitch theme={theme} resolvedTheme={resolvedTheme} />
    </NextIntlClientProvider>
  );
  try {
    await act(async () => {
      root.render(render('system', 'dark'));
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    assert.deepEqual(posts.at(-1), { mode: 'helena', theme: 'system', resolvedTheme: 'dark' });
    const light = [...document.querySelectorAll('button')].find(
      (button) => button.textContent === 'Always light',
    );
    assert(light);
    await act(async () => {
      light.click();
    });
    assert.deepEqual(posts.at(-1), { mode: 'light', theme: 'system', resolvedTheme: 'dark' });
    assert.equal(light.getAttribute('aria-checked'), 'true');
    await act(async () => {
      root.render(render('light', 'light'));
    });
    assert.deepEqual(posts.at(-1), { mode: 'light', theme: 'light', resolvedTheme: 'light' });
  } finally {
    await act(async () => root.unmount());
    globalThis.fetch = originalFetch;
    dom.window.close();
    for (const [name, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else Reflect.deleteProperty(globalThis, name);
    }
  }
});
