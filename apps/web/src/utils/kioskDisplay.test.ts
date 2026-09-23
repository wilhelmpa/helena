import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readKioskDisplay } from './kioskDisplay';

function memoryStorage() {
  const items = new Map<string, string>();
  return {
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => void items.set(key, value),
  };
}

describe('readKioskDisplay', () => {
  it('reads the display from the query and keeps it for later pages', () => {
    const storage = memoryStorage();
    assert.equal(readKioskDisplay('?kioskDisplay=dual', storage), 'dual');
    assert.equal(readKioskDisplay('', storage), 'dual');
  });

  it('lets a new query value replace the kept one', () => {
    const storage = memoryStorage();
    readKioskDisplay('?kioskDisplay=dual', storage);
    assert.equal(readKioskDisplay('?kioskDisplay=single', storage), 'single');
  });

  it('ignores unknown values and a browser that is no kiosk', () => {
    const storage = memoryStorage();
    assert.equal(readKioskDisplay('?kioskDisplay=triple', storage), null);
    assert.equal(readKioskDisplay('', storage), null);
  });
});
