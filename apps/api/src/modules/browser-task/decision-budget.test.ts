import { expect, test } from 'bun:test';
import { DecisionBudget } from './decision-budget';

const wait = (ms: number) => Bun.sleep(ms);

test('queue waiting does not spend the generation budget', async () => {
  const budget = new DecisionBudget(120, 30);
  await budget.run(undefined, async (_signal, admitted) => {
    await wait(50);
    admitted();
    await wait(10);
  });
  expect(budget.waitMs).toBeGreaterThanOrEqual(45);
  expect(budget.generationMs).toBeLessThan(30);
});

test('generation and queue timeouts identify the exhausted phase', async () => {
  const generation = new DecisionBudget(100, 15);
  await expect(
    generation.run(undefined, async (_signal, admitted) => {
      admitted();
      await wait(50);
    }),
  ).rejects.toThrow('generation');
  await expect(new DecisionBudget(15, 100).run(undefined, async () => wait(50))).rejects.toThrow(
    'queue',
  );
});

test('generation budget covers all sequential classifier questions', async () => {
  const budget = new DecisionBudget(100, 45);
  await budget.run(undefined, async (_signal, admitted) => {
    admitted();
    await wait(30);
  });
  await expect(
    budget.run(undefined, async (_signal, admitted) => {
      admitted();
      await wait(30);
    }),
  ).rejects.toThrow('generation');
});

test('cancellation stops queue waiting without admitting or retrying', async () => {
  const controller = new AbortController();
  const budget = new DecisionBudget(100, 100);
  const pending = budget.run(controller.signal, async () => wait(60));
  controller.abort(new Error('cancelled'));
  await expect(pending).rejects.toThrow('cancelled');
});
