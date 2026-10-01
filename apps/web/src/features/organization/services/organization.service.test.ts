import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test } from 'node:test';

const { mock } = createRequire(import.meta.url)('bun:test') as {
  mock: { module(specifier: string, factory: () => Record<string, unknown>): void };
};
let queryOptions: { enabled: boolean; queryKey: unknown[] };
mock.module('@tanstack/react-query', () => ({
  useQuery: (options: typeof queryOptions) => {
    queryOptions = options;
    return options;
  },
  useMutation: () => undefined,
  useQueryClient: () => undefined,
}));
const { useOrganizationQuery: organizationQuery } = await import('./organization.service');

test('does not request an organization before a valid team is available', () => {
  for (const teamId of [null, 0, -1]) {
    organizationQuery(teamId);
    assert.equal(queryOptions.enabled, false);
  }
  organizationQuery(1, 5);
  assert.equal(queryOptions.enabled, true);
  assert.ok(queryOptions.queryKey.includes(1));
  assert.ok(queryOptions.queryKey.includes(5));
});
