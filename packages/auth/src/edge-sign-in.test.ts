import { describe, expect, it } from 'bun:test';
import { EDGE_SESSION_MAX_MS, edgeEntryAuthorized, edgeSessionExpiry } from './edge-sign-in';

const proof = 'test-only-edge-entry-proof-0123456789abcdef';

describe('the tunnel entry proof', () => {
  it('is off without a configured proof', () => {
    expect(edgeEntryAuthorized(new Headers({ 'x-helena-edge-entry': proof }), {})).toBe(false);
    expect(
      edgeEntryAuthorized(new Headers({ 'x-helena-edge-entry': 'short' }), {
        HELENA_EDGE_ENTRY_TOKEN: 'short',
      }),
    ).toBe(false);
  });

  it('needs exactly the configured value', () => {
    const env = { HELENA_EDGE_ENTRY_TOKEN: proof };
    for (const supplied of ['', 'wrong', proof + 'x', 'ö'.repeat(proof.length)]) {
      expect(edgeEntryAuthorized(new Headers({ 'x-helena-edge-entry': supplied }), env)).toBe(
        false,
      );
    }
    expect(edgeEntryAuthorized(new Headers(), env)).toBe(false);
    expect(edgeEntryAuthorized(new Headers({ 'x-helena-edge-entry': proof }), env)).toBe(true);
  });
});

describe('the session the Cloudflare sign-in opens', () => {
  const now = Date.UTC(2026, 8, 25, 12);
  const identity = (expiresAt: Date | null) => ({
    provider: 'cloudflare-access',
    email: 'owner@example.com',
    expiresAt,
  });

  it('ends with the Access session when that ends first', () => {
    const access = new Date(now + 2 * 3600_000);
    expect(edgeSessionExpiry(identity(access), now).valueOf()).toBe(access.valueOf());
  });

  it('never lasts longer than a day', () => {
    const far = new Date(now + 7 * 24 * 3600_000);
    expect(edgeSessionExpiry(identity(far), now).valueOf()).toBe(now + EDGE_SESSION_MAX_MS);
    expect(edgeSessionExpiry(identity(null), now).valueOf()).toBe(now + EDGE_SESSION_MAX_MS);
    // An end that just passed (inside the clock tolerance) gives a minute, never a day.
    expect(edgeSessionExpiry(identity(new Date(now - 1000)), now).valueOf()).toBe(now + 60_000);
  });
});
