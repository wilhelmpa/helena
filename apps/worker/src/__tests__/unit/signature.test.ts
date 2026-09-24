import { describe, it, expect } from 'bun:test';
import { createHmac } from 'node:crypto';
import { signPayload, standardWebhookSignature } from '../../signature';
import { isRetryableStatus } from '../../delivery';

describe('signPayload', () => {
  it('produces t=<ts>,v1=<hmac> over `${ts}.${body}`', () => {
    const secret = 'whsec_test';
    const body = JSON.stringify({ a: 1 });
    const ts = 1_700_000_000;
    const expected = createHmac('sha256', secret).update(`${ts}.${body}`).digest('hex');
    expect(signPayload(secret, ts, body)).toBe(`t=${ts},v1=${expected}`);
  });

  it('changes when the body changes', () => {
    expect(signPayload('s', 1, '{}')).not.toBe(signPayload('s', 1, '{ }'));
  });

  it('changes when the secret changes', () => {
    expect(signPayload('a', 1, '{}')).not.toBe(signPayload('b', 1, '{}'));
  });
});

describe('isRetryableStatus', () => {
  it('retries 408, 429, and 5xx', () => {
    for (const s of [408, 429, 500, 502, 503]) expect(isRetryableStatus(s)).toBe(true);
  });

  it('does not retry other 4xx', () => {
    for (const s of [400, 401, 403, 404, 410, 422]) expect(isRetryableStatus(s)).toBe(false);
  });
});

describe('standardWebhookSignature', () => {
  it('verifies with the Standard Webhooks library, as a receiver would', async () => {
    const { Webhook } = await import('standardwebhooks');
    const secret = `whsec_${'ab12'.repeat(12)}`;
    const body = JSON.stringify({ action: 'create', type: 'Issue', data: { id: 1 } });
    const ts = Math.floor(Date.now() / 1000);
    const id = '6a0b7c4e-1111-4222-8333-944455556666';
    const headers = {
      'webhook-id': id,
      'webhook-timestamp': String(ts),
      'webhook-signature': standardWebhookSignature(secret, id, ts, body),
    };
    expect(new Webhook(secret).verify(body, headers)).toEqual(JSON.parse(body));
    expect(() => new Webhook(secret).verify(body.replace('Issue', 'Comment'), headers)).toThrow();
  });
});
