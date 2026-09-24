import { Elysia } from 'elysia';
import { requireGod, requireUser } from '#shared/access';
import { authContext } from '#shared/auth-context';
import { errors } from '#shared/responses';
import { EmergencyStopResponse, emergencyStopBody } from './model';
import { getEmergencyStop, setEmergencyStop } from './service';

// The instance's emergency stop: every signed-in person sees whether it is on (the app shows
// it across every page), and the instance owner switches it.
export const emergencyStopRoutes = new Elysia({
  name: 'emergency-stop',
  detail: { tags: ['Emergency Stop'] },
})
  .use(authContext)

  .get(
    '/emergency-stop',
    async ({ user }) => {
      requireUser(user);
      return getEmergencyStop();
    },
    {
      response: { 200: EmergencyStopResponse, ...errors(401) },
      detail: { summary: "Read the instance's emergency stop" },
    },
  )

  .put(
    '/god/emergency-stop',
    async ({ user, body }) => {
      const owner = requireGod(user);
      return setEmergencyStop(body.active, owner.id, body.reason);
    },
    {
      body: emergencyStopBody,
      response: { 200: EmergencyStopResponse, ...errors(400, 401, 403) },
      detail: {
        summary: 'Switch the emergency stop on or off',
        description:
          'On: no agent is handed a run or a chat answer, runs in flight are stopped and ' +
          'handed back (they resume their session afterwards), answers being written stop, and ' +
          "every Hermes runtime gets Hermes' own stop. Off lifts all of it.",
      },
    },
  );
