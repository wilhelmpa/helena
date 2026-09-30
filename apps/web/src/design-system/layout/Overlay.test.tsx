import assert from 'node:assert/strict';
import { test } from 'node:test';
import { act } from 'react';
import { NextIntlClientProvider } from 'next-intl';
import common from '../../../messages/en/common.json';
import { withDom } from '../../../test/dom';

// Every overlay has the same head (Auftrag 117): the thing's own actions, then pin, full
// screen and close in this order; pinned it survives a click on the page and the page
// changing; closing it unpins it.
test('the head is actions · pin · full screen · close, and pinning keeps it open', async () => {
  await withDom('https://ava.example/project/VOL', async (dom) => {
    Object.defineProperty(globalThis, 'sessionStorage', {
      configurable: true,
      value: dom.window.sessionStorage,
    });
    const pins = await import('@/utils/overlayPin');
    pins.resetOverlayPinForTest();
    const { Overlay } = await import('./Overlay');
    const { createRoot } = await import('react-dom/client');
    const root = createRoot(document.querySelector('#root')!);
    const closed: string[] = [];
    try {
      await act(async () => {
        root.render(
          <NextIntlClientProvider locale="en" timeZone="UTC" messages={{ common }}>
            <Overlay
              label="VOL-42"
              tabs={[{ id: 'task', label: 'VOL-42' }]}
              actions={<button type="button">Copy link</button>}
              onClose={() => closed.push('closed')}
              closeOnOutsideClick
              pin={{ kind: 'issue', value: 'VOL:42' }}
            >
              <p>Body</p>
            </Overlay>
          </NextIntlClientProvider>,
        );
      });
      const tools = [...document.querySelectorAll('.ds-panel-head-tools button')].map(
        (button) => button.getAttribute('aria-label') ?? button.textContent,
      );
      assert.deepEqual(tools, ['Copy link', common.pinOverlay, common.fullscreen, common.close]);
      const pin = document.querySelector<HTMLButtonElement>('.ds-panel-pin')!;
      await act(async () => pin.click());
      assert.deepEqual(pins.pinnedOverlay(), { kind: 'issue', value: 'VOL:42' });
      assert.equal(pin.getAttribute('aria-pressed'), 'true');
      assert.equal(document.querySelector('aside')!.getAttribute('data-pinned'), 'true');
      // A click on the page behind leaves a pinned overlay open.
      await act(async () => {
        document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
        document.body.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
      });
      assert.deepEqual(closed, []);
      // Closing unpins it.
      const close = [...document.querySelectorAll('.ds-panel-head-tools button')].at(-1)!;
      await act(async () => (close as HTMLButtonElement).click());
      assert.deepEqual(closed, ['closed']);
      assert.equal(pins.pinnedOverlay(), null);
    } finally {
      await act(async () => root.unmount());
    }
  });
});

