import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readLocal, writeLocal } from './useLocalValue';

function withStorage(storage: unknown, run: () => void) {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage });
  try {
    run();
  } finally {
    if (descriptor) Object.defineProperty(globalThis, 'localStorage', descriptor);
    else Reflect.deleteProperty(globalThis, 'localStorage');
  }
}

test('a value goes to localStorage and comes back from it', () => {
  const items = new Map<string, string>();
  withStorage(
    {
      getItem: (key: string) => items.get(key) ?? null,
      setItem: (key: string, value: string) => void items.set(key, value),
      removeItem: (key: string) => void items.delete(key),
    },
    () => {
      writeLocal('layout:test', 'chat-left');
      assert.equal(items.get('layout:test'), 'chat-left');
      assert.equal(readLocal('layout:test'), 'chat-left');
      writeLocal('layout:test', null);
      assert.equal(readLocal('layout:test'), null);
    },
  );
});

test('with storage blocked, a written value still holds for the page', () => {
  const blocked = () => {
    throw new Error('SecurityError');
  };
  withStorage({ getItem: blocked, setItem: blocked, removeItem: blocked }, () => {
    assert.equal(readLocal('layout:blocked'), null);
    writeLocal('layout:blocked', 'two-tools');
    assert.equal(readLocal('layout:blocked'), 'two-tools');
  });
});
