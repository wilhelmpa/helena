import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  defaultLayout,
  dockWidthsKey,
  layoutContext,
  layoutStorageKey,
  migrateLegacyLayout,
  parseStoredLayout,
} from './workspaceLayoutStorage';

function memoryStorage(entries: Record<string, string> = {}) {
  const items = new Map(Object.entries(entries));
  return {
    items,
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => void items.set(key, value),
    removeItem: (key: string) => void items.delete(key),
  };
}

describe('workspace layout storage', () => {
  it('keeps the dual kiosk, the single kiosk and a browser apart', () => {
    assert.equal(layoutContext('dual'), 'kiosk-dual');
    assert.equal(layoutContext('single'), 'kiosk-single');
    assert.equal(layoutContext(null), 'browser');
    assert.equal(layoutStorageKey('kiosk-dual'), 'workspace:layout:kiosk-dual');
    assert.notEqual(
      dockWidthsKey('kiosk-dual', 'chat-left'),
      dockWidthsKey('browser', 'chat-left'),
    );
  });

  it('starts the dual kiosk with the chat beside the page, everything else as it was', () => {
    assert.equal(defaultLayout('kiosk-dual').layout, 'chat-left');
    assert.equal(defaultLayout('kiosk-single').layout, 'standard');
    assert.equal(defaultLayout('browser').layout, 'standard');
  });

  it('reads a stored layout and drops what does not belong', () => {
    assert.deepEqual(
      parseStoredLayout(
        JSON.stringify({ layout: 'chat-left', previous: '', tools: { 'x.y': 'chat', bad: 3 } }),
      ),
      { layout: 'chat-left', tools: { 'x.y': 'chat' } },
    );
    assert.deepEqual(
      parseStoredLayout(JSON.stringify({ layout: 'tool-full', previous: 'two-tools' })),
      {
        layout: 'tool-full',
        previous: 'two-tools',
        tools: {},
      },
    );
    assert.equal(parseStoredLayout('{not json'), null);
    assert.equal(parseStoredLayout(JSON.stringify({ tools: {} })), null);
    assert.equal(parseStoredLayout(null), null);
  });

  it('turns the old split panel into "two tools" once', () => {
    const storage = memoryStorage({ 'workspace:panel:split': 'terminal' });
    assert.deepEqual(migrateLegacyLayout(storage, 'browser'), {
      layout: 'two-tools',
      tools: { 'two-tools.second': 'terminal' },
    });
    assert.equal(storage.items.size, 0);
    assert.equal(migrateLegacyLayout(storage, 'browser'), null);
  });

  it('turns the old fullscreen panel into the full layout, not on the dual kiosk', () => {
    assert.deepEqual(
      migrateLegacyLayout(memoryStorage({ 'workspace:panel:fullscreen': 'true' }), 'browser'),
      { layout: 'tool-full', previous: 'standard', tools: {} },
    );
    assert.equal(
      migrateLegacyLayout(memoryStorage({ 'workspace:panel:fullscreen': 'true' }), 'kiosk-dual'),
      null,
    );
  });
});
