import assert from 'node:assert/strict';
import { test } from 'node:test';
import { withDom } from '../../test/dom';
import {
  OVERLAY_PIN_STORAGE_KEY,
  pinOverlay,
  pinnedOverlay,
  resetOverlayPinForTest,
  toggleOverlayPin,
  unpinOverlay,
} from './overlayPin';

test('one overlay is pinned at a time, kept for the tab’s session', async () => {
  await withDom('https://ava.example/', async (dom) => {
    Object.defineProperty(globalThis, 'sessionStorage', {
      configurable: true,
      value: dom.window.sessionStorage,
    });
    resetOverlayPinForTest();
    assert.equal(pinnedOverlay(), null);
    toggleOverlayPin({ kind: 'issue', value: 'VOL:42' });
    assert.deepEqual(pinnedOverlay(), { kind: 'issue', value: 'VOL:42' });
    // Pinning another replaces it.
    pinOverlay({ kind: 'file', value: 'vault:Docs/a.md', data: '{"x":1}' });
    assert.equal(pinnedOverlay()?.kind, 'file');
    // A reload reads it back from the session.
    resetOverlayPinForTest();
    assert.deepEqual(pinnedOverlay(), { kind: 'file', value: 'vault:Docs/a.md', data: '{"x":1}' });
    // Closing another overlay leaves it pinned; closing this one unpins it.
    unpinOverlay({ kind: 'issue', value: 'VOL:42' });
    assert.equal(pinnedOverlay()?.value, 'vault:Docs/a.md');
    toggleOverlayPin({ kind: 'file', value: 'vault:Docs/a.md' });
    assert.equal(pinnedOverlay(), null);
    assert.equal(dom.window.sessionStorage.getItem(OVERLAY_PIN_STORAGE_KEY), null);
  });
});
