import { Elysia, t } from 'elysia';
import type { LocalizedText } from '@helena/sdk';
import { trustedOrigins } from '@repo/auth';
import { authContext } from '#shared/auth-context';
import { requireUser, type AuthUser } from '#shared/access';
import { HttpError } from '#shared/lib';
import { noContent } from '#shared/http';
import { commonErrors, errors } from '#shared/responses';
import { categoriesFor } from './categories';
import {
  DeviceParams,
  DevicePatch,
  PresenceBody,
  PushDeviceView,
  PushOverviewResponse,
  SubscribeBody,
  TestResponse,
} from './model';
import {
  listDevices,
  publicKeyOrNull,
  removeDevice,
  sendTest,
  setPresence,
  subscribe,
  updateDevice,
} from './service';

// Konto → Benachrichtigungen (docs/helena-decisions/push.md): the signed-in person's devices
// that receive Helena's pushes. Every route is the person's own and belongs to the app in
// their browser: an API key or an MCP token cannot register a device (it would route the
// owner's emergencies to a stranger's endpoint), and a change must come from the app's own
// origin. Not MCP tools.

function sessionOnly(request: Request): void {
  if (request.headers.has('x-api-key') || request.headers.has('authorization')) {
    throw new HttpError(403, 'Push devices are managed in the signed-in app');
  }
  if (!request.headers.get('cookie')) {
    throw new HttpError(403, 'Push devices are managed in the signed-in app');
  }
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    const origin = request.headers.get('origin');
    if (!origin || !trustedOrigins.includes(origin)) {
      throw new HttpError(403, 'The request must come from the signed-in application');
    }
  }
}

const isOwner = (user: AuthUser) => user.role === 'god';

// A category's label as the page resolves it: a text, `{ i18n }` (a key of the web's own
// translations) or a plugin's text per language.
const labelOut = (text: LocalizedText): string | Record<string, string> =>
  text as string | Record<string, string>;

export const pushRoutes = new Elysia({ name: 'push', detail: { tags: ['Notifications'] } })
  .use(authContext)

  .get(
    '/account/push',
    async ({ user, request }) => {
      const me = requireUser(user);
      sessionOnly(request);
      const owner = isOwner(me);
      return {
        publicKey: await publicKeyOrNull(),
        categories: categoriesFor(owner).map((category) => ({
          id: category.id,
          label: labelOut(category.label),
          description: category.description ? labelOut(category.description) : null,
          defaultOn: category.defaultOn,
          audience: category.audience,
        })),
        devices: await listDevices(me.id, owner),
      };
    },
    {
      response: { 200: PushOverviewResponse, ...errors(401, 403) },
      detail: {
        summary: 'Read the push settings',
        description:
          "The instance's public VAPID key browsers subscribe with, the categories this person " +
          'may receive, and their devices with the categories each one has on.',
      },
    },
  )

  .post(
    '/account/push/devices',
    async ({ user, request, body }) => {
      const me = requireUser(user);
      sessionOnly(request);
      return subscribe(
        me.id,
        isOwner(me),
        {
          endpoint: body.subscription.endpoint,
          expirationTime: body.subscription.expirationTime ?? null,
          keys: body.subscription.keys,
          vapidKey: body.vapidKey,
          ...(body.label !== undefined ? { label: body.label } : {}),
          ...(body.locale !== undefined ? { locale: body.locale } : {}),
          ...(body.categories !== undefined ? { categories: body.categories } : {}),
          ...(body.replaces !== undefined ? { replaces: body.replaces } : {}),
        },
        request.headers.get('user-agent') ?? '',
      );
    },
    {
      body: SubscribeBody,
      response: { 200: PushDeviceView, ...commonErrors, ...errors(409) },
      detail: {
        summary: 'Register this browser for push',
        description:
          "Stores the browser's push subscription (PushSubscription.toJSON()). The same browser " +
          'again updates its device; `replaces` names the endpoint a renewed subscription ' +
          'takes over from. 409 `push_key_changed` when the browser subscribed with an old key.',
      },
    },
  )

  .patch(
    '/account/push/devices/:id',
    async ({ user, request, params, body }) => {
      const me = requireUser(user);
      sessionOnly(request);
      return updateDevice(me.id, isOwner(me), params.id, body);
    },
    {
      params: DeviceParams,
      body: DevicePatch,
      response: { 200: PushDeviceView, ...commonErrors },
      detail: {
        summary: "Change a device's name or categories",
        description: 'Switches categories on or off for one device; the others keep theirs.',
      },
    },
  )

  .delete(
    '/account/push/devices/:id',
    async ({ user, request, params }) => {
      const me = requireUser(user);
      sessionOnly(request);
      await removeDevice(me.id, params.id);
      return noContent();
    },
    {
      params: DeviceParams,
      response: { 204: t.Void(), ...commonErrors },
      detail: {
        summary: 'Remove a device',
        description: 'The device receives nothing any more; messages waiting for it are dropped.',
      },
    },
  )

  .post(
    '/account/push/devices/:id/test',
    async ({ user, request, params }) => {
      const me = requireUser(user);
      sessionOnly(request);
      return sendTest(me.id, params.id);
    },
    {
      params: DeviceParams,
      response: { 200: TestResponse, ...commonErrors },
      detail: {
        summary: 'Send a test push to a device',
        description:
          "Sends a test message now, whatever the device's categories, and returns the push " +
          "service's answer. A device the push service no longer knows is removed.",
      },
    },
  )

  .put(
    '/account/push/presence',
    async ({ user, request, body }) => {
      const me = requireUser(user);
      sessionOnly(request);
      await setPresence(me.id, body.visible);
      return noContent();
    },
    {
      body: PresenceBody,
      response: { 204: t.Void(), ...commonErrors },
      detail: {
        summary: 'Report that {appName} is visible',
        description:
          "A visible page of {appName} reports itself every minute; an agent's chat answer is " +
          'pushed only while none is.',
      },
    },
  );
