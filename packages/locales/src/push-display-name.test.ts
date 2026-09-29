import { expect, test } from 'bun:test';
import { formatPush } from './push';

test('push title uses the current display name', () => {
  expect(formatPush('en', 'test.title', { appName: 'Atlas' })).toBe('Atlas');
});
