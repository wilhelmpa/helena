import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

// The stacking order lives in tokens.css (--z-*) and every layer above the page takes its
// number from there (owner, O95: the project menu of the sidebar opened behind the drawer).
const read = (name: string) => readFileSync(new URL(`./${name}`, import.meta.url), 'utf8');
const tokens = read('tokens.css');
const z = (name: string) => {
  const match = tokens.match(new RegExp(`--z-${name}:\\s*(\\d+)`));
  assert.ok(match, `--z-${name} is defined`);
  return Number(match[1]);
};

describe('stacking order', () => {
  it('drawer < menus < dialogs < the large modal < what opens over it', () => {
    const order = [
      'overlay',
      'drawer-scrim',
      'drawer',
      'menu',
      'dialog-scrim',
      'dialog',
      'modal',
      'modal-menu',
      'modal-dialog',
    ].map(z);
    assert.deepEqual(
      order,
      [...order].sort((a, b) => a - b),
    );
    assert.equal(new Set(order).size, order.length);
  });

  it('menus, popovers and tooltips lie above the sidebar drawer', () => {
    const overlays = read('overlays.css');
    assert.match(
      overlays,
      /\[data-slot='dropdown-menu-content'\][\s\S]{0,300}\{\s*z-index:\s*var\(--z-menu\)/,
    );
    assert.ok(z('menu') > z('drawer'));
  });

  it('the rules take the layers from the tokens, never a number above the page chrome', () => {
    for (const name of ['shell.css', 'overlays.css', 'components.css']) {
      for (const line of read(name).split('\n')) {
        const match = line.match(/^\s*z-index:\s*(-?\d+)/);
        if (match) assert.ok(Number(match[1]) < 55, `${name}: ${line.trim()}`);
      }
    }
  });
});
