import assert from 'node:assert/strict';
import { test } from 'node:test';
import { act } from 'react';
import { withDom } from '../../test/dom';

// A pinned overlay or panel takes its room from the page (O103): the width of what is docked,
// plus the gap, is published for the main area; the widest counts; releasing gives it back.
test('the docked width reaches the page and goes back when it is released', async () => {
  await withDom('https://ava.example/project/VOL', async () => {
    const { useDock, useDockedWidth } = await import('./dock');
    const { createRoot } = await import('react-dom/client');
    const root = createRoot(document.querySelector('#root')!);
    const seen: number[] = [];
    function Probe({ chat, task }: { chat: number | null; task: number | null }) {
      useDock('panel', chat);
      useDock('overlay', task);
      seen.push(useDockedWidth());
      return null;
    }
    const inset = () => document.documentElement.style.getPropertyValue('--ds-dock-inset');
    try {
      await act(async () => root.render(<Probe chat={null} task={null} />));
      assert.equal(seen.at(-1), 0);
      await act(async () => root.render(<Probe chat={480} task={null} />));
      assert.equal(inset(), '492px');
      assert.equal(document.documentElement.hasAttribute('data-docked'), true);
      // The widest one counts.
      await act(async () => root.render(<Probe chat={480} task={880} />));
      assert.equal(inset(), '892px');
      assert.equal(seen.at(-1), 880);
      await act(async () => root.render(<Probe chat={480} task={null} />));
      assert.equal(inset(), '492px');
      await act(async () => root.unmount());
      assert.equal(inset(), '0px');
      assert.equal(document.documentElement.hasAttribute('data-docked'), false);
    } finally {
      // the root is already unmounted
    }
  });
});
