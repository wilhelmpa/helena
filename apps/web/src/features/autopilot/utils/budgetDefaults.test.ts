import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { budgetsFromDefaults, budgetsMatchDefaults } from './budgetDefaults';

describe('Budgets: Vorgabe und Überschreibung', () => {
  const defaults = [{ metric: 'cost' as const, period: 'day' as const, limit: 5 }];

  test('gleich der Vorgabe nur bei gleichen Grenzen in gleichen Feldern', () => {
    assert.equal(
      budgetsMatchDefaults([{ metric: 'cost', period: 'day', limit: 5 }], defaults),
      true,
    );
    assert.equal(
      budgetsMatchDefaults([{ metric: 'cost', period: 'day', limit: 6 }], defaults),
      false,
    );
    assert.equal(budgetsMatchDefaults([], defaults), false);
    assert.equal(budgetsMatchDefaults([], []), true);
    assert.equal(
      budgetsMatchDefaults(
        [
          { metric: 'cost', period: 'day', limit: 5 },
          { metric: 'tokens', period: 'month', limit: 9 },
        ],
        defaults,
      ),
      false,
    );
  });

  test('zurück auf die Vorgabe: jedes Feld auf ihre Grenze oder leer', () => {
    const change = budgetsFromDefaults(defaults);
    assert.equal(change.length, 6);
    assert.deepEqual(
      change.filter((cell) => cell.limit != null),
      [{ metric: 'cost', period: 'day', limit: 5 }],
    );
  });
});
