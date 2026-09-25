import { describe, expect, it } from 'bun:test';
import { createECDH, randomBytes } from 'node:crypto';
import { buildPushPayload } from '@block65/webcrypto-web-push';
import ece from 'http_ece';
import { pushBackoffMs } from './backoff';
import { wantsCategory } from './choices';
import { generateVapidKeys } from './keys';
import { pushPayload, pushTopic } from './payload';
import { fakeDevice } from './testing';

// What needs no database: the fake device's decryption against the reference implementation
// and the sender's library, the payload and topic, the category switch and the backoff.

describe('the fake device', () => {
  it('decrypts what the reference implementation (http_ece) encrypts', async () => {
    const device = await fakeDevice('https://push.example.test/a');
    const sender = createECDH('prime256v1');
    sender.generateKeys();
    const body = ece.encrypt(Buffer.from('{"hello":"Helena"}'), {
      version: 'aes128gcm',
      privateKey: sender,
      dh: device.subscription.keys.p256dh,
      authSecret: device.subscription.keys.auth,
      salt: randomBytes(16),
    });
    expect(await device.decrypt(new Uint8Array(body))).toBe('{"hello":"Helena"}');
  });

  it('decrypts what the sender library encrypts, padded to 4096 bytes', async () => {
    const device = await fakeDevice('https://push.example.test/b');
    const keys = await generateVapidKeys();
    const built = await buildPushPayload(
      { data: 'Spiegel md127 ist unvollständig', options: { ttl: 60 } },
      device.subscription,
      { subject: 'mailto:owner@example.com', ...keys },
    );
    expect(built.body.byteLength).toBe(4096);
    expect(await device.decrypt(built.body)).toBe('Spiegel md127 ist unvollständig');
  });
});

describe('the payload', () => {
  it('names a topic of at most 32 base64url characters, the same for the same tag', () => {
    const topic = pushTopic('alert:helena.server|helena.server.storage/raid:helena-root');
    expect(topic).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(pushTopic('alert:x')).toBe(pushTopic('alert:x'));
    expect(pushTopic('alert:x')).not.toBe(pushTopic('alert:y'));
  });

  it('cuts a long title and body with an ellipsis', () => {
    const payload = pushPayload({
      category: 'agent-replies',
      title: 'T'.repeat(300),
      body: 'ü'.repeat(900),
      url: '/chat',
      tag: 'chat:1',
      urgency: 'normal',
      ttlSeconds: 60,
      at: '2026-09-25T10:00:00.000Z',
    });
    expect([...payload.title]).toHaveLength(120);
    expect(payload.title.endsWith('…')).toBe(true);
    expect([...payload.body]).toHaveLength(600);
    expect(new TextEncoder().encode(JSON.stringify(payload)).length).toBeLessThan(3993);
  });
});

describe('categories and retries', () => {
  it("follows a device's own switch, else the category's default", () => {
    expect(wantsCategory({}, 'emergencies', true)).toBe(true);
    expect(wantsCategory({ emergencies: false }, 'emergencies', true)).toBe(false);
    expect(wantsCategory({ 'agent-replies': true }, 'agent-replies', false)).toBe(true);
    expect(wantsCategory(null, 'needs-you', false)).toBe(false);
  });

  it('backs off between half and all of a doubling window, capped', () => {
    for (let attempt = 1; attempt <= 8; attempt += 1) {
      const window = Math.min(30 * 60_000, 30_000 * 2 ** (attempt - 1));
      const delay = pushBackoffMs(attempt);
      expect(delay).toBeGreaterThanOrEqual(window / 2);
      expect(delay).toBeLessThanOrEqual(window);
    }
  });
});
