import { Elysia } from 'elysia';
import { aiAgent, db } from '@repo/db';
import { and, eq } from 'drizzle-orm';
import { authContext } from '#shared/auth-context';
import { guards } from '#shared/guards';
import { requireUser } from '#shared/access';
import { HttpError } from '#shared/lib';
import { commonErrors, errors } from '#shared/responses';
import { mcpTool } from '#mcp/generate';
import { getCallingAgent } from '#modules/approvals/service';
import {
  OrderListResponse,
  OrderResponse,
  orderBody,
  orderDecision,
  orderParams,
  helenaOrderParams,
  orderPatch,
} from './model';
import { createOrder, decideOrder, listOrders, updateOrder } from './service';

function owner(user: { id: string; role?: string | null } | null | undefined) {
  const me = requireUser(user);
  if (me.role !== 'god') throw new HttpError(403, 'Only the owner may change Helena orders');
  return me.id;
}

async function helenaAgentId() {
  const [agent] = await db
    .select({ id: aiAgent.id })
    .from(aiAgent)
    .where(eq(aiAgent.agentRole, 'home'))
    .orderBy(aiAgent.id)
    .limit(1);
  if (!agent) throw new HttpError(404, 'Helena agent not found');
  return agent.id;
}

export const standingOrderRoutes = new Elysia({
  name: 'standing-orders',
  detail: { tags: ['Standing Orders'] },
})
  .use(authContext)
  .use(guards)
  .get(
    '/projects/:projectKey/standing-orders',
    ({ project }) => listOrders({ projectId: project.id }),
    {
      projectMember: true,
      response: { 200: OrderListResponse, ...commonErrors },
      detail: { summary: 'List project standing orders' },
    },
  )
  .post(
    '/projects/:projectKey/standing-orders',
    ({ project, user, body }) =>
      createOrder({ projectId: project.id }, requireUser(user).id, body, false),
    {
      projectOwner: true,
      body: orderBody,
      response: { 200: OrderResponse, ...commonErrors },
      detail: { summary: 'Create a project standing order' },
    },
  )
  .post(
    '/projects/:projectKey/standing-orders/proposals',
    async ({ project, user, body }) => {
      const agent = await getCallingAgent(requireUser(user).id, project.teamId);
      if (!agent) throw new HttpError(403, 'Only an agent may propose a standing order');
      return createOrder({ projectId: project.id }, agent.userId, body, true);
    },
    {
      projectMember: true,
      body: orderBody,
      response: { 200: OrderResponse, ...commonErrors },
      detail: { summary: 'Propose a project standing order', ...mcpTool('propose_standing_order') },
    },
  )
  .patch(
    '/projects/:projectKey/standing-orders/:orderId',
    ({ project, params, body }) => updateOrder({ projectId: project.id }, params.orderId, body),
    {
      projectOwner: true,
      params: orderParams,
      body: orderPatch,
      response: { 200: OrderResponse, ...commonErrors },
      detail: { summary: 'Update a project standing order' },
    },
  )
  .post(
    '/projects/:projectKey/standing-orders/:orderId/decision',
    ({ project, params, user, body }) =>
      decideOrder({ projectId: project.id }, params.orderId, requireUser(user).id, body.approved),
    {
      projectOwner: true,
      params: orderParams,
      body: orderDecision,
      response: { 200: OrderResponse, ...commonErrors, ...errors(409) },
      detail: { summary: 'Decide a project standing order proposal' },
    },
  )
  .get(
    '/helena/standing-orders',
    async ({ user }) => {
      owner(user);
      return listOrders({ agentId: await helenaAgentId() });
    },
    {
      response: { 200: OrderListResponse, ...commonErrors },
      detail: { summary: 'List Helena standing orders' },
    },
  )
  .post(
    '/helena/standing-orders',
    async ({ user, body }) =>
      createOrder({ agentId: await helenaAgentId() }, owner(user), body, false),
    {
      body: orderBody,
      response: { 200: OrderResponse, ...commonErrors },
      detail: { summary: 'Create a Helena standing order' },
    },
  )
  .post(
    '/helena/standing-orders/proposals',
    async ({ user, body }) => {
      const me = requireUser(user);
      const agentId = await helenaAgentId();
      const [agent] = await db
        .select({ id: aiAgent.id })
        .from(aiAgent)
        .where(and(eq(aiAgent.id, agentId), eq(aiAgent.userId, me.id)));
      if (!agent) throw new HttpError(403, 'Only Helena may propose a Helena standing order');
      return createOrder({ agentId }, me.id, body, true);
    },
    {
      body: orderBody,
      response: { 200: OrderResponse, ...commonErrors },
      detail: {
        summary: 'Propose a Helena standing order',
        ...mcpTool('propose_helena_standing_order'),
      },
    },
  )
  .patch(
    '/helena/standing-orders/:orderId',
    async ({ user, params, body }) => {
      owner(user);
      return updateOrder({ agentId: await helenaAgentId() }, params.orderId, body);
    },
    {
      params: helenaOrderParams,
      body: orderPatch,
      response: { 200: OrderResponse, ...commonErrors },
      detail: { summary: 'Update a Helena standing order' },
    },
  )
  .post(
    '/helena/standing-orders/:orderId/decision',
    async ({ user, params, body }) =>
      decideOrder({ agentId: await helenaAgentId() }, params.orderId, owner(user), body.approved),
    {
      params: helenaOrderParams,
      body: orderDecision,
      response: { 200: OrderResponse, ...commonErrors, ...errors(409) },
      detail: { summary: 'Decide a Helena standing order proposal' },
    },
  );
