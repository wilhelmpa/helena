import { expect, test } from 'bun:test';
import type { z } from 'zod';
import { templateBundleSchema } from './bundle-schema';

test('department and agent budgets preserve all supported periods', () => {
  const budgets = (['day', 'week', 'month'] as const).map((period) => ({
    metric: 'tokens' as const,
    period,
    limit: 100,
  }));
  const schema = templateBundleSchema.shape.department;
  const department: z.infer<typeof schema> = {
    name: 'Test',
    description: '',
    restrictedSkills: false,
    allowedSkills: [],
    budgets,
    agents: [
      {
        name: 'test',
        role: 'specialist',
        reportsTo: null,
        projects: ['TEST'],
        heartbeat: {
          intervalMinutes: null,
          timezone: 'UTC',
          days: [1],
          start: '09:00',
          end: '17:00',
          instructions: '',
        },
        budgets,
      },
    ],
    goals: [],
    routines: [],
  };
  expect(schema.parse(department)).toEqual(department);
  expect(
    schema.safeParse({ ...department, budgets: [{ ...budgets[0], period: 'year' }] }).success,
  ).toBe(false);
});
