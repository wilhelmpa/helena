import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { StandingOrder } from '@/lib/api/endpoints/standingOrders';
import { standingOrderGroups } from './standingOrders';

const order = (id: number, status: StandingOrder['status'], active: boolean) =>
  ({ id, status, active, body: `Regel ${id}` }) as StandingOrder;

describe('Dauerhafte Anweisungen', () => {
  test('Vorschläge zuerst, dann geltende vor abgeschalteten, abgelehnte nicht', () => {
    const groups = standingOrderGroups([
      order(4, 'confirmed', false),
      order(3, 'proposed', false),
      order(1, 'confirmed', true),
      order(2, 'rejected', false),
      order(5, 'confirmed', true),
    ]);
    assert.deepEqual(
      groups.proposed.map((item) => item.id),
      [3],
    );
    assert.deepEqual(
      groups.confirmed.map((item) => item.id),
      [1, 5, 4],
    );
  });
});
