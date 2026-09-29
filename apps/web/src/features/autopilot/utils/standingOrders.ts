import type { StandingOrder } from '@/lib/api/endpoints/standingOrders';

// The orders as the settings list them: the agents' proposals waiting for a decision
// first, then the confirmed ones (in force, then switched off), each oldest first; a
// rejected proposal is not shown.
export function standingOrderGroups(orders: StandingOrder[]): {
  proposed: StandingOrder[];
  confirmed: StandingOrder[];
} {
  const byId = (a: StandingOrder, b: StandingOrder) => a.id - b.id;
  return {
    proposed: orders.filter((order) => order.status === 'proposed').sort(byId),
    confirmed: orders
      .filter((order) => order.status === 'confirmed')
      .sort((a, b) => Number(b.active) - Number(a.active) || byId(a, b)),
  };
}
