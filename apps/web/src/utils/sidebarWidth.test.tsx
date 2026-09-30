import assert from 'node:assert/strict';
import { test } from 'node:test';
import { act } from 'react';
import { withDom } from '../../test/dom';
import {
  SIDEBAR_DEFAULT,
  SIDEBAR_MAX,
  SIDEBAR_MIN,
  clampSidebarWidth,
  parseSidebarWidth,
} from './sidebarWidth';

// The sidebar's width (owner, O110) stays between its smallest and largest width and always
// leaves the page room; nothing stored means the standard width.
test('a width is clamped to the range and to what the window leaves the page', () => {
  assert.equal(clampSidebarWidth(100, 1440), SIDEBAR_MIN);
  assert.equal(clampSidebarWidth(900, 1440), SIDEBAR_MAX);
  assert.equal(clampSidebarWidth(300.4, 1440), 300);
  // A narrow window leaves the page 560px: 1000 - 560 = 440.
  assert.equal(clampSidebarWidth(480, 1000), 440);
  assert.equal(clampSidebarWidth(480, 700), SIDEBAR_MIN);
});

test('nothing or garbage stored means the standard width', () => {
  assert.equal(parseSidebarWidth(null), SIDEBAR_DEFAULT);
  assert.equal(parseSidebarWidth('abc'), SIDEBAR_DEFAULT);
  assert.equal(parseSidebarWidth('320'), 320);
});

// The grip: drag reports from the width at the start, the arrow keys move by 10 (50 with
// Shift), Enter and double click reset, and it says its size to assistive technology.
test('the sidebar grip sizes by drag and keys and resets to the standard', async () => {
  await withDom('https://ava.example/project/VOL', async () => {
    const { NextIntlClientProvider } = await import('next-intl');
    const { default: SidebarResizeGrip } = await import('@/components/layout/SidebarResizeGrip');
    const { readLocal, writeLocal } = await import('@/hooks/useLocalValue');
    const { createRoot } = await import('react-dom/client');
    const root = createRoot(document.querySelector('#root')!);
    const key = 'helena:sidebar-width:u1';
    const width = () => Number(readLocal(key));
    try {
      await act(async () =>
        root.render(
          <NextIntlClientProvider locale="de" messages={{ nav: { sidebarResize: 'Breite' } }}>
            <SidebarResizeGrip userId="u1" />
          </NextIntlClientProvider>,
        ),
      );
      const grip = document.querySelector<HTMLElement>('[role="separator"]')!;
      assert.equal(grip.getAttribute('aria-label'), 'Breite');
      assert.equal(grip.getAttribute('aria-valuenow'), String(SIDEBAR_DEFAULT));
      assert.equal(grip.getAttribute('aria-valuemin'), String(SIDEBAR_MIN));
      const press = async (init: KeyboardEventInit) =>
        act(async () => {
          grip.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, ...init }));
        });
      await press({ key: 'ArrowRight' });
      assert.equal(width(), SIDEBAR_DEFAULT + 10);
      await press({ key: 'ArrowLeft', shiftKey: true });
      assert.equal(width(), SIDEBAR_DEFAULT - 40);
      await press({ key: 'Enter' });
      assert.equal(width(), SIDEBAR_DEFAULT);
      await act(async () => writeLocal(key, '400'));
      await act(async () => {
        grip.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
      });
      assert.equal(width(), SIDEBAR_DEFAULT);
      // Never below the smallest, whatever the keys ask.
      await act(async () => writeLocal(key, String(SIDEBAR_MIN)));
      await press({ key: 'ArrowLeft', shiftKey: true });
      assert.equal(width(), SIDEBAR_MIN);
    } finally {
      await act(async () => root.unmount());
    }
  });
});
