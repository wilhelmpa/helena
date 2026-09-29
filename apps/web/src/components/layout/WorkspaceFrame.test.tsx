import assert from 'node:assert/strict';
import { test } from 'node:test';
import { act } from 'react';
import { NextIntlClientProvider } from 'next-intl';
import nav from '../../../messages/en/nav.json';
import { withDom } from '../../../test/dom';
import { PanelToolCloseCtx } from '@/context/panelToolTab';

// An embedded tool whose address does not answer never shows the browser's own error page:
// Ava's view names it, offers "Reload" and "Close tab", and loads the frame once it answers
// (Auftrag 116).
test('shows Ava’s own view for a tool that does not answer, then loads it on reload', async () => {
  await withDom('https://ava.example/project/VOL', async () => {
    const realFetch = globalThis.fetch;
    let up = false;
    const asked: string[] = [];
    globalThis.fetch = (async (url: string) => {
      asked.push(String(url));
      if (!up) throw new TypeError('Failed to fetch');
      return { status: 200, type: 'basic' } as Response;
    }) as unknown as typeof fetch;
    const { default: WorkspaceFrame } = await import('./WorkspaceFrame');
    const { createRoot } = await import('react-dom/client');
    const root = createRoot(document.querySelector('#root')!);
    const closed: string[] = [];
    try {
      await act(async () => {
        root.render(
          <NextIntlClientProvider locale="en" timeZone="UTC" messages={{ nav }}>
            <PanelToolCloseCtx.Provider value={() => closed.push('code')}>
              <WorkspaceFrame url="/code/?folder=/srv" title="Code" active />
            </PanelToolCloseCtx.Provider>
          </NextIntlClientProvider>,
        );
      });
      await act(async () => new Promise((resolve) => setTimeout(resolve, 10)));
      assert.equal(document.querySelector('iframe'), null);
      const view = document.querySelector('.ds-embed-problem');
      assert.ok(view, 'the problem view is shown');
      assert.equal(view!.getAttribute('data-reason'), 'unreachable');
      assert.match(view!.textContent ?? '', /Code cannot be reached/);
      const button = (label: string) =>
        [...document.querySelectorAll('button')].find((node) => node.textContent === label)!;
      await act(async () => button(nav.workspace.frameProblem.close).click());
      assert.deepEqual(closed, ['code']);
      up = true;
      await act(async () => button(nav.workspace.frameProblem.reload).click());
      await act(async () => new Promise((resolve) => setTimeout(resolve, 10)));
      assert.ok(document.querySelector('iframe'), 'the frame loads once the tool answers');
      assert.equal(document.querySelector('.ds-embed-problem'), null);
      assert.equal(asked.at(-1), '/code/?folder=/srv');
    } finally {
      await act(async () => root.unmount());
      globalThis.fetch = realFetch;
    }
  });
});
