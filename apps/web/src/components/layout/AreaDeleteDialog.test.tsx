import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { act } from 'react';
import { JSDOM } from 'jsdom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { NextIntlClientProvider } from 'next-intl';
import views from '../../../messages/en/views.json';

const { mock } = createRequire(import.meta.url)('bun:test') as {
  mock: { module(specifier: string, factory: () => Record<string, unknown>): void };
};

mock.module('@/lib/api/endpoints/views', () => ({
  countViewFolderFiles: async () => ({ count: 3 }),
}));
mock.module('@/components/common/overlay/ConfirmDialog', () => ({
  default: ({
    children,
    confirmDisabled,
  }: {
    children: React.ReactNode;
    confirmDisabled: boolean;
  }) => (
    <div>
      {children}
      <button disabled={confirmDisabled}>Delete area</button>
    </div>
  ),
}));
const { default: AreaDeleteDialog } = await import('./AreaDeleteDialog');

test('warns with the file count before enabling area deletion', async () => {
  const dom = new JSDOM('<!doctype html><div id="root"></div>');
  const names = ['window', 'document', 'navigator', 'HTMLElement', 'IS_REACT_ACT_ENVIRONMENT'];
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
        <QueryClientProvider
          client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
        >
          <NextIntlClientProvider locale="en" timeZone="UTC" messages={{ views }}>
            <AreaDeleteDialog id={1} name="Design" onConfirm={async () => {}} onClose={() => {}} />
          </NextIntlClientProvider>
        </QueryClientProvider>,
      );
    });
    assert.equal(document.querySelector('button')?.disabled, true);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    assert.match(document.body.textContent ?? '', /contains 3 files/);
    assert.equal(document.querySelector('button')?.disabled, false);
  } finally {
    await act(async () => root.unmount());
    dom.window.close();
    for (const [name, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else Reflect.deleteProperty(globalThis, name);
    }
  }
});
