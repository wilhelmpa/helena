import { request } from '@/lib/api/core/client';

// Standing orders (OpenClaw's "dauerhafte Anweisungen"; apps/api modules/standing-orders):
// rules the agents of a project, or Helena, follow in every run until they are switched
// off. An agent may propose one; it works only once the owner confirms it.
export interface StandingOrder {
  id: number;
  projectId: number | null;
  agentId: number | null;
  body: string;
  // Where the rule comes from (the owner's name, an agent's suggestion …).
  source: string;
  authorUserId: string;
  status: 'proposed' | 'confirmed' | 'rejected';
  active: boolean;
  decidedByUserId: string | null;
  createdAt: string;
  updatedAt: string;
}

// A project's orders, or Helena's (null).
export type StandingOrderScope = { projectKey: string } | null;

const base = (scope: StandingOrderScope) =>
  scope ? `/projects/${scope.projectKey}/standing-orders` : '/helena/standing-orders';

export const listStandingOrders = (scope: StandingOrderScope) =>
  request<StandingOrder[]>(base(scope));

export const createStandingOrder = (
  scope: StandingOrderScope,
  input: { body: string; source: string },
) => request<StandingOrder>(base(scope), { method: 'POST', body: JSON.stringify(input) });

export const updateStandingOrder = (
  scope: StandingOrderScope,
  id: number,
  patch: { body?: string; active?: boolean },
) =>
  request<StandingOrder>(`${base(scope)}/${id}`, { method: 'PATCH', body: JSON.stringify(patch) });

export const decideStandingOrder = (scope: StandingOrderScope, id: number, approved: boolean) =>
  request<StandingOrder>(`${base(scope)}/${id}/decision`, {
    method: 'POST',
    body: JSON.stringify({ approved }),
  });

export const deleteStandingOrder = (scope: StandingOrderScope, id: number) =>
  request<StandingOrder>(`${base(scope)}/${id}`, { method: 'DELETE' });
