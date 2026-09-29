import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { ChartHover } from './OrganizationChartFlow';
import { createHoverStore } from './organizationHoverStore';

const hoverOf = (id: string): ChartHover =>
  ({
    node: { id, position: { x: 0, y: 0 }, data: {} },
    rect: { left: 0, top: 0, width: 10, height: 10 },
    width: 100,
    height: 100,
  }) as ChartHover;

// The team chart's hover card lives outside the chart's state (the chart re-rendered on
// every hover and React Flow hid the node under the pointer: the card flickered).
describe('organization hover store', () => {
  test('tells its listeners only about a real change', () => {
    const store = createHoverStore();
    let calls = 0;
    const stop = store.subscribe(() => calls++);
    const first = hoverOf('58');
    store.set(first);
    assert.equal(store.get(), first);
    store.set(hoverOf('58'));
    assert.equal(store.get(), first, 'the same node keeps its card');
    store.set(hoverOf('59'));
    store.set(null);
    store.set(null);
    assert.equal(store.get(), null);
    assert.equal(calls, 3);
    stop();
    store.set(first);
    assert.equal(calls, 3, 'an unsubscribed listener hears nothing');
  });
});
