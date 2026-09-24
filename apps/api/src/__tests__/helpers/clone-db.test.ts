import { describe, expect, test } from 'bun:test';

import { cloneName, databaseName, isStaleClone } from './clone-db';

describe('per-run test database', () => {
  test('the copy is named after the template, the time and a random suffix', () => {
    expect(cloneName('itsaplan_test', 1_700_000_000_000, 0.5)).toBe('itsaplan_test_run_1700000000000_i00000');
  });

  test('a long template name is shortened so the copy stays within 63 bytes', () => {
    const name = cloneName('x'.repeat(80) + '_test', 1_700_000_000_000, 0.123456);
    expect(name.length).toBeLessThanOrEqual(63);
    expect(name).toContain('_run_1700000000000_');
  });

  test('only copies of this template older than six hours are stale', () => {
    const now = 1_700_000_000_000;
    const old = cloneName('itsaplan_test', now - 7 * 3600_000);
    const fresh = cloneName('itsaplan_test', now - 60_000);
    expect(isStaleClone(old, 'itsaplan_test', now)).toBe(true);
    expect(isStaleClone(fresh, 'itsaplan_test', now)).toBe(false);
    expect(isStaleClone(cloneName('other_test', now - 7 * 3600_000), 'itsaplan_test', now)).toBe(false);
    expect(isStaleClone('itsaplan_test', 'itsaplan_test', now)).toBe(false);
  });

  test('reads the database name of a URL', () => {
    expect(databaseName('postgres://u:p@127.0.0.1:55495/itsaplan_test?sslmode=disable')).toBe('itsaplan_test');
  });
});
