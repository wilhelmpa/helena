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
