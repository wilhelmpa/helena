import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { and, eq } from 'drizzle-orm';
import {
  db,
  helenaAlert,
  helenaPushSubscription,
  notificationDelivery,
  recordServiceCheck,
} from '@repo/db';
import {
  enqueuePush,
  forgetVapidKeys,
  generateVapidKeys,
  processPushDeliveries,
  usePushTransport,
  vapidPublicKey,
} from '@helena/push';
import { fakeDevice, fakePushService, type FakeDevice } from '@helena/push/testing';
import { apiKeyApi, app, authedApi } from '#tests/helpers/app';
import { signUpTestUser, type TestUser } from '#tests/helpers/auth';
import { resetDb } from '#tests/helpers/db';
import { createAgent } from '#tests/helpers/agents';
import { HostdError, useHostdTransport } from '#modules/server/hostd';
import { invalidate } from '#modules/server/service';
import { backup, power, storage } from '#modules/server/__tests__/fixtures';
import { checkAlerts } from '../../alerts';
import { forgetHostdSeen } from '../../sources';

// Web Push end to end against a fake push service: a browser's subscription, the categories
// per device, the test message, the alert watcher (once when a problem appears, once when it
// is over, a reminder after 12 hours, never on a failed read), the outbox drain with its
// retries and the removal of a device the push service no longer knows, and the pushes for
// an approval request and a chat answer.

const ORIGIN = (process.env.APP_URL ?? '').split(',')[0]!.trim();

// The JSON a route answered, read field by field in the assertions.
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- any response body
type Body = any;

