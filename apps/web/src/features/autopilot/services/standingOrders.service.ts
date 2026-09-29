'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  createStandingOrder,
  decideStandingOrder,
  deleteStandingOrder,
  listStandingOrders,
  updateStandingOrder,
  type StandingOrderScope,
} from '@/lib/api/endpoints/standingOrders';

export const standingOrdersKey = (scope: StandingOrderScope) =>
  ['standing-orders', scope?.projectKey ?? 'helena'] as const;

export function useStandingOrders(scope: StandingOrderScope, enabled = true) {
  return useQuery({
    queryKey: standingOrdersKey(scope),
    queryFn: () => listStandingOrders(scope),
    enabled,
  });
}

// Every change refetches the list: an order's place (active, proposal, rejected) moves.
export function useStandingOrderMutations(scope: StandingOrderScope) {
  const queryClient = useQueryClient();
  const onSuccess = () => queryClient.invalidateQueries({ queryKey: standingOrdersKey(scope) });
  return {
    create: useMutation({
      mutationFn: (input: { body: string; source: string }) => createStandingOrder(scope, input),
      onSuccess,
    }),
    update: useMutation({
      mutationFn: ({ id, patch }: { id: number; patch: { body?: string; active?: boolean } }) =>
        updateStandingOrder(scope, id, patch),
      onSuccess,
    }),
    decide: useMutation({
      mutationFn: ({ id, approved }: { id: number; approved: boolean }) =>
        decideStandingOrder(scope, id, approved),
      onSuccess,
    }),
    remove: useMutation({
      mutationFn: (id: number) => deleteStandingOrder(scope, id),
      onSuccess,
    }),
  };
}
