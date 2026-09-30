import { expect, mock, test } from 'bun:test';

const useQuery = mock((options: { enabled: boolean; queryKey: unknown[] }) => options);
mock.module('@tanstack/react-query', () => ({
  useQuery,
  useMutation: mock(),
  useQueryClient: mock(),
}));
const { useOrganizationQuery: organizationQuery } = await import('./organization.service');

test('does not request an organization before a valid team is available', () => {
  for (const teamId of [null, 0, -1]) {
    organizationQuery(teamId);
    expect(useQuery.mock.lastCall?.[0].enabled).toBe(false);
  }
  organizationQuery(1, 5);
  expect(useQuery.mock.lastCall?.[0].enabled).toBe(true);
  expect(useQuery.mock.lastCall?.[0].queryKey).toContain(1);
  expect(useQuery.mock.lastCall?.[0].queryKey).toContain(5);
});
