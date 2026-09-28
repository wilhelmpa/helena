import { Elysia } from 'elysia';
import { requireGod } from '#shared/access';
import { authContext } from '#shared/auth-context';
import { errors } from '#shared/responses';
import { EscalationSettings, escalationBody } from './model';
import { readEscalation, writeEscalation } from './service';

// The escalation rules (rules.ts): when a strong subscription model takes over from the local
// one. Owner only. A draft for Phase 2 (docs/plan-lokal-halogen.md): stored and shown, not yet
// acted on.
export const escalationRoutes = new Elysia({
  name: 'escalation',
  detail: { tags: ['Local AI'] },
})
  .use(authContext)
  .get(
    '/god/escalation',
    ({ user }) => {
      requireGod(user);
      return readEscalation();
    },
    {
      response: { 200: EscalationSettings, ...errors(401, 403) },
      detail: {
        summary: 'Read the escalation rules',
        description:
          'When a strong model (Opus, gpt-6-sol) takes over from the local one: work of a ' +
          'hard kind, an unsure local answer, a failed local attempt, and fixed choices per ' +
          'agent, project or task. Off by default; Phase 2 wires it into the runs.',
      },
    },
  )
  .put(
    '/god/escalation',
    ({ user, body }) => {
      requireGod(user);
      return writeEscalation(body);
    },
    {
      body: escalationBody,
      response: { 200: EscalationSettings, ...errors(400, 401, 403) },
      detail: { summary: 'Change the escalation rules' },
    },
  );