// Full screen is a real switch (O83): the same button enlarges and reduces, Esc leaves full
// screen before it closes the overlay, and a pinned overlay keeps the state across pages
// (another host showing the same pin). A thing with a page of its own has its own button.
test('full screen switches back, Esc leaves it first, and a pinned overlay keeps it', async () => {
  await withDom('https://ava.example/project/VOL', async (dom) => {
    Object.defineProperty(globalThis, 'sessionStorage', {
      configurable: true,
      value: dom.window.sessionStorage,
    });
    const pins = await import('@/utils/overlayPin');
    pins.resetOverlayPinForTest();
    const { Overlay } = await import('./Overlay');
    const { createRoot } = await import('react-dom/client');
    const root = createRoot(document.querySelector('#root')!);
    const closed: string[] = [];
    const opened: string[] = [];
    const render = (key: string) =>
      act(async () => {
        root.render(
          <NextIntlClientProvider locale="en" timeZone="UTC" messages={{ common }}>
            <Overlay
              key={key}
              label="Plan"
              tabs={[{ id: 'file', label: 'Plan' }]}
              onClose={() => closed.push('closed')}
              onOpenPage={() => opened.push('page')}
              pin={{ kind: 'file', value: 'Docs/plan.md' }}
            >
              <p>Body</p>
            </Overlay>
          </NextIntlClientProvider>,
        );
      });
    try {
      await render('page-a');
      const tools = () =>
        [...document.querySelectorAll('.ds-panel-head-tools button')].map(
          (button) => button.getAttribute('aria-label') ?? button.textContent,
        );
      assert.deepEqual(tools(), [
        common.openAsPage,
        common.pinOverlay,
        common.fullscreen,
        common.close,
      ]);
      const aside = () => document.querySelector('aside')!;
      const full = () => document.querySelector<HTMLButtonElement>('.ds-panel-full')!;
      await act(async () => full().click());
      assert.equal(aside().getAttribute('data-full'), 'true');
      assert.equal(full().getAttribute('aria-label'), common.exitFullscreen);
      assert.equal(full().getAttribute('aria-pressed'), 'true');
      // The same button makes it small again.
      await act(async () => full().click());
      assert.equal(aside().getAttribute('data-full'), 'false');
      assert.equal(full().getAttribute('aria-label'), common.fullscreen);
      // Esc leaves full screen first; only the next Esc closes.
      await act(async () => full().click());
      await act(async () => {
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      });
      assert.equal(aside().getAttribute('data-full'), 'false');
      assert.deepEqual(closed, []);
      await act(async () => {
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      });
      assert.deepEqual(closed, ['closed']);
      // The page button is its own action.
      await act(async () =>
        document.querySelector<HTMLButtonElement>('.ds-panel-open-page')!.click(),
      );
      assert.deepEqual(opened, ['page']);
      // Pinned and large, another page's host shows it large too.
      await render('page-a2');
      await act(async () => full().click());
      await act(async () => document.querySelector<HTMLButtonElement>('.ds-panel-pin')!.click());
      assert.equal(aside().getAttribute('data-full'), 'true');
      await render('page-b');
      assert.equal(aside().getAttribute('data-full'), 'true');
      // Reduced while pinned stays reduced on the next page.
      await act(async () => full().click());
      await render('page-c');
      assert.equal(aside().getAttribute('data-full'), 'false');
    } finally {
      pins.resetOverlayPinForTest();
      await act(async () => root.unmount());
    }
  });
});

// Pinned, the overlay does not lie over the page, it takes its room (O103): the main area gets
// as narrow as the overlay is wide (the dock inset), and gets it back when the overlay is
// unpinned, made full screen or closed. Below 1024px there is no pin at all.
test('a pinned overlay takes its room from the page and gives it back', async () => {
  await withDom('https://ava.example/project/VOL', async (dom) => {
    Object.defineProperty(globalThis, 'sessionStorage', {
      configurable: true,
      value: dom.window.sessionStorage,
    });
    const pins = await import('@/utils/overlayPin');
    pins.resetOverlayPinForTest();
    const { Overlay } = await import('./Overlay');
    const { createRoot } = await import('react-dom/client');
    const root = createRoot(document.querySelector('#root')!);
    const inset = () => document.documentElement.style.getPropertyValue('--ds-dock-inset');
    const tree = (sheet: boolean) => {
      // The media query of the sheet mode (below 1024px).
      (dom.window as unknown as { matchMedia: (q: string) => unknown }).matchMedia = (
        query: string,
      ) => ({
        matches: sheet && query.includes('max-width: 1023px'),
        media: query,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
      });
      return (
        <NextIntlClientProvider locale="en" timeZone="UTC" messages={{ common }}>
          <Overlay
            label="VOL-42"
            tabs={[{ id: 'task', label: 'VOL-42' }]}
            onClose={() => undefined}
            pin={{ kind: 'issue', value: 'VOL:42' }}
          >
            <p>Body</p>
          </Overlay>
        </NextIntlClientProvider>
      );
    };
    try {
      await act(async () => root.render(tree(false)));
      assert.equal(inset() === '' || inset() === '0px', true);
      await act(async () => document.querySelector<HTMLButtonElement>('.ds-panel-pin')!.click());
      // 480px wide plus the 12px to the window's edge.
      assert.equal(inset(), '492px');
      // Full screen covers everything: nothing to make room for.
      await act(async () => document.querySelector<HTMLButtonElement>('.ds-panel-full')!.click());
      assert.equal(inset(), '0px');
      await act(async () => document.querySelector<HTMLButtonElement>('.ds-panel-full')!.click());
      assert.equal(inset(), '492px');
      // Unpinned: the room is back.
      await act(async () => document.querySelector<HTMLButtonElement>('.ds-panel-pin')!.click());
      assert.equal(inset(), '0px');
      // A narrow window: a sheet, no pin button.
      await act(async () => root.unmount());
      const narrowRoot = createRoot(document.querySelector('#root')!);
      await act(async () => narrowRoot.render(tree(true)));
      assert.equal(document.querySelector('.ds-panel-pin'), null);
      await act(async () => narrowRoot.unmount());
    } finally {
      pins.resetOverlayPinForTest();
    }
  });
});