async function call(
  user: TestUser | null,
  method: string,
  path: string,
  body?: unknown,
  headers: Record<string, string> = {},
): Promise<{ status: number; data: Body }> {
  const response = await app.handle(
    new Request(`http://localhost${path}`, {
      method,
      headers: {
        ...(user ? { cookie: user.cookie } : {}),
        ...(method === 'GET' ? {} : { origin: ORIGIN }),
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        'user-agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 19_0 like Mac OS X) Safari/605.1',
        ...headers,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }),
  );
  const text = await response.text();
  return { status: response.status, data: text ? JSON.parse(text) : null };
}

async function subscribe(user: TestUser, device: FakeDevice, extra: Record<string, unknown> = {}) {
  return call(user, 'POST', '/account/push/devices', {
    subscription: device.subscription,
    vapidKey: await vapidPublicKey(),
    ...extra,
  });
}

// ── A fake host helper ──────────────────────────────────────────────────────────────────────

let helperDown = false;
let storageNow = storage();

function fakeHelper() {
  useHostdTransport(async (method) => {
    if (helperDown) throw new HostdError('Timeout', 'The host helper did not answer in time');
    switch (method) {
      case 'Capabilities':
        return {
          version: '1.0.0',
          system: true,
          storage: { raid: true, smart: true, efi: true },
          backup: { installed: true, initialized: true },
          power: { ec: true, os: true, ryzenadj: true },
        };
      case 'SystemStatus':
        return { memory: { availableBytes: 20_000_000_000, underPressure: false } };
      case 'StorageStatus':
        return storageNow;
      case 'PowerStatus':
        return power();
      case 'BackupStatus':
        return backup();
      case 'Events':
        return { events: [], seenUpTo: 0, unseen: 0, unseenCritical: 0 };
      default:
        throw new HostdError('NotFound', `no fake for ${method}`);
    }
  });
}

function degraded() {
  const base = storage();
  return storage({
    arrays: [{ ...base.arrays[0]!, degraded: 1, syncAction: 'idle', syncPercent: null }],
  });
}

function healthy() {
  const base = storage();
  return storage({
    arrays: [{ ...base.arrays[0]!, degraded: 0, syncAction: 'idle', syncPercent: null }],
  });
}

const minutes = (at: Date, n: number) => new Date(at.getTime() + n * 60_000);

describe('push', () => {
  let service: ReturnType<typeof fakePushService>;
  let phone: FakeDevice;
  let laptop: FakeDevice;

  beforeEach(async () => {
    await resetDb();
    forgetVapidKeys();
    forgetHostdSeen();
    invalidate();
    helperDown = false;
    storageNow = healthy();
    // No host helper and no audit report unless a test fakes one: never the machine's own.
    useHostdTransport(async () => {
      throw new HostdError('Unavailable', 'The host helper is not installed or not running');
    });
    process.env.HELENA_SECURITY_AUDIT_FILE = '/nonexistent/helena-push-test/audit.json';
    phone = await fakeDevice('https://web.push.apple.com/QGw-phone');
    laptop = await fakeDevice('https://fcm.googleapis.com/fcm/send/laptop');
    service = fakePushService([phone, laptop]);
    usePushTransport(service.transport);
  });

  afterEach(() => {
    usePushTransport(null);
    useHostdTransport(null);
  });

  describe('devices', () => {
    it('shows the key, the categories and no device before one subscribes', async () => {
      const owner = await signUpTestUser({ name: 'Owner' });
      const res = await call(owner, 'GET', '/account/push');
      expect(res.status).toBe(200);
      expect(res.data.publicKey).toMatch(/^[A-Za-z0-9_-]{87}$/);
      expect(res.data.categories.map((c: { id: string }) => c.id)).toEqual([
        'emergencies',
        'approvals',
        'needs-you',
        'agent-replies',
      ]);
      expect(res.data.devices).toEqual([]);
      // Generated once: the same key on the next read.
      forgetVapidKeys();
      expect((await call(owner, 'GET', '/account/push')).data.publicKey).toBe(res.data.publicKey);
    });

    it('offers someone who is not the owner no owner-only category', async () => {
      await signUpTestUser({ name: 'Owner' });
      const member = await signUpTestUser({ name: 'Member' });
      const res = await call(member, 'GET', '/account/push');
      expect(res.data.categories.map((c: { id: string }) => c.id)).toEqual([
        'approvals',
        'agent-replies',
      ]);
      const device = await subscribe(member, phone, { categories: { emergencies: true } });
      expect(device.data.categories).toEqual({ approvals: true, 'agent-replies': false });
    });

    it('registers a browser with the default categories, once per endpoint', async () => {
      const owner = await signUpTestUser({ name: 'Owner' });
      const first = await subscribe(owner, phone, { label: 'iPhone', locale: 'de' });
      expect(first.status).toBe(200);
      expect(first.data).toMatchObject({
        label: 'iPhone',
        locale: 'de',
        service: 'web.push.apple.com',
        currentKey: true,
        categories: {
          emergencies: true,
          approvals: true,
          'needs-you': false,
          'agent-replies': false,
        },
        failureCount: 0,
      });
      expect(first.data.userAgent).toContain('iPhone');
      // The same browser again: the same device, its name kept.
      const again = await subscribe(owner, phone);
      expect(again.data.id).toBe(first.data.id);
      expect(again.data.label).toBe('iPhone');
      expect((await call(owner, 'GET', '/account/push')).data.devices).toHaveLength(1);
    });

    it('moves a browser to the person signed in on it now', async () => {
      const owner = await signUpTestUser({ name: 'Owner' });
      const member = await signUpTestUser({ name: 'Member' });
      await subscribe(owner, phone);
      await subscribe(member, phone);
      expect((await call(owner, 'GET', '/account/push')).data.devices).toHaveLength(0);
      expect((await call(member, 'GET', '/account/push')).data.devices).toHaveLength(1);
    });

    it('refuses an API key, a request from elsewhere, an old key and bad subscriptions', async () => {
      const owner = await signUpTestUser({ name: 'Owner' });
      const key = await vapidPublicKey();
      const good = { subscription: phone.subscription, vapidKey: key };
      // The owner's own API key (what an agent could hold) cannot register a device.
      const created = await app.handle(
        new Request('http://localhost/api/auth/api-key/create', {
          method: 'POST',
          headers: { 'content-type': 'application/json', cookie: owner.cookie, origin: ORIGIN },
          body: JSON.stringify({ name: 'push test' }),
        }),
      );
      const apiKey = ((await created.json()) as { key: string }).key;
      const viaKey = await app.handle(
        new Request('http://localhost/account/push/devices', {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-api-key': apiKey, origin: ORIGIN },
          body: JSON.stringify(good),
        }),
      );
      expect(viaKey.status).toBe(403);
      expect(
        (
          await call(owner, 'POST', '/account/push/devices', good, {
            origin: 'https://evil.example.com',
          })
        ).status,
      ).toBe(403);
      const stale = await call(owner, 'POST', '/account/push/devices', {
        ...good,
        vapidKey: (await generateVapidKeys()).publicKey,
      });
      expect(stale.status).toBe(409);
      expect(stale.data.code).toBe('push_key_changed');
      for (const endpoint of [
        'http://fcm.googleapis.com/fcm/send/x',
        'https://127.0.0.1/push',
        'https://169.254.169.254/latest',
        'https://printer.local/push',
        'https://user:pw@fcm.googleapis.com/x',
      ]) {
        const res = await call(owner, 'POST', '/account/push/devices', {
          ...good,
          subscription: { ...phone.subscription, endpoint },
        });
        expect(res.status).toBe(400);
      }
      const badKey = await call(owner, 'POST', '/account/push/devices', {
        ...good,
        subscription: {
          ...phone.subscription,
          keys: { ...phone.subscription.keys, auth: 'AAAAAAAAAAAAAAAAAAAAAAAAAA' },
        },
      });
      expect(badKey.status).toBe(400);
      expect((await call(null, 'GET', '/account/push')).status).toBe(401);
    });

    it('switches categories per device and removes a device', async () => {
      const owner = await signUpTestUser({ name: 'Owner' });
      const device = (await subscribe(owner, phone)).data;
      const other = (await subscribe(owner, laptop)).data;
      const patched = await call(owner, 'PATCH', `/account/push/devices/${device.id}`, {
        label: 'Telefon',
        categories: { 'agent-replies': true, emergencies: false, 'no.such': true },
      });
      expect(patched.status).toBe(200);
      expect(patched.data.label).toBe('Telefon');
      expect(patched.data.categories).toMatchObject({
        emergencies: false,
        'agent-replies': true,
      });
      expect(patched.data.categories['no.such']).toBeUndefined();
      const list = (await call(owner, 'GET', '/account/push')).data.devices;
      expect(list.find((d: { id: number }) => d.id === other.id).categories.emergencies).toBe(true);

      const stranger = await signUpTestUser({ name: 'Stranger' });
      expect((await call(stranger, 'DELETE', `/account/push/devices/${device.id}`)).status).toBe(
        404,
      );
      expect((await call(owner, 'DELETE', `/account/push/devices/${device.id}`)).status).toBe(204);
      expect((await call(owner, 'GET', '/account/push')).data.devices).toHaveLength(1);
    });
  });

  describe('the test message', () => {
    it("arrives encrypted, signed and in the device's language", async () => {
      const owner = await signUpTestUser({ name: 'Owner', email: 'owner@example.com' });
      const device = (await subscribe(owner, phone, { locale: 'de' })).data;
      const res = await call(owner, 'POST', `/account/push/devices/${device.id}/test`);
      expect(res.data).toEqual({ ok: true, status: 201, gone: false, error: null });
      expect(service.received).toHaveLength(1);
      const got = service.received[0]!;
      expect(got.payload).toMatchObject({
        v: 1,
        title: 'Ava',
        body: 'Push funktioniert auf diesem Gerät.',
        url: '/account/notifications',
      });
      expect(got.headers.urgency).toBe('high');
      expect(got.headers.ttl).toBe('300');
      expect(got.jwt.aud).toBe('https://web.push.apple.com');
      expect(got.jwt.sub).toBe('mailto:owner@example.com');
      expect(got.vapidKey).toBe(await vapidPublicKey());
      const list = (await call(owner, 'GET', '/account/push')).data.devices;
      expect(list[0].lastSuccessAt).not.toBeNull();
    });

    it('removes a device the push service no longer knows', async () => {
      const owner = await signUpTestUser({ name: 'Owner' });
      const device = (await subscribe(owner, phone)).data;
      service.answer(410);
      const res = await call(owner, 'POST', `/account/push/devices/${device.id}/test`);
      expect(res.data).toMatchObject({ ok: false, status: 410, gone: true });
      expect((await call(owner, 'GET', '/account/push')).data.devices).toHaveLength(0);
    });
  });

  describe('the outbox', () => {
    it('queues a message once per device and sends it', async () => {
      const owner = await signUpTestUser({ name: 'Owner' });
      await subscribe(owner, phone);
      await subscribe(owner, laptop);
      const notice = {
        category: 'approvals',
        defaultOn: true,
        urgency: 'high' as const,
        ttlSeconds: 600,
        dedupeKey: 'approval:1',
        tag: 'approval:1',
        url: '/approvals',
        render: () => ({ title: 'T', body: 'B' }),
      };
      expect(await enqueuePush([owner.userId], notice)).toBe(2);
      expect(await enqueuePush([owner.userId], notice)).toBe(0);
      expect(await processPushDeliveries()).toBe(2);
      expect(service.received.map((r) => r.endpoint).sort()).toEqual(
        [laptop.subscription.endpoint, phone.subscription.endpoint].sort(),
      );
      expect(service.received[0]!.headers.topic).toMatch(/^[A-Za-z0-9_-]{32}$/);
      const left = await db
        .select()
        .from(notificationDelivery)
        .where(eq(notificationDelivery.channel, 'push'));
      expect(left).toHaveLength(0);
    });

    it('tries again later on a server error and drops a device that is gone', async () => {
      const owner = await signUpTestUser({ name: 'Owner' });
      const onPhone = (await subscribe(owner, phone)).data;
      await subscribe(owner, laptop);
      service.answer((endpoint) => (endpoint === phone.subscription.endpoint ? 503 : 404), {
        'retry-after': '120',
      });
      await enqueuePush([owner.userId], {
        category: 'approvals',
        defaultOn: true,
        urgency: 'high',
        ttlSeconds: 600,
        dedupeKey: 'x',
        tag: 'x',
        url: '/',
        render: () => ({ title: 'T', body: 'B' }),
      });
      await processPushDeliveries();
      const rows = await db
        .select()
        .from(notificationDelivery)
        .where(eq(notificationDelivery.channel, 'push'));
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        status: 'pending',
        attempts: 1,
        recipient: String(onPhone.id),
      });
      expect(rows[0]!.nextAttemptAt.getTime()).toBeGreaterThan(Date.now() + 100_000);
      const devices = (await call(owner, 'GET', '/account/push')).data.devices;
      expect(devices).toHaveLength(1);
      expect(devices[0].lastError).toContain('HTTP 503');
    });

    it('does not send a message that waited longer than it lives', async () => {
      const owner = await signUpTestUser({ name: 'Owner' });
      await subscribe(owner, phone);
      await enqueuePush([owner.userId], {
        category: 'approvals',
        defaultOn: true,
        urgency: 'normal',
        ttlSeconds: 60,
        dedupeKey: 'old',
        tag: 'old',
        url: '/',
        render: () => ({ title: 'T', body: 'B' }),
      });
      await db
        .update(notificationDelivery)
        .set({ createdAt: new Date(Date.now() - 3_600_000) })
        .where(eq(notificationDelivery.channel, 'push'));
      await processPushDeliveries();
      expect(service.received).toHaveLength(0);
      expect(
        await db
          .select()
          .from(notificationDelivery)
          .where(eq(notificationDelivery.channel, 'push')),
      ).toHaveLength(0);
    });
  });

  describe('alerts', () => {
    async function ownerWithPhone(locale = 'de', categories?: Record<string, boolean>) {
      const owner = await signUpTestUser({ name: 'Owner' });
      await subscribe(owner, phone, { locale, ...(categories ? { categories } : {}) });
      return owner;
    }

    async function check(at: Date) {
      invalidate();
      const result = await checkAlerts(at);
      await processPushDeliveries();
      return result;
    }

    it('pushes a degraded mirror once, a reminder after 12 hours and once when it is fine', async () => {
      await ownerWithPhone('de');
      fakeHelper();
      const t0 = new Date();
      await check(t0);
      expect(service.received).toHaveLength(0);

      storageNow = degraded();
      await check(minutes(t0, 1));
      // Within the grace period: nothing yet.
      expect(service.received).toHaveLength(0);
      const opened = await check(minutes(t0, 3));
      expect(opened.opened).toBe(1);
      expect(service.received).toHaveLength(1);
      expect(service.received[0]!.payload).toMatchObject({
        category: 'emergencies',
        title: 'Notfall: Spiegel helena-root',
        url: '/god/server/disks',
        renotify: true,
        requireInteraction: true,
      });
      expect(service.received[0]!.payload.body).toContain('eine Platte fehlt');
      expect(service.received[0]!.headers.urgency).toBe('high');

      // No spam while it stays the same.
      await check(minutes(t0, 5));
      await check(minutes(t0, 60));
      expect(service.received).toHaveLength(1);

      // Rebuilding is still an emergency: the same alert, no new push.
      storageNow = storage();
      await check(minutes(t0, 90));
      expect(service.received).toHaveLength(1);

      const reminded = await check(minutes(t0, 3 + 12 * 60));
      expect(reminded.reminded).toBe(1);
      expect(service.received[1]!.payload.title).toBe('Noch offen: Spiegel helena-root');
      expect(service.received[1]!.payload.body).toContain('Seit 12 Stunden');

      storageNow = healthy();
      const resolved = await check(minutes(t0, 13 * 60));
      expect(resolved.resolved).toBe(1);
      expect(service.received[2]!.payload).toMatchObject({
        title: 'Wieder in Ordnung: Spiegel helena-root',
        tag: service.received[0]!.payload.tag,
      });
      expect(service.received[2]!.headers.urgency).toBe('normal');
      await check(minutes(t0, 14 * 60));
      expect(service.received).toHaveLength(3);
    });

    it('never announces a recovery because the helper stopped answering', async () => {
      await ownerWithPhone('en');
      fakeHelper();
      storageNow = degraded();
      const t0 = new Date();
      await check(t0);
      await check(minutes(t0, 3));
      expect(service.received).toHaveLength(1);
      expect(service.received[0]!.payload.title).toBe('Emergency: Mirror helena-root');

      helperDown = true;
      const failed = await check(minutes(t0, 5));
      expect(failed.failed).toContain('helena.server');
      expect(failed.resolved).toBe(0);
      const open = await db.select().from(helenaAlert);
      expect(open.find((row) => row.source === 'helena.server')?.resolvedAt).toBeNull();

      // The helper itself is missed once it stays away.
      await check(minutes(t0, 10));
      expect(service.received.map((r) => r.payload.title)).toContain('Emergency: Host helper');
    });

    it('resolves a blip inside the grace period silently', async () => {
      await ownerWithPhone();
      fakeHelper();
      const t0 = new Date();
      storageNow = degraded();
      await check(t0);
      storageNow = healthy();
      await check(minutes(t0, 0.5));
      await check(minutes(t0, 5));
      expect(service.received).toHaveLength(0);
    });

    it('reaches only devices with emergencies on', async () => {
      await ownerWithPhone('de', { emergencies: false });
      fakeHelper();
      storageNow = degraded();
      const t0 = new Date();
      await check(t0);
      await check(minutes(t0, 3));
      expect(service.received).toHaveLength(0);
    });

    it('pushes a service that stays down after a deploy would be over', async () => {
      await ownerWithPhone('de');
      await recordServiceCheck('worker', 'connection refused');
      const t0 = new Date();
      await check(t0);
      await check(minutes(t0, 2));
      expect(service.received).toHaveLength(0);
      await check(minutes(t0, 5));
      expect(service.received).toHaveLength(1);
      expect(service.received[0]!.payload.title).toBe('Notfall: Dienst Worker');
      await recordServiceCheck('worker', null);
      await check(minutes(t0, 6));
      expect(service.received[1]!.payload.title).toBe('Wieder in Ordnung: Dienst Worker');
    });
  });

  describe('events', () => {
    it('pushes an approval request to the people who may decide it', async () => {
      const owner = await signUpTestUser({ name: 'Owner' });
      const asOwner = authedApi(owner.cookie);
      await subscribe(owner, phone, { locale: 'de' });
      await asOwner.projects.post({ key: 'MKT', name: 'Marketing' });
      const created = await createAgent(asOwner, 'MKT', {
        name: 'Ext Bot',
        username: 'ext',
        kind: 'external',
        triggerOnMention: true,
      });
      const asAgent = apiKeyApi(created.data!.apiKey!);
      const res = await asAgent.projects({ projectKey: 'MKT' }).approvals.post({
        kind: 'send',
        action: 'Angebot an jane@example.com senden',
      } as never);
      expect(res.status).toBe(201);
      await processPushDeliveries();
      expect(service.received).toHaveLength(1);
      expect(service.received[0]!.payload).toMatchObject({
        category: 'approvals',
        title: 'Freigabe: Ext Bot',
        body: 'Angebot an jane@example.com senden · Marketing',
        url: '/approvals',
      });
    });

    it("pushes an agent's answer only while nobody looks at Helena", async () => {
      const owner = await signUpTestUser({ name: 'Owner' });
      await subscribe(owner, phone, { locale: 'en', categories: { 'agent-replies': true } });
      const { publishDomainEvent } = await import('#shared/helena');
      const answer = (messageId: number) =>
        publishDomainEvent({
          type: 'helena.chat.message',
          projectId: null,
          subject: `chats/t1/messages/${messageId}`,
          data: {
            threadId: 't1',
            messageId,
            role: 'assistant',
            status: 'success',
            agentId: 999_999,
            userId: owner.userId,
            projectId: null,
          },
        });

      expect((await call(owner, 'PUT', '/account/push/presence', { visible: true })).status).toBe(
        204,
      );
      await answer(1);
      await processPushDeliveries();
      expect(service.received).toHaveLength(0);

      await call(owner, 'PUT', '/account/push/presence', { visible: false });
      await answer(2);
      await processPushDeliveries();
      expect(service.received).toHaveLength(1);
      expect(service.received[0]!.payload).toMatchObject({
        category: 'agent-replies',
        title: 'Ava answered',
        body: 'The answer is ready.',
        url: '/chat?agent=999999&thread=t1',
        tag: 'chat:t1',
      });
    });
  });

  it('keeps push rows out of the email and Telegram drain', async () => {
    const owner = await signUpTestUser({ name: 'Owner' });
    const device = (await subscribe(owner, phone)).data;
    await db.insert(notificationDelivery).values({
      projectId: null,
      channel: 'push',
      recipient: String(device.id),
      payload: { text: 'x' },
    });
    const rows = await db
      .select()
      .from(notificationDelivery)
      .where(
        and(eq(notificationDelivery.channel, 'push'), eq(notificationDelivery.status, 'pending')),
      );
    expect(rows).toHaveLength(1);
    // A push row without a message is marked failed by the push drain, not sent elsewhere.
    await processPushDeliveries();
    const [after] = await db
      .select()
      .from(notificationDelivery)
      .where(eq(notificationDelivery.channel, 'push'));
    expect(after?.status).toBe('failed');
    expect(
      await db
        .select()
        .from(helenaPushSubscription)
        .where(eq(helenaPushSubscription.id, device.id)),
    ).toHaveLength(1);
  });
});
