import { Elysia } from 'elysia';
import { requireGod } from '#shared/access';
import { authContext } from '#shared/auth-context';
import { errors } from '#shared/responses';
import { runSystemJobNow, systemJobState } from '#modules/engine/system-jobs';
import { UPDATES_JOB_ID } from './job';
import {
  UpdateAction,
  UpdateCenterResponse,
  UpdateSettings,
  actionParams,
  applyBody,
  itemParams,
  updateSettingsBody,
} from './model';
import { applyUpdate, getUpdateAction, refreshHermesOffline, updateCenterState } from './service';
import { getUpdateSettings, setUpdateSettings } from './settings';

// The update center (Administrator → Updates, and the card on Start): what Helena runs on,
// what is newer, what it changes, and applying it. The Administrator's alone: an update is
// a download and an install on the host. The scheduled job applies eligible low-risk
// components according to the owner's settings.

async function state() {
  return { ...(await updateCenterState()), job: await systemJobState(UPDATES_JOB_ID) };
}

export const updateCenterRoutes = new Elysia({
  name: 'update-center',
  detail: { tags: ['Update Center'] },
})
  .use(authContext)

  .get(
    '/god/update-center',
    async ({ user }) => {
      requireGod(user);
      return state();
    },
    {
      response: { 200: UpdateCenterResponse, ...errors(401, 403) },
      detail: {
        summary: 'Read the update center',
        description:
          'Every component {appName} runs on with its installed and newest version, whether the ' +
          'update fixes a vulnerability, the summary of what it changes with its risk, the ' +
          'updates started and how they went, the settings and the scheduled check.',
      },
    },
  )

  .post(
    '/god/update-center/check',
    async ({ user }) => {
      requireGod(user);
      await runSystemJobNow(UPDATES_JOB_ID);
      return state();
    },
    {
      response: { 200: UpdateCenterResponse, ...errors(401, 403) },
      detail: {
        summary: 'Check for updates now',
        description:
          'Starts the check (every source, then the summaries of new versions) and answers the ' +
          'state at once; a check that is running is not started twice.',
      },
    },
  )

  .post(
    '/god/update-center/hermes/refresh-local',
    async ({ user }) => {
      requireGod(user);
      await refreshHermesOffline();
      return state();
    },
    {
      response: { 200: UpdateCenterResponse, ...errors(401, 403, 500, 503) },
      detail: {
        summary: 'Refresh installed Hermes from cached Git refs',
        description:
          'Reads the locally installed Hermes checkout and cached release tags through the ' +
          'runner and helper without fetching or installing anything. Refreshes only the Hermes row.',
      },
    },
  )

  .post(
    '/god/update-center/items/:itemId/apply',
    async ({ user, params, body, set }) => {
      const owner = requireGod(user);
      const actionId = await applyUpdate(owner.id, params.itemId, body.scope ?? 'item');
      set.status = 201;
      return getUpdateAction(actionId);
    },
    {
      params: itemParams,
      body: applyBody,
      response: { 201: UpdateAction, ...errors(400, 401, 403, 404, 409, 500) },
      detail: {
        summary: 'Apply an update',
        description:
          "Starts the download and install approved by the owner: the component's helper " +
          'updates it to the version the last check found (Debian packages after a database ' +
          'dump). Answers the update, which is followed with GET …/actions/:actionId.',
      },
    },
  )

  .get(
    '/god/update-center/actions/:actionId',
    async ({ user, params }) => {
      requireGod(user);
      return getUpdateAction(params.actionId);
    },
    {
      params: actionParams,
      response: { 200: UpdateAction, ...errors(401, 403, 404) },
      detail: { summary: 'Follow an update', description: 'Its state, the log and the result.' },
    },
  )

  .get(
    '/god/update-center/settings',
    async ({ user }) => {
      requireGod(user);
      return getUpdateSettings();
    },
    {
      response: { 200: UpdateSettings, ...errors(401, 403) },
      detail: { summary: 'Read the update center settings' },
    },
  )

  .patch(
    '/god/update-center/settings',
    async ({ user, body }) => {
      requireGod(user);
      return setUpdateSettings(body);
    },
    {
      body: updateSettingsBody,
      response: { 200: UpdateSettings, ...errors(400, 401, 403) },
      detail: {
        summary: 'Change the update center settings',
        description:
          'When the check runs on its own (cron and time zone), whether new versions are ' +
          'summarized, and by which agent, model and reasoning ("null" is automatic: the Home ' +
          'agent, the cheapest model the account serves).',
      },
    },
  );
